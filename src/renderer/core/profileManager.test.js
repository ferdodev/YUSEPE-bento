/**
 * src/renderer/core/profileManager.test.js
 * --------------------------------------------------------------
 * Sólo el guard de borrado de tiles del loop.
 *
 * Es la única regla del ProfileManager que protege algo que el usuario no
 * puede recuperar: si se borra la terminal de un agente, los demás le
 * siguen escribiendo a un nombre que ya no tiene dónde recibir, y el loop
 * se rompe sin que se vea nada raro en pantalla.
 *
 * `window.yusepe.profiles` se moquea porque `saveCurrent()` lo llama; el
 * resto del módulo (que es cableado con el preload) no se testea acá.
 * --------------------------------------------------------------
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProfileManager } from './profileManager.js';
import { state } from './state.js';

beforeEach(() => {
  globalThis.window = {
    yusepe: {
      profiles: {
        // `saveCurrent()` reemplaza state.profile con lo que devuelve el
        // save, así que el mock tiene que devolver el perfil, no un {}.
        save: vi.fn().mockImplementation(async (profile) => profile),
        // saveCurrent() refresca el índice después de guardar.
        list: vi.fn().mockResolvedValue([]),
      },
    },
  };
  state.profile = {
    id: 'p1',
    tiles: [
      { id: 'libre', kind: 'terminal', col: 0, row: 0, colSpan: 6, rowSpan: 4 },
      { id: 'enloop', kind: 'terminal', loopAgent: 'claudio', col: 6, row: 0, colSpan: 6, rowSpan: 4 },
    ],
  };
});

describe('removeTile: terminales del loop', () => {
  it('borra normalmente una terminal que no está en un loop', async () => {
    await ProfileManager.removeTile('libre');
    expect(state.profile.tiles.map((t) => t.id)).toEqual(['enloop']);
  });

  it('se niega a borrar una terminal que pertenece a un loop', async () => {
    await expect(ProfileManager.removeTile('enloop')).rejects.toThrow(/@claudio/);
  });

  it('el tile sigue ahí después del intento fallido', async () => {
    await expect(ProfileManager.removeTile('enloop')).rejects.toThrow();
    expect(state.profile.tiles.map((t) => t.id)).toEqual(['libre', 'enloop']);
  });

  // El mensaje es la única salida que tiene el usuario: si no dice qué
  // hacer, el tile queda imborrable y parece un bug.
  it('el error explica cómo destrabarlo', async () => {
    await expect(ProfileManager.removeTile('enloop')).rejects.toThrow(/[Ss]acala del loop/);
  });

  it('sacada del loop, se puede borrar', async () => {
    await ProfileManager.updateTile('enloop', { loopAgent: null });
    await ProfileManager.removeTile('enloop');
    expect(state.profile.tiles.map((t) => t.id)).toEqual(['libre']);
  });
});
