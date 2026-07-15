# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es esto

YUSEPE Bento: app de escritorio Electron que funciona como hub de espacios de
trabajo ("perfiles") con un Bento Grid dinámico y redimensionable a mano.
Cada tile puede ser una terminal real (node-pty), un `<webview>` embebido,
una calculadora, un explorador de archivos, un panel de Git, o un panel de
"Agentes" (instrucciones de IA tipo CLAUDE.md/AGENTS.md). Vanilla JS (sin
framework de UI) + TailwindCSS, sin bundler de estado — reactividad manual
vía `Proxy` + un event bus.

## Comandos

```bash
npm run dev             # electron-vite dev (HMR renderer, autoreload main)
npm run build            # build de producción -> out/
npm run preview          # previsualizar el build
npm test                 # vitest run (suite completa)
npm run test:watch       # vitest en watch
npx vitest run src/renderer/core/layout.test.js   # un solo archivo de test
npm run rebuild          # recompila node-pty contra la versión de Electron (electron-rebuild)
npm run package:mac      # empaquetar solo macOS (dmg + zip)
npm run package:win      # empaquetar solo Windows (nsis)
npm run package:linux    # empaquetar solo Linux (AppImage + deb)
```

`postinstall` corre `electron-rebuild` automáticamente; si falla por falta
de toolchain nativo, la app sigue funcionando pero sin terminales hasta que
se corra `npm run rebuild` a mano.

```bash
npm run lint             # eslint (flat config, ESLint 9) sobre src/ + configs
npm run lint:fix         # eslint --fix
npm run format           # prettier --write sobre src/ (opt-in, ver nota)
npm run format:check     # prettier --check (no corre en CI todavía)
```

Linter: **ESLint 9** (`eslint.config.mjs`, flat config) con globals por
dominio (main/preload = Node, renderer = browser) y foco en bugs reales
(`no-unused-vars`, `no-undef`), no estilo. **Prettier** está configurado
(`.prettierrc.json`) pero el repo **todavía no fue formateado de una** — por
eso `format:check` no corre en CI: correr `npm run format` genera un diff
masivo (44 archivos) que debe ser un commit one-shot aparte antes de
enforcearlo. `eslint-config-prettier` ya desactiva reglas de estilo que
chocarían.

CI: `.github/workflows/ci.yml` corre lint + test + build en cada push/PR
(Node 20, ubuntu). `node-pty` no se necesita compilado para ninguno de los
tres, así que el fallo de su `electron-rebuild` en CI es tolerado.

**Versiones fijadas a propósito** (no actualizar sin revisar por qué):
- `electron-builder@24.13.3` — la rama 26.x falla al empaquetar (`ERR_REQUIRE_ESM`
  en `@noble/hashes`, incompatible con la cadena de `require()` de este entorno).
- `vitest@^2` — la v4 requiere Node 20+; este proyecto corre en Node 18.

## Arquitectura

### Proceso Main vs Renderer

- `src/main/index.js` — `BrowserWindow`, CSP estricta (`onHeadersReceived`,
  incluye `connect-src` para el fetch de la librería de apps), menú,
  `nativeTheme`, `dialog` (folder picker). Permisos de `<webview>`
  denegados por defecto (`setPermissionRequestHandler`).
- `src/main/ipc.js` — registra todos los handlers IPC, agrupados por dominio:
  `profiles:*` (CRUD, delega a `storage.js`), `pty:*` (ciclo de vida de
  terminal real), `tools:detect` (`toolDetector.js`), `explorer:*`
  (`explorerFs.js`), `git:*` (`gitOps.js`), `agents:*` (`agentOps.js`),
  `pexels:*` (`pexelsOps.js`), `snippets:*` (`snippetsOps.js`).
  `profiles:export`/`profiles:import` son la excepción: viven en
  `main/index.js` (no acá) porque necesitan `dialog` + `mainWindow`,
  mismo criterio que `dialog:pick-folder`/`dialog:pick-image`.
- `src/main/snippetsOps.js` — librería de snippets (comandos/rutinas
  multi-línea) **global a la app**, no por workspace — un solo JSON en
  `<userData>/snippets.json`, mismo patrón de escritura atómica que
  `storage.js`. Se ejecutan en la terminal enfocada vía
  `components/snippetsSidebar.js`.
- `src/main/tasksOps.js` — app de Tareas: lista por workspace respaldada en
  `.md` reales dentro del proyecto (`.ybento/tasks/`), un archivo por tarea
  con frontmatter mínimo (`title`/`done`/`createdAt`) + cuerpo libre para
  notas. **El disco es la fuente de verdad, no hay índice**: el estado ES el
  directorio, así que los `.md` se editan a mano y se versionan con git sin
  desincronizar nada. Un archivo por tarea (y no un JSON único) porque cada
  tarea necesita ruta propia para el futuro `launchText` (`{{task_route}}`).
  Mismo `resolveSafe` que explorerFs/agentOps; los ids se validan como
  nombre de archivo `.md` pelado (`resolveTaskPath`), sin separadores.
  El auto-`.gitignore` de `.ybento` quedó **fuera de alcance** a propósito:
  las tareas se commitean con el repo.
- `src/main/pexelsOps.js` — cliente de la API de Pexels para el buscador de
  wallpapers. Vive en el proceso main a propósito: la API key
  (`process.env.APIKEY_PEXELS`) se inyecta en build-time desde `.env` vía
  `define` en `electron.vite.config.mjs`, así nunca llega al bundle del
  renderer. El renderer solo pide fotos por IPC (`window.yusepe.pexels.search`,
  ver `core/pexels.js`) — no hay configuración de API key para el usuario.
- `src/main/storage.js` — persistencia JSON atómica de perfiles (`.tmp` +
  `rename`) + índice ligero con deduplicación al leer. Perfiles en
  `~/Library/Application Support/yusepe-bento/profiles/` (macOS),
  `%APPDATA%\yusepe-bento\profiles\` (Windows), `~/.config/yusepe-bento/profiles/` (Linux).
  Incluye `gridVersion`: perfiles guardados con la resolución de grid
  anterior (6 cols) se migran una sola vez al cargarlos (`migrateGrid`),
  escalando `col/row/colSpan/rowSpan` x2 a la resolución actual (12 cols).
  Si el grid vuelve a cambiar de resolución, sumá un nuevo `GRID_VERSION`
  en vez de mutar la migración existente. `importProfile()` crea el
  perfil con un id nuevo siempre (nunca reutiliza el del archivo
  exportado) y resuelve colisiones de nombre con un sufijo `" (2)"`;
  preserva el `gridVersion` del archivo tal cual, así un export viejo
  se re-migra solo al importarlo y uno ya actual no se vuelve a escalar.
- `src/main/explorerFs.js`, `src/main/agentOps.js` — ambos resuelven rutas
  con el mismo patrón de seguridad (`resolveSafe`): toda ruta relativa se
  valida contra el `root`/`cwd` del workspace para bloquear path traversal
  (`..`). Si tocás uno, revisá el otro para mantener el patrón consistente.
  En explorerFs, las operaciones destructivas (renombrar, borrar) usan
  `resolveEntryPath`, que además rechaza el root mismo. **explorerFs no
  importa `electron` a propósito**: así corre bajo vitest sin mocks. Lo que
  necesita `shell` (papelera, revelar en Finder) vive en `ipc.js`.
- `src/main/toolDetector.js` — detecta CLIs instaladas (`claude`, `opencode`,
  `lazygit`, `lazydocker`, `nvim`, `vim`, `btop`) invocando el shell del
  usuario en modo interactivo (`-ic`), no `process.env.PATH` crudo — las
  apps GUI en macOS arrancan con un PATH mínimo que no incluye lo que
  agrega Homebrew/nvm en `~/.zshrc`.
- `src/preload/index.js` — expone `window.yusepe.{profiles,pty,tools,shell,theme,dialog,menu}`
  vía `contextBridge` (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).

### Renderer: core (lógica pura, sin DOM) vs components (UI)

- `core/eventBus.js` — pub/sub con wildcards (`bus.on('tile:*', handler)`).
  Eventos clave: `profile:loaded`, `workspace:left` (dispara desmontaje
  no-destructivo de tiles persistentes al cambiar de perfil),
  `tile:added/removed/updated`, `theme:changed`, `live-tiles:changed`.
- `core/state.js` — estado reactivo vía `Proxy` (perfil activo, lista de perfiles).
- `core/profileManager.js` — CRUD de perfiles/tiles, orquesta cambios de workspace.
- `core/layout.js` — **lógica pura del grid** (sin dependencias de DOM):
  auto-placement, resize con push/pull entre vecinos, drag libre,
  compactación al cerrar tiles. Es el módulo más cubierto por tests
  (`layout.test.js`) — cualquier cambio de comportamiento del grid debe
  poder razonarse ahí sin tocar `bentoGrid.js`.
- `core/liveTiles.js` — registro de tiles vivos (terminal/webview) que
  persisten entre cambios de workspace en vez de destruirse.
- `core/theme.js` — tema claro/oscuro persistido en `localStorage`, y
  propagado a `nativeTheme.themeSource` (proceso main) para que los
  `<webview>` respeten el mismo `prefers-color-scheme`.
- `core/appLibrary.js` — fetch del catálogo dinámico de apps para el modal
  "Agregar al espacio" (`{ count, apps: [{ id, name, url, icon }] }`).
- `core/pexels.js` — wrapper delgado sobre `window.yusepe.pexels.search`
  para `components/wallpaperPicker.js`; la búsqueda real (y la API key)
  vive en `main/pexelsOps.js`, no acá.
- `core/codeHighlight.js` — highlight.js "core" build con lenguajes
  elegidos a mano (no el paquete completo), usado por el preview del
  explorador y por bloques de código en Markdown renderizado.

### Persistencia de tiles vivos entre workspaces

Al cambiar de perfil, las terminales (proceso pty real) y los `<webview>`
**no se destruyen** — quedan vivos en background vía `core/liveTiles.js` y
se re-adjuntan igual al volver a ese workspace. El truco para webviews: en
vez de sacarlos del DOM (Electron lo interpreta como destruir el guest), se
mueven a una zona oculta (`#tile-holding-area`, `display:none`) que sigue
en el documento. Solo se mata un tile de verdad al borrarlo puntualmente o
al cerrar su workspace en background desde la topbar — nunca al simple
cambio de perfil.

### Seguridad de `<webview>`

Cada `<webview>` está aislado en su propia partición
`persist:yusepe-<tileId>`. Si agregás una feature que toca webviews, seguí
ese patrón de partición por tile en vez de compartir sesión.

## Tests

Vitest cubre lógica pura y de persistencia crítica, sin depender de
Electron ni del DOM:

- `src/renderer/core/layout.test.js` — auto-placement, push/pull resize, drag libre.
- `src/renderer/core/liveTiles.test.js` — registro/kill de tiles vivos entre workspaces.
- `src/renderer/core/eventBus.test.js` — pub/sub, wildcards, resiliencia a errores.
- `src/main/storage.test.js` — CRUD de perfiles sobre disco real (dir temporal), incluye regresión del bug histórico de índice duplicado.
- `src/main/pathSafety.test.js` — regresión de seguridad: `resolveSafe` (vía `resolvePath`) en explorerFs **y** agentOps rechaza path traversal (`..`, rutas absolutas, hermanos con prefijo compartido). Misma batería para ambos porque comparten implementación.
- `src/main/tasksOps.test.js` — app de Tareas sobre disco real: alta/marcado/borrado, slugs únicos, y las regresiones que importan cuando el usuario puede tocar los `.md` a mano (frontmatter roto no tira la lista abajo, marcar una tarea no le come las notas del cuerpo, un id con separadores no escribe fuera de `.ybento/tasks`).
- `src/main/explorerFs.test.js` — escrituras del explorador sobre disco real: `createEntry`, `renameEntry`, `duplicateEntry`, `resolveEntryPath`. La regresión clave es que ninguna pise trabajo del usuario en silencio (`fs.rename` sí lo haría). Cubre además que `searchFiles` encuentre dotfiles/dotfolders: **el explorador muestra todos los archivos del proyecto a propósito** (decisión de producto), así que el buscador no debe esconder nada — lo único que no se recorre es `SEARCH_IGNORE`, que filtra por carpeta concreta (`.git`, `node_modules`, …), nunca por "empieza con punto".

## Notas de empaquetado

- `node-pty` (módulo nativo) se excluye del `asar` (`asarUnpack` en
  `electron-builder.yml`) porque sus binarios `.node` y el ejecutable
  `spawn-helper` necesitan existir como archivos reales en disco.
- macOS sin firma (`identity: null`, no hay cuenta Apple Developer) — el
  `.app` funciona pero Gatekeeper pide *click derecho → Abrir* la primera vez.
