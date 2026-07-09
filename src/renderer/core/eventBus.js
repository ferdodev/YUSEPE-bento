/**
 * src/renderer/core/eventBus.js
 * --------------------------------------------------------------
 * Bus de eventos minimalista (publish/subscribe).
 *
 * Uso:
 *   const off = bus.on('tile:added', (tile) => { ... });
 *   bus.emit('tile:added', tile);
 *   off(); // desuscribir
 *
 * Características:
 *  - Wildcards: bus.on('tile:*', handler)
 *  - Una vez:    bus.once('profile:loaded', handler)
 *  - Async-safe: los handlers se ejecutan en orden de suscripción.
 * --------------------------------------------------------------
 */
export class EventBus {
  constructor() {
    this._handlers = new Map(); // event -> Set<fn>
  }

  on(event, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(event, handler) {
    const set = this._handlers.get(event);
    if (set) set.delete(handler);
  }

  emit(event, payload) {
    // Soporte de wildcards simples
    const direct = this._handlers.get(event);
    if (direct) for (const fn of [...direct]) safe(fn, payload);

    if (event.includes(':')) {
      const wildcard = event.split(':')[0] + ':*';
      const starred = this._handlers.get(wildcard);
      if (starred) for (const fn of [...starred]) safe(fn, { event, payload });
    }
  }

  clear(event) {
    if (event) this._handlers.delete(event);
    else this._handlers.clear();
  }
}

function safe(fn, payload) {
  try { fn(payload); }
  catch (err) { console.error('[eventBus] handler error:', err); }
}

/** Singleton accesible desde cualquier parte del renderer. */
export const bus = new EventBus();
