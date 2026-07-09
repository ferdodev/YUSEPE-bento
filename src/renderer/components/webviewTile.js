/**
 * src/renderer/components/webviewTile.js
 * --------------------------------------------------------------
 * Tile webview SIN header. El <webview> llena el 100% del tile.
 * Overlay de error visible si la carga falla.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { bus } from '../core/eventBus.js';
import * as liveTiles from '../core/liveTiles.js';

const SAFE_PROTOCOLS = /^https?:\/\//i;

export function normalizeUrl(input) {
  if (!input) return null;
  let url = input.trim();
  if (!SAFE_PROTOCOLS.test(url)) {
    if (/^[\w-]+(\.[\w-]+)+/.test(url)) url = 'https://' + url;
    else return null;
  }
  try { return new URL(url).toString(); }
  catch { return null; }
}

export function createWebviewTile(tile, profileId) {
  // Si esta webview ya está viva (el usuario volvió a este workspace),
  // reutilizamos el mismo <webview>/guest: sesión, scroll y JS en memoria
  // siguen exactamente donde quedaron.
  const cached = liveTiles.get(tile.id);
  if (cached) {
    return { root: cached.node, webview: cached.meta.webview };
  }

  const url = tile.url;
  const partition = `persist:yusepe-${tile.id}`;

  const errorOverlay = h('div', {
    class: 'absolute inset-0 hidden grid place-items-center bg-bg-soft/95 text-center p-4 z-10',
  });

  const webview = h('webview', {
    src: url,
    partition,
    allowpopups: 'false',
    webpreferences: 'contextIsolation=true, nodeIntegration=false',
  });

  webview.addEventListener('did-attach', () => {
    try {
      const ses = webview.getWebContents?.()?.session;
      if (ses) {
        ses.setPermissionRequestHandler((_wc, permission, callback) => {
          const allowed = ['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'mediaKeySystem'];
          callback(allowed.includes(permission));
        });
      }
    } catch (err) {
      console.warn('[webview] permisos:', err);
    }
    // Zoom por-tile persistido (ver components/workspaceManager.js). Se
    // fuerza a nivel Chromium (setZoomFactor), así que funciona incluso en
    // sitios que bloquean el zoom del navegador con CSS/meta viewport.
    try { webview.setZoomFactor(tile.zoom || 1); } catch { /* noop */ }
  });

  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return;
    errorOverlay.innerHTML = `<div>
      <div class="text-sm text-fg-soft mb-1">⚠ No se pudo cargar</div>
      <div class="text-[10px] text-fg-subtle">${e.errorCode} · ${e.errorDescription || ''}</div>
      <div class="text-[10px] text-fg-subtle mt-1 break-all">${e.validatedURL}</div>
    </div>`;
    errorOverlay.classList.remove('hidden');
  });

  webview.addEventListener('did-finish-load', () => {
    errorOverlay.classList.add('hidden');
  });

  // El <webview> es una superficie de compositor aparte: un click dentro
  // no burbujea 'mousedown' al contenedor del tile, así que el foco del
  // grid (usado por Cmd+W) no se actualizaba. El evento nativo 'focus'
  // sí se dispara sobre el propio elemento <webview> al recibir el click.
  webview.addEventListener('focus', () => {
    bus.emit('tile:focus', { id: tile.id });
  });

  const root = h('div', {
    class: 'tile',
    dataset: { tileId: tile.id, kind: tile.kind },
  }, [webview, errorOverlay]);

  // El kill real destruye el <webview> de verdad (saca el guest del DOM
  // para siempre). Desmontar por cambio de workspace NO pasa por acá —
  // ver liveTiles.js y bentoGrid.js (se mueve a una zona oculta en vez
  // de removerse, así el guest sigue vivo).
  function killReal() {
    try { webview.remove(); } catch { /* noop */ }
  }
  liveTiles.register(tile.id, {
    profileId, kind: 'webview', node: root, kill: killReal, meta: { webview },
  });

  return { root, webview };
}
