# Tasks — Cola de entrada

> **Regla principal:** si una tarea no está aquí, no se ejecuta.
>
> **Flujo:** agregar tarea acá → Claude crea `spec/features/NNN-nombre/` (spec + plan + tasks) → se implementa → se marca como hecho.

## Pendientes 🔜

_(vacío — agregar acá la próxima tarea a trabajar)_

## En curso 🔄

_(vacío)_

## Hecho ✅

_(vacío por ahora — el historial de features anteriores está en `spec/constitution/roadmap.md`)_

---

### Cómo agregar una tarea

Agregar una línea bajo **Pendientes** con el formato:

```
- [ ] **<Nombre corto>** — <qué quiero que haga, en una o dos frases>.
```

Claude tomará esa descripción, creará la carpeta de feature con spec + plan + tasks, pedirá confirmación si algo no está claro y luego implementará.
