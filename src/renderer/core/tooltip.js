/**
 * src/renderer/core/tooltip.js
 * --------------------------------------------------------------
 * Tooltips de la app. Un solo listener delegado en `document` y un
 * solo nodo reutilizado — no hay componente por botón ni hay que
 * tocar cada call site.
 *
 * Se apodera del atributo `title` nativo: al pasar el mouse le saca
 * el `title` al elemento y lo guarda en `data-tip`. Dos razones:
 *   - el tooltip nativo de Chromium tarda ~1.5s y usa el estilo del
 *     SO — en la práctica los devs nuevos nunca lo veían;
 *   - si dejáramos el `title` puesto saldrían los dos tooltips.
 * Como el robo pasa en el hover (no al arrancar), sirve igual para
 * el DOM que se crea después: tiles, filas del explorador, mensajes
 * del loop. Poner `title` en un elemento nuevo sigue siendo la única
 * API — este módulo no se importa desde los componentes.
 *
 * Para texto que NO debe salir como tooltip (una ruta larga que ya
 * se ve en pantalla, por ejemplo) usá `data-no-tip`.
 * --------------------------------------------------------------
 */

const DELAY_MS = 350;
const GAP = 8;

let tipEl = null;
let timer = null;
let current = null;

function ensureEl() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'app-tooltip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.append(tipEl);
  }
  return tipEl;
}

/** El texto vive en `title` (primera vez) o ya en `data-tip` (siguientes). */
function tipTextOf(el) {
  const native = el.getAttribute('title');
  if (native) {
    el.dataset.tip = native;
    el.removeAttribute('title');
  }
  return el.dataset.tip || '';
}

function show(el) {
  const text = tipTextOf(el);
  if (!text) return;
  const node = ensureEl();
  node.textContent = text;
  node.classList.add('is-visible');

  // Debajo del elemento; si no entra, arriba. Siempre dentro del viewport.
  const r = el.getBoundingClientRect();
  const t = node.getBoundingClientRect();
  const below = r.bottom + GAP;
  const top = below + t.height <= window.innerHeight ? below : r.top - t.height - GAP;
  const left = Math.min(
    Math.max(4, r.left + r.width / 2 - t.width / 2),
    window.innerWidth - t.width - 4,
  );
  node.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(4, top))}px)`;
}

function hide() {
  clearTimeout(timer);
  current = null;
  tipEl?.classList.remove('is-visible');
}

/** El candidato es el ancestro más cercano con tooltip, salvo opt-out. */
function targetFrom(node) {
  if (!(node instanceof Element)) return null;
  const el = node.closest('[title], [data-tip]');
  if (!el || el.hasAttribute('data-no-tip')) return null;
  return el;
}

function schedule(el) {
  if (el === current) return;
  hide();
  current = el;
  timer = setTimeout(() => { if (current === el) show(el); }, DELAY_MS);
}

export function initTooltips() {
  document.addEventListener('mouseover', (e) => {
    const el = targetFrom(e.target);
    if (el) schedule(el);
    else if (current) hide();
  });

  // Teclado: quien navega con Tab también tiene que poder leerlos.
  document.addEventListener('focusin', (e) => {
    const el = targetFrom(e.target);
    if (el) schedule(el);
  });
  document.addEventListener('focusout', hide);

  // Cualquier interacción real lo saca del medio. `scroll` y `wheel` en
  // captura porque el scroll de los paneles no burbujea hasta document.
  for (const ev of ['mousedown', 'keydown']) document.addEventListener(ev, hide);
  for (const ev of ['scroll', 'wheel']) document.addEventListener(ev, hide, true);
  window.addEventListener('blur', hide);
}
