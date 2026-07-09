/**
 * src/main/explorerFs.js
 * --------------------------------------------------------------
 * Lectura de sistema de archivos para el tile "Explorador".
 * Todo acceso se resuelve relativo a un `root` (el cwd del workspace)
 * y se valida que no escape de ahí (protección básica contra path
 * traversal vía `..`) — la lectura queda acotada al árbol del workspace.
 * --------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import path from 'path';

const MAX_PREVIEW_BYTES = 1_000_000;

const MEDIA_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

function resolveSafe(root, relPath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relPath || '.');
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Ruta fuera del workspace');
  }
  return resolved;
}

/** Ruta absoluta validada dentro del workspace (para abrir con la app del sistema). */
export function resolvePath(root, relPath) {
  return resolveSafe(root, relPath);
}

/** Lista el contenido de una carpeta (carpetas primero, luego alfabético). */
export async function listDir(root, relPath = '.') {
  const dir = resolveSafe(root, relPath);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      relPath: relPath === '.' ? e.name : path.join(relPath, e.name),
    }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

const SEARCH_IGNORE = new Set(['node_modules', '.git', 'out', 'release', 'dist', '.vite', 'build']);
const SEARCH_RESULT_LIMIT = 200;
const SEARCH_SCAN_LIMIT = 20_000; // tope de entradas visitadas, por si algún ignore no aplica

/**
 * Búsqueda recursiva de archivos por nombre (substring, case-insensitive).
 * Salta carpetas ruidosas típicas (node_modules, .git, etc.) y corta en
 * `SEARCH_RESULT_LIMIT` resultados / `SEARCH_SCAN_LIMIT` entradas visitadas
 * para no colgarse en árboles enormes.
 */
export async function searchFiles(root, query) {
  const resolvedRoot = path.resolve(root);
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results = [];
  let scanned = 0;
  const queue = ['.'];

  while (queue.length && results.length < SEARCH_RESULT_LIMIT && scanned < SEARCH_SCAN_LIMIT) {
    const relDir = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(resolveSafe(resolvedRoot, relDir), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (results.length >= SEARCH_RESULT_LIMIT || scanned >= SEARCH_SCAN_LIMIT) break;
      scanned++;
      if (e.name.startsWith('.') && e.name !== '.env') continue;

      const relPath = relDir === '.' ? e.name : path.join(relDir, e.name);
      if (e.isDirectory()) {
        if (!SEARCH_IGNORE.has(e.name)) queue.push(relPath);
      } else if (e.name.toLowerCase().includes(q)) {
        results.push({ name: e.name, relPath });
      }
    }
  }

  return results;
}

/** Lee un archivo para preview. Detecta binarios y corta archivos grandes. */
export async function readFilePreview(root, relPath) {
  const file = resolveSafe(root, relPath);
  const stat = await fs.stat(file);
  if (stat.isDirectory()) throw new Error('Es una carpeta, no un archivo');

  if (stat.size > MAX_PREVIEW_BYTES) {
    return { truncated: true, binary: false, content: '', size: stat.size };
  }

  const buf = await fs.readFile(file);
  const sample = buf.subarray(0, 8000);
  const isBinary = sample.includes(0);
  if (isBinary) {
    return { truncated: false, binary: true, content: '', size: stat.size };
  }

  return { truncated: false, binary: false, content: buf.toString('utf8'), size: stat.size };
}

const MAX_MEDIA_BYTES = 50_000_000;

/**
 * Lee los bytes crudos de una imagen o PDF para previsualizar (no pasa por
 * el chequeo de "binario" de readFilePreview, que está pensado para texto).
 * Devuelve el Buffer directo — vía IPC llega al renderer como Uint8Array, y
 * de ahí va a pdf.js (`data`) o a un Blob para <img>. Se leen los bytes acá
 * a propósito, para no depender de que el renderer pueda descargar el
 * archivo por sí mismo (protocolos custom / fetch dan problemas).
 */
export async function readMediaBytes(root, relPath) {
  const mime = MEDIA_MIME_TYPES[path.extname(relPath).toLowerCase()];
  if (!mime) throw new Error('Tipo de archivo no soportado para previsualizar como medio');

  const file = resolveSafe(root, relPath);
  const stat = await fs.stat(file);
  if (stat.isDirectory()) throw new Error('Es una carpeta, no un archivo');
  if (stat.size > MAX_MEDIA_BYTES) {
    throw new Error(`El archivo pesa ${(stat.size / 1_000_000).toFixed(1)} MB — el máximo para previsualizar es 50 MB.`);
  }

  const buf = await fs.readFile(file);
  return { mime, bytes: buf };
}

/** Escribe un archivo (escritura atómica: .tmp + rename). */
export async function writeFile(root, relPath, content) {
  const file = resolveSafe(root, relPath);
  const stat = await fs.stat(file).catch(() => null);
  if (stat && stat.isDirectory()) throw new Error('Es una carpeta, no un archivo');

  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
  return { size: Buffer.byteLength(content, 'utf8') };
}
