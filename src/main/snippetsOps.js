/**
 * src/main/snippetsOps.js
 * --------------------------------------------------------------
 * Librería de snippets (comandos/rutinas multi-línea reutilizables),
 * global a la app — no pertenecen a un workspace puntual, se pueden
 * ejecutar en la terminal enfocada de cualquiera (ver
 * components/snippetsSidebar.js). Un solo JSON en <userData>/snippets.json,
 * mismo patrón de escritura atómica que storage.js.
 * --------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

export class SnippetsStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async _read() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data.snippets) ? data.snippets : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async _write(snippets) {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ snippets }, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }

  async list() {
    const snippets = await this._read();
    return [...snippets].sort((a, b) => a.name.localeCompare(b.name));
  }

  async create({ name, script } = {}) {
    if (!name || !name.trim()) throw new Error('El snippet necesita un nombre.');
    const snippets = await this._read();
    const now = Date.now();
    const snippet = { id: randomUUID(), name: name.trim(), script: script || '', createdAt: now, updatedAt: now };
    snippets.push(snippet);
    await this._write(snippets);
    return snippet;
  }

  async update(id, { name, script } = {}) {
    const snippets = await this._read();
    const snippet = snippets.find((s) => s.id === id);
    if (!snippet) throw new Error('Snippet no encontrado.');
    if (name != null) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('El snippet necesita un nombre.');
      snippet.name = trimmed;
    }
    if (script != null) snippet.script = script;
    snippet.updatedAt = Date.now();
    await this._write(snippets);
    return snippet;
  }

  async remove(id) {
    const snippets = await this._read();
    await this._write(snippets.filter((s) => s.id !== id));
  }
}
