# 021 · fix: Scroll del textarea del compositor — Plan (v2)

## Enfoque

Dos puntos de fuga, dos parches en `renderComposer`:

**Caso 1 — refresh (microtask):** mover la restauración de `scrollTop` al FINAL del microtask, después de que `resize()` haya fijado `overflow-y: auto`. Así el navegador puede honrar el `scrollTop` asignado porque ya hay espacio de scroll real.

**Caso 2 — tipeo (resize en cada input):** `resize()` hace `height='auto'` para medir el contenido, lo que temporalmente colapsa el overflow y fuerza `scrollTop = 0`. Hay que guardar y restaurar `scrollTop` dentro de `resize()`.

## Implementación

Archivo: `src/renderer/components/loopSidebar.js` — función `renderComposer`.

1. **Eliminar** la restauración sincrónica al final de `renderComposer` (`if (draft) input.scrollTop = scrollTop`) — corre antes del microtask y queda anulada.

2. **Dentro de `resize()`**, guardar y restaurar `scrollTop` alrededor de `height='auto'`:
   ```js
   const resize = () => {
     const prevScroll = input.scrollTop;
     input.style.height = 'auto';
     const natural = input.scrollHeight;
     const next = Math.min(Math.max(natural, minH), maxH);
     input.style.height = `${next}px`;
     input.style.overflowY = natural > maxH ? 'auto' : 'hidden';
     if (natural > maxH) input.scrollTop = prevScroll;
   };
   ```
   Solo se restaura cuando `natural > maxH` (textarea en modo scroll); cuando cabe entero no hay posición que preservar.

3. **Al final del microtask**, después de la primera llamada a `resize()`:
   ```js
   if (draft) input.scrollTop = scrollTop;
   ```
   En este punto `overflow-y` ya es `auto` (si el texto es largo), así que el navegador acepta el valor.

## Decisiones

- **Restaurar en el microtask, no sincrónicamente** — la secuencia `value='' → value=savedVal` dentro del microtask resetea `scrollTop` a 0; cualquier restauración anterior queda anulada.
- **Guardar/restaurar en resize()** — `height='auto'` elimina temporalmente el overflow en cada pulsación; sin esta guarda cada tecla jumpa al inicio.
- **Solo restaurar cuando `natural > maxH`** — cuando el texto cabe en el textarea visible no existe posición de scroll que preservar y la asignación sería un no-op de todos modos.

## Riesgos

- Ninguno significativo: son lecturas y escrituras de propiedades DOM estándar, sin side effects sobre el resto del panel.
