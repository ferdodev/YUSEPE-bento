/**
 * src/main/agentOps.js
 * --------------------------------------------------------------
 * Panel "Agentes": detecta y edita los archivos de instrucciones que
 * leen los distintos asistentes de IA (Claude Code, Cursor, Copilot,
 * Windsurf, Cline, y el estándar abierto AGENTS.md), y lista los
 * subagentes de Claude Code definidos en .claude/agents/*.md.
 *
 * Mismo patrón de seguridad que explorerFs.js: toda ruta se resuelve
 * relativa al `cwd` del workspace y se valida que no escape de ahí.
 * --------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import path from 'path';

function resolveSafe(root, relPath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relPath || '.');
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Ruta fuera del workspace');
  }
  return resolved;
}

/** Ruta absoluta validada dentro del workspace (mismo patrón que explorerFs). */
export function resolvePath(cwd, relPath) {
  return resolveSafe(cwd, relPath);
}

/** Archivos de instrucciones que reconocemos, por orden de relevancia. */
export const INSTRUCTION_FILES = [
  { id: 'agents', label: 'AGENTS.md', relPath: 'AGENTS.md',
    hint: 'Estándar abierto — lo leen Codex, Cursor, aider y otros.' },
  { id: 'claude', label: 'CLAUDE.md', relPath: 'CLAUDE.md',
    hint: 'Instrucciones de proyecto para Claude Code.' },
  { id: 'cursor', label: '.cursorrules', relPath: '.cursorrules',
    hint: 'Reglas de proyecto para Cursor.' },
  { id: 'windsurf', label: '.windsurfrules', relPath: '.windsurfrules',
    hint: 'Reglas de proyecto para Windsurf.' },
  { id: 'cline', label: '.clinerules', relPath: '.clinerules',
    hint: 'Reglas de proyecto para Cline.' },
  { id: 'copilot', label: 'copilot-instructions.md', relPath: '.github/copilot-instructions.md',
    hint: 'Instrucciones de proyecto para GitHub Copilot.' },
];

/** Devuelve INSTRUCTION_FILES con `exists` por cada uno. */
export async function listInstructionFiles(cwd) {
  return Promise.all(INSTRUCTION_FILES.map(async (f) => {
    try {
      const stat = await fs.stat(resolveSafe(cwd, f.relPath));
      return { ...f, exists: stat.isFile() };
    } catch {
      return { ...f, exists: false };
    }
  }));
}

export async function readInstructionFile(cwd, relPath) {
  const file = resolveSafe(cwd, relPath);
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

/** Escritura atómica; crea la carpeta contenedora si hace falta (p.ej. .github/). */
export async function writeInstructionFile(cwd, relPath, content) {
  const file = resolveSafe(cwd, relPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

/** Frontmatter YAML mínimo: pares `clave: valor` entre líneas `---`. */
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { meta: {}, body: content };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    meta[key] = val;
  }
  return { meta, body: content.slice(m[0].length).trim() };
}

/** Subagentes de Claude Code: .claude/agents/*.md con frontmatter name/description/tools/model. */
export async function listSubagents(cwd) {
  const dir = resolveSafe(cwd, '.claude/agents');
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const relPath = path.join('.claude/agents', e.name);
    const content = await fs.readFile(path.join(dir, e.name), 'utf8').catch(() => '');
    const { meta } = parseFrontmatter(content);
    agents.push({
      relPath,
      name: meta.name || e.name.replace(/\.md$/, ''),
      description: meta.description || '',
      tools: meta.tools || '',
      model: meta.model || '',
    });
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}
