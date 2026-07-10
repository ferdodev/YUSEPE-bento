/**
 * src/main/pathSafety.test.js
 * --------------------------------------------------------------
 * Regresión de seguridad: `resolveSafe` (vía el wrapper `resolvePath`)
 * en explorerFs y agentOps debe acotar TODA ruta al árbol del workspace
 * y rechazar cualquier intento de path traversal (`..`, rutas absolutas,
 * prefijos hermanos tipo `/ws-evil`). Es lógica pura de rutas, sin disco.
 *
 * Ambos módulos comparten la misma implementación de resolveSafe a
 * propósito (ver CLAUDE.md); los corremos con la misma batería para que
 * no se desincronicen.
 * --------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolvePath as explorerResolve } from './explorerFs.js';
import { resolvePath as agentResolve } from './agentOps.js';

const ROOT = path.resolve('/tmp/yusepe-ws');

describe.each([
  ['explorerFs', explorerResolve],
  ['agentOps', agentResolve],
])('resolveSafe (%s)', (_name, resolve) => {
  describe('rutas válidas dentro del workspace', () => {
    it('resuelve un archivo directo', () => {
      expect(resolve(ROOT, 'README.md')).toBe(path.join(ROOT, 'README.md'));
    });

    it('resuelve una ruta anidada', () => {
      expect(resolve(ROOT, 'src/main/index.js')).toBe(path.join(ROOT, 'src/main/index.js'));
    });

    it('"." (y vacío/null) resuelven al root mismo', () => {
      expect(resolve(ROOT, '.')).toBe(ROOT);
      expect(resolve(ROOT, '')).toBe(ROOT);
      expect(resolve(ROOT, null)).toBe(ROOT);
      expect(resolve(ROOT, undefined)).toBe(ROOT);
    });

    it('permite `..` mientras el resultado siga dentro del root', () => {
      // src/main/../renderer => renderer, sigue dentro del workspace.
      expect(resolve(ROOT, 'src/main/../renderer')).toBe(path.join(ROOT, 'src/renderer'));
    });
  });

  describe('intentos de path traversal (deben lanzar)', () => {
    const OUTSIDE = 'Ruta fuera del workspace';

    it('rechaza `..` que sube del root', () => {
      expect(() => resolve(ROOT, '..')).toThrow(OUTSIDE);
    });

    it('rechaza `../../etc/passwd`', () => {
      expect(() => resolve(ROOT, '../../etc/passwd')).toThrow(OUTSIDE);
    });

    it('rechaza `..` intercalado que termina afuera', () => {
      expect(() => resolve(ROOT, 'foo/../../bar')).toThrow(OUTSIDE);
    });

    it('rechaza una ruta absoluta fuera del root', () => {
      expect(() => resolve(ROOT, '/etc/passwd')).toThrow(OUTSIDE);
    });

    it('rechaza un hermano con prefijo compartido (ws-evil no está dentro de ws)', () => {
      // Sin el chequeo de `+ path.sep`, "/tmp/yusepe-ws-evil" pasaría por
      // startsWith("/tmp/yusepe-ws"). Este caso es la razón de ese `+ sep`.
      expect(() => resolve(ROOT, '../yusepe-ws-evil/secret')).toThrow(OUTSIDE);
    });
  });
});
