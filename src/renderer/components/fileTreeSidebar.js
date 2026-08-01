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
import { h, debounce } from '../utils/dom.js';
import { applySavedWidth, makeResizeHandle } from '../utils/resizableSidebar.js';
import { svgIcon } from '../utils/icons.js';
import { fileIconEl, folderIconEl, setFolderIcon } from '../core/fileIcons.js';
import { state } from '../core/state.js';
import { bus } from '../core/eventBus.js';
import { openModal, closeModal, confirmModal } from './modal.js';
import { toast } from './toast.js';
import { TileFactory } from './tile.js';
import { isMediaFile, mountMediaView, renderTextInto } from './fileViewer.js';

let panelEl = null;
let headerEl = null;
let searchInput = null;
let treeEl = null;
let resultsEl = null;
let isOpen = false;

/* ---------- Estado del árbol ---------- */
// La expansión vive acá y no en cada fila para que se pueda reconstruir el
// árbol entero (refrescar) sin perder qué carpetas estaban abiertas, y para
// que "colapsar todo" sea un solo `clear()`.
const expandedPaths = new Set();

// relPath de carpeta -> contenedor de sus hijos. Se repuebla en cada render;
// lo usa la creación inline para saber dónde insertar el input.
const containers = new Map();

// Entrada seleccionada: define dónde se crea un archivo/carpeta nuevo
// (misma regla que VSCode: dentro de la carpeta seleccionada, o junto al
// archivo seleccionado). `null` = raíz del workspace.
let selectedRel = null;
let selectedIsDir = false;
let selectedRowEl = null;

// Las relPath vienen del proceso main armadas con `path.join`, así que en
// Windows usan "\" y en el resto "/". Se parsean con ambos separadores y se
// arman siempre con "/" (path.resolve del main entiende los dos).
function parentDirOf(relPath) {
  const parts = relPath.split(/[\\/]/);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
}

/** Carpeta destino para crear: la seleccionada, la del archivo seleccionado, o la raíz. */
function targetDir() {
  if (!selectedRel) return '.';
  return selectedIsDir ? selectedRel : parentDirOf(selectedRel);
}

const WIDTH_OPTS = {
  storageKey: 'yusepe:file-tree-width',
  edge: 'right',
  min: 200,
  max: 640,
  defaultWidth: 288,
};

export function initFileTreeSidebar() {
  panelEl = document.getElementById('file-tree-sidebar');
  if (!panelEl) return;

  applySavedWidth(panelEl, WIDTH_OPTS);
  buildChrome();

  // El árbol nuevo es de otro workspace: la expansión/selección anterior no
  // significan nada acá.
  bus.on('profile:loaded', () => { resetTreeState(); if (isOpen) resetToTree(); });
  bus.on('profile:cleared', closeSidebar);
  bus.on('workspace:left', closeSidebar);
  // Un tile de archivo pide abrir el modal (para editar). Va por el bus
  // porque fileTile.js no puede importar este módulo sin cerrar un ciclo.
  bus.on('file:open-modal', (entry) => openFileModal(entry));
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
    actionBtn('file-plus', 'Nuevo archivo', () => startInlineCreate(false)),
    actionBtn('folder-plus', 'Nueva carpeta', () => startInlineCreate(true)),
    actionBtn('refresh', 'Refrescar', refreshTree),
    actionBtn('collapse', 'Colapsar todo', collapseAll),
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

  panelEl.append(headerEl, searchInput, treeEl, resultsEl, makeResizeHandle({ panel: panelEl, ...WIDTH_OPTS }));
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
  return renderTree();
}

/** Olvida expansión y selección — al cambiar de workspace no aplican más. */
function resetTreeState() {
  expandedPaths.clear();
  containers.clear();
  selectedRel = null;
  selectedIsDir = false;
  selectedRowEl = null;
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
  containers.clear();
  containers.set('.', treeEl);
  await renderChildrenInto(treeEl, '.', 0);
}

/**
 * Llena `container` con las entradas de `relPath`, bajando sola por las
 * carpetas que estén en `expandedPaths`. Eso es lo que hace que refrescar
 * reconstruya el árbol con la misma forma que tenía abierta.
 *
 * `_depth` queda guardado en el contenedor porque la creación inline lo
 * necesita para indentar su input a la altura de los hermanos.
 */
async function renderChildrenInto(container, relPath, depth) {
  container._loaded = true;
  container._depth = depth;

  const entries = await loadChildren(relPath);
  container.innerHTML = '';

  if (!Array.isArray(entries)) {
    container.append(h('p', { class: 'text-red-400 text-xs px-1' },
      entries.error || 'No se pudo leer la carpeta.'));
    return;
  }

  for (const entry of entries) {
    const { row, container: childEl } = renderEntry(entry, depth);
    container.append(row, childEl);
    if (entry.isDir && expandedPaths.has(entry.relPath)) {
      await renderChildrenInto(childEl, entry.relPath, depth + 1);
    }
  }
}

function renderEntry(entry, depth) {
  const expanded = entry.isDir && expandedPaths.has(entry.relPath);
  const arrow = h('span', { class: 'w-3 text-fg-subtle shrink-0 inline-block text-center' },
    entry.isDir ? (expanded ? '▾' : '▸') : '');
  const icon = entry.isDir ? folderIconEl(entry.name, expanded) : fileIconEl(entry.name);
  const row = h('div', {
    class: 'flex items-center gap-1 rounded hover:bg-bg-elev cursor-pointer truncate text-xs',
    style: `padding: 3px 6px 3px ${6 + depth * 12}px`,
    title: entry.name,
  }, [arrow, icon, h('span', { class: 'truncate' }, entry.name)]);

  const childrenEl = h('div', { class: expanded ? '' : 'hidden' });
  if (entry.isDir) containers.set(entry.relPath, childrenEl);

  // Reengancha el resaltado tras un re-render (el row viejo ya no existe).
  if (entry.relPath === selectedRel) {
    selectedRowEl = row;
    row.classList.add('bg-accent/15');
  }

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    selectEntry(entry, row);
    openContextMenu(entry, row);
  });

  row.addEventListener('click', async () => {
    selectEntry(entry, row);
    if (!entry.isDir) {
      openFileModal(entry);
      return;
    }
    const nowExpanded = !expandedPaths.has(entry.relPath);
    if (nowExpanded) expandedPaths.add(entry.relPath);
    else expandedPaths.delete(entry.relPath);
    arrow.textContent = nowExpanded ? '▾' : '▸';
    setFolderIcon(icon, nowExpanded);
    childrenEl.classList.toggle('hidden', !nowExpanded);
    if (nowExpanded && !childrenEl._loaded) {
      await renderChildrenInto(childrenEl, entry.relPath, depth + 1);
    }
  });

  return { row, container: childrenEl };
}

function selectEntry(entry, row) {
  if (selectedRowEl) selectedRowEl.classList.remove('bg-accent/15');
  selectedRel = entry?.relPath || null;
  selectedIsDir = !!entry?.isDir;
  selectedRowEl = row || null;
  if (selectedRowEl) selectedRowEl.classList.add('bg-accent/15');
}

/* ===================== Acciones de la cabecera ===================== */

function actionBtn(icon, title, onClick) {
  return h('button', {
    class: 'inline-flex items-center justify-center rounded p-1 shrink-0 text-fg-muted hover:text-fg hover:bg-bg-elev transition',
    title,
    onClick,
  }, svgIcon(icon, { size: 14 }));
}

/** Relee el árbol desde disco conservando qué carpetas estaban abiertas. */
function refreshTree() {
  return resetToTree();
}

function collapseAll() {
  expandedPaths.clear();
  return resetToTree();
}

/**
 * Input inline en el árbol para crear archivo/carpeta (estilo VSCode).
 * Es inline y no un modal a propósito: el pedido era justamente no tener
 * que salir del panel para crear un archivo.
 *
 * Acepta nombres anidados ("utils/foo.js"): las carpetas intermedias las
 * crea el proceso main (ver createEntry en explorerFs.js).
 */
let inlineRowEl = null;
// Al renombrar se oculta la fila original: hay que volver a mostrarla si se
// cancela. Crear no necesita restaurar nada, así que queda en null.
let inlineRestore = null;

function cancelInline() {
  if (inlineRowEl) inlineRowEl.remove();
  inlineRowEl = null;
  if (inlineRestore) {
    inlineRestore();
    inlineRestore = null;
  }
}

async function startInlineCreate(isDir) {
  if (!state.profile) return;
  cancelInline();

  // Si estábamos viendo resultados de búsqueda el árbol está oculto.
  if (searchInput.value.trim()) await resetToTree();

  const dirRel = targetDir();

  // El input se inserta dentro del contenedor de la carpeta destino, así que
  // esa carpeta tiene que estar expandida y cargada. Re-renderizar es lo más
  // simple y deja flechas/iconos consistentes de paso.
  if (dirRel !== '.' && (!expandedPaths.has(dirRel) || !containers.has(dirRel))) {
    expandedPaths.add(dirRel);
    await renderTree();
  }

  const container = containers.get(dirRel) || treeEl;
  const depth = container._depth ?? 0;

  const input = h('input', {
    type: 'text',
    spellcheck: false,
    placeholder: isDir ? 'nombre-de-carpeta' : 'nombre-de-archivo.js',
    class: 'flex-1 min-w-0 bg-bg-elev border border-accent rounded px-1 py-0.5 text-xs focus:outline-none',
  });

  inlineRowEl = h('div', {
    class: 'flex items-center gap-1 text-xs',
    style: `padding: 3px 6px 3px ${6 + depth * 12}px`,
  }, [
    h('span', { class: 'w-3 shrink-0' }),
    svgIcon(isDir ? 'folder-plus' : 'file-plus', { size: 14 }),
    input,
  ]);

  container.prepend(inlineRowEl);
  input.focus();

  // `done` corta el doble commit (Enter dispara blur) y le avisa al blur que
  // ya no tiene que cancelar nada.
  let done = false;

  async function commit() {
    if (done) return;
    const name = input.value.trim();
    if (!name) {
      done = true;
      cancelInline();
      return;
    }
    done = true;
    input.disabled = true;

    try {
      const created = await window.yusepe.explorer.create(
        currentRoot(), dirRel === '.' ? name : `${dirRel}/${name}`, isDir);
      cancelInline();
      selectedRel = created.relPath;
      selectedIsDir = created.isDir;
      if (isDir) expandedPaths.add(created.relPath);
      await renderTree();
      toast.success(`Se creó "${created.name}"`);
    } catch (err) {
      // Nombre inválido/repetido: el input queda abierto con lo tipeado
      // para corregirlo sin volver a empezar.
      done = false;
      input.disabled = false;
      input.focus();
      toast.error(err?.message || String(err));
    }
  }

  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // que los atajos globales no se coman el tipeo
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done = true;
      cancelInline();
    }
  });
  // Salir del input sin confirmar cancela (mismo criterio que VSCode).
  input.addEventListener('blur', () => {
    if (!done) {
      done = true;
      cancelInline();
    }
  });
}

/**
 * Renombrado inline: mismo input que crear, pero sobre la fila existente
 * (se oculta y el input toma su lugar, a su misma indentación).
 */
async function startInlineRename(entry, row) {
  cancelInline();

  const input = h('input', {
    type: 'text',
    spellcheck: false,
    class: 'flex-1 min-w-0 bg-bg-elev border border-accent rounded px-1 py-0.5 text-xs focus:outline-none',
  });
  input.value = entry.name;

  inlineRowEl = h('div', {
    class: 'flex items-center gap-1 text-xs',
    style: `padding: ${row.style.padding}`,
  }, [
    h('span', { class: 'w-3 shrink-0' }),
    entry.isDir ? folderIconEl(entry.name, false) : fileIconEl(entry.name),
    input,
  ]);

  row.before(inlineRowEl);
  row.classList.add('hidden');
  inlineRestore = () => row.classList.remove('hidden');

  input.focus();
  // Preselecciona solo el nombre, sin la extensión (igual que VSCode/Finder):
  // lo más común es cambiar el nombre y conservar el tipo de archivo.
  const dot = entry.isDir ? -1 : entry.name.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);

  let done = false;

  async function commit() {
    if (done) return;
    const newName = input.value.trim();
    if (!newName || newName === entry.name) {
      done = true;
      cancelInline();
      return;
    }
    done = true;
    input.disabled = true;

    try {
      const renamed = await window.yusepe.explorer.rename(currentRoot(), entry.relPath, newName);
      inlineRestore = null; // la fila vieja se va con el re-render
      cancelInline();
      remapExpanded(entry.relPath, renamed.relPath);
      selectedRel = renamed.relPath;
      selectedIsDir = renamed.isDir;
      await renderTree();
      toast.success(`Renombrado a "${renamed.name}"`);
    } catch (err) {
      done = false;
      input.disabled = false;
      input.focus();
      toast.error(err?.message || String(err));
    }
  }

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done = true;
      cancelInline();
    }
  });
  input.addEventListener('blur', () => {
    if (!done) {
      done = true;
      cancelInline();
    }
  });
}

/* ===================== Menú contextual ===================== */
// El menú lo dibuja macOS (Electron Menu.popup vía IPC): el renderer manda
// el template y recibe el id elegido. Ver el handler 'menu:popup' en
// src/main/ipc.js.

/** Al renombrar una carpeta cambian las relPath de todo lo que cuelga de ella. */
function remapExpanded(oldRel, newRel) {
  for (const p of [...expandedPaths]) {
    if (p === oldRel || p.startsWith(oldRel + '/') || p.startsWith(oldRel + '\\')) {
      expandedPaths.delete(p);
      expandedPaths.add(newRel + p.slice(oldRel.length));
    }
  }
}

/** Al borrar/mover una carpeta, su expansión (y la de sus hijos) ya no aplica. */
function pruneExpanded(rel) {
  for (const p of [...expandedPaths]) {
    if (p === rel || p.startsWith(rel + '/') || p.startsWith(rel + '\\')) expandedPaths.delete(p);
  }
}

async function openContextMenu(entry, row) {
  const items = [
    { id: 'rename', label: 'Renombrar' },
    { id: 'duplicate', label: 'Duplicar' },
    { id: 'trash', label: 'Eliminar' },
    { type: 'separator' },
    { id: 'copy-rel', label: 'Copiar ruta relativa' },
    { id: 'copy-abs', label: 'Copiar ruta absoluta' },
    { type: 'separator' },
    { id: 'new-file', label: 'Nuevo archivo acá' },
    { id: 'new-folder', label: 'Nueva carpeta acá' },
    { type: 'separator' },
    { id: 'reveal', label: 'Revelar en Finder' },
  ];
  if (!entry.isDir) {
    items.splice(items.length - 1, 0, { id: 'open-system', label: 'Abrir con la app del sistema' });
  }

  const picked = await window.yusepe.menu.popup(items);
  if (!picked) return;

  try {
    await runContextAction(picked, entry, row);
  } catch (err) {
    toast.error(err?.message || String(err));
  }
}

async function runContextAction(action, entry, row) {
  const root = currentRoot();

  switch (action) {
    case 'rename':
      return startInlineRename(entry, row);

    case 'duplicate': {
      const copy = await window.yusepe.explorer.duplicate(root, entry.relPath);
      selectedRel = copy.relPath;
      selectedIsDir = copy.isDir;
      await renderTree();
      return toast.success(`Se creó "${copy.name}"`);
    }

    case 'trash': {
      const confirmed = await confirmModal({
        title: 'Eliminar',
        body: `¿Enviar "${entry.name}" a la Papelera?${entry.isDir ? ' Se va con todo su contenido.' : ''}`,
        confirmLabel: 'Eliminar',
        danger: true,
      });
      if (!confirmed) return;
      await window.yusepe.explorer.trash(root, entry.relPath);
      pruneExpanded(entry.relPath);
      if (selectedRel === entry.relPath) selectEntry(null, null);
      await renderTree();
      return toast.success(`"${entry.name}" fue a la Papelera`);
    }

    case 'copy-rel':
      await window.yusepe.clipboard.writeText(entry.relPath);
      return toast.success('Ruta relativa copiada');

    case 'copy-abs': {
      const abs = await window.yusepe.explorer.absPath(root, entry.relPath);
      await window.yusepe.clipboard.writeText(abs);
      return toast.success('Ruta absoluta copiada');
    }

    // La selección ya la fijó el contextmenu, así que targetDir() apunta a
    // la carpeta correcta (la propia si es carpeta, la del padre si es archivo).
    case 'new-file':
      return startInlineCreate(false);
    case 'new-folder':
      return startInlineCreate(true);

    case 'reveal':
      return window.yusepe.explorer.reveal(root, entry.relPath);
    case 'open-system':
      return window.yusepe.explorer.openInSystem(root, entry.relPath);
  }
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
// El renderizado del contenido vive en fileViewer.js, compartido con el
// tile fijado (fileTile.js) — acá arriba queda solo lo propio del modal:
// la barra de acciones, la edición y "Fijar".

export async function openFileModal(entry) {
  const toolbar = h('div', { class: 'flex items-center gap-2 mb-2 min-h-[1.75rem]' });
  const contentArea = h('div', {}, [h('p', { class: 'text-fg-subtle text-xs' }, 'Cargando…')]);
  const body = h('div', {}, [toolbar, contentArea]);
  openModal({ title: entry.name, body, size: 'lg' });

  // Fijar el archivo como tile: cierra el modal (si no, queda flotando
  // encima del tile recién creado) y deja el mosaico enfocado.
  const pinBtn = () => h('button', {
    class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition',
    title: 'Dejar este archivo fijo en el espacio de trabajo',
    onClick: async () => {
      try {
        await TileFactory.file(entry);
        closeModal();
        toast.success(`"${entry.name}" fijado en el espacio`);
      } catch (err) {
        toast.error(err?.message || String(err));
      }
    },
  }, [svgIcon('pin', { size: 13 }), h('span', {}, 'Fijar')]);

  if (isMediaFile(entry.name)) {
    toolbar.append(
      h('button', {
        class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition',
        onClick: () => window.yusepe.explorer.openInSystem(currentRoot(), entry.relPath),
      }, [svgIcon('external', { size: 13 }), h('span', {}, 'Abrir con la app del sistema')]),
      pinBtn(),
    );
    await mountMediaView(contentArea, entry, { root: currentRoot() });
    return;
  }

  let raw = '';
  let editing = false;
  let saveError = '';

  function renderToolbar() {
    toolbar.innerHTML = '';
    if (!editing) {
      toolbar.append(
        h('button', {
          class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition',
          onClick: () => { editing = true; saveError = ''; renderView(); renderToolbar(); },
        }, [svgIcon('edit', { size: 13 }), h('span', {}, 'Editar')]),
        pinBtn(),
      );
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
      // Los tiles fijados de este mismo archivo quedaron desactualizados.
      bus.emit('file:changed', { relPath: entry.relPath });
    } catch (err) {
      saveError = `No se pudo guardar: ${err?.message || err}`;
      renderToolbar();
    }
  }

  function renderView() {
    if (!editing) {
      renderTextInto(contentArea, { name: entry.name, raw });
      return;
    }
    contentArea.innerHTML = '';
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
