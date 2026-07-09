/**
 * src/renderer/components/toast.js
 * --------------------------------------------------------------
 * Notificaciones no-bloqueantes (estilo macOS): éxito / error / info /
 * warning, apiladas abajo a la derecha, con auto-dismiss y slide-in.
 *
 * Dos formas de usarlo:
 *   import { toast } from './toast.js';  toast.success('Push completado');
 *   bus.emit('toast', { type: 'error', message: '...' });  // desacoplado
 *
 * El feedback es parte de sentirse "tope de gama": un pty que muere, un
 * push que falla o un import que sale bien nunca deben pasar en silencio.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { bus } from '../core/eventBus.js';

const ICON = { success: 'check', error: 'close', warning: 'warning', info: 'info' };
const ACCENT = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-accent',
};
const DEFAULT_MS = { success: 3500, error: 6000, warning: 5000, info: 4000 };

let container = null;
function ensureContainer() {
  if (container && document.body.contains(container)) return container;
  container = h('div', {
    id: 'toast-container',
    class: 'fixed z-[60] bottom-4 right-4 flex flex-col gap-2 items-end pointer-events-none',
  });
  document.body.appendChild(container);
  return container;
}

/** Muestra un toast. `type`: success|error|warning|info. */
export function showToast({ type = 'info', message = '', duration } = {}) {
  if (!message) return;
  const kind = ICON[type] ? type : 'info';
  const root = ensureContainer();

  const card = h('div', {
    class: 'toast-item pointer-events-auto flex items-start gap-2.5 max-w-sm '
      + 'bg-bg-soft/95 backdrop-blur border border-line rounded-xl shadow-bento px-3.5 py-2.5 '
      + 'text-sm text-fg-soft cursor-pointer select-none',
    title: 'Click para descartar',
  }, [
    h('span', { class: `shrink-0 mt-0.5 ${ACCENT[kind]}` }, svgIcon(ICON[kind], { size: 16 })),
    h('span', { class: 'min-w-0 leading-snug break-words' }, message),
  ]);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    clearTimeout(timer);
    card.classList.add('toast-out');
    setTimeout(() => card.remove(), 180);
  };

  card.addEventListener('click', remove);
  root.appendChild(card);

  const ms = duration ?? DEFAULT_MS[kind];
  const timer = setTimeout(remove, ms);
  return remove;
}

export const toast = {
  success: (message, opts) => showToast({ ...opts, type: 'success', message }),
  error: (message, opts) => showToast({ ...opts, type: 'error', message }),
  warning: (message, opts) => showToast({ ...opts, type: 'warning', message }),
  info: (message, opts) => showToast({ ...opts, type: 'info', message }),
};

// Canal desacoplado: cualquier módulo puede emitir sin importar este archivo.
bus.on('toast', (payload) => showToast(payload || {}));
