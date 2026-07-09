# YUSEPE Bento

Hub de espacios de trabajo con **Bento Grid** dinámico: perfiles locales,
terminales reales (node-pty), webapps embebidas y una librería de apps
configurable — todo redimensionable y reorganizable a mano, con tema
claro/oscuro y persistencia de sesiones entre workspaces.

Construido con **Electron + electron-vite + Vanilla JS + TailwindCSS**.

---

## 1. Instalación

```bash
npm install
```

> `postinstall` corre `electron-rebuild` automáticamente para compilar
> `node-pty` contra la versión de Electron del proyecto. Si falla (por
> ejemplo, sin toolchain de compilación nativa), la app sigue funcionando
> pero sin terminales — correlo a mano cuando tengas el entorno listo:
> ```bash
> npm run rebuild
> ```
> En Windows puede hacer falta **Visual Studio Build Tools** para compilar
> módulos nativos.

---

## 2. Desarrollo

```bash
npm run dev       # Modo desarrollo (HMR en renderer, autoreload en main)
npm run build     # Build de producción (out/)
npm run preview   # Previsualizar el build de producción
npm test          # Suite de tests (Vitest)
npm run test:watch
```

Los datos de perfiles se guardan en:
- macOS:   `~/Library/Application Support/yusepe-bento/profiles/`
- Windows: `%APPDATA%\yusepe-bento\profiles\`
- Linux:   `~/.config/yusepe-bento/profiles/`

Cada perfil es un JSON (`<id>.json`) + un índice ligero (`_index.json`),
con escrituras atómicas (`.tmp` + `rename`) y deduplicación automática del
índice al leer.

---

## 3. Estructura

```
src/
├── main/                    # Proceso Main de Electron
│   ├── index.js             # BrowserWindow, CSP, menú, nativeTheme, dialog (folder picker)
│   ├── ipc.js                # Handlers IPC: perfiles (CRUD) + pty (ciclo de vida de terminal)
│   ├── storage.js           # Persistencia JSON atómica de perfiles
│   └── storage.test.js
├── preload/
│   └── index.js             # contextBridge → window.yusepe.{profiles,pty,shell,theme,dialog,menu}
└── renderer/
    ├── index.html
    ├── main.js               # Entry point: pantalla de perfiles, topbar, wiring de eventos
    ├── style.css             # Tokens de tema (CSS vars) + Bento Grid
    ├── core/
    │   ├── eventBus.js       # Pub/sub minimalista con wildcards ('tile:*')
    │   ├── state.js          # Estado reactivo (Proxy) — perfil activo, lista de perfiles
    │   ├── profileManager.js # CRUD de perfiles/tiles, orquesta cambios de workspace
    │   ├── layout.js         # Lógica PURA del grid: auto-placement, push/pull resize, drag libre
    │   ├── liveTiles.js      # Registro de tiles vivos (terminal/webview) entre workspaces
    │   ├── theme.js          # Tema claro/oscuro (persistido + nativeTheme vía IPC)
    │   ├── settings.js       # Preferencias de app (URL de la librería de apps)
    │   └── appLibrary.js     # Fetch del catálogo dinámico de apps
    ├── components/
    │   ├── bentoGrid.js      # Render incremental, resize, drag, watermark de espacio libre
    │   ├── tile.js            # Factoría de tiles (TileFactory) + dispatcher de render
    │   ├── webviewTile.js     # Tile <webview> (persistente vía liveTiles)
    │   ├── terminal.js        # Tile terminal (xterm.js + pty, persistente vía liveTiles)
    │   ├── calculator.js
    │   ├── addToSpace.js      # Modal "Agregar al espacio" (terminal/URL/apps de la librería)
    │   ├── settings.js        # Modal de Configuración (tema + URL de librería)
    │   └── modal.js           # Modal genérico + promptModal/confirmModal
    ├── assets/                # Ilustraciones del estado vacío (claro/oscuro)
    └── utils/
        └── dom.js             # Helpers: h(), debounce, uid, escapeHtml
```

---

## 4. Funcionalidad

### Espacios de trabajo (perfiles)
- Cada perfil tiene nombre único, tiles con posición manual (`col/row/colSpan/rowSpan`)
  y una **carpeta de inicio (`cwd`)** opcional donde arrancan sus terminales.
- La carpeta se pide al crear el perfil y es editable después (📁 en la
  tarjeta del perfil).

### Bento Grid
- Grid manual de 12 columnas, filas automáticas (`minmax(70px, 1fr)`).
  Perfiles guardados con la resolución anterior (6 columnas) se migran
  automáticamente al abrirlos (`gridVersion`, ver `main/storage.js`),
  escalando posiciones y tamaños x2 para que el layout se vea igual.
- **Resize** arrastrando los bordes/esquina del tile: si el crecimiento
  choca con un vecino, lo **encoge** (push) en vez de bloquear el gesto;
  si lo encogés, el vecino pegado a ese borde se **expande** para llenar
  el hueco. Ver `resolveColGrowth/Shrink` y `resolveRowGrowth/Shrink` en
  `core/layout.js`.
- **Mover** arrastrando el grip (⠿): se posiciona en la celda bajo el
  cursor; cualquier tile tapado se reacomoda en el primer hueco libre
  disponible (`moveTileTo`).
- Al cerrar un tile, los demás se reacomodan automáticamente sin dejar
  huecos (`compactTiles`).
- El espacio libre del grid muestra el logo de YUSEPE Bento como marca de
  agua (fondo `position:absolute` detrás de los tiles — se asoma en
  cualquier celda vacía, no solo cuando el workspace está 100% vacío).

### Terminales y webviews persistentes entre workspaces
- Al cambiar de perfil, las terminales (proceso pty real) y los webviews
  **no se destruyen**: quedan vivos en segundo plano (`core/liveTiles.js`)
  y se re-adjuntan tal cual al volver a ese workspace (scrollback, shell
  en ejecución, sesión de la página — todo intacto).
- Truco para los webviews: en vez de sacarlos del DOM (lo que Electron
  interpreta como destruir el guest), se mueven a una zona oculta
  (`#tile-holding-area`, `display:none`) que sigue dentro del documento.
- La topbar muestra un chip por cada workspace con tiles corriendo en
  background (excluyendo el activo), con botón para cerrarlo del todo
  (mata sus procesos reales, con confirmación).
- Solo se mata de verdad un tile al borrarlo puntualmente o al cerrar su
  workspace en background — nunca al simple cambio de perfil.

### Agregar al espacio
Modal único (`Cmd/Ctrl+K`) con: nueva terminal, terminal precargada
(ejecuta un comando automáticamente al abrirse), calculadora, URL manual,
y un catálogo de webapps con UI tipo marketplace — buscador, filtro por
categoría y tarjetas con descripción (ver `core/appLibrary.js`).

### Administrador del workspace (🧰)
Modal con una tabla de todos los tiles del workspace activo: nombre,
tamaño (`colSpan x rowSpan`), comando/URL editable en línea (para
webviews, prellenado con la URL *actual* de navegación — un botón la
fija como URL principal del tile), control de zoom por webview (a nivel
Chromium, funciona incluso en sitios que bloquean el zoom del navegador)
y un botón para eliminar el tile. Ver `components/workspaceManager.js`.

### Command Palette (`Cmd/Ctrl+P`)
Buscador único para saltar a otro workspace, enfocar un tile del
workspace activo, o disparar cualquier acción rápida (nueva terminal,
paneles, tema, importar/exportar, nuevo workspace). Navegación con
↑/↓/Enter. Ver `components/commandPalette.js`.

### Snippets (panel lateral, ícono `{}`)
Librería de comandos/rutinas multi-línea, **global a la app** (no por
workspace) — vive en `<userData>/snippets.json`. Un click en un snippet
lo tipea y ejecuta línea por línea en la terminal enfocada (o la primera
terminal del workspace si ninguna está enfocada), como si se hubiera
tipeado a mano. Ver `components/snippetsSidebar.js` y `main/snippetsOps.js`.

### Importar / exportar workspaces
Cada perfil se puede exportar a un `.json` portable (⬇ en la lista de
workspaces, o desde el Command Palette) e importar de vuelta (⬆
Importar) — genera un id nuevo siempre y resuelve colisiones de nombre
con un sufijo. Ver `ProfileStorage.importProfile` en `main/storage.js`.

### Tema claro/oscuro
- Toggle en Configuración (`Cmd/Ctrl+,`). Persistido en `localStorage`.
- Afecta la UI completa vía variables CSS (`--color-bg`, `--color-fg`, etc.),
  la paleta de xterm.js, y — vía `nativeTheme.themeSource` en el proceso
  main — el `prefers-color-scheme` de **todos** los `<webview>`, para que
  las webapps embebidas respeten el mismo tema (si la web lo soporta).

---

## 5. Seguridad

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- CSP estricta vía `onHeadersReceived` (incluye `connect-src` para el
  fetch de la librería de apps).
- Permisos denegados por defecto (`setPermissionRequestHandler`).
- Cada `<webview>` aislado en su propia partición `persist:yusepe-<tileId>`.

## 6. IPC

- API expuesta en `window.yusepe` mediante `contextBridge`:
  `profiles`, `pty`, `shell`, `theme`, `dialog`, `menu`.
- Canales nombrados (`profiles:*`, `pty:*`, `theme:set`, `dialog:pick-folder`).

## 7. Bus de eventos

`bus.on('tile:*', handler)` con wildcards. Eventos clave: `profile:loaded`,
`workspace:left` (cambio de perfil — dispara el desmontaje no-destructivo
de tiles persistentes), `tile:added/removed/updated`, `theme:changed`,
`live-tiles:changed`.

---

## 8. Tests

Vitest cubre la lógica pura y de persistencia más crítica (sin depender
de Electron ni del DOM):

- `core/layout.test.js` — auto-placement, push/pull resize, drag libre.
- `core/liveTiles.test.js` — registro/kill de tiles vivos entre workspaces.
- `core/eventBus.test.js` — pub/sub, wildcards, resiliencia a errores.
- `main/storage.test.js` — CRUD de perfiles sobre disco real (dir temporal),
  incluye regresión del bug histórico de índice duplicado.

```bash
npm test
```

---

## 9. Empaquetado (electron-builder)

```bash
npm run package        # todas las plataformas configuradas
npm run package:mac    # solo macOS (dmg + zip)
npm run package:win    # solo Windows (nsis)
npm run package:linux  # solo Linux (AppImage + deb)
```

Config en `electron-builder.yml`. Antes de generar un instalador real hace
falta:

- **`build/icon.png`**: ícono cuadrado, idealmente 1024×1024, PNG con
  fondo transparente. electron-builder deriva automáticamente `.icns`
  (macOS) e `.ico` (Windows) a partir de ese único archivo.

Notas:
- **node-pty** (módulo nativo) se excluye del `asar` (`asarUnpack`) porque
  sus binarios `.node` y el ejecutable `spawn-helper` necesitan existir
  como archivos reales en disco.
- **macOS sin firma**: `electron-builder.yml` tiene `identity: null`
  (no hay cuenta de Apple Developer configurada). El `.app` funciona
  perfecto, pero Gatekeeper va a pedir *click derecho → Abrir* la primera
  vez que se instale, en vez de doble click directo.
- `electron-builder@24.13.3` está fijado a propósito: la rama 26.x actual
  falla al empaquetar (`ERR_REQUIRE_ESM` en una dependencia transitiva,
  `@noble/hashes`, incompatible con el resto de la cadena de `require()`
  en este entorno). Mismo tipo de problema que forzó fijar `vitest@^2` en
  vez de la v4 (requiere Node 20+; este proyecto corre en Node 18).

## 10. Atajos de teclado

| Combinación   | Acción                       |
|---------------|-------------------------------|
| `Ctrl/⌘ + P`  | Command Palette                |
| `Ctrl/⌘ + K`  | Agregar al espacio             |
| `Ctrl/⌘ + T`  | Nueva terminal (directo)       |
| `Ctrl/⌘ + B`  | Nueva calculadora (directo)    |
| `Ctrl/⌘ + ,`  | Configuración                  |
| `Ctrl/⌘ + W`  | Cerrar el tile enfocado        |
| `Escape`      | Cerrar modal                   |

---

## 11. Próximos pasos (roadmap)

- [x] Importar/exportar perfiles.
- [ ] Ícono real de la app (`build/icon.png`) — hoy el empaquetado funciona pero sin ícono definitivo.
- [ ] Firma/notarización de macOS (requiere cuenta de Apple Developer).
- [ ] Indicador visual de "workspace corriendo" en la lista de perfiles.
- [ ] Comunicación entre tiles vía `postMessage` + bus relay.
