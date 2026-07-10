/**
 * src/renderer/components/quickOpenFile.js
 * --------------------------------------------------------------
 * Quick Open de archivos (Cmd/Ctrl+P), estilo VSCode: un buscador
 * fuzzy para saltar directo a cualquier archivo del workspace activo
 * sin navegar el árbol carpeta por carpeta. El Command Palette de
 * acciones/workspaces/tiles se movió a Cmd/Ctrl+Shift+P.
 *
 * Reutiliza el backend recursivo del explorador
 * (`window.yusepe.explorer.search`, mismo que usa el buscador del
 * árbol lateral) y abre el archivo con el mismo modal de preview/edición
 * (`openFileModal` de fileTreeSidebar.js). El ranking se hace acá en el
 * cliente: coincidencia exacta > prefijo > match en el nombre > ruta más
 * corta, para que lo más probable quede arriba.
 * --------------------------------------------------------------
 */
import { h, debounce } from '../utils/dom.js';
import { fileIconEl } from '../core/fileIcons.js';
import { openModal, closeModal } from './modal.js';
import { openFileModal, currentRoot } from './fileTreeSidebar.js';

const RESULT_LIMIT = 50;

/** Ordena los resultados del backend por relevancia respecto a la query. */
function rankResults(results, q) {
  const ql = q.toLowerCase();
  return results
    .map((r) => {
      const name = r.name.toLowerCase();
      const path = r.relPath.toLowerCase();
      let score = 0;
      if (name === ql) score = 100;
      else if (name.startsWith(ql)) score = 80;
      else if (name.includes(ql)) score = 60;
      else if (path.includes(ql)) score = 30;
      // Empate: rutas más cortas (menos profundas) primero.
      score -= r.relPath.length * 0.05;
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, RESULT_LIMIT);
}

export function openQuickOpenFile() {
  const root = currentRoot();

  const input = h('input', {
    type: 'text',
    placeholder: root ? 'Ir a archivo…' : 'Abrí un workspace primero',
    disabled: !root,
    class: 'w-full bg-bg-elev border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent',
  });
  const list = h('div', { class: 'mt-2 max-h-[50vh] overflow-y-auto' });

  let results = [];
  let selected = 0;
  let reqId = 0;
  let rows = [];
  // Mientras navegás con teclado ignoramos el hover: reordenar/scrollear la
  // lista dispara `mouseenter` en la fila que queda bajo el cursor quieto, y
  // eso pisaría la selección de las flechas. Se rehabilita al mover el mouse.
  let usingKeyboard = false;

  const rowClass = (active) =>
    `flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm transition ${
      active ? 'bg-accent/20 text-fg' : 'text-fg-soft hover:bg-bg-elev'
    }`;

  openModal({ title: 'Ir a archivo', body: h('div', {}, [input, list]), size: 'md' });
  renderEmpty();
  setTimeout(() => input.focus(), 0);

  const runSearch = debounce(async () => {
    const q = input.value.trim();
    const myReq = ++reqId;
    if (!q || !root) { results = []; selected = 0; renderEmpty(); return; }
    let raw = [];
    try {
      raw = await window.yusepe.explorer.search(root, q);
    } catch {
      raw = [];
    }
    // Descartá respuestas viejas si el usuario ya siguió tecleando.
    if (myReq !== reqId) return;
    results = rankResults(raw, q);
    selected = 0;
    render();
  }, 160);

  input.addEventListener('input', runSearch);

  // Listener a nivel document (captura) para que las flechas/Enter funcionen
  // aunque el input pierda el foco. Se auto-remueve cuando el modal se cierra
  // (el input deja de estar en el DOM).
  function onKeyDown(e) {
    if (!document.body.contains(input)) {
      document.removeEventListener('keydown', onKeyDown, true);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); open(results[selected]); }
  }
  document.addEventListener('keydown', onKeyDown, true);

  list.addEventListener('mousemove', () => { usingKeyboard = false; });

  function open(entry) {
    if (!entry) return;
    closeModal();
    openFileModal(entry);
  }

  /** Mueve la selección sin reconstruir la lista (sólo actualiza clases). */
  function moveSelection(delta) {
    if (!results.length) return;
    usingKeyboard = true;
    selected = Math.max(0, Math.min(selected + delta, results.length - 1));
    applyActive(true);
  }

  /** Refleja `selected` en las filas ya montadas — nunca reemplaza nodos. */
  function applyActive(scroll = false) {
    rows.forEach((row, i) => { row.className = rowClass(i === selected); });
    if (scroll && rows[selected]) rows[selected].scrollIntoView({ block: 'nearest' });
  }

  function renderEmpty() {
    list.innerHTML = '';
    rows = [];
    const msg = root ? 'Escribí para buscar un archivo…' : 'No hay ningún workspace activo.';
    list.append(h('p', { class: 'text-fg-subtle text-xs py-4 text-center' }, msg));
  }

  function render() {
    list.innerHTML = '';
    rows = [];
    if (!results.length) {
      list.append(h('p', { class: 'text-fg-subtle text-xs py-4 text-center' }, 'Sin resultados.'));
      return;
    }
    results.forEach((entry, i) => {
      // relPath sin el nombre = carpeta contenedora (dimmed).
      const dir = entry.relPath.slice(0, entry.relPath.length - entry.name.length).replace(/\/$/, '');
      const row = h('div', {
        class: rowClass(i === selected),
        onClick: () => open(entry),
        // Sólo actualiza la selección; NO reconstruye la lista. Ignorado si
        // venís navegando con teclado (mouseenter fantasma por scroll).
        onMouseenter: () => { if (usingKeyboard) return; selected = i; applyActive(); },
      }, [
        h('span', { class: 'w-5 flex justify-center shrink-0' }, fileIconEl(entry.name, 15)),
        h('span', { class: 'shrink-0 truncate max-w-[55%]' }, entry.name),
        dir ? h('span', { class: 'text-[10px] text-fg-subtle truncate flex-1 min-w-0' }, dir) : null,
      ]);
      rows.push(row);
      list.append(row);
    });
  }
}
