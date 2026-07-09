/**
 * src/renderer/core/state.js
 * --------------------------------------------------------------
 * Estado reactivo simple basado en Proxy.
 * Cualquier cambio dispara `bus.emit('state:changed', { key, value })`
 * para que la UI (u otras apps embebidas) reaccione.
 * --------------------------------------------------------------
 */
import { bus } from './eventBus.js';

export const state = new Proxy(
  {
    /** @type {object|null} Perfil activo en memoria. */
    profile: null,
    /** @type {Array<object>} Lista resumida de perfiles. */
    profiles: [],
    /** @type {string|null} id del perfil actualmente cargado. */
    activeProfileId: null,
  },
  {
    set(target, key, value) {
      const prev = target[key];
      target[key] = value;
      bus.emit('state:changed', { key, value, prev });
      return true;
    },
  }
);
