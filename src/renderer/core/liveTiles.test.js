import { describe, it, expect, vi } from 'vitest';
import * as liveTiles from './liveTiles.js';
import { bus } from './eventBus.js';

// El módulo es un singleton (Map a nivel de módulo) que vitest NO resetea
// entre tests dentro del mismo archivo. Usamos ids únicos por test para
// que no se pisen entre sí.
let seq = 0;
const uid = (prefix) => `${prefix}-${++seq}`;

describe('liveTiles', () => {
  it('register + get devuelve la entrada registrada', () => {
    const tileId = uid('tile');
    const node = {};
    const kill = vi.fn();
    liveTiles.register(tileId, { profileId: 'p1', kind: 'terminal', node, kill });

    const entry = liveTiles.get(tileId);
    expect(entry).toBeDefined();
    expect(entry.profileId).toBe('p1');
    expect(entry.kind).toBe('terminal');
    expect(entry.node).toBe(node);
  });

  it('get de un tile no registrado devuelve undefined', () => {
    expect(liveTiles.get(uid('nope'))).toBeUndefined();
  });

  it('kill invoca la función kill y elimina la entrada', () => {
    const tileId = uid('tile');
    const kill = vi.fn();
    liveTiles.register(tileId, { profileId: 'p1', kind: 'webview', node: {}, kill });

    liveTiles.kill(tileId);

    expect(kill).toHaveBeenCalledTimes(1);
    expect(liveTiles.get(tileId)).toBeUndefined();
  });

  it('kill sobre un tileId inexistente no lanza', () => {
    expect(() => liveTiles.kill(uid('nope'))).not.toThrow();
  });

  it('si kill() del tile lanza, igual se elimina la entrada (no queda huérfano)', () => {
    const tileId = uid('tile');
    const kill = vi.fn(() => { throw new Error('boom'); });
    liveTiles.register(tileId, { profileId: 'p1', kind: 'terminal', node: {}, kill });

    expect(() => liveTiles.kill(tileId)).not.toThrow();
    expect(liveTiles.get(tileId)).toBeUndefined();
  });

  it('killWorkspace mata solo los tiles del profileId indicado', () => {
    const profileId = uid('profile');
    const otherProfileId = uid('profile');
    const tileA = uid('tile');
    const tileB = uid('tile');
    const tileOther = uid('tile');
    const killA = vi.fn();
    const killB = vi.fn();
    const killOther = vi.fn();

    liveTiles.register(tileA, { profileId, kind: 'terminal', node: {}, kill: killA });
    liveTiles.register(tileB, { profileId, kind: 'webview', node: {}, kill: killB });
    liveTiles.register(tileOther, { profileId: otherProfileId, kind: 'terminal', node: {}, kill: killOther });

    const count = liveTiles.killWorkspace(profileId);

    expect(count).toBe(2);
    expect(killA).toHaveBeenCalledTimes(1);
    expect(killB).toHaveBeenCalledTimes(1);
    expect(killOther).not.toHaveBeenCalled();
    expect(liveTiles.get(tileA)).toBeUndefined();
    expect(liveTiles.get(tileB)).toBeUndefined();
    expect(liveTiles.get(tileOther)).toBeDefined();

    // limpieza para no ensuciar tests siguientes
    liveTiles.kill(tileOther);
  });

  it('runningProfileIds refleja los profileId con al menos un tile vivo', () => {
    const profileId = uid('profile');
    const tileId = uid('tile');
    liveTiles.register(tileId, { profileId, kind: 'terminal', node: {}, kill: vi.fn() });

    expect(liveTiles.runningProfileIds().has(profileId)).toBe(true);

    liveTiles.kill(tileId);
    expect(liveTiles.runningProfileIds().has(profileId)).toBe(false);
  });

  it('countForProfile cuenta los tiles vivos de ese perfil', () => {
    const profileId = uid('profile');
    const tileA = uid('tile');
    const tileB = uid('tile');
    liveTiles.register(tileA, { profileId, kind: 'terminal', node: {}, kill: vi.fn() });
    liveTiles.register(tileB, { profileId, kind: 'webview', node: {}, kill: vi.fn() });

    expect(liveTiles.countForProfile(profileId)).toBe(2);

    liveTiles.killWorkspace(profileId);
    expect(liveTiles.countForProfile(profileId)).toBe(0);
  });

  it('emite live-tiles:changed en register y en kill', () => {
    const handler = vi.fn();
    const off = bus.on('live-tiles:changed', handler);
    const tileId = uid('tile');

    liveTiles.register(tileId, { profileId: 'p', kind: 'terminal', node: {}, kill: vi.fn() });
    expect(handler).toHaveBeenCalledTimes(1);

    liveTiles.kill(tileId);
    expect(handler).toHaveBeenCalledTimes(2);

    off();
  });

  it('killWorkspace sin tiles para ese perfil no emite el evento', () => {
    const handler = vi.fn();
    const off = bus.on('live-tiles:changed', handler);

    liveTiles.killWorkspace(uid('profile-sin-tiles'));

    expect(handler).not.toHaveBeenCalled();
    off();
  });
});
