/**
 * src/renderer/components/tile.js
 * --------------------------------------------------------------
 * Factoría de tiles. Nuevos tiles incluyen colSpan/rowSpan
 * para el grid manual de 12 columnas.
 * --------------------------------------------------------------
 */
import { ProfileManager } from '../core/profileManager.js';
import { uid } from '../utils/dom.js';
import { createWebviewTile, normalizeUrl } from './webviewTile.js';
import { createCalculatorTile } from './calculator.js';
import { createTerminalTile } from './terminal.js';

const factories = {
  webview:    (t, profileId) => createWebviewTile(t, profileId),
  calculator: (t) => createCalculatorTile(t),
  terminal:   async (t, profileId) => createTerminalTile(t, profileId),
};

export async function addTile({ kind, ...rest }) {
  const tile = {
    id: uid(),
    kind,
    createdAt: Date.now(),
    ...rest,
  };
  await ProfileManager.addTile(tile);
  return tile;
}

export const TileFactory = {
  fromUrl(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url) return null;
    return addTile({
      kind: 'webview',
      url,
      title: domainOf(url),
      colSpan: 4,
      rowSpan: 4,
    });
  },

  calculator() {
    return addTile({ kind: 'calculator', colSpan: 4, rowSpan: 4 });
  },

  terminal(cwd = null) {
    return addTile({ kind: 'terminal', colSpan: 6, rowSpan: 4, cwd: cwd || null });
  },

  /** Terminal que ejecuta `command` automáticamente al abrirse. */
  terminalPreloaded(command, cwd = null) {
    return addTile({
      kind: 'terminal',
      colSpan: 6,
      rowSpan: 4,
      cwd: cwd || null,
      command: command || null,
    });
  },

  fromApp(app) {
    return addTile({
      kind: 'webview',
      url: app.url,
      title: app.name,
      icon: app.icon,
      appId: app.id,
      colSpan: 4,
      rowSpan: 4,
    });
  },
};

export function removeTileById(tileId) {
  return ProfileManager.removeTile(tileId);
}

/**
 * Renderiza un tile y devuelve { node, dispose }.
 */
export async function renderTile(tile, profileId) {
  const factory = factories[tile.kind];
  if (!factory) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.dataset.tileId = tile.id;
    el.dataset.kind = 'unknown';
    el.innerHTML = `<div class="p-3 text-xs text-fg-muted">Tile desconocido: ${tile.kind}</div>`;
    return { node: el, dispose: null };
  }
  const out = await factory(tile, profileId);
  return { node: out.root, dispose: out.shutdown || null };
}

function domainOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); }
  catch { return url; }
}
