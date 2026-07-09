/**
 * src/main/toolDetector.js
 * --------------------------------------------------------------
 * Detecta herramientas CLI ya instaladas (claude, opencode, lazygit,
 * lazydocker, vim/nvim, btop) para ofrecerlas como acceso directo en
 * "Agregar al espacio" (terminal precargada con ese comando).
 *
 * Importante: NO se busca con el PATH crudo de Electron (process.env.PATH),
 * porque las apps de GUI en macOS arrancan con un PATH mínimo que no
 * incluye lo que agregan Homebrew/nvm/etc en ~/.zshrc — el mismo comando
 * podría funcionar perfecto dentro de una terminal real de la app y sin
 * embargo no detectarse acá. Para evitar falsos negativos, se invoca el
 * shell del usuario en modo interactivo (`-ic`), que sí carga ese entorno.
 * --------------------------------------------------------------
 */
import { spawn } from 'child_process';

export const TOOLS = [
  { id: 'claude', label: 'Claude Code', bin: 'claude' },
  { id: 'opencode', label: 'opencode', bin: 'opencode' },
  { id: 'lazygit', label: 'lazygit', bin: 'lazygit' },
  { id: 'lazydocker', label: 'lazydocker', bin: 'lazydocker' },
  { id: 'nvim', label: 'Neovim', bin: 'nvim' },
  { id: 'vim', label: 'Vim', bin: 'vim' },
  { id: 'btop', label: 'btop', bin: 'btop' },
];

function isAvailable(bin) {
  return new Promise((resolve) => {
    let cmd;
    let args;
    if (process.platform === 'win32') {
      cmd = 'where';
      args = [bin];
    } else {
      cmd = process.env.SHELL || '/bin/zsh';
      args = ['-ic', `command -v ${bin}`];
    }

    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };

    let child;
    try {
      child = spawn(cmd, args, { stdio: 'ignore' });
    } catch {
      finish(false);
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      finish(false);
    }, 4000);

    child.on('exit', (code) => { clearTimeout(timer); finish(code === 0); });
    child.on('error', () => { clearTimeout(timer); finish(false); });
  });
}

/** Devuelve TOOLS con un flag `available` por cada uno (chequeo en paralelo). */
export async function detectTools() {
  return Promise.all(TOOLS.map(async (t) => ({ ...t, available: await isAvailable(t.bin) })));
}
