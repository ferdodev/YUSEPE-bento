/**
 * src/renderer/components/fileTreeSidebar.js
 * --------------------------------------------------------------
 * Panel lateral fijo con el árbol de archivos del workspace activo,
 * por encima del Bento Grid (no es un tile — no compite por espacio
 * en la grilla). Se abre/cierra con el botón 🗂 de la topbar o la X
 * propia del panel. Incluye buscador (recursivo, vía IPC) para saltar
 * directo a un archivo sin navegar el árbol carpeta por carpeta.
 *
 * Al hacer click en un archivo, el contenido se muestra en un modal
 * grande con resaltado de sintaxis (highlight.js) — Markdown se
 * renderiza con `marked` (los bloques de código dentro también se
 * resaltan), el resto se muestra como código con su lenguaje detectado
 * por extensión.
 * --------------------------------------------------------------
 */
import { marked } from 'marked';
// Build "legacy" a propósito: apunta a runtimes más viejos y evita APIs
// muy nuevas (p.ej. Uint8Array.prototype.toHex) que el Chromium de
// Electron 33 todavía no trae. Con el build normal daba "a.toHex is not a
// function". Igual usamos pdfjs-dist v4 (v6 asume runtimes aún más nuevos).
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { h, debounce } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { fileIconEl, folderIconEl, setFolderIcon } from '../core/fileIcons.js';
import { state } from '../core/state.js';
import { bus } from '../core/eventBus.js';
import { openModal } from './modal.js';
import { highlightCode, languageForFilename } from '../core/codeHighlight.js';

// El visor de PDF nativo de Chromium no coopera con archivos locales fuera
// de http(s):// — en vez de pelear con eso, renderizamos el PDF nosotros
// mismos con pdf.js, página por página, en <canvas>, a partir de los bytes
// que leemos por IPC (ver openMediaPreview). Evita por completo el visor
// nativo y todos los líos de esquema/CORS.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
const MAX_PDF_PAGES_RENDERED = 30;

const MARKDOWN_RE = /\.(md|markdown)$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|ico)$/i;
const PDF_RE = /\.pdf$/i;
const SVG_RE = /\.svg$/i;
const CSV_RE = /\.csv$/i;

/** Parser CSV simple: soporta comillas con comas/comillas escapadas dentro. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// Los bloques de código dentro de Markdown también pasan por highlight.js.
marked.use({
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').split(/\s+/)[0] || null;
      const html = highlightCode(text, language);
      return `<pre class="hljs"><code>${html}</code></pre>\n`;
    },
  },
});

let panelEl = null;
let headerEl = null;
let searchInput = null;
let treeEl = null;
let resultsEl = null;
let isOpen = false;

const WIDTH_KEY = 'yusepe:file-tree-width';
const WIDTH_MIN = 200;
const WIDTH_MAX = 640;
const WIDTH_DEFAULT = 288;

function applySavedWidth() {
  const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10);
  const w = Number.isFinite(saved) ? Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, saved)) : WIDTH_DEFAULT;
  panelEl.style.width = w + 'px';
}

/** Handle de redimensionado en el borde derecho (estilo VSCode). */
function makeResizeHandle() {
  const handle = h('div', { class: 'file-tree-resize-handle', title: 'Arrastrá para redimensionar' });
  let startX = 0;
  let startW = 0;

  const onMove = (e) => {
    const w = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, startW + (e.clientX - startX)));
    panelEl.style.width = w + 'px';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('resizing-sidebar');
    localStorage.setItem(WIDTH_KEY, String(Math.round(panelEl.getBoundingClientRect().width)));
  };
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = panelEl.getBoundingClientRect().width;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.classList.add('resizing-sidebar');
  });
  // Doble click: restablece el ancho por defecto.
  handle.addEventListener('dblclick', () => {
    panelEl.style.width = WIDTH_DEFAULT + 'px';
    localStorage.setItem(WIDTH_KEY, String(WIDTH_DEFAULT));
  });
  return handle;
}

export function initFileTreeSidebar() {
  panelEl = document.getElementById('file-tree-sidebar');
  if (!panelEl) return;

  applySavedWidth();
  buildChrome();

  bus.on('profile:loaded', () => { if (isOpen) resetToTree(); });
  bus.on('profile:cleared', closeSidebar);
  bus.on('workspace:left', closeSidebar);
}

export function isFileTreeSidebarOpen() {
  return isOpen;
}

export function toggleFileTreeSidebar() {
  if (!state.profile) return;
  if (isOpen) closeSidebar();
  else openSidebar();
}

function buildChrome() {
  panelEl.innerHTML = '';

  const closeBtn = h('button', {
    class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg px-1 shrink-0',
    title: 'Cerrar árbol de archivos',
    onClick: closeSidebar,
  }, svgIcon('close', { size: 15 }));

  const rootLabel = h('div', { class: 'text-[10px] text-fg-subtle truncate flex-1 min-w-0' }, '');

  headerEl = h('div', { class: 'flex items-center gap-1.5 px-2 py-1.5 border-b border-line' }, [
    rootLabel,
    closeBtn,
  ]);

  searchInput = h('input', {
    type: 'text',
    placeholder: 'Buscar archivo…',
    class: 'w-full bg-bg-elev border border-line rounded-md px-2 py-1 text-xs mx-2 mt-2 focus:outline-none focus:ring-1 focus:ring-accent',
    style: 'width: calc(100% - 1rem)',
  });
  searchInput.addEventListener('input', debounce(onSearchInput, 200));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); searchInput.value = ''; resetToTree(); } });

  treeEl = h('div', { class: 'flex-1 overflow-y-auto text-xs py-2 px-1' });
  resultsEl = h('div', { class: 'hidden flex-1 overflow-y-auto text-xs py-2 px-1' });

  panelEl.append(headerEl, searchInput, treeEl, resultsEl, makeResizeHandle());
  panelEl.classList.add('flex', 'flex-col');

  // Guarda referencia al label del root para actualizarlo en cada render.
  panelEl._rootLabel = rootLabel;
}

let closeTimer = null;

function openSidebar() {
  if (!panelEl) return;
  isOpen = true;
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  panelEl.classList.remove('hidden');
  // Fuerza un reflow para que la transición desde translateX(-100%) se
  // reproduzca en vez de saltar directo al estado final.
  void panelEl.offsetWidth;
  panelEl.classList.add('sidebar-open');
  resetToTree();
}

function closeSidebar() {
  if (!panelEl) return;
  isOpen = false;
  panelEl.classList.remove('sidebar-open');
  // Espera a que termine el slide-out antes de sacarlo del layout.
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (!isOpen) panelEl.classList.add('hidden');
    closeTimer = null;
  }, 220);
}

export function currentRoot() {
  return state.profile?.cwd || null;
}

function resetToTree() {
  if (searchInput) searchInput.value = '';
  resultsEl.classList.add('hidden');
  treeEl.classList.remove('hidden');
  renderTree();
}

async function loadChildren(relPath) {
  try {
    return await window.yusepe.explorer.list(currentRoot(), relPath);
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

async function renderTree() {
  if (panelEl._rootLabel) panelEl._rootLabel.textContent = currentRoot() || '(home)';
  treeEl.innerHTML = '';

  const entries = await loadChildren('.');
  if (!Array.isArray(entries)) {
    treeEl.append(h('p', { class: 'text-red-400 text-xs px-1' },
      entries.error || 'No se pudo leer la carpeta.'));
    return;
  }
  for (const entry of entries) {
    const { row, container } = renderEntry(entry, 0);
    treeEl.append(row, container);
  }
}

function renderEntry(entry, depth) {
  const arrow = h('span', { class: 'w-3 text-fg-subtle shrink-0 inline-block text-center' }, entry.isDir ? '▸' : '');
  const icon = entry.isDir ? folderIconEl(entry.name, false) : fileIconEl(entry.name);
  const row = h('div', {
    class: 'flex items-center gap-1 rounded hover:bg-bg-elev cursor-pointer truncate text-xs',
    style: `padding: 3px 6px 3px ${6 + depth * 12}px`,
    title: entry.name,
  }, [arrow, icon, h('span', { class: 'truncate' }, entry.name)]);

  const childrenEl = h('div', { class: 'hidden' });
  let loaded = false;
  let expanded = false;

  row.addEventListener('click', async () => {
    if (!entry.isDir) {
      openFileModal(entry);
      return;
    }
    expanded = !expanded;
    arrow.textContent = expanded ? '▾' : '▸';
    setFolderIcon(icon, expanded);
    childrenEl.classList.toggle('hidden', !expanded);
    if (expanded && !loaded) {
      loaded = true;
      const children = await loadChildren(entry.relPath);
      if (Array.isArray(children)) {
        for (const child of children) {
          const { row: cRow, container: cContainer } = renderEntry(child, depth + 1);
          childrenEl.append(cRow, cContainer);
        }
      } else {
        childrenEl.append(h('p', { class: 'text-red-400 text-[10px] px-2' },
          children.error || 'No se pudo leer la carpeta.'));
      }
    }
  });

  return { row, container: childrenEl };
}

/* ===================== Buscador ===================== */

async function onSearchInput() {
  const query = searchInput.value.trim();
  if (!query) {
    resetToTree();
    return;
  }

  treeEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  resultsEl.innerHTML = '';
  resultsEl.append(h('p', { class: 'text-fg-subtle text-xs px-1' }, 'Buscando…'));

  let results;
  try {
    results = await window.yusepe.explorer.search(currentRoot(), query);
  } catch (err) {
    resultsEl.innerHTML = '';
    resultsEl.append(h('p', { class: 'text-red-400 text-xs px-1' }, err?.message || String(err)));
    return;
  }

  // El usuario pudo haber seguido tipeando/borrado mientras esperábamos.
  if (searchInput.value.trim() !== query) return;

  resultsEl.innerHTML = '';
  if (!results.length) {
    resultsEl.append(h('p', { class: 'text-fg-subtle text-xs px-1' }, 'Sin resultados.'));
    return;
  }
  for (const entry of results) {
    resultsEl.append(h('div', {
      class: 'flex items-center gap-2 rounded hover:bg-bg-elev cursor-pointer px-2 py-1.5',
      title: entry.relPath,
      onClick: () => openFileModal(entry),
    }, [
      entry.isDir ? folderIconEl(entry.name, false) : fileIconEl(entry.name),
      h('div', { class: 'min-w-0 flex-1' }, [
        h('div', { class: 'truncate' }, entry.name),
        h('div', { class: 'text-[10px] text-fg-subtle truncate' }, entry.relPath),
      ]),
    ]));
  }
}

/* ===================== Preview en modal (view + edición) ===================== */

export async function openFileModal(entry) {
  const toolbar = h('div', { class: 'flex items-center gap-2 mb-2 min-h-[1.75rem]' });
  const contentArea = h('div', {}, [h('p', { class: 'text-fg-subtle text-xs' }, 'Cargando…')]);
  const body = h('div', {}, [toolbar, contentArea]);
  openModal({ title: entry.name, body, size: 'lg' });

  if (IMAGE_RE.test(entry.name) || PDF_RE.test(entry.name)) {
    toolbar.append(h('button', {
      class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition',
      onClick: () => window.yusepe.explorer.openInSystem(currentRoot(), entry.relPath),
    }, [svgIcon('external', { size: 13 }), h('span', {}, 'Abrir con la app del sistema')]));
    await openMediaPreview(entry, contentArea);
    return;
  }

  const isMarkdown = MARKDOWN_RE.test(entry.name);
  const isSvg = SVG_RE.test(entry.name);
  const isCsv = CSV_RE.test(entry.name);
  const lang = languageForFilename(entry.name);
  let raw = '';
  let editing = false;
  let saveError = '';

  function renderToolbar() {
    toolbar.innerHTML = '';
    if (!editing) {
      toolbar.append(h('button', {
        class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition',
        onClick: () => { editing = true; saveError = ''; renderView(); renderToolbar(); },
      }, [svgIcon('edit', { size: 13 }), h('span', {}, 'Editar')]));
    } else {
      toolbar.append(
        h('button', {
          class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-accent hover:bg-accent-soft text-white transition',
          onClick: saveEdit,
        }, [svgIcon('save', { size: 13 }), h('span', {}, 'Guardar')]),
        h('button', {
          class: 'text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition',
          onClick: () => { editing = false; saveError = ''; renderView(); renderToolbar(); },
        }, 'Cancelar'),
        h('span', { class: 'text-[10px] text-fg-subtle' }, 'Cmd/Ctrl+S para guardar'),
      );
      if (saveError) {
        toolbar.append(h('span', { class: 'text-[10px] text-red-400' }, saveError));
      }
    }
  }

  async function saveEdit() {
    const textarea = contentArea.querySelector('textarea');
    if (!textarea) return;
    try {
      await window.yusepe.explorer.write(currentRoot(), entry.relPath, textarea.value);
      raw = textarea.value;
      editing = false;
      saveError = '';
      renderView();
      renderToolbar();
    } catch (err) {
      saveError = `No se pudo guardar: ${err?.message || err}`;
      renderToolbar();
    }
  }

  function renderView() {
    contentArea.innerHTML = '';
    if (editing) {
      const textarea = h('textarea', {
        class: 'w-full h-[60vh] bg-bg-elev border border-line rounded-md p-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent resize-none',
        spellcheck: false,
      });
      textarea.value = raw;
      textarea.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault();
          e.stopPropagation();
          saveEdit();
        }
        if (e.key === 'Escape') e.stopPropagation(); // no cerrar el modal sin querer mientras se edita
      });
      contentArea.append(textarea);
      setTimeout(() => textarea.focus(), 0);
    } else if (isMarkdown) {
      const rendered = h('div', { class: 'prose-bento' });
      rendered.innerHTML = marked.parse(raw);
      contentArea.append(rendered);
    } else if (isSvg) {
      const img = h('img', {
        src: `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`,
        class: 'max-w-full max-h-[60vh] mx-auto block bg-white rounded',
        alt: entry.name,
      });
      contentArea.append(h('div', { class: 'p-3 text-center' }, [img]));
    } else if (isCsv) {
      contentArea.append(renderCsvTable(raw));
    } else {
      const pre = h('pre', { class: 'hljs' });
      const code = h('code');
      code.innerHTML = highlightCode(raw, lang);
      pre.append(code);
      contentArea.append(pre);
    }
  }

  try {
    const result = await window.yusepe.explorer.read(currentRoot(), entry.relPath);
    contentArea.innerHTML = '';

    if (result.binary) {
      contentArea.append(h('p', { class: 'text-fg-subtle text-xs' },
        'Archivo binario — no se puede previsualizar ni editar.'));
      return;
    }
    if (result.truncated) {
      contentArea.append(h('p', { class: 'text-fg-subtle text-xs' },
        'Archivo demasiado grande para previsualizar o editar.'));
      return;
    }

    raw = result.content;
    renderView();
    renderToolbar();
  } catch (err) {
    contentArea.innerHTML = '';
    contentArea.append(h('p', { class: 'text-red-400 text-xs' },
      `No se pudo leer "${entry.name}": ${err?.message || err}`));
  }
}

function renderCsvTable(raw) {
  const rows = parseCsv(raw);
  if (!rows.length) return h('p', { class: 'text-fg-subtle text-xs' }, '(csv vacío)');

  const [header, ...body] = rows;
  const wrap = h('div', { class: 'overflow-auto max-h-[60vh]' });
  const table = h('table', { class: 'text-xs w-full border-collapse' }, [
    h('thead', {}, [h('tr', {}, header.map((cell) => h('th', {
      class: 'text-left px-2 py-1 border-b border-line sticky top-0 bg-bg-elev whitespace-nowrap',
    }, cell)))]),
    h('tbody', {}, body.map((r) => h('tr', { class: 'hover:bg-bg-elev' },
      r.map((cell) => h('td', { class: 'px-2 py-1 border-b border-line/50 whitespace-nowrap' }, cell))))),
  ]);
  wrap.append(table);
  return wrap;
}

/** Dibuja cada página del PDF en su propio <canvas>, vía pdf.js, a partir de los bytes. */
async function renderPdfPreview(bytes, contentArea) {
  const wrap = h('div', {
    class: 'flex flex-col items-center gap-3 overflow-auto max-h-[70vh] bg-bg-elev/40 p-3 rounded',
  });
  contentArea.append(wrap);

  // Los bytes vienen del proceso principal vía IPC (ver explorerFs.readMediaBytes)
  // y se le pasan directo a pdf.js como `data` — así pdf.js no tiene que
  // descargar nada, lo que evita todos los líos de esquema/CORS que dan los
  // protocolos custom y el fetch cross-scheme en el renderer.
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pagesToRender = Math.min(pdf.numPages, MAX_PDF_PAGES_RENDERED);

  for (let i = 1; i <= pagesToRender; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = h('canvas', { class: 'shadow bg-white max-w-full' });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrap.append(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }

  if (pdf.numPages > MAX_PDF_PAGES_RENDERED) {
    wrap.append(h('p', { class: 'text-fg-subtle text-xs' },
      `Mostrando las primeras ${MAX_PDF_PAGES_RENDERED} de ${pdf.numPages} páginas — abrí con la app del sistema para verlo completo.`));
  }
}

/** Preview de imágenes/PDF: bytes leídos por IPC (ver explorerFs.readMediaBytes). */
async function openMediaPreview(entry, contentArea) {
  contentArea.innerHTML = '';
  try {
    const { mime, bytes } = await window.yusepe.explorer.readMedia(currentRoot(), entry.relPath);
    // `bytes` llega como Uint8Array (Buffer serializado por IPC).
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    if (mime === 'application/pdf') {
      await renderPdfPreview(data, contentArea);
    } else {
      const blobUrl = URL.createObjectURL(new Blob([data], { type: mime }));
      const img = h('img', {
        src: blobUrl,
        class: 'max-w-full max-h-[70vh] mx-auto block rounded',
        alt: entry.name,
      });
      img.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
      contentArea.append(h('div', { class: 'p-3 text-center' }, [img]));
    }
  } catch (err) {
    contentArea.append(h('p', { class: 'text-red-400 text-xs' },
      `No se pudo leer "${entry.name}": ${err?.message || err}`));
  }
}
