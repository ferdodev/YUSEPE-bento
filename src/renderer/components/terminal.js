/**
 * src/renderer/components/terminal.js
 * --------------------------------------------------------------
 * Terminal SIN header. xterm.js llena el 100% del tile.
 * node-pty en el main process, IPC para I/O.
 * --------------------------------------------------------------
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { h, debounce } from '../utils/dom.js';
import { bus } from '../core/eventBus.js';
import * as liveTiles from '../core/liveTiles.js';

/**
 * Lee la paleta de la terminal desde las variables CSS del tema activo.
 * Si hay un wallpaper de workspace activo (--term-tile-opacity < 1), el
 * fondo se vuelve semitransparente con esa misma opacidad para dejarlo
 * ver (estilo Warp) — ver bentoGrid.js `applyWallpaper`.
 */
function readTermTheme() {
  const style = getComputedStyle(document.documentElement);
  const v = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const opacity = parseFloat(v('--term-tile-opacity', '1')) || 1;
  const bgRgb = v('--color-term-bg-rgb', '22, 22, 25');
  return {
    background: opacity < 1 ? `rgba(${bgRgb}, ${opacity})` : v('--color-term-bg', '#161619'),
    foreground: v('--color-term-fg', '#e6e6ea'),
    cursor: v('--color-term-cursor', '#0a84ff'),
    selectionBackground: v('--color-term-selection', '#14375f'),
  };
}

export async function createTerminalTile(tile, profileId) {
  // Si esta terminal ya está viva (el usuario volvió a este workspace),
  // reutilizamos el mismo nodo/proceso en vez de crear uno nuevo:
  // scrollback y el shell en ejecución quedan intactos.
  const cached = liveTiles.get(tile.id);
  if (cached) {
    queueMicrotask(() => { try { cached.meta.fit.fit(); } catch { /* noop */ } });
    return { root: cached.node, shutdown: () => {} };
  }

  // Contenedor que llena el tile. Sin fondo propio a propósito: así el
  // fondo (semi)transparente del .tile — ver estilo `.tile[data-kind=
  // 'terminal']` — se ve por debajo de xterm cuando hay wallpaper activo.
  const body = h('div', {
    class: 'absolute inset-0',
  });

  const root = h('div', {
    class: 'tile',
    dataset: { tileId: tile.id, kind: 'terminal' },
  }, [body]);

  let term = null;
  let fit = null;
  let ptyId = null;
  let offData = null;
  let offExit = null;
  let offTheme = null;

  queueMicrotask(async () => {
    try {
      term = new Terminal({
        fontFamily: 'JetBrains Mono, Menlo, monospace',
        fontSize: 13,
        cursorBlink: true,
        theme: readTermTheme(),
        allowProposedApi: true,
      });

      offTheme = bus.on('theme:changed', () => {
        if (term) term.options.theme = readTermTheme();
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(body);
      fit.fit();

      const { ptyId: id } = await window.yusepe.pty.create({
        cols: term.cols,
        rows: term.rows,
        cwd: tile.cwd || undefined,
      });
      ptyId = id;

      offData = window.yusepe.pty.onData(ptyId, (data) => term.write(data));
      offExit = window.yusepe.pty.onExit(ptyId, (code) => {
        term.writeln(`\r\n\x1b[2m[proceso finalizado con código ${code}]\x1b[0m`);
      });

      term.onData((d) => window.yusepe.pty.input(ptyId, d));
      const debouncedResize = debounce(({ cols, rows }) => {
        window.yusepe.pty.resize(ptyId, cols, rows);
      }, 80);
      term.onResize(debouncedResize);

      const ro = new ResizeObserver(() => {
        try { fit.fit(); } catch { /* noop */ }
      });
      ro.observe(body);
      root._disposers = [() => ro.disconnect()];

      term.writeln('\x1b[2mInicializando shell…\x1b[0m');
      term.focus();

      // Terminal precargada: escribe el comando en el shell apenas arranca.
      if (tile.command) {
        setTimeout(() => window.yusepe.pty.input(ptyId, `${tile.command}\r`), 300);
      }

      // Registra la terminal como "viva": persiste entre cambios de
      // workspace. Solo `killReal` (borrado del tile o kill de workspace)
      // termina el proceso de verdad.
      liveTiles.register(tile.id, {
        profileId, kind: 'terminal', node: root, kill: killReal, meta: { fit, ptyId },
      });
    } catch (err) {
      body.innerHTML = `<div class="p-3 text-xs text-fg-muted">
        No se pudo iniciar la terminal.<br/>
        Ejecuta <code>npm run rebuild</code> para compilar node-pty.<br/>
        <pre class="mt-2 text-[10px] text-fg-subtle">${String(err.message || err)}</pre>
      </div>`;
      bus.emit('terminal:error', { tileId: tile.id, error: String(err.message || err) });
    }
  });

  async function killReal() {
    try { offData?.(); offExit?.(); offTheme?.(); } catch { /* noop */ }
    if (ptyId) { try { window.yusepe.pty.kill(ptyId); } catch { /* noop */ } ptyId = null; }
    term?.dispose();
    term = null;
    (root._disposers || []).forEach((fn) => { try { fn(); } catch { /* noop */ } });
  }

  // Al desmontar el tile (cambio de workspace) NO se mata el proceso —
  // solo se quita del DOM. El kill real vive en el registry (killReal)
  // y se dispara explícitamente desde ProfileManager.removeTile / killWorkspace.
  return { root, shutdown: () => {} };
}
