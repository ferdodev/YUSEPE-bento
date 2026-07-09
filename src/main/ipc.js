/**
 * src/main/ipc.js
 * --------------------------------------------------------------
 * Punto único donde se registran los handlers de IPC.
 * Mantiene el main.js limpio y centraliza la lógica de:
 *   - Perfiles (CRUD)
 *   - PTY (crear terminales por webContents del sender)
 * --------------------------------------------------------------
 */
import { ipcMain, shell } from 'electron';
import { join } from 'path';
import { ProfileStorage } from './storage.js';
import { detectTools } from './toolDetector.js';
import { listDir, readFilePreview, readMediaBytes, resolvePath, searchFiles, writeFile } from './explorerFs.js';
import * as gitOps from './gitOps.js';
import * as agentOps from './agentOps.js';
import * as pexelsOps from './pexelsOps.js';
import { SnippetsStore } from './snippetsOps.js';

// Carga pty de forma perezosa: si falla (p.ej. sin recompilar)
// no rompemos el arranque de la app.
let pty = null;
function getPty() {
  if (pty) return pty;
  try {
    pty = require('node-pty');
    return pty;
  } catch (err) {
    console.warn('[ipc] node-pty no disponible:', err.message);
    return null;
  }
}

/**
 * @param {{ app: import('electron').App, profilesDir: string }} opts
 * @returns {{ storage: ProfileStorage, dispose: () => void }}
 */
export function registerIpc({ app, profilesDir }) {
  const storage = new ProfileStorage(profilesDir);
  const snippets = new SnippetsStore(join(app.getPath('userData'), 'snippets.json'));

  // -------- Perfiles --------
  ipcMain.handle('profiles:list', () => storage.list());
  ipcMain.handle('profiles:create', (_e, payload) => storage.create(payload));
  ipcMain.handle('profiles:load', (_e, id) => storage.load(id));
  ipcMain.handle('profiles:save', (_e, profile) => storage.save(profile));
  ipcMain.handle('profiles:delete', (_e, id) => storage.remove(id));
  ipcMain.handle('profiles:rename', (_e, { id, name }) => storage.rename(id, name));
  ipcMain.handle('profiles:exists', (_e, name) => storage.isNameTaken(name));
  ipcMain.handle('profiles:set-cwd', (_e, { id, cwd }) => storage.setCwd(id, cwd));
  ipcMain.handle('profiles:touch', (_e, id) => storage.touchLastOpened(id));
  ipcMain.handle('profiles:set-wallpaper', (_e, { id, wallpaper }) => storage.setWallpaper(id, wallpaper));

  // -------- Detección de herramientas CLI --------
  ipcMain.handle('tools:detect', () => detectTools());

  // -------- Explorador de archivos --------
  ipcMain.handle('explorer:list', (_e, { root, relPath }) =>
    listDir(root || app.getPath('home'), relPath));
  ipcMain.handle('explorer:read', (_e, { root, relPath }) =>
    readFilePreview(root || app.getPath('home'), relPath));
  ipcMain.handle('explorer:search', (_e, { root, query }) =>
    searchFiles(root || app.getPath('home'), query));
  ipcMain.handle('explorer:write', (_e, { root, relPath, content }) =>
    writeFile(root || app.getPath('home'), relPath, content));
  ipcMain.handle('explorer:read-media', (_e, { root, relPath }) =>
    readMediaBytes(root || app.getPath('home'), relPath));
  ipcMain.handle('explorer:open-in-system', (_e, { root, relPath }) =>
    shell.openPath(resolvePath(root || app.getPath('home'), relPath)));

  // -------- Git --------
  ipcMain.handle('git:status', (_e, { cwd }) => gitOps.getStatus(cwd));
  ipcMain.handle('git:diff', (_e, { cwd, filePath, staged }) => gitOps.getDiff(cwd, filePath, staged));
  ipcMain.handle('git:stage', (_e, { cwd, filePath }) => gitOps.stageFile(cwd, filePath));
  ipcMain.handle('git:stage-all', (_e, { cwd }) => gitOps.stageAll(cwd));
  ipcMain.handle('git:unstage', (_e, { cwd, filePath }) => gitOps.unstageFile(cwd, filePath));
  ipcMain.handle('git:discard', (_e, { cwd, filePath }) => gitOps.discardFile(cwd, filePath));
  ipcMain.handle('git:commit', (_e, { cwd, message }) => gitOps.commit(cwd, message));
  ipcMain.handle('git:push', (_e, { cwd }) => gitOps.push(cwd));
  ipcMain.handle('git:branches', (_e, { cwd }) => gitOps.listBranches(cwd));
  ipcMain.handle('git:switch-branch', (_e, { cwd, branch }) => gitOps.switchBranch(cwd, branch));
  ipcMain.handle('git:create-branch', (_e, { cwd, name }) => gitOps.createBranch(cwd, name));

  ipcMain.handle('agents:instruction-files', (_e, { cwd }) => agentOps.listInstructionFiles(cwd));
  ipcMain.handle('agents:read-instruction-file', (_e, { cwd, relPath }) => agentOps.readInstructionFile(cwd, relPath));
  ipcMain.handle('agents:write-instruction-file', (_e, { cwd, relPath, content }) => agentOps.writeInstructionFile(cwd, relPath, content));
  ipcMain.handle('agents:subagents', (_e, { cwd }) => agentOps.listSubagents(cwd));

  // -------- Pexels (buscador de wallpapers) --------
  ipcMain.handle('pexels:search', (_e, { query, page }) => pexelsOps.searchPhotos(query, page));

  // -------- Snippets (librería global de comandos/rutinas) --------
  ipcMain.handle('snippets:list', () => snippets.list());
  ipcMain.handle('snippets:create', (_e, payload) => snippets.create(payload));
  ipcMain.handle('snippets:update', (_e, { id, ...patch }) => snippets.update(id, patch));
  ipcMain.handle('snippets:delete', (_e, { id }) => snippets.remove(id));

  // -------- PTY / Terminal --------
  /** Mapa de ptyId -> { proc, senderId } */
  const ptys = new Map();
  let ptySeq = 0;

  ipcMain.handle('pty:create', async (event, { cols, rows, cwd, shell } = {}) => {
    const lib = getPty();
    if (!lib) throw new Error('node-pty no está disponible en este binario');

    const ptyId = `pty_${++ptySeq}`;
    const useShell =
      shell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash');

    const shellArgs = process.platform === 'win32' ? [] : ['-l'];

    const proc = lib.spawn(useShell, shellArgs, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: cwd || app.getPath('home'),
      env: process.env,
    });

    proc.onData((data) => {
      // Reenviamos solo al webContents que creó esta pty
      if (!event.sender.isDestroyed()) {
        event.sender.send(`pty:data:${ptyId}`, data);
      }
    });

    proc.onExit(({ exitCode }) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`pty:exit:${ptyId}`, exitCode);
      }
      ptys.delete(ptyId);
    });

    ptys.set(ptyId, { proc, senderId: event.sender.id });
    return { ptyId, shell: useShell };
  });

  ipcMain.on('pty:input', (_e, { ptyId, data }) => {
    const entry = ptys.get(ptyId);
    if (entry) entry.proc.write(data);
  });

  ipcMain.on('pty:resize', (_e, { ptyId, cols, rows }) => {
    const entry = ptys.get(ptyId);
    if (entry) {
      try {
        entry.proc.resize(Math.max(2, cols | 0), Math.max(2, rows | 0));
      } catch {
        // resize puede fallar si el proceso ya terminó; lo ignoramos
      }
    }
  });

  ipcMain.on('pty:kill', (_e, { ptyId }) => {
    const entry = ptys.get(ptyId);
    if (entry) {
      try { entry.proc.kill(); } catch { /* noop */ }
      ptys.delete(ptyId);
    }
  });

  const dispose = () => {
    for (const { proc } of ptys.values()) {
      try { proc.kill(); } catch { /* noop */ }
    }
    ptys.clear();
    ipcMain.removeHandler('profiles:list');
    ipcMain.removeHandler('profiles:create');
    ipcMain.removeHandler('profiles:load');
    ipcMain.removeHandler('profiles:save');
    ipcMain.removeHandler('profiles:delete');
    ipcMain.removeHandler('profiles:rename');
    ipcMain.removeHandler('profiles:exists');
    ipcMain.removeHandler('profiles:set-cwd');
    ipcMain.removeHandler('profiles:touch');
    ipcMain.removeHandler('tools:detect');
    ipcMain.removeHandler('explorer:list');
    ipcMain.removeHandler('explorer:read');
    ipcMain.removeHandler('explorer:search');
    ipcMain.removeHandler('explorer:write');
    ipcMain.removeHandler('explorer:read-media');
    ipcMain.removeHandler('explorer:open-in-system');
    ipcMain.removeHandler('git:status');
    ipcMain.removeHandler('git:diff');
    ipcMain.removeHandler('git:stage');
    ipcMain.removeHandler('git:stage-all');
    ipcMain.removeHandler('git:unstage');
    ipcMain.removeHandler('git:discard');
    ipcMain.removeHandler('git:commit');
    ipcMain.removeHandler('git:push');
    ipcMain.removeHandler('git:branches');
    ipcMain.removeHandler('git:switch-branch');
    ipcMain.removeHandler('git:create-branch');
    ipcMain.removeHandler('agents:instruction-files');
    ipcMain.removeHandler('agents:read-instruction-file');
    ipcMain.removeHandler('agents:write-instruction-file');
    ipcMain.removeHandler('agents:subagents');
    ipcMain.removeHandler('profiles:set-wallpaper');
    ipcMain.removeHandler('pexels:search');
    ipcMain.removeHandler('snippets:list');
    ipcMain.removeHandler('snippets:create');
    ipcMain.removeHandler('snippets:update');
    ipcMain.removeHandler('snippets:delete');
  };

  return { storage, dispose };
}
