import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { SnippetsStore } from './snippetsOps.js';

let dir;
let store;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yusepe-snippets-test-'));
  store = new SnippetsStore(path.join(dir, 'snippets.json'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('SnippetsStore.list', () => {
  it('devuelve [] si el archivo todavía no existe', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('devuelve los snippets ordenados por nombre', async () => {
    await store.create({ name: 'Zeta', script: 'echo z' });
    await store.create({ name: 'Alfa', script: 'echo a' });
    const list = await store.list();
    expect(list.map((s) => s.name)).toEqual(['Alfa', 'Zeta']);
  });
});

describe('SnippetsStore.create', () => {
  it('crea un snippet con id único y persiste en disco', async () => {
    const snippet = await store.create({ name: 'Deploy', script: 'cd app\nnpm run build' });
    expect(snippet.id).toBeTruthy();
    expect(snippet.name).toBe('Deploy');
    expect(snippet.script).toBe('cd app\nnpm run build');

    const store2 = new SnippetsStore(path.join(dir, 'snippets.json'));
    expect(await store2.list()).toHaveLength(1);
  });

  it('rechaza nombre vacío', async () => {
    await expect(store.create({ name: '  ', script: 'x' })).rejects.toThrow(/nombre/i);
  });

  it('script ausente se normaliza a string vacío', async () => {
    const snippet = await store.create({ name: 'Sin script' });
    expect(snippet.script).toBe('');
  });
});

describe('SnippetsStore.update', () => {
  it('actualiza nombre y script de un snippet existente', async () => {
    const created = await store.create({ name: 'Original', script: 'echo 1' });
    const updated = await store.update(created.id, { name: 'Renombrado', script: 'echo 2' });
    expect(updated).toMatchObject({ name: 'Renombrado', script: 'echo 2' });

    const [persisted] = await store.list();
    expect(persisted).toMatchObject({ name: 'Renombrado', script: 'echo 2' });
  });

  it('id inexistente lanza', async () => {
    await expect(store.update('no-existe', { name: 'x' })).rejects.toThrow(/no encontrado/i);
  });
});

describe('SnippetsStore.remove', () => {
  it('elimina el snippet del archivo', async () => {
    const a = await store.create({ name: 'A', script: '' });
    await store.create({ name: 'B', script: '' });
    await store.remove(a.id);
    const list = await store.list();
    expect(list.map((s) => s.name)).toEqual(['B']);
  });

  it('id inexistente no lanza', async () => {
    await expect(store.remove('no-existe')).resolves.toBeUndefined();
  });
});
