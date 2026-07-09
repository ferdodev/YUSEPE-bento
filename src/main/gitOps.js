/**
 * src/main/gitOps.js
 * --------------------------------------------------------------
 * Operaciones de Git para el panel del cockpit (status, diff,
 * stage/unstage, commit, push). Ejecuta el `git` real instalado del
 * usuario vía child_process (sin dependencias nuevas), siempre en el
 * `cwd` del workspace activo.
 *
 * Alcance a propósito acotado a "lo del día a día" (ver status, subir
 * cambios). Para rebase, merges, stash, branches, etc. seguís usando
 * lazygit en una terminal — no intenta reemplazarlo.
 * --------------------------------------------------------------
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  if (!cwd) throw new Error('Este workspace no tiene una carpeta de inicio configurada.');
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    throw new Error((err.stderr || err.message || String(err)).trim());
  }
}

function parseBranchLine(line) {
  // "## master...origin/master [ahead 1, behind 2]" | "## master" | "## No commits yet on master"
  const m = line.match(/^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?:\s+\[(.+)\])?/);
  if (!m) return { branch: '(desconocido)', upstream: null, ahead: 0, behind: 0 };
  const [, branch, upstream, aheadBehind] = m;
  let ahead = 0;
  let behind = 0;
  if (aheadBehind) {
    const a = aheadBehind.match(/ahead (\d+)/);
    const b = aheadBehind.match(/behind (\d+)/);
    if (a) ahead = Number(a[1]);
    if (b) behind = Number(b[1]);
  }
  return { branch, upstream: upstream || null, ahead, behind };
}

/** Estado del repo: rama, ahead/behind, y archivos con su status. */
export async function getStatus(cwd) {
  const raw = await git(cwd, ['status', '--porcelain=v1', '-b']);
  const lines = raw.split('\n').filter(Boolean);
  const branchLine = lines.shift() || '';
  const branchInfo = parseBranchLine(branchLine);

  const files = lines.map((line) => {
    const index = line[0];
    const workTree = line[1];
    let filePath = line.slice(3);
    let renamedFrom = null;
    if (filePath.includes(' -> ')) {
      const [from, to] = filePath.split(' -> ');
      renamedFrom = from;
      filePath = to;
    }
    return {
      path: filePath,
      renamedFrom,
      index,
      workTree,
      untracked: index === '?' && workTree === '?',
      staged: index !== ' ' && index !== '?',
    };
  });

  return { ...branchInfo, files };
}

export async function getDiff(cwd, filePath, staged) {
  const args = ['diff', '--no-color'];
  if (staged) args.push('--cached');
  args.push('--', filePath);
  return git(cwd, args);
}

export async function stageFile(cwd, filePath) {
  await git(cwd, ['add', '--', filePath]);
}

export async function stageAll(cwd) {
  await git(cwd, ['add', '-A']);
}

export async function unstageFile(cwd, filePath) {
  // `git restore --staged` falla con "could not resolve HEAD" en un repo
  // sin commits todavía (rama "unborn"); `git reset -- file` funciona en
  // ambos casos.
  await git(cwd, ['reset', '--', filePath]);
}

export async function discardFile(cwd, filePath) {
  await git(cwd, ['checkout', '--', filePath]);
}

export async function commit(cwd, message) {
  await git(cwd, ['commit', '-m', message]);
}

export async function push(cwd) {
  await git(cwd, ['push']);
}

/** Ramas locales y remotas, con cuál está activa (HEAD). */
export async function listBranches(cwd) {
  const raw = await git(cwd, ['branch', '-a', '--format=%(refname:short)%00%(HEAD)']);
  const seen = new Set();
  const branches = [];
  for (const line of raw.split('\n').filter(Boolean)) {
    const [name, head] = line.split('\0');
    if (!name || name.includes('HEAD ->')) continue;
    const isRemote = name.startsWith('origin/') || name.startsWith('remotes/');
    const shortName = name.replace(/^remotes\//, '');
    if (seen.has(shortName)) continue;
    seen.add(shortName);
    branches.push({ name: shortName, remote: isRemote, current: head === '*' });
  }
  return branches;
}

export async function switchBranch(cwd, branch) {
  // Si es una rama remota sin tracking local (p.ej. "origin/feature-x"),
  // `checkout` crea automáticamente la rama local de tracking.
  await git(cwd, ['checkout', branch.replace(/^origin\//, '')]);
}

export async function createBranch(cwd, name) {
  await git(cwd, ['checkout', '-b', name]);
}
