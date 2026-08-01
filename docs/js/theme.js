/**
 * Tema claro/oscuro. El valor inicial ya lo puso el script inline del
 * <head> antes del primer paint — acá sólo se alterna y se persiste.
 */
const KEY = 'yb-theme';
const btn = document.querySelector('[data-theme-toggle]');
const meta = document.querySelector('meta[name="theme-color"]');

function paint() {
  const dark = document.documentElement.dataset.theme === 'dark';
  btn.textContent = dark ? '◐ dark' : '◑ light';
  meta.content = dark ? '#0b0c0e' : '#f2efe6';
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* modo privado: se pierde al recargar */ }
  paint();
}

btn.addEventListener('click', toggleTheme);
paint();
