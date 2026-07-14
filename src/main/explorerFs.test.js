/**
 * src/main/explorerFs.test.js
 * --------------------------------------------------------------
 * Operaciones de escritura del árbol del explorador: `createEntry`
 * (botones "nuevo archivo"/"nueva carpeta"), `renameEntry` y
 * `duplicateEntry` (menú contextual), más `resolveEntryPath`.
 *
 * Corre sobre disco real (dir temporal), igual que storage.test.js:
 * lo que interesa acá es el comportamiento contra el FS (exclusividad,
 * padres intermedios, copia recursiva), no un mock de fs.
 *
 * El foco está en que ninguna operación destruya trabajo del usuario en
 * silencio — `fs.rename` pisa el destino sin avisar, así que el caso de
 * "renombrar sobre un archivo existente" es la regresión más importante
 * de este archivo.
 *
 * La batería completa de path traversal de `resolveSafe` vive en
 * pathSafety.test.js; acá solo se verifica que cada operación pase por
 * ese chequeo y no escriba fuera del root.
 *
 * `trashItem`/`showItemInFolder` no se testean acá: viven en ipc.js
 * porque necesitan `shell` de electron (ver explorerFs.js, que a
 * propósito no importa electron para poder correr en vitest).
 * --------------------------------------------------------------
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createEntry, duplicateEntry, renameEntry, resolveEntryPath } from './explorerFs.js';

let root;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-explorer-test-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('createEntry — archivos', () => {
  it('crea un archivo vacío y devuelve su nombre y relPath', async () => {
    const created = await createEntry(root, 'nuevo.js', false);

    expect(created).toEqual({ name: 'nuevo.js', isDir: false, relPath: 'nuevo.js' });
    expect(await fs.readFile(path.join(root, 'nuevo.js'), 'utf8')).toBe('');
  });

  it('crea las carpetas intermedias de una ruta anidada', async () => {
    const created = await createEntry(root, 'src/utils/dom.js', false);

    expect(created.relPath).toBe(path.join('src', 'utils', 'dom.js'));
    expect(created.name).toBe('dom.js');
    await expect(fs.stat(path.join(root, 'src', 'utils', 'dom.js'))).resolves.toBeTruthy();
  });

  it('no pisa un archivo existente', async () => {
    await fs.writeFile(path.join(root, 'ya-esta.txt'), 'contenido original');

    await expect(createEntry(root, 'ya-esta.txt', false)).rejects.toThrow(/ya existe/i);
    // lo importante: el contenido sigue intacto
    expect(await fs.readFile(path.join(root, 'ya-esta.txt'), 'utf8')).toBe('contenido original');
  });
});

describe('createEntry — carpetas', () => {
  it('crea una carpeta', async () => {
    const created = await createEntry(root, 'components', true);

    expect(created).toEqual({ name: 'components', isDir: true, relPath: 'components' });
    const stat = await fs.stat(path.join(root, 'components'));
    expect(stat.isDirectory()).toBe(true);
  });

  it('falla si la carpeta ya existe', async () => {
    await createEntry(root, 'components', true);
    await expect(createEntry(root, 'components', true)).rejects.toThrow(/ya existe/i);
  });

  it('falla si ya hay un archivo con ese nombre', async () => {
    await createEntry(root, 'choque', false);
    await expect(createEntry(root, 'choque', true)).rejects.toThrow(/ya existe/i);
  });
});

describe('createEntry — validación', () => {
  it('rechaza un nombre vacío en vez de "crear" el root', async () => {
    await expect(createEntry(root, '', false)).rejects.toThrow(/vacío/i);
    await expect(createEntry(root, '.', true)).rejects.toThrow(/vacío/i);
  });

  it('rechaza escapar del workspace con `..`', async () => {
    await expect(createEntry(root, '../fuera.txt', false)).rejects.toThrow(/fuera del workspace/i);
    await expect(createEntry(root, 'src/../../fuera.txt', false)).rejects.toThrow(/fuera del workspace/i);

    // no debe haber creado nada en el padre del root
    const parent = path.dirname(root);
    await expect(fs.stat(path.join(parent, 'fuera.txt'))).rejects.toThrow();
  });

  it('rechaza rutas absolutas fuera del root', async () => {
    await expect(createEntry(root, '/etc/colado.txt', false)).rejects.toThrow(/fuera del workspace/i);
  });

  it('permite `..` mientras el resultado siga dentro del root', async () => {
    await createEntry(root, 'src/main/index.js', false);
    const created = await createEntry(root, 'src/main/../renderer/app.js', false);

    expect(created.relPath).toBe(path.join('src', 'renderer', 'app.js'));
    await expect(fs.stat(path.join(root, 'src', 'renderer', 'app.js'))).resolves.toBeTruthy();
  });
});

describe('resolveEntryPath', () => {
  it('resuelve una entrada normal', () => {
    expect(resolveEntryPath(root, 'algo.txt')).toBe(path.join(root, 'algo.txt'));
  });

  it('rechaza apuntar a la raíz del workspace (borrar/renombrar el root)', () => {
    expect(() => resolveEntryPath(root, '.')).toThrow(/raíz del workspace/i);
    expect(() => resolveEntryPath(root, '')).toThrow(/raíz del workspace/i);
    expect(() => resolveEntryPath(root, 'sub/..')).toThrow(/raíz del workspace/i);
  });

  it('sigue rechazando path traversal', () => {
    expect(() => resolveEntryPath(root, '../vecino')).toThrow(/fuera del workspace/i);
  });
});

describe('renameEntry', () => {
  it('renombra un archivo conservando el contenido', async () => {
    await fs.writeFile(path.join(root, 'viejo.txt'), 'contenido');

    const renamed = await renameEntry(root, 'viejo.txt', 'nuevo.txt');

    expect(renamed).toMatchObject({ name: 'nuevo.txt', isDir: false, relPath: 'nuevo.txt' });
    expect(await fs.readFile(path.join(root, 'nuevo.txt'), 'utf8')).toBe('contenido');
    await expect(fs.stat(path.join(root, 'viejo.txt'))).rejects.toThrow();
  });

  it('renombra una carpeta con todo su contenido', async () => {
    await createEntry(root, 'vieja/dentro/f.txt', false);

    const renamed = await renameEntry(root, 'vieja', 'nueva');

    expect(renamed).toMatchObject({ name: 'nueva', isDir: true });
    await expect(fs.stat(path.join(root, 'nueva', 'dentro', 'f.txt'))).resolves.toBeTruthy();
  });

  it('NO pisa un archivo existente (fs.rename lo haría en silencio)', async () => {
    await fs.writeFile(path.join(root, 'origen.txt'), 'soy el origen');
    await fs.writeFile(path.join(root, 'ocupado.txt'), 'NO ME PISES');

    await expect(renameEntry(root, 'origen.txt', 'ocupado.txt')).rejects.toThrow(/ya existe/i);

    // las dos puntas siguen intactas
    expect(await fs.readFile(path.join(root, 'ocupado.txt'), 'utf8')).toBe('NO ME PISES');
    expect(await fs.readFile(path.join(root, 'origen.txt'), 'utf8')).toBe('soy el origen');
  });

  it('permite cambiar solo mayúsculas/minúsculas', async () => {
    // En un FS case-insensitive (APFS/NTFS) stat("foo.md") encuentra el propio
    // origen: sin comparar inodes esto fallaría como "ya existe".
    await fs.writeFile(path.join(root, 'Foo.md'), 'x');

    const renamed = await renameEntry(root, 'Foo.md', 'foo.md');
    expect(renamed.name).toBe('foo.md');
  });

  it('mueve a una subcarpeta si el nombre trae ruta', async () => {
    await fs.writeFile(path.join(root, 'suelto.txt'), 'x');

    const renamed = await renameEntry(root, 'suelto.txt', 'sub/anidado.txt');

    expect(renamed.relPath).toBe(path.join('sub', 'anidado.txt'));
    await expect(fs.stat(path.join(root, 'sub', 'anidado.txt'))).resolves.toBeTruthy();
  });

  it('rechaza nombre vacío', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'x');
    await expect(renameEntry(root, 'a.txt', '   ')).rejects.toThrow(/vacío/i);
  });

  it('rechaza sacar el archivo del workspace', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'x');

    await expect(renameEntry(root, 'a.txt', '../fugado.txt')).rejects.toThrow(/fuera del workspace/i);
    await expect(fs.stat(path.join(path.dirname(root), 'fugado.txt'))).rejects.toThrow();
  });

  it('rechaza renombrar la raíz del workspace', async () => {
    await expect(renameEntry(root, '.', 'otro')).rejects.toThrow(/raíz del workspace/i);
  });
});

describe('duplicateEntry', () => {
  it('duplica un archivo con sufijo " copia" conservando la extensión', async () => {
    await fs.writeFile(path.join(root, 'notas.md'), 'contenido');

    const copy = await duplicateEntry(root, 'notas.md');

    expect(copy).toMatchObject({ name: 'notas copia.md', isDir: false });
    expect(await fs.readFile(path.join(root, 'notas copia.md'), 'utf8')).toBe('contenido');
    // el original sigue ahí
    expect(await fs.readFile(path.join(root, 'notas.md'), 'utf8')).toBe('contenido');
  });

  it('numera si la copia ya existe, sin pisar nada', async () => {
    await fs.writeFile(path.join(root, 'notas.md'), 'original');
    await duplicateEntry(root, 'notas.md');
    await fs.writeFile(path.join(root, 'notas copia.md'), 'primera copia editada');

    const copy2 = await duplicateEntry(root, 'notas.md');

    expect(copy2.name).toBe('notas copia 2.md');
    expect(await fs.readFile(path.join(root, 'notas copia.md'), 'utf8')).toBe('primera copia editada');
  });

  it('duplica una carpeta recursivamente', async () => {
    await createEntry(root, 'src/utils/dom.js', false);

    const copy = await duplicateEntry(root, 'src');

    expect(copy).toMatchObject({ name: 'src copia', isDir: true });
    await expect(fs.stat(path.join(root, 'src copia', 'utils', 'dom.js'))).resolves.toBeTruthy();
  });

  it('rechaza duplicar la raíz del workspace', async () => {
    await expect(duplicateEntry(root, '.')).rejects.toThrow(/raíz del workspace/i);
  });
});
