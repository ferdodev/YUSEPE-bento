# 021 · fix: Scroll del textarea del compositor — Plan

## Enfoque

`renderComposer()` ya guarda `selectionStart` y `selectionEnd` del textarea anterior antes de reconstruirlo, y los restaura al final. La solución es el mismo patrón para `scrollTop`: leerlo antes de destruir el DOM y escribirlo de vuelta después de asignar el valor.

Un solo campo, un solo archivo, cero riesgo de regresión.

## Implementación

1. En `renderComposer()` (`src/renderer/components/loopSidebar.js`), junto a donde se leen `selectionStart`/`selectionEnd`, añadir:
   ```js
   const scrollTop = previous?.scrollTop ?? 0;
   ```
2. Al final de `renderComposer()`, donde ya se restauran foco y selección, añadir inmediatamente después:
   ```js
   input.scrollTop = scrollTop;
   ```
   Dentro del mismo `if (hadFocus)` — si el textarea no tenía foco, el scroll también debe restaurarse porque el usuario puede haber scrolleado con la rueda sin hacer click.

   En realidad, `scrollTop` se debe restaurar **siempre** que haya un borrador, no solo cuando hay foco:
   ```js
   if (draft) input.scrollTop = scrollTop;
   ```

## Decisiones

- **Restaurar siempre (no solo con foco)** — el usuario puede scrollear el textarea con la rueda sin hacer click primero, así que `hadFocus` no es el guard correcto para `scrollTop`. Si hay borrador, hay posición que preservar.
- **No usar `queueMicrotask`** — `scrollTop` se puede asignar de forma síncrona tras asignar `value`; un microtask no es necesario y añadiría un frame de destello.

## Riesgos

- Ninguno identificado: es una lectura + escritura de una propiedad DOM estándar, sin side effects.
