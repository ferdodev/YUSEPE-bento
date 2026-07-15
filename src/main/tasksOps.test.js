/**
 * src/main/tasksOps.test.js
 * --------------------------------------------------------------
 * App de Tareas sobre disco real (dir temporal), igual que
 * storage.test.js / explorerFs.test.js.
 *
 * Lo que más importa acá: las tareas son archivos `.md` del proyecto del
 * usuario, editables a mano. Así que se cubre (a) que el estado sobreviva
 * el ida y vuelta a disco, (b) que un .md tocado a mano no rompa la lista,
 * (c) que las notas escritas por el usuario no se pierdan al marcar una
 * tarea, y (d) que un id malicioso no escriba fuera de .ybento/tasks.
 * --------------------------------------------------------------
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, default as fsSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  applyTemplate, createTask, DEFAULT_LAUNCH_TEMPLATE, deleteTask, getLaunchText,
  LAUNCH_TEMPLATE_FILE, listTasks, readLaunchTemplate, resolveTaskPath, setTaskDone,
  TASKS_DIR, updateTask, watchTasks, writeLaunchTemplate,
} from './tasksOps.js';

let cwd;
const tasksDir = () => path.join(cwd, TASKS_DIR);

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-tasks-test-'));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

describe('listTasks', () => {
  it('devuelve [] si el workspace todavía no tiene .ybento', async () => {
    expect(await listTasks(cwd)).toEqual([]);
    // y no crea la carpeta solo por mirar
    await expect(fs.stat(path.join(cwd, '.ybento'))).rejects.toThrow();
  });

  it('ignora archivos que no son .md', async () => {
    await createTask(cwd, 'Real');
    await fs.writeFile(path.join(tasksDir(), '.DS_Store'), 'basura');
    await fs.writeFile(path.join(tasksDir(), 'notas.txt'), 'otra cosa');

    const tasks = await listTasks(cwd);
    expect(tasks.map((t) => t.title)).toEqual(['Real']);
  });

  it('ordena pendientes primero y las más nuevas arriba', async () => {
    const vieja = await createTask(cwd, 'Vieja');
    await new Promise((r) => setTimeout(r, 5)); // createdAt distinto
    await createTask(cwd, 'Nueva');
    await createTask(cwd, 'Hecha');
    await setTaskDone(cwd, 'hecha.md', true);
    await setTaskDone(cwd, vieja.id, false);

    const tasks = await listTasks(cwd);
    expect(tasks.map((t) => t.title)).toEqual(['Nueva', 'Vieja', 'Hecha']);
  });

  it('un .md editado a mano sin frontmatter no rompe la lista', async () => {
    await createTask(cwd, 'Buena');
    await fs.writeFile(path.join(tasksDir(), 'a-mano.md'), 'escribí esto sin frontmatter');

    const tasks = await listTasks(cwd);
    expect(tasks).toHaveLength(2);
    // cae al nombre de archivo como título, y se asume pendiente
    const suelta = tasks.find((t) => t.id === 'a-mano.md');
    expect(suelta).toMatchObject({ title: 'a-mano', done: false });
  });
});

describe('createTask', () => {
  it('crea el .md con frontmatter y lo deja pendiente', async () => {
    const task = await createTask(cwd, 'Arreglar el login');

    expect(task).toMatchObject({
      id: 'arreglar-el-login.md',
      title: 'Arreglar el login',
      done: false,
      relPath: path.join('.ybento', 'tasks', 'arreglar-el-login.md'),
    });

    const raw = await fs.readFile(path.join(tasksDir(), task.id), 'utf8');
    expect(raw).toContain('title: Arreglar el login');
    expect(raw).toContain('done: false');
  });

  it('el slug saca tildes y caracteres raros', async () => {
    const task = await createTask(cwd, '¡Añadir validación (urgente)!');
    expect(task.id).toBe('anadir-validacion-urgente.md');
  });

  it('un título sin caracteres usables no produce un nombre vacío', async () => {
    const task = await createTask(cwd, '🔥🔥🔥');
    expect(task.id).toBe('tarea.md');
  });

  it('dos tareas con el mismo título no se pisan', async () => {
    const a = await createTask(cwd, 'Revisar PR');
    const b = await createTask(cwd, 'Revisar PR');

    expect(a.id).toBe('revisar-pr.md');
    expect(b.id).toBe('revisar-pr-2.md');
    expect(await listTasks(cwd)).toHaveLength(2);
  });

  it('rechaza título vacío', async () => {
    await expect(createTask(cwd, '   ')).rejects.toThrow(/título/i);
  });

  it('un título con saltos de línea no rompe el frontmatter', async () => {
    const task = await createTask(cwd, 'Primera línea\nsegunda línea');

    const tasks = await listTasks(cwd);
    expect(tasks.find((t) => t.id === task.id).title).toBe('Primera línea segunda línea');
    expect(tasks).toHaveLength(1);
  });
});

describe('setTaskDone', () => {
  it('marca y desmarca, y persiste en disco', async () => {
    const task = await createTask(cwd, 'Pendiente');

    await setTaskDone(cwd, task.id, true);
    expect((await listTasks(cwd))[0].done).toBe(true);

    await setTaskDone(cwd, task.id, false);
    expect((await listTasks(cwd))[0].done).toBe(false);
  });

  it('conserva las notas que el usuario escribió a mano en el cuerpo', async () => {
    const task = await createTask(cwd, 'Con notas');
    const file = path.join(tasksDir(), task.id);
    const raw = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, raw + 'Estas notas las escribí yo.\n- un punto\n');

    await setTaskDone(cwd, task.id, true);

    const after = await fs.readFile(file, 'utf8');
    expect(after).toContain('Estas notas las escribí yo.');
    expect(after).toContain('- un punto');
    expect(after).toContain('done: true');
    expect((await listTasks(cwd))[0].notes).toContain('Estas notas las escribí yo.');
  });

  it('conserva el createdAt original', async () => {
    const task = await createTask(cwd, 'X');
    await setTaskDone(cwd, task.id, true);
    expect((await listTasks(cwd))[0].createdAt).toBe(task.createdAt);
  });
});

describe('updateTask', () => {
  it('guarda la descripción y la devuelve en el listado', async () => {
    const task = await createTask(cwd, 'Con detalle');

    await updateTask(cwd, task.id, { notes: 'Pasos:\n1. mirar el log\n2. reproducir' });

    const [saved] = await listTasks(cwd);
    expect(saved.notes).toBe('Pasos:\n1. mirar el log\n2. reproducir');
  });

  it('edita el título sin renombrar el archivo (el id es estable)', async () => {
    const task = await createTask(cwd, 'Título viejo');

    const updated = await updateTask(cwd, task.id, { title: 'Título nuevo' });

    expect(updated.id).toBe('titulo-viejo.md');
    expect(updated.title).toBe('Título nuevo');
    await expect(fs.stat(path.join(tasksDir(), 'titulo-viejo.md'))).resolves.toBeTruthy();
    expect((await listTasks(cwd))[0].title).toBe('Título nuevo');
  });

  it('conserva done y createdAt (editar el detalle no toca el estado)', async () => {
    const task = await createTask(cwd, 'Hecha');
    await setTaskDone(cwd, task.id, true);

    await updateTask(cwd, task.id, { title: 'Hecha y editada', notes: 'algo' });

    const [saved] = await listTasks(cwd);
    expect(saved.done).toBe(true);
    expect(saved.createdAt).toBe(task.createdAt);
  });

  it('editar solo el título no borra las notas, y viceversa', async () => {
    const task = await createTask(cwd, 'X');
    await updateTask(cwd, task.id, { title: 'X', notes: 'no me borres' });

    await updateTask(cwd, task.id, { title: 'Y' });
    expect((await listTasks(cwd))[0].notes).toBe('no me borres');

    await updateTask(cwd, task.id, { notes: 'nuevas notas' });
    expect((await listTasks(cwd))[0].title).toBe('Y');
  });

  it('permite vaciar la descripción', async () => {
    const task = await createTask(cwd, 'X');
    await updateTask(cwd, task.id, { notes: 'algo' });

    await updateTask(cwd, task.id, { notes: '' });
    expect((await listTasks(cwd))[0].notes).toBe('');
  });

  it('una descripción con --- no rompe el parseo del frontmatter', async () => {
    const task = await createTask(cwd, 'Con separadores');

    await updateTask(cwd, task.id, { notes: 'Antes\n\n---\n\nDespués' });

    const [saved] = await listTasks(cwd);
    expect(saved.title).toBe('Con separadores');
    expect(saved.notes).toBe('Antes\n\n---\n\nDespués');
  });

  it('rechaza vaciar el título', async () => {
    const task = await createTask(cwd, 'X');
    await expect(updateTask(cwd, task.id, { title: '  ' })).rejects.toThrow(/título/i);
  });

  it('rechaza un id con traversal', async () => {
    await expect(updateTask(cwd, '../fuera.md', { notes: 'x' })).rejects.toThrow(/inválido/i);
  });
});

describe('deleteTask', () => {
  it('borra el .md', async () => {
    const task = await createTask(cwd, 'Chau');
    await deleteTask(cwd, task.id);

    expect(await listTasks(cwd)).toEqual([]);
    await expect(fs.stat(path.join(tasksDir(), task.id))).rejects.toThrow();
  });
});

describe('applyTemplate', () => {
  it('sustituye variables conocidas', () => {
    expect(applyTemplate('Hacé {{a}} y después {{b}}', { a: 'esto', b: 'lo otro' }))
      .toBe('Hacé esto y después lo otro');
  });

  it('repite la misma variable todas las veces que aparezca', () => {
    expect(applyTemplate('{{x}} {{x}} {{x}}', { x: 'ping' })).toBe('ping ping ping');
  });

  it('tolera espacios dentro de las llaves', () => {
    expect(applyTemplate('{{ task_route }}', { task_route: 'r.md' })).toBe('r.md');
  });

  it('deja intacto lo que no reconoce (para que se vea el typo)', () => {
    expect(applyTemplate('{{task_rout}} y {{task_route}}', { task_route: 'ok.md' }))
      .toBe('{{task_rout}} y ok.md');
  });

  it('no re-procesa los valores insertados', () => {
    // Si una descripción trae {{...}}, no debe disparar otra sustitución.
    const out = applyTemplate('{{notes}}', { notes: 'literal {{task_title}}', task_title: 'X' });
    expect(out).toBe('literal {{task_title}}');
  });

  it('una variable vacía o nula queda como cadena vacía', () => {
    expect(applyTemplate('[{{a}}][{{b}}]', { a: '', b: null })).toBe('[][]');
  });
});

describe('launchTemplate', () => {
  it('sin archivo devuelve la plantilla por defecto y no crea nada', async () => {
    expect(await readLaunchTemplate(cwd)).toBe(DEFAULT_LAUNCH_TEMPLATE);
    await expect(fs.stat(path.join(cwd, '.ybento'))).rejects.toThrow();
  });

  it('guarda y relee la plantilla del proyecto', async () => {
    await writeLaunchTemplate(cwd, 'Andá con {{task_route}}');

    expect(await readLaunchTemplate(cwd)).toBe('Andá con {{task_route}}');
    const onDisk = await fs.readFile(path.join(cwd, LAUNCH_TEMPLATE_FILE), 'utf8');
    expect(onDisk).toBe('Andá con {{task_route}}');
  });
});

describe('getLaunchText', () => {
  it('usa la plantilla por defecto si el proyecto no definió una', async () => {
    const task = await createTask(cwd, 'Arreglar el login');

    const text = await getLaunchText(cwd, task.id);

    expect(text).toContain('Arreglar el login');
    expect(text).toContain(path.join('.ybento', 'tasks', 'arreglar-el-login.md'));
    expect(text).not.toContain('{{');
  });

  it('rellena todas las variables documentadas', async () => {
    const task = await createTask(cwd, 'Mi tarea');
    await updateTask(cwd, task.id, { notes: 'Los detalles.' });
    await writeLaunchTemplate(cwd,
      'T:{{task_title}}|R:{{task_route}}|N:{{task_notes}}|P:{{project_root}}');

    const text = await getLaunchText(cwd, task.id);

    expect(text).toBe(
      `T:Mi tarea|R:${path.join('.ybento', 'tasks', 'mi-tarea.md')}|N:Los detalles.|P:${path.resolve(cwd)}`);
  });

  it('task_route es relativa al proyecto (el agente corre en el cwd)', async () => {
    const task = await createTask(cwd, 'X');
    await writeLaunchTemplate(cwd, '{{task_route}}');

    const text = await getLaunchText(cwd, task.id);

    expect(path.isAbsolute(text)).toBe(false);
    expect(text).toBe(path.join('.ybento', 'tasks', 'x.md'));
  });

  it('refleja la descripción tal como quedó en el .md', async () => {
    const task = await createTask(cwd, 'Con cuerpo');
    await updateTask(cwd, task.id, { notes: 'linea 1\nlinea 2' });
    await writeLaunchTemplate(cwd, '{{task_notes}}');

    expect(await getLaunchText(cwd, task.id)).toBe('linea 1\nlinea 2');
  });

  it('rechaza un id con traversal', async () => {
    await expect(getLaunchText(cwd, '../../secreto.md')).rejects.toThrow(/inválido/i);
  });
});

describe('watchTasks', () => {
  // Espera a que el watcher dispare, con tope: fs.watch depende del SO y no
  // queremos un test que cuelgue si algo cambia de plataforma.
  const waitForChange = (fired, ms = 2000) => new Promise((resolveWait, reject) => {
    const started = Date.now();
    const tick = () => {
      if (fired.count > 0) return resolveWait();
      if (Date.now() - started > ms) return reject(new Error('el watcher no disparó'));
      setTimeout(tick, 10);
    };
    tick();
  });

  it('devuelve null si .ybento/tasks todavía no existe (y no la crea)', () => {
    expect(watchTasks(cwd, () => {})).toBeNull();
    expect(fsSync.existsSync(path.join(cwd, '.ybento'))).toBe(false);
  });

  it('avisa cuando una tarea cambia por fuera (el agente marcándola hecha)', async () => {
    const task = await createTask(cwd, 'La vigilada');

    const fired = { count: 0 };
    const stop = watchTasks(cwd, () => { fired.count++; });
    expect(stop).toBeTypeOf('function');

    // Simula al agente: escribe el .md directo, sin pasar por Bento.
    const file = path.join(tasksDir(), task.id);
    const raw = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, raw.replace('done: false', 'done: true'));

    await waitForChange(fired);
    stop();

    expect((await listTasks(cwd))[0].done).toBe(true);
  });

  it('cortada la vigilancia, deja de avisar', async () => {
    await createTask(cwd, 'X');
    const fired = { count: 0 };
    const stop = watchTasks(cwd, () => { fired.count++; });
    stop();

    await createTask(cwd, 'Y');
    await new Promise((r) => setTimeout(r, 150));

    expect(fired.count).toBe(0);
  });
});

describe('resolveTaskPath — seguridad', () => {
  it('resuelve un id normal dentro de .ybento/tasks', () => {
    expect(resolveTaskPath(cwd, 'algo.md')).toBe(path.join(cwd, '.ybento', 'tasks', 'algo.md'));
  });

  it('rechaza ids con separadores (traversal)', () => {
    expect(() => resolveTaskPath(cwd, '../../../etc/passwd.md')).toThrow(/inválido/i);
    expect(() => resolveTaskPath(cwd, 'sub/otro.md')).toThrow(/inválido/i);
    expect(() => resolveTaskPath(cwd, '..')).toThrow(/inválido/i);
  });

  it('rechaza ids que no son .md', () => {
    expect(() => resolveTaskPath(cwd, 'CLAUDE')).toThrow(/inválido/i);
    expect(() => resolveTaskPath(cwd, '')).toThrow(/inválido/i);
  });

  it('borrar con un id malicioso no toca nada de afuera', async () => {
    const victima = path.join(cwd, 'importante.txt');
    await fs.writeFile(victima, 'no me borres');

    await expect(deleteTask(cwd, '../importante.txt')).rejects.toThrow(/inválido/i);
    expect(await fs.readFile(victima, 'utf8')).toBe('no me borres');
  });
});
