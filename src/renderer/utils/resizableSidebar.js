/**
 * src/renderer/utils/resizableSidebar.js
 * --------------------------------------------------------------
 * Handle de redimensionado para paneles laterales (estilo VSCode).
 *
 * Vive acá y no dentro de un componente porque hay paneles en los dos
 * bordes de la ventana y la única diferencia entre ellos es el signo del
 * arrastre: el del árbol de archivos (izquierda) crece al arrastrar hacia
 * la derecha, y el del loop (derecha) al revés.
 *
 * El ancho se guarda en localStorage por panel, así cada uno recuerda el
 * suyo entre sesiones.
 * --------------------------------------------------------------
 */
import { h } from './dom.js';

/** Ancho guardado, acotado al rango — o el default si no hay nada. */
export function applySavedWidth(panel, { storageKey, min, max, defaultWidth }) {
  const saved = parseInt(localStorage.getItem(storageKey), 10);
  const width = Number.isFinite(saved)
    ? Math.min(max, Math.max(min, saved))
    : defaultWidth;
  panel.style.width = `${width}px`;
}

/**
 * Crea el handle. Hay que agregarlo al panel (que debe ser `relative` o
 * `fixed`, porque el handle se posiciona absoluto contra él).
 *
 * @param {object} opts
 * @param {HTMLElement} opts.panel
 * @param {string} opts.storageKey
 * @param {'left'|'right'} opts.edge  borde donde va el handle
 * @param {number} opts.min
 * @param {number} opts.max
 * @param {number} opts.defaultWidth
 * @param {() => void} [opts.onResize] por si el contenido necesita recalcular
 */
export function makeResizeHandle({
  panel, storageKey, edge, min, max, defaultWidth, onResize = () => {},
}) {
  const handle = h('div', {
    class: 'sidebar-resize-handle',
    dataset: { edge },
    title: 'Arrastrá para redimensionar (doble click restablece)',
  });

  let startX = 0;
  let startW = 0;

  const onMove = (e) => {
    // Un panel pegado al borde derecho crece cuando el mouse va a la
    // izquierda: de ahí el signo invertido.
    const delta = edge === 'left' ? startX - e.clientX : e.clientX - startX;
    panel.style.width = `${Math.min(max, Math.max(min, startW + delta))}px`;
    onResize();
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('resizing-sidebar');
    localStorage.setItem(storageKey, String(Math.round(panel.getBoundingClientRect().width)));
  };

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.classList.add('resizing-sidebar');
  });

  handle.addEventListener('dblclick', () => {
    panel.style.width = `${defaultWidth}px`;
    localStorage.setItem(storageKey, String(defaultWidth));
    onResize();
  });

  return handle;
}
