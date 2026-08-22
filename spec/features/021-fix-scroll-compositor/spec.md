# 021 · fix: Scroll del textarea del compositor vuelve al inicio en cada refresh

**Estado:** en curso

## Qué hace

Cuando el usuario escribe un mensaje largo en el textarea del compositor (sección 3 de la cabina del loop), el textarea crece y tiene scroll interno. Si mientras escribe llega un mensaje nuevo de un agente, el panel se refresca y el textarea vuelve al inicio del texto: el usuario ve el principio de su borrador en vez de donde estaba escribiendo.

## Por qué

El flujo de escritura se interrumpe en el momento más inconveniente: justo cuando el loop está activo y los agentes mandan mensajes seguidos, que es exactamente cuando el usuario está redactando una respuesta larga. Perder la posición dentro del propio texto obliga a volver a scrollear dentro del textarea en cada refresh.

## Criterios de aceptación

- [ ] Escribir un mensaje largo en el textarea (que supere la altura visible y tenga scroll interno), y recibir un mensaje de un agente: el textarea conserva la posición de scroll exacta tras el refresh.
- [ ] El cursor y la selección siguen restaurándose correctamente (comportamiento existente no regresa).
- [ ] El texto del borrador no se pierde ni se modifica.
- [ ] El fix no introduce ningún destello visual ni salto en el textarea al refrescar.

## Fuera de alcance

- Scroll de la sección 2 (hilo de mensajes) — ya tiene su propia lógica de "smart scroll" (`atBottom`).
- Ningún otro elemento del panel.
