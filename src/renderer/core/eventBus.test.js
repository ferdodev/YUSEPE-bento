import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './eventBus.js';

describe('EventBus', () => {
  it('on + emit invoca al handler con el payload', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('foo', handler);

    bus.emit('foo', { a: 1 });

    expect(handler).toHaveBeenCalledWith({ a: 1 });
  });

  it('on devuelve una función para desuscribirse', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on('foo', handler);

    off();
    bus.emit('foo', {});

    expect(handler).not.toHaveBeenCalled();
  });

  it('off desuscribe explícitamente', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('foo', handler);
    bus.off('foo', handler);

    bus.emit('foo', {});

    expect(handler).not.toHaveBeenCalled();
  });

  it('once solo se dispara una vez', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('foo', handler);

    bus.emit('foo', 1);
    bus.emit('foo', 2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('soporta múltiples handlers para el mismo evento', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('foo', a);
    bus.on('foo', b);

    bus.emit('foo', 'x');

    expect(a).toHaveBeenCalledWith('x');
    expect(b).toHaveBeenCalledWith('x');
  });

  it('wildcard "prefix:*" recibe eventos "prefix:algo" con { event, payload }', () => {
    const bus = new EventBus();
    const wildcardHandler = vi.fn();
    bus.on('tile:*', wildcardHandler);

    bus.emit('tile:added', { id: 1 });

    expect(wildcardHandler).toHaveBeenCalledWith({ event: 'tile:added', payload: { id: 1 } });
  });

  it('el wildcard no interfiere con el handler directo del mismo evento', () => {
    const bus = new EventBus();
    const direct = vi.fn();
    const wildcard = vi.fn();
    bus.on('tile:added', direct);
    bus.on('tile:*', wildcard);

    bus.emit('tile:added', 42);

    expect(direct).toHaveBeenCalledWith(42);
    expect(wildcard).toHaveBeenCalledWith({ event: 'tile:added', payload: 42 });
  });

  it('un handler que lanza no rompe el emit ni bloquea a los demás handlers', () => {
    const bus = new EventBus();
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    bus.on('foo', bad);
    bus.on('foo', good);

    expect(() => bus.emit('foo', {})).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it('clear(event) borra solo los handlers de ese evento', () => {
    const bus = new EventBus();
    const foo = vi.fn();
    const bar = vi.fn();
    bus.on('foo', foo);
    bus.on('bar', bar);

    bus.clear('foo');
    bus.emit('foo', {});
    bus.emit('bar', {});

    expect(foo).not.toHaveBeenCalled();
    expect(bar).toHaveBeenCalled();
  });

  it('clear() sin argumentos borra todos los handlers', () => {
    const bus = new EventBus();
    const foo = vi.fn();
    bus.on('foo', foo);

    bus.clear();
    bus.emit('foo', {});

    expect(foo).not.toHaveBeenCalled();
  });

  it('on lanza si el handler no es una función', () => {
    const bus = new EventBus();
    expect(() => bus.on('foo', 'no soy función')).toThrow(TypeError);
  });
});
