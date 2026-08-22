# 021 · fix: Scroll del textarea del compositor vuelve al inicio

**Estado:** en curso

## Qué hace

Cuando el usuario escribe un mensaje en el compositor (sección 3 de la cabina), el textarea vuelve al inicio del texto al recibir cualquier evento de refresh. El texto escrito no se pierde, pero la posición de scroll dentro del textarea salta al principio, haciendo que el usuario pierda de vista lo que estaba redactando.

## Por qué

El refresh del panel (cada vez que llega un mensaje de un agente) reconstruye el textarea. El flujo de restauración tiene dos capas que se pisan:

1. `renderComposer` guarda `scrollTop` y lo restaura **sincrónicamente**.
2. Un `queueMicrotask` posterior limpia el valor (`input.value = ''`) para medir la altura mínima. Al limpiar el valor, el `scrollHeight` cae a 0 y el navegador fuerza `scrollTop = 0`. Al restaurar el valor, el `scrollHeight` vuelve pero `scrollTop` queda en 0.
3. Dentro del mismo microtask, `resize()` hace `input.style.height = 'auto'` en cada pulsación de tecla, que también puede resetear `scrollTop`.

## Criterios de aceptación

- [ ] Escribir un mensaje largo que supere la altura del textarea; al llegar un mensaje de agente, la posición de scroll dentro del textarea se conserva.
- [ ] Escribir un mensaje largo carácter a carácter; el textarea no salta al principio del texto en cada pulsación.
- [ ] El texto del borrador no se pierde ni se modifica.
- [ ] El cursor y la selección siguen restaurándose correctamente.

## Fuera de alcance

- Scroll del hilo de mensajes (sección 2) — no es el reportado.
