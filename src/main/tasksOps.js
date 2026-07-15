/**
 * src/main/tasksOps.js
 * --------------------------------------------------------------
 * App de Tareas: lista de tareas por workspace, respaldada en archivos
 * `.md` reales dentro del proyecto (`.ybento/tasks/`).
 *
 * Mismo patrón de seguridad que explorerFs.js/agentOps.js: toda ruta se
 * resuelve relativa al `cwd` del workspace y se valida que no escape.
 *
 * ¿Por qué un archivo por tarea y no un JSON con todo?
 *   - Cada tarea tiene una ruta propia, que es lo que va a necesitar el
 *     `launchText` para pasársela al agente de código ({{task_route}}).
 *   - Son .md de verdad: se leen, se editan a mano y se versionan con
 *     git como cualquier archivo del proyecto.
 *   - Sin índice aparte no hay dos fuentes de verdad que se desincronicen:
 *     el estado ES el directorio.
 *
 * Formato (frontmatter mínimo + cuerpo libre para notas):
 *
 *     ---
 *     title: Arreglar el login
 *     done: false
 *     createdAt: 2026-07-15T12:00:00.000Z
 *     ---
 *
 *     Notas libres de la tarea.
 *
 * El parser es a propósito chiquito (3 claves, sin anidar): no queremos
 * una dependencia de YAML para esto. Lo que no reconoce, lo ignora sin
 * romper — un .md editado a mano nunca debería tirar la lista abajo.
 * --------------------------------------------------------------
 */
import { promises as fs, watch } from 'fs';
import path from 'path';

export const TASKS_DIR = path.join('.ybento', 'tasks');

/**
 * Plantilla del "launchText": el texto que se le pasa al agente de código
 * para que arranque una tarea. Vive en el proyecto (y no en el perfil de
 * Bento) por dos razones: viaja con el repo — si el equipo comparte las
 * tareas, comparte también cómo se lanzan — y se edita a mano como
 * cualquier otro archivo.
 */
export const LAUNCH_TEMPLATE_FILE = path.join('.ybento', 'launch-template.md');

// El cierre del ciclo (que el agente marque la tarea como completada al
// terminar) va en el default porque es lo que hace que la lista se mantenga
// sola: sin esa línea, el agente hace el trabajo pero la tarea queda
// pendiente para siempre y hay que cerrarla a mano.
// Se le dice *cómo* (done: true en el frontmatter) y no sólo "marcala":
// siendo explícito, cualquier agente acierta sin tener que deducir el
// formato del .md.
export const DEFAULT_LAUNCH_TEMPLATE =
  'Ejecuta la siguiente tarea: {{task_title}}\n\n' +
  'La descripción completa está en {{task_route}} — leela antes de empezar.\n\n' +
  'Al finalizar la tarea, marcala como completada: poné `done: true` en el ' +
  'frontmatter de {{task_route}}.\n';

function resolveSafe(root, relPath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relPath || '.');
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Ruta fuera del workspace');
  }
  return resolved;
}

/** Ruta absoluta de una tarea, validada dentro del workspace. */
export function resolveTaskPath(cwd, id) {
  const name = String(id || '');
  // El id viene del renderer: si trajera separadores podría apuntar a otro
  // lado del árbol. Sólo se acepta un nombre de archivo .md pelado.
  if (!name || name !== path.basename(name) || !name.endsWith('.md')) {
    throw new Error('Id de tarea inválido');
  }
  return resolveSafe(cwd, path.join(TASKS_DIR, name));
}

/* ---------- Frontmatter ---------- */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatter(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: raw };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (key) data[key] = value;
  }
  return { data, body: raw.slice(match[0].length) };
}

function serialize({ title, done, createdAt }, body = '') {
  // El título va en una línea del frontmatter: los saltos lo romperían.
  const safeTitle = String(title).replace(/\r?\n/g, ' ').trim();
  return `---\ntitle: ${safeTitle}\ndone: ${done ? 'true' : 'false'}\ncreatedAt: ${createdAt}\n---\n\n${body}`;
}

/** Nombre de archivo legible y seguro a partir del título. */
function slugify(title) {
  const slug = String(title)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // saca tildes/diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  // Un título de puros emojis/símbolos puede quedar vacío: no podemos
  // producir un nombre de archivo vacío ni ".md" a secas.
  return slug || 'tarea';
}

/* ---------- API ---------- */

/**
 * Lista las tareas del workspace. Pendientes primero, y dentro de cada
 * grupo por fecha de creación (las más nuevas arriba).
 * Si todavía no existe `.ybento/tasks/`, devuelve [] — no se crea nada
 * hasta que haya una tarea de verdad que guardar.
 */
export async function listTasks(cwd) {
  const dir = resolveSafe(cwd, TASKS_DIR);

  let names;
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const tasks = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    let raw;
    try {
      raw = await fs.readFile(path.join(dir, name), 'utf8');
    } catch {
      continue; // borrado mientras leíamos, o ilegible: no vale tirar la lista
    }
    const { data, body } = parseFrontmatter(raw);
    tasks.push({
      id: name,
      title: data.title || name.replace(/\.md$/, ''),
      done: data.done === 'true',
      createdAt: data.createdAt || '',
      notes: body.trim(),
      relPath: path.join(TASKS_DIR, name),
    });
  }

  return tasks.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

/** Crea una tarea nueva. Devuelve la tarea creada. */
export async function createTask(cwd, title) {
  const clean = String(title || '').trim();
  if (!clean) throw new Error('La tarea necesita un título');

  const dir = resolveSafe(cwd, TASKS_DIR);
  await fs.mkdir(dir, { recursive: true });

  const base = slugify(clean);
  const createdAt = new Date().toISOString();

  // Exclusivo ('wx'): si dos tareas comparten título, la segunda va a
  // `-2` en vez de pisar la primera.
  let name = `${base}.md`;
  for (let n = 2; ; n++) {
    try {
      const handle = await fs.open(path.join(dir, name), 'wx');
      await handle.writeFile(serialize({ title: clean, done: false, createdAt }), 'utf8');
      await handle.close();
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      name = `${base}-${n}.md`;
    }
  }

  return { id: name, title: clean, done: false, createdAt, notes: '', relPath: path.join(TASKS_DIR, name) };
}

/**
 * Marca/desmarca una tarea. Reescribe solo el frontmatter y conserva el
 * cuerpo tal cual — si el usuario escribió notas a mano, no se pierden.
 */
export async function setTaskDone(cwd, id, done) {
  const file = resolveTaskPath(cwd, id);
  const raw = await fs.readFile(file, 'utf8');
  const { data, body } = parseFrontmatter(raw);

  const next = serialize({
    title: data.title || String(id).replace(/\.md$/, ''),
    done: !!done,
    createdAt: data.createdAt || new Date().toISOString(),
  }, body.replace(/^\n+/, ''));

  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, next, 'utf8');
  await fs.rename(tmp, file);

  return { id, done: !!done };
}

/**
 * Edita título y/o descripción de una tarea. `done` y `createdAt` se
 * conservan siempre — esto es el detalle, no el estado.
 *
 * El nombre del archivo NO cambia aunque cambie el título: el id es el
 * archivo, el título es metadato. Renombrar el .md al reeditar el título
 * dejaría colgada cualquier referencia a su ruta (que es justo lo que va a
 * consumir el `launchText` con {{task_route}}), a cambio de que el nombre
 * "se lea lindo". No vale la pena.
 */
export async function updateTask(cwd, id, { title, notes } = {}) {
  const file = resolveTaskPath(cwd, id);
  const raw = await fs.readFile(file, 'utf8');
  const { data, body } = parseFrontmatter(raw);

  const nextTitle = title === undefined
    ? (data.title || String(id).replace(/\.md$/, ''))
    : String(title).trim();
  if (!nextTitle) throw new Error('La tarea necesita un título');

  const nextNotes = notes === undefined ? body.replace(/^\n+/, '') : String(notes);

  const next = serialize({
    title: nextTitle,
    done: data.done === 'true',
    createdAt: data.createdAt || new Date().toISOString(),
  }, nextNotes);

  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, next, 'utf8');
  await fs.rename(tmp, file);

  return {
    id,
    title: nextTitle,
    done: data.done === 'true',
    createdAt: data.createdAt || '',
    notes: nextNotes.trim(),
    relPath: path.join(TASKS_DIR, id),
  };
}

/** Borra el .md de una tarea. */
export async function deleteTask(cwd, id) {
  await fs.unlink(resolveTaskPath(cwd, id));
  return { id };
}

/* ---------- Vigilancia del directorio ---------- */

/**
 * Avisa cuando algo cambia en `.ybento/tasks/`.
 *
 * Existe porque las tareas no las toca sólo Bento: el agente de código
 * marca `done: true` en el .md cuando termina (es lo que pide el
 * launchText), y el usuario puede editarlas a mano. Sin esto, la lista
 * miente hasta que alguien la recarga.
 *
 * Devuelve una función para cortar la vigilancia, o `null` si la carpeta
 * todavía no existe — no la creamos sólo por querer mirarla; el que llama
 * puede reintentar cuando haya una tarea de verdad.
 *
 * `persistent: false`: un watcher no debe ser motivo para que el proceso
 * siga vivo.
 */
export function watchTasks(cwd, onChange) {
  const dir = resolveSafe(cwd, TASKS_DIR);

  let watcher;
  try {
    watcher = watch(dir, { persistent: false }, () => onChange());
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  // fs.watch emite 'error' si la carpeta desaparece; no vale tirar el main
  // abajo por eso — se corta la vigilancia y listo.
  watcher.on('error', () => watcher.close());

  return () => watcher.close();
}

/* ---------- launchText ---------- */

/** Variables que entiende la plantilla, con su descripción para la UI. */
export const LAUNCH_VARIABLES = [
  { name: 'task_route', hint: 'Ruta de la tarea, relativa al proyecto (.ybento/tasks/…)' },
  { name: 'task_title', hint: 'Título de la tarea' },
  { name: 'task_notes', hint: 'Descripción completa de la tarea' },
  { name: 'project_root', hint: 'Ruta absoluta del workspace' },
];

/**
 * Sustituye `{{variable}}` por su valor.
 *
 * Lo que no reconoce lo deja tal cual, a propósito: si el usuario escribe
 * `{{task_rout}}`, ver el placeholder crudo en el texto copiado le dice
 * dónde está el error. Reemplazarlo por vacío lo escondería.
 *
 * Tolera espacios (`{{ task_route }}`). Los valores se insertan de una y
 * no se re-procesan, así que una descripción que contenga `{{...}}` no
 * dispara otra sustitución.
 */
export function applyTemplate(template, vars) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? '') : match);
}

/** Lee la plantilla del proyecto; si no existe todavía, devuelve la default. */
export async function readLaunchTemplate(cwd) {
  const file = resolveSafe(cwd, LAUNCH_TEMPLATE_FILE);
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return DEFAULT_LAUNCH_TEMPLATE;
    throw err;
  }
}

/** Guarda la plantilla del proyecto (escritura atómica). */
export async function writeLaunchTemplate(cwd, content) {
  const file = resolveSafe(cwd, LAUNCH_TEMPLATE_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });

  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, String(content ?? ''), 'utf8');
  await fs.rename(tmp, file);
  return { relPath: LAUNCH_TEMPLATE_FILE };
}

/** Texto listo para pegarle al agente, para una tarea puntual. */
export async function getLaunchText(cwd, id) {
  const file = resolveTaskPath(cwd, id);
  const raw = await fs.readFile(file, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const template = await readLaunchTemplate(cwd);

  return applyTemplate(template, {
    task_route: path.join(TASKS_DIR, id),
    task_title: data.title || String(id).replace(/\.md$/, ''),
    task_notes: body.trim(),
    project_root: path.resolve(cwd),
  });
}
