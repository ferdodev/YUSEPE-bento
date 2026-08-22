# 021 · fix: Scroll del textarea del compositor — Tareas

- [ ] Leer `previous?.scrollTop ?? 0` antes de reconstruir el textarea en `renderComposer()`.
- [ ] Restaurar `input.scrollTop = scrollTop` tras asignar `input.value = draft` (siempre que haya borrador).
- [ ] Verificar manualmente: escribir texto largo, scroll abajo dentro del textarea, esperar refresh, confirmar que la posición se mantiene.
- [ ] Verificar que cursor y selección siguen funcionando (regresión existente).
- [ ] Validar contra los criterios de aceptación de `spec.md`.
- [ ] Mover la feature a "Hecho" en `../../constitution/roadmap.md`.
- [ ] Commit y registrar hash en `tasks.md` raíz.
