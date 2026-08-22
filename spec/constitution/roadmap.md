# Roadmap

## Hecho ✅

1. **001 · Bento Grid core** — grid de 12 columnas con auto-placement, resize push/pull y drag libre.
2. **002 · Perfiles / Workspaces** — CRUD de perfiles, persistencia JSON atómica, migración de gridVersion.
3. **003 · Terminal (node-pty + xterm.js)** — terminal real con OSC 52 write, bracketed paste, copy-on-select.
4. **004 · Webview tiles** — webview por tile con partición aislada, permisos denegados por defecto.
5. **005 · Live tiles** — terminales y webviews persisten entre cambios de workspace (no se destruyen).
6. **006 · Explorador de archivos** — listado, búsqueda (dotfiles incluidos), preview, escritura, renombrar, duplicar, papelera.
7. **007 · Panel Git** — status, diff, stage/unstage, commit, push, fetch, pull, branches.
8. **008 · Panel de Agentes** — lectura/escritura de instruction files (CLAUDE.md, AGENTS.md…).
9. **009 · Tareas** — lista por workspace en `.md` reales, frontmatter, notas, launch template.
10. **010 · Snippets** — librería global de comandos multi-línea, ejecución en terminal activa.
11. **011 · CLI `ybento`** — `estado`, `bandeja`, `enviar`; wrapper sin dependencia de Node del usuario.
12. **012 · Loop multiagente** — mensajería entre terminales con reparto automático, presencia, cruces, sello de commit.
13. **013 · Loop: sonidos y notificaciones OS** — ≥5 sonidos sintéticos seleccionables + notificación cuando @usuario recibe mensaje.
14. **014 · Loop: estado del panel por workspace** — el panel abierto/cerrado es independiente por perfil.
15. **015 · Loop: modo configurable** — "Un loop a la vez" vs "Loops simultáneos", persiste en localStorage.
16. **016 · Loop: bindings por workspace** — en modo simultáneo, agentes del mismo nombre en workspaces distintos no se pisan.
17. **017 · Wallpaper picker** — buscador Pexels, posición, opacidad; API key solo en proceso main.
18. **018 · Tema claro/oscuro** — persistido, propagado a webviews y nativeTheme.
19. **019 · Calculadora tile** — calculadora básica embebida.
20. **020 · Tooltip propio** — reemplaza el nativo de Chromium (lento); un nodo reutilizado, delegado en document.

## Siguiente 🔜

_(vacío — definir la próxima feature en `tasks.md` raíz antes de crear la carpeta de feature)_

## Hecho ✅ (continuación)

21. **021 · fix: Scroll del textarea del compositor** — el textarea del compositor conserva su posición de scroll tras cada refresh del panel.

## Backlog / ideas 💡

- **Loop: chunking de mensajes largos** — se descartó en sesión 2025-08; el usuario prefiere pasar el mensaje completo sin fragmentar.
- **Editor de código integrado** — tile tipo editor (Monaco u otro); no es prioridad core.
- **Exportar/importar workspaces** — ya existe export/import de perfil; mejorar UX del flujo.
- **Auto-`.gitignore` de `.ybento`** — dejado fuera de alcance a propósito; las tareas se commitean.
