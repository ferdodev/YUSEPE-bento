/**
 * src/main/index.js
 * --------------------------------------------------------------
 * Proceso principal de Electron.
 *
 * Seguridad + Menu con accelerators globales (Cmd+W, Cmd+K, etc.)
 * que funcionan incluso cuando un <webview> tiene el foco.
 * --------------------------------------------------------------
 */
import { app, BrowserWindow, shell, session, ipcMain, Menu, nativeTheme, dialog } from 'electron';
import { join, extname } from 'path';
import { promises as fs } from 'fs';
import { registerIpc } from './ipc.js';

const MAX_WALLPAPER_BYTES = 8 * 1024 * 1024; // 8 MB
const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

// __dirname está disponible en CJS (electron-vite compila main a CJS).
const isDev = !app.isPackaged;

let mainWindow = null;
let ipcHandle = null;

/** Menu con accelerators globales para atajos de teclado. */
function setupMenu(win) {
  const isMac = process.platform === 'darwin';
  const send = (ch) => () => {
    if (win && !win.isDestroyed()) win.webContents.send(ch);
  };

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Tile',
      submenu: [
        { label: 'Cerrar tile', accelerator: 'CmdOrCtrl+W', click: send('menu:close-tile') },
        { type: 'separator' },
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+P', click: send('menu:command-palette') },
        { label: 'Agregar al espacio', accelerator: 'CmdOrCtrl+K', click: send('menu:add-to-space') },
        { label: 'Nueva terminal', accelerator: 'CmdOrCtrl+T', click: send('menu:new-terminal') },
        { label: 'Nueva calculadora', accelerator: 'CmdOrCtrl+B', click: send('menu:new-calc') },
        { label: 'Configuración', accelerator: 'CmdOrCtrl+,', click: send('menu:settings') },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1c1c1e',
    show: false,
    title: 'YUSEPE Bento',
    // Chrome nativo de macOS: traffic lights embebidos en la topbar
    // (estilo Finder/Safari), sin barra de título aparte. En Windows/Linux
    // Electron ignora estas opciones y usa el frame estándar. El renderer
    // reserva el espacio de los semáforos vía la clase `platform-darwin`.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      // Habilita el visor de PDF interno de Chromium — sin esto, el
      // <embed type="application/pdf"> del preview de archivos queda en
      // blanco (ver fileTreeSidebar.js openMediaPreview).
      plugins: true,
    },
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL;
    if (allowed && url.startsWith(allowed)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
}

function configureSession() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'mediaKeySystem'];
    callback(allowed.includes(permission));
  });

  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob: https:; " +
          "frame-src 'self' https:; " +
          "connect-src 'self' https: http:;",
        ],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });
}

app.whenReady().then(() => {
  configureSession();

  const profilesDir = join(app.getPath('userData'), 'profiles');
  ipcHandle = registerIpc({ app, profilesDir });

  ipcMain.on('shell:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // `nativeTheme.themeSource` es global a toda la app: cambia
  // `prefers-color-scheme` para el renderer, los <webview> (webapps
  // embebidas) y los controles nativos, sin necesidad de tocar cada
  // WebContents por separado.
  ipcMain.on('theme:set', (_e, mode) => {
    nativeTheme.themeSource = mode === 'light' ? 'light' : 'dark';
  });

  ipcMain.handle('dialog:pick-folder', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled || !filePaths.length ? null : filePaths[0];
  });

  // Imagen local para wallpaper: se lee y codifica a data URL acá mismo
  // (no se guarda la ruta) para que el perfil quede autocontenido y no
  // se rompa si el archivo original se mueve o se borra después.
  ipcMain.handle('dialog:pick-image', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (canceled || !filePaths.length) return null;

    const filePath = filePaths[0];
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_WALLPAPER_BYTES) {
      throw new Error(`La imagen pesa ${(stat.size / 1024 / 1024).toFixed(1)} MB — el máximo es 8 MB.`);
    }

    const ext = extname(filePath).slice(1).toLowerCase();
    const mime = IMAGE_MIME[ext] || 'application/octet-stream';
    const buf = await fs.readFile(filePath);
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: stat.size };
  });

  // Export/import de perfiles como JSON portable (necesitan diálogos
  // nativos con `mainWindow`, por eso viven acá y no en ipc.js — mismo
  // criterio que dialog:pick-folder/pick-image).
  ipcMain.handle('profiles:export', async (_e, { id }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true };
    const profile = await ipcHandle.storage.load(id);
    const safeName = (profile.name || 'workspace').replace(/[\\/:*?"<>|]/g, '_');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${safeName}.yusepe-bento.json`,
      filters: [{ name: 'YUSEPE Bento Workspace', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf8');
    return { canceled: false, filePath };
  });

  ipcMain.handle('profiles:import', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true };
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'YUSEPE Bento Workspace', extensions: ['json'] }],
    });
    if (canceled || !filePaths.length) return { canceled: true };

    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(filePaths[0], 'utf8'));
    } catch {
      throw new Error('El archivo no es un JSON válido.');
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.name) {
      throw new Error('El archivo no tiene el formato de un workspace de YUSEPE Bento.');
    }
    const profile = await ipcHandle.storage.importProfile(parsed);
    return { canceled: false, profile };
  });

  createWindow();
  setupMenu(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  ipcHandle?.dispose();
});
