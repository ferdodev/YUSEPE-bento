/**
 * src/renderer/components/calculator.js
 * --------------------------------------------------------------
 * Calculadora SIN header. Llena el tile completo.
 * Display arriba, botones llenan el resto con grid auto-rows.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { bus } from '../core/eventBus.js';

export function createCalculatorTile(tile) {
  const display = h('div', {
    class: 'text-right px-4 py-3 text-3xl font-mono text-fg bg-bg-elev/40 min-h-[3.5rem] flex items-center justify-end',
  }, '0');

  const grid = h('div', {
    class: 'grid grid-cols-4 gap-1 p-2 flex-1',
    style: 'grid-auto-rows: 1fr;',
  });

  const keys = [
    'C', '±', '%', '÷',
    '7', '8', '9', '×',
    '4', '5', '6', '−',
    '1', '2', '3', '+',
    '0', '.', '⌫', '=',
  ];

  let expr = '';
  const render = () => { display.textContent = expr || '0'; };

  function press(k) {
    if (k === 'C') { expr = ''; }
    else if (k === '⌫') { expr = expr.slice(0, -1); }
    else if (k === '=') { return evaluate(); }
    else if (k === '±') { expr = expr.startsWith('-') ? expr.slice(1) : (expr ? '-' + expr : ''); }
    else if (k === '%') {
      const v = parseFloat(expr);
      if (!Number.isNaN(v)) expr = String(v / 100);
    }
    else { expr += k; }
    render();
  }

  function evaluate() {
    if (!expr) return;
    const safe = expr
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .replace(/[^0-9+\-*/().\s]/g, '');
    try {
      const fn = new Function('"use strict"; return (' + safe + ');');
      const result = fn();
      expr = String(result);
      render();
      bus.emit('calc:result', { tileId: tile.id, value: result, expression: safe });
    } catch {
      display.textContent = 'Error';
    }
  }

  for (const k of keys) {
    grid.append(h('button', {
      class: btnClass(k) + ' text-base rounded-md active:scale-95 transition',
      style: 'min-height: 2rem;',
      onClick: () => press(k),
    }, k));
  }

  const root = h('div', {
    class: 'tile',
    dataset: { tileId: tile.id, kind: 'calculator' },
  }, [
    h('div', { class: 'flex flex-col h-full bg-bg-soft' }, [display, grid]),
  ]);

  return { root };
}

function btnClass(k) {
  const base = 'hover:bg-bg-elev transition';
  if ('÷×−+=%±'.includes(k)) return `${base} bg-accent/20 text-accent-soft hover:bg-accent/30`;
  if (k === 'C' || k === '⌫') return `${base} bg-bg-elev text-fg-soft`;
  return `${base} bg-bg-soft text-fg`;
}
