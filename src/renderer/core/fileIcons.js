/**
 * src/renderer/core/fileIcons.js
 * --------------------------------------------------------------
 * Iconos de archivos/carpetas por tipo, estilo VSCode, usando el
 * paquete `material-icon-theme` (el mismo Material Icon Theme del editor).
 *
 * No dibujamos SVGs a mano: `generateManifest()` nos da el mapeo
 * nombre-de-archivo → icono, y los ~1250 SVG del paquete se cargan como
 * URLs de asset vía `import.meta.glob` — Vite emite cada uno como archivo
 * suelto y el navegador solo baja el que realmente se muestra, así el
 * bundle no engorda con 5 MB de SVGs inlineados.
 *
 * Los iconos Material ya vienen coloreados, por eso se usan como <img>
 * (no como currentColor). `fileIconEl` / `folderIconEl` devuelven el
 * elemento listo para insertar en una fila del árbol.
 * --------------------------------------------------------------
 */
import { generateManifest } from 'material-icon-theme';
import { h } from '../utils/dom.js';

// Mapa basename-del-svg → URL de asset (p.ej. 'javascript' -> '/assets/javascript-x.svg').
// Path relativo (no '/node_modules'): el root del renderer es src/renderer,
// así que la ruta absoluta no resolvería. Desde core/ subimos a la raíz.
const rawUrls = import.meta.glob('../../../node_modules/material-icon-theme/icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});
const urlByBasename = {};
for (const [path, url] of Object.entries(rawUrls)) {
  const base = path.split('/').pop().replace(/\.svg$/, '');
  urlByBasename[base] = url;
}

const manifest = generateManifest();

/** iconName (según el manifest) → URL del svg, o undefined. */
function urlForIconName(iconName) {
  const def = iconName && manifest.iconDefinitions[iconName];
  if (!def) return undefined;
  const base = def.iconPath.split('/').pop().replace(/\.svg$/, '');
  return urlByBasename[base];
}

/** URL del icono para un archivo, con fallback al icono de archivo genérico. */
export function fileIconUrl(fileName) {
  const lower = fileName.toLowerCase();
  let name = manifest.fileNames[lower];
  if (!name) {
    // Extensión más larga que matchee (ej. "component.ts" antes que "ts").
    const parts = lower.split('.');
    for (let i = 1; i < parts.length; i++) {
      const ext = parts.slice(i).join('.');
      if (manifest.fileExtensions[ext]) { name = manifest.fileExtensions[ext]; break; }
    }
  }
  return urlForIconName(name) || urlForIconName(manifest.file);
}

/** URL del icono para una carpeta (variante abierta/cerrada). */
export function folderIconUrl(folderName, expanded = false) {
  const lower = folderName.toLowerCase();
  const named = (expanded ? manifest.folderNamesExpanded : manifest.folderNames)[lower];
  const fallback = expanded ? manifest.folderExpanded : manifest.folder;
  return urlForIconName(named) || urlForIconName(fallback);
}

/** <img> del icono de archivo, tamaño fijo. */
export function fileIconEl(fileName, size = 16) {
  return h('img', {
    src: fileIconUrl(fileName),
    class: 'shrink-0 select-none',
    style: `width:${size}px;height:${size}px`,
    alt: '',
    draggable: 'false',
  });
}

/** <img> del icono de carpeta; se puede re-apuntar con setFolderIcon al expandir. */
export function folderIconEl(folderName, expanded = false, size = 16) {
  const el = h('img', {
    src: folderIconUrl(folderName, expanded),
    class: 'shrink-0 select-none',
    style: `width:${size}px;height:${size}px`,
    alt: '',
    draggable: 'false',
  });
  el._folderName = folderName;
  return el;
}

/** Actualiza el src de un icono de carpeta al abrir/cerrar. */
export function setFolderIcon(el, expanded) {
  if (el && el._folderName != null) el.src = folderIconUrl(el._folderName, expanded);
}
