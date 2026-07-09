/**
 * src/renderer/core/theme.js
 * --------------------------------------------------------------
 * Tema claro/oscuro de la plataforma.
 *  - Aplica `data-theme` en <html>, lo que alterna las variables
 *    CSS consumidas por Tailwind (bg/line/fg) y por xterm.js.
 *  - Notifica al proceso main vía IPC para que `nativeTheme.themeSource`
 *    cambie también, lo que hace que TODAS las webviews (webapps
 *    embebidas) respeten `prefers-color-scheme` acorde al tema elegido.
 *  - Persistido en localStorage (preferencia de la app, no del perfil).
 * --------------------------------------------------------------
 */
import { bus } from './eventBus.js';

const STORAGE_KEY = 'yusepe:theme';

let current = localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';

export function getTheme() {
  return current;
}

export function applyTheme(mode) {
  current = mode === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', current);
  localStorage.setItem(STORAGE_KEY, current);
  window.yusepe?.theme?.set(current);
  bus.emit('theme:changed', { theme: current });
}

export function toggleTheme() {
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  applyTheme(current);
}
