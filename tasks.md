# Tasks — Cola de entrada

> **Regla principal:** si una tarea no está aquí, no se ejecuta.
>
> **Flujo obligatorio:**
> 1. Agregar la tarea acá (estado: `pendiente`)
> 2. Claude crea `spec/features/NNN-nombre/` con spec + plan
> 3. Confirmar spec + plan antes de tocar código
> 4. Implementar siguiendo el checklist de la feature
> 5. Marcar `hecho` y registrar el commit de cierre

---

## Formato de tarea

```
### tipo: Nombre breve
- fecha:   YYYY-MM-DD HH:MM
- estado:  pendiente | en curso | hecho | descartado
- detalle: Qué hay que hacer y por qué, en dos o tres frases.
- spec:    spec/features/NNN-nombre/   (se completa al crear la spec)
- commit:  —                           (se completa al cerrar)
- notas:   —
```

`tipo` es `feature:` o `fix:`.

---

## Pendientes 🔜

_(vacío)_

---

## En curso 🔄

_(vacío)_

---

## Hecho ✅

### fix: Scroll del textarea del compositor vuelve al inicio en cada refresh
- fecha:   2026-08-22 00:00
- estado:  hecho
- detalle: Al llegar un mensaje nuevo de un agente, renderComposer() reconstruía
           el textarea restaurando texto y cursor pero no scrollTop. El usuario
           veía el inicio del borrador en vez de donde estaba escribiendo.
- spec:    spec/features/021-fix-scroll-compositor/
- commit:  852d4a4
- notas:   Se restaura cuando hay borrador (no solo con foco): el usuario puede
           scrollear con la rueda sin hacer click primero.

---

## Ejemplos de referencia

### feature: Nombre corto de la feature
- fecha:   2025-08-22 10:00
- estado:  pendiente
- detalle: Descripción clara de qué debe hacer la feature desde el punto de vista del usuario y por qué aporta valor ahora.
- spec:    —
- commit:  —
- notas:   —

### fix: Nombre corto del bug
- fecha:   2025-08-22 14:30
- estado:  hecho
- detalle: El botón X no respondía al hacer click cuando el panel estaba colapsado. Causa: el listener se registraba antes de que el elemento existiera en el DOM.
- spec:    spec/features/021-fix-boton-x/
- commit:  a1b2c3d
- notas:   Solo afectaba al tema oscuro; en claro funcionaba porque el orden de render era distinto.
