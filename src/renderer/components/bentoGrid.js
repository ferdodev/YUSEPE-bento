/**
 * src/renderer/components/bentoGrid.js
 * --------------------------------------------------------------
 * Bento Grid con posiciones manuales:
 *  - Grid de 12 columnas, filas auto (minmax 70px, 1fr).
 *  - Cada tile tiene col/row/colSpan/rowSpan explícitos.
 *  - Auto-placement para tiles nuevos (busca hueco libre).
 *  - Resize: arrastrar bordes (right, bottom, corner), con push/expand
 *    de vecinos (ver core/layout.js).
 *  - Move: arrastrar grip superior-izq → se posiciona en la celda bajo
 *    el cursor; cualquier tile que quede tapado se reacomoda en el
 *    primer hueco libre disponible (ver moveTileTo en core/layout.js).
 *  - Rendering incremental (preserva estado de terminales/webviews).
 * --------------------------------------------------------------
 */
import { bus } from '../core/eventBus.js';
import { state } from '../core/state.js';
import { renderTile } from './tile.js';
import { ProfileManager } from '../core/profileManager.js';
import { GRID_COLS, findEmptySpot, resolveColGrowth, resolveRowGrowth, moveTileTo } from '../core/layout.js';
import * as liveTiles from '../core/liveTiles.js';
import emptyDarkUrl from '../assets/empty-dark.svg';
import emptyLightUrl from '../assets/empty-light.svg';

const GAP = 8;
const MIN_ROW_PX = 70;

const grid = document.getElementById('bento');
// Zona oculta (pero dentro del documento) donde "aparcamos" tiles vivos
// (terminales/webviews) al cambiar de workspace. Electron solo destruye
// el guest de un <webview> cuando sale del documento por completo, no
// cuando queda con display:none — así siguen corriendo en background.
const holdingArea = document.getElementById('tile-holding-area');

let focusedTileId = null;

const renderedTiles = new Map();  // tileId -> { node, dispose }
const pendingRenders = new Set(); // tileId en render async

/* ===================== Helpers de grid ===================== */

function getColWidth() {
  const rect = grid.getBoundingClientRect();
  if (!rect.width) return 100;
  return (rect.width - (GRID_COLS - 1) * GAP) / GRID_COLS;
}

function getGridRows() {
  let max = 1;
  for (const tile of state.profile?.tiles || []) {
    const r = tile.row || 1;
    const rs = tile.rowSpan || 1;
    max = Math.max(max, r + rs - 1);
  }
  return max;
}

function getRowHeight() {
  const rows = getGridRows();
  const rect = grid.getBoundingClientRect();
  if (!rect.height || !rows) return MIN_ROW_PX;
  return Math.max(MIN_ROW_PX, (rect.height - (rows - 1) * GAP) / rows);
}

/* ===================== Posiciones ===================== */

function ensurePositions(tiles) {
  const occupied = new Set();
  const unpositioned = [];

  for (const tile of tiles) {
    if (tile.col != null && tile.row != null) {
      const cs = tile.colSpan || 1;
      const rs = tile.rowSpan || 1;
      for (let r = tile.row; r < tile.row + rs; r++)
        for (let c = tile.col; c < tile.col + cs; c++)
          occupied.add(`${c},${r}`);
    } else {
      unpositioned.push(tile);
    }
  }

  let changed = false;
  for (const tile of unpositioned) {
    const cs = tile.colSpan || 4;
    const rs = tile.rowSpan || 4;
    const pos = findEmptySpot(cs, rs, occupied);
    tile.col = pos.col;
    tile.row = pos.row;
    for (let r = pos.row; r < pos.row + rs; r++)
      for (let c = pos.col; c < pos.col + cs; c++)
        occupied.add(`${c},${r}`);
    changed = true;
  }
  return changed;
}

function updateTilePosition(tileId) {
  const tile = state.profile?.tiles.find((t) => t.id === tileId);
  if (!tile) return;
  const entry = renderedTiles.get(tileId);
  if (!entry?.node) return;
  const col = tile.col || 1;
  const row = tile.row || 1;
  const cs = tile.colSpan || 1;
  const rs = tile.rowSpan || 1;
  entry.node.style.gridColumn = `${col} / span ${cs}`;
  entry.node.style.gridRow = `${row} / span ${rs}`;
}

/* ===================== Focus ===================== */

function focusTile(tileId) {
  focusedTileId = tileId;
  document.querySelectorAll('.tile').forEach((el) => {
    el.classList.toggle('focused', el.dataset.tileId === tileId);
  });
}

// Los tiles webview notifican su foco vía bus (ver webviewTile.js),
// ya que un click dentro de un <webview> no burbujea 'mousedown'.
bus.on('tile:focus', ({ id }) => focusTile(id));

/** Tile actualmente enfocado (usado por Cmd+W y por snippetsSidebar.js para saber a qué terminal apuntar). */
export function getFocusedTileId() {
  return focusedTileId;
}

/** Enfoca un tile por id y lo trae a la vista (command palette / snippets). */
export function focusTileById(tileId) {
  focusTile(tileId);
  document.querySelector(`.tile[data-tile-id="${tileId}"]`)
    ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/* ===================== Marca de agua de espacio libre ===================== */
// Vive SIEMPRE detrás del grid como fondo (position:absolute → no participa
// del layout de grid ni consume celdas). Como los tiles tienen fondo opaco,
// el logo solo se asoma en las celdas realmente libres, sean todas (perfil
// vacío) o solo el hueco que sobra junto a otros tiles.

function emptyStateUrl() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? emptyLightUrl : emptyDarkUrl;
}

const emptyBackdrop = document.createElement('div');
emptyBackdrop.className = 'bento-empty-backdrop';
emptyBackdrop.style.backgroundImage = `url(${emptyStateUrl()})`;
grid.appendChild(emptyBackdrop);

const emptyHint = document.createElement('div');
emptyHint.className =
  'absolute bottom-6 left-0 right-0 text-center text-xs text-fg-subtle pointer-events-none';
emptyHint.textContent = 'Cmd/Ctrl+K para añadir tu primera app';
emptyHint.classList.add('hidden');
grid.appendChild(emptyHint);

bus.on('theme:changed', () => {
  emptyBackdrop.style.backgroundImage = `url(${emptyStateUrl()})`;
});

/* ===================== Wallpaper por workspace ===================== */
// Fondo de pantalla personalizado (Pexels) + transparencia de las
// terminales sobre esa imagen. Ver components/wallpaperPicker.js.

const wallpaperCredit = document.createElement('a');
wallpaperCredit.className =
  'absolute bottom-1.5 right-2 text-[10px] text-white/70 hover:text-white transition z-10 hidden';
wallpaperCredit.target = '_blank';
wallpaperCredit.rel = 'noopener noreferrer';
grid.appendChild(wallpaperCredit);
wallpaperCredit.addEventListener('click', (e) => {
  e.preventDefault();
  if (wallpaperCredit.href) window.yusepe.shell.openExternal(wallpaperCredit.href);
});

function applyWallpaper(profile) {
  const wp = profile?.wallpaper;

  if (wp) {
    grid.style.backgroundImage = `url(${wp.url})`;
    grid.style.backgroundSize = 'cover';
    grid.style.backgroundPosition = 'center';
    emptyBackdrop.style.display = 'none';
    document.documentElement.style.setProperty('--term-tile-opacity', String(wp.opacity ?? 0.55));
    wallpaperCredit.href = wp.photographerUrl;
    wallpaperCredit.textContent = `Foto de ${wp.photographerName} en Pexels`;
    wallpaperCredit.classList.remove('hidden');
  } else {
    grid.style.backgroundImage = '';
    emptyBackdrop.style.display = '';
    document.documentElement.style.setProperty('--term-tile-opacity', '1');
    wallpaperCredit.classList.add('hidden');
  }
  // Los terminales ya abiertos escuchan 'theme:changed' para releer su
  // paleta (background incluido) — lo reutilizamos para aplicar en vivo.
  bus.emit('theme:changed');
}

bus.on('profile:wallpaper-changed', (profile) => {
  if (state.profile && profile?.id === state.profile.id) applyWallpaper(profile);
});

/* ===================== Disposal ===================== */

function disposeTile(tileId) {
  const entry = renderedTiles.get(tileId);
  if (!entry) return;

  // Si sigue vivo en el registro (terminal/webview persistente), no lo
  // destruimos: lo aparcamos oculto para poder reutilizarlo tal cual al
  // volver a este workspace.
  if (liveTiles.get(tileId)) {
    holdingArea?.appendChild(entry.node);
  } else {
    if (entry.dispose) {
      try { entry.dispose(); } catch { /* noop */ }
    }
    entry.node?.remove();
  }
  renderedTiles.delete(tileId);
}

function disposeAllTiles() {
  for (const id of [...renderedTiles.keys()]) disposeTile(id);
}

// Al dejar un workspace (cambio de perfil), se desmontan los tiles del
// perfil anterior SIN matar los que están registrados como persistentes
// (terminales, webviews) — quedan aparcados y vivos en background. El
// resto de tiles (calculadora) sí se destruye normalmente.
bus.on('workspace:left', () => disposeAllTiles());

/* ===================== Handles ===================== */

function addHandles(node, tileId) {
  if (node.dataset.handles) return;
  node.dataset.handles = 'true';

  const move = document.createElement('div');
  move.className = 'tile-handle-move';
  move.textContent = '⠿';
  move.title = 'Arrastrar para mover';
  move.addEventListener('mousedown', (e) => startMove(e, tileId));

  const resizeR = document.createElement('div');
  resizeR.className = 'tile-handle-r';
  resizeR.addEventListener('mousedown', (e) => startResize(e, tileId, 'r'));

  const resizeB = document.createElement('div');
  resizeB.className = 'tile-handle-b';
  resizeB.addEventListener('mousedown', (e) => startResize(e, tileId, 'b'));

  const resizeBR = document.createElement('div');
  resizeBR.className = 'tile-handle-br';
  resizeBR.addEventListener('mousedown', (e) => startResize(e, tileId, 'br'));

  node.append(move, resizeR, resizeB, resizeBR);
}

/* ===================== Resize ===================== */

// Los <webview> son superficies de compositor separadas: si el cursor
// pasa sobre uno durante un drag, mousemove/mouseup dejan de llegar al
// document del renderer y el drag se "cuelga". Se deshabilitan los
// eventos de puntero en todos los webviews mientras dura el drag.
function beginDrag() {
  document.body.classList.add('dragging');
}
function endDrag() {
  document.body.classList.remove('dragging');
}

function startResize(e, tileId, dir) {
  e.stopPropagation();
  e.preventDefault();

  const tile = state.profile?.tiles.find((t) => t.id === tileId);
  if (!tile) return;

  const startX = e.clientX;
  const startY = e.clientY;
  const startCS = tile.colSpan || 1;
  const startRS = tile.rowSpan || 1;

  const colWidth = getColWidth();
  const rowHeight = getRowHeight();

  beginDrag();

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const tiles = state.profile?.tiles || [];

    if (dir === 'r' || dir === 'br') {
      const deltaCols = Math.round(dx / colWidth);
      const desiredCS = Math.max(1, startCS + deltaCols);
      if (desiredCS !== (tile.colSpan || 1)) {
        const result = resolveColGrowth(tiles, tileId, desiredCS);
        if (result) applyColResult(result);
      }
    }
    if (dir === 'b' || dir === 'br') {
      const deltaRows = Math.round(dy / rowHeight);
      const desiredRS = Math.max(1, startRS + deltaRows);
      if (desiredRS !== (tile.rowSpan || 1)) {
        const result = resolveRowGrowth(tiles, tileId, desiredRS);
        if (result) applyRowResult(result);
      }
    }
  }

  function applyColResult(result) {
    tile.colSpan = result.colSpan;
    updateTilePosition(tileId);
    for (const p of result.pushed) {
      p.tile.col = p.col;
      p.tile.colSpan = p.colSpan;
      updateTilePosition(p.tile.id);
    }
  }

  function applyRowResult(result) {
    tile.rowSpan = result.rowSpan;
    updateTilePosition(tileId);
    for (const p of result.pushed) {
      p.tile.row = p.row;
      p.tile.rowSpan = p.rowSpan;
      updateTilePosition(p.tile.id);
    }
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    endDrag();
    // Los vecinos empujados ya quedaron mutados en sus propios objetos;
    // saveCurrent() persiste el perfil completo (incluye esos cambios).
    ProfileManager.updateTile(tileId, {
      colSpan: tile.colSpan,
      rowSpan: tile.rowSpan,
    }).catch((err) => console.error('[bento] resize save:', err));
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ===================== Move (drag libre) ===================== */

/** Convierte una posición de mouse en la celda (col,row) del grid que hay debajo. */
function cellAtPoint(clientX, clientY) {
  const rect = grid.getBoundingClientRect();
  const colStep = getColWidth() + GAP;
  const rowStep = getRowHeight() + GAP;
  const col = Math.floor((clientX - rect.left) / colStep) + 1;
  const row = Math.floor((clientY - rect.top) / rowStep) + 1;
  return { col: Math.max(1, col), row: Math.max(1, row) };
}

function startMove(e, tileId) {
  e.stopPropagation();
  e.preventDefault();

  beginDrag();

  function onMove(ev) {
    const { col, row } = cellAtPoint(ev.clientX, ev.clientY);
    const tiles = state.profile?.tiles || [];
    moveTileTo(tiles, tileId, col, row);
    for (const t of tiles) updateTilePosition(t.id);
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    endDrag();
    ProfileManager.saveCurrent().catch((err) => console.error('[bento] move save:', err));
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ===================== Render incremental ===================== */

export async function renderBento() {
  const profile = state.profile;
  applyWallpaper(profile);

  if (!profile) {
    disposeAllTiles();
    grid.classList.add('hidden');
    return;
  }

  if (!profile.tiles?.length) {
    disposeAllTiles();
    grid.classList.remove('hidden');
    grid.style.gridTemplateColumns = `repeat(${GRID_COLS}, 1fr)`;
    grid.style.gridAutoRows = `minmax(${MIN_ROW_PX}px, 1fr)`;
    emptyHint.classList.remove('hidden');
    focusedTileId = null;
    return;
  }

  emptyHint.classList.add('hidden');

  // Auto-posicionar tiles sin col/row
  const positionsChanged = ensurePositions(profile.tiles);

  grid.classList.remove('hidden');
  grid.style.gridTemplateColumns = `repeat(${GRID_COLS}, 1fr)`;
  grid.style.gridAutoRows = `minmax(${MIN_ROW_PX}px, 1fr)`;

  const newTileIds = new Set(profile.tiles.map((t) => t.id));

  // 1. Eliminar tiles que ya no están
  for (const id of [...renderedTiles.keys()]) {
    if (!newTileIds.has(id)) disposeTile(id);
  }

  // 2. Actualizar posiciones de existentes + recolectar nuevos
  const tilesToRender = [];
  for (const tile of profile.tiles) {
    if (renderedTiles.has(tile.id)) {
      updateTilePosition(tile.id);
    } else if (!pendingRenders.has(tile.id)) {
      pendingRenders.add(tile.id);
      tilesToRender.push(tile);
    }
  }

  // 3. Renderizar tiles nuevos
  if (tilesToRender.length > 0) {
    const results = await Promise.all(
      tilesToRender.map(async (tile) => ({ tile, result: await renderTile(tile, profile.id) }))
    );

    for (const { tile, result } of results) {
      const idx = profile.tiles.findIndex((t) => t.id === tile.id);
      if (idx === -1) {
        result.dispose?.();
        result.node.remove();
        pendingRenders.delete(tile.id);
        continue;
      }
      result.node.dataset.tileId = tile.id;
      // dataset.focusBound evita apilar el mismo listener cuando una
      // terminal en background se remonta (mismo nodo reutilizado).
      if (!result.node.dataset.focusBound) {
        result.node.dataset.focusBound = 'true';
        result.node.addEventListener('mousedown', () => focusTile(tile.id), true);
      }
      grid.append(result.node);
      renderedTiles.set(tile.id, { node: result.node, dispose: result.dispose });
      updateTilePosition(tile.id);
      addHandles(result.node, tile.id);
      pendingRenders.delete(tile.id);
    }
  }

  // 4. Asegurar handles en todos los tiles
  for (const tile of profile.tiles) {
    const entry = renderedTiles.get(tile.id);
    if (entry) addHandles(entry.node, tile.id);
  }

  // 5. Foco
  const tiles = profile.tiles;
  if (!focusedTileId || !tiles.find((t) => t.id === focusedTileId)) {
    focusedTileId = tiles[0]?.id || null;
  }
  focusTile(focusedTileId);

  // 6. Persistir posiciones auto-asignadas
  if (positionsChanged) {
    ProfileManager.saveCurrent().catch(() => {});
  }

  bus.emit('bento:rendered', { count: tiles.length });
}

export async function closeFocusedTile() {
  if (!focusedTileId) return;
  const id = focusedTileId;
  focusedTileId = null;
  await ProfileManager.removeTile(id);
}
