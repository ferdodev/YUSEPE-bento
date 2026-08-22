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

## Flujo de trabajo (Spec Driven Development)

**Si una tarea no está en `tasks.md` (raíz), no se ejecuta.**

El flujo obligatorio para cualquier feature o cambio no trivial es:

1. **`tasks.md` raíz** — el usuario agrega la tarea en la sección "Pendientes".
2. **Spec** — Claude crea `spec/features/NNN-nombre/spec.md` (qué hace, por qué, criterios de aceptación).
3. **Plan** — Claude crea `spec/features/NNN-nombre/plan.md` (enfoque técnico, archivos afectados, riesgos).
4. **Confirmación** — el usuario aprueba spec + plan antes de que Claude toque código.
5. **Implementación** — Claude ejecuta siguiendo `spec/features/NNN-nombre/tasks.md`.
6. **Cierre** — se actualiza `spec/constitution/roadmap.md` (mover a "Hecho") y se hace commit.

La constitución (`spec/constitution/`) manda: si una feature choca con `mission.md` o `tech-stack.md`, se replantea la feature, no la constitución. Ver `spec/README.md` para referencia completa.

## Reglas de operación

**Nunca matar ni cerrar la app Bento en ejecución sin confirmación explícita del usuario.**
Si se necesita cerrar Bento para resolver un problema (por ejemplo, un archivo bloqueado
durante el empaquetado), se debe pedir confirmación primero y esperar respuesta antes de
ejecutar cualquier `Stop-Process`, `kill`, o comando equivalente sobre procesos de Bento/Electron.
El usuario puede estar trabajando en la app en ese momento.

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
- `src/main/loopOps.js` + `loopDispatcher.js` + `loopShim.js` — **loop
  multiagente**: varias terminales, cada una con un agente distinto, que se
  mandan mensajes para trabajar en conjunto (uno codea, otro revisa). Estado
  en `.ybento/loop/` dentro del proyecto: `messages.jsonl` (append-only),
  `status.json` (agentes + `waiting`/`working`) y `skill.md` (el protocolo
  que leen los agentes). Mismo criterio que tasksOps: el disco es la fuente
  de verdad, y acá suma que el agente puede leer su bandeja con un `Read`
  aunque el CLI falle.
  - **`messages.jsonl` y no `.json`**: hay N escritores concurrentes (un
    proceso del CLI por agente, más Bento). Un JSON único obliga a
    leer-modificar-escribir y dos agentes que postean a la vez se pisan el
    mensaje. `status.json` sí se reescribe entero, por eso va con lock de
    archivo (`open` en `wx` + ruptura por antigüedad).
  - **El repartidor (`loopDispatcher.js`) vive en main, no en el renderer**:
    los mensajes los postean *otros procesos*, así que hace falta alguien
    vigilando el disco. Entrega **un mensaje por vuelta y por agente**, y
    sólo a los que están en `waiting` — escribir en el pty de un agente
    ocupado entrelaza el texto con su TUI. La serialización sale gratis del
    gate de estado, sin cola aparte.
  - **`nombre -> ptyId` vive en memoria, nunca en disco**: el ptyId muere
    con la terminal, la identidad (`@claudio`) no. `status.json` guarda el
    `tileId`, que es lo estable.
  - **Entregar es: una línea, y el Enter aparte.** Del otro lado hay un TUI
    (Claude Code, opencode), no un shell. Dos reglas que salieron de la
    primera prueba de campo y no son cosméticas:
    (a) `formatForTerminal` colapsa el mensaje a **una sola línea** — un
    `\n` no es un separador visual, es un Enter dentro de la caja de texto
    del agente, y parte el mensaje. El texto original conserva sus saltos en
    `messages.jsonl` y en el panel; sólo se aplana para el viaje por el pty.
    (b) el `\r` se manda en una **escritura separada**, con `SUBMIT_DELAY_MS`
    de por medio: esos TUIs detectan ráfagas de input como *pegado* y se
    tragan el CR como contenido, dejando el mensaje escrito sin enviar. Con
    la pausa, llega como una pulsación de tecla de verdad.
    (c) el payload va **entre comillas simples**. No siempre hay un TUI
    escuchando: si el proceso del agente terminó, la terminal volvió al
    prompt y lo que pegamos lo interpreta el shell. Sin comillas, un
    backtick o `$(...)` dentro de un mensaje **se ejecuta** (verificado en
    campo), y una comilla sin cerrar deja a zsh en continuación tragándose
    el Enter y colgando el loop. Entre comillas simples el peor caso es un
    "command not found" con el prompt limpio. Las comillas simples del
    texto se pasan a tipográficas (`’`) para no tener que escapar nada.
  - **Presencia: no se entrega a una terminal sin agente.** Cuando el
    proceso del agente termina, su terminal vuelve al prompt; entregar ahí
    marcaba el mensaje como leído por nadie — pérdida silenciosa. El
    detector es `proc.process` (el proceso en primer plano del pty): si es
    el shell, el agente no está. En ese caso **no se entrega y el cursor no
    avanza**, así el mensaje sigue pendiente y recuperable. Ante la duda
    (sin sonda, o el pty no responde) se asume presente: es peor dejar mudo
    un loop sano que entregar de más. La presencia vive en memoria, como el
    binding `nombre -> ptyId`.
  - **El quoting es un problema en las DOS direcciones.** Además de lo que
    Bento escribe al pty, está lo que el agente escribe en su shell:
    `ybento enviar @x "reporte largo"` expande backticks y `$` en silencio,
    y el agente manda algo distinto de lo que escribió sin enterarse. Por
    eso el CLI acepta `-f archivo` y **stdin** (heredoc), que es lo que el
    `skill.md` recomienda para mensajes largos.
  - **`ybento enviar` devuelve el agente a `waiting`** salvo `--ocupado`.
    Depender de que se acuerde de hacerlo a mano es un footgun: si se
    olvida queda incomunicado y su bandeja se frena, y el olvido aparece
    justo cuando la iteración se pone larga. Enviar es, en el protocolo,
    lo que hacés al terminar el turno.
  - **Color de identidad por agente.** El hilo es grupal y todas las burbujas
    se veían iguales: con reportes de QA de 30 líneas, el único distintivo era
    el `@x → @y` de 10px. Cada agente tiene un `color` (`#rrggbb`) que le pinta
    el borde izquierdo y un lavado del fondo de sus mensajes. Tres detalles que
    no son cosméticos: (a) el color **se valida como hex en `loopOps`, al
    escribir y al leer** — va a un `style` inline y `status.json` es un archivo
    del proyecto que editan a mano el usuario y los agentes, así que un string
    libre sería inyección de CSS; (b) si no hay color elegido se **deriva del
    nombre**, y por eso no hizo falta migrar nada ni tocar los agentes ya
    registrados; (c) la paleta **no tiene verde, ámbar ni rojo**, que ya
    significan libre/ocupado/caído en el roster — un agente no puede "verse
    caído" por su color. Se tiñe el fondo y no el texto: son reportes largos y
    el contraste de lectura no se negocia (el nombre, que sí va coloreado, se
    mezcla hacia `--color-fg` para servir en tema claro y oscuro).
  - **Cruces**: cada mensaje guarda `seenUpTo` (hasta dónde había leído
    quien lo escribió) y al leer se le calcula un `seq` por posición en el
    archivo — no se persiste, porque repartir números con N escritores
    concurrentes necesitaría un contador compartido y el orden del archivo
    ya es la verdad. Con eso, `crossedMessages()` detecta que dos agentes
    se escribieron a la vez y el aviso viaja en el texto que se pega. Sin
    esto el desencuentro se descubre tres mensajes después, por contenido.
  - **Desfase de código**: además del cruce de mensajes existe el cruce de
    *versiones* — uno reporta un bug y el otro ya lo arregló y commiteó, así
    que el reporte describe código que ya no existe. Cada mensaje se sella
    con el HEAD del momento (`readHead`) y al entregarlo se avisa si el
    árbol ya avanzó. Son dos problemas distintos con la misma pinta; los
    dos salieron de feedback de agentes, no de los tests.
  - **Sello de entrega y `--re`.** Cada mensaje muestra siempre sobre qué
    commit se escribió (`[sobre a1b2c3d +cambios sin commitear]`), no sólo
    cuando hay desfase: es el límite exacto sobre el que arranca un QA, en
    vez de "el árbol en este momento". Y `ybento enviar --re <n>` marca a
    qué mensaje contesta — sin eso dos agentes terminan defendiendo
    posiciones que el otro ya había dado por cerradas.
  - **Nombrar una terminal con el agente ya corriendo no le da identidad.**
    El `export YBENTO_AGENT` sólo se tipea si el pty está en el prompt del
    shell (`looksLikeShell`): si adentro hay un TUI, ese texto le entraría
    como un mensaje del usuario, y además las herramientas del agente
    lanzan procesos hijos del suyo, no del shell. En ese caso se avisa por
    toast y hay que reiniciar el agente. Lo correcto es nombrar la terminal
    **antes** de levantar el agente.
  - **Los tests del repartidor apagan `watchFs` y suben `pollMs`.** Sus
    propias escrituras dispararían la vigilancia y una vuelta de fondo
    entregaría un mensaje en medio de las aserciones. Sólo el test de la
    vigilancia los deja activos.
  - **Las terminales de un loop no se borran.** El guard está en
    `ProfileManager.removeTile` porque es el único camino por el que se
    borra un tile; los botones sólo muestran el error. Cerrar el workspace
    entero sí las mata, pero es un acto deliberado: ahí se avisa en el
    confirm en vez de bloquear.
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
- `src/cli/` — el CLI **`ybento`**, lo que usan los agentes desde su
  terminal (`ybento estado`, `ybento bandeja`, `ybento enviar @opencito
  "..."`). Corre suelto con Node, fuera de Electron. `run.js` tiene la
  lógica y recibe su entorno por parámetro (argv, cwd, env, salidas) para
  poder testearse sin spawnear procesos; `ybento.mjs` es sólo el ejecutable.
  El comando existe en el PATH porque `loopShim.js` genera un wrapper en
  `<userData>/bin` y `pty:create` antepone ese directorio — el wrapper
  ejecuta **el binario de la propia app** con `ELECTRON_RUN_AS_NODE=1`, así
  no depende de que el usuario tenga Node instalado.
  **`src/package.json` (`{"type":"module"}`) es parte de esto**: sin él,
  Node imprime un warning de módulo en *cada* invocación del CLI, que el
  agente ve en su terminal y paga en tokens.
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
- `components/loopSidebar.js` — panel del loop multiagente (lado derecho,
  mismo patrón que `snippetsSidebar.js`): roster de terminales con su
  nombre/rol/estado, y el hilo de mensajes. Es una conversación **grupal**
  —todo el workspace en un solo hilo con `de → para` visible— a propósito:
  el valor de mirarlo es seguir la cadena completa (usuario pide → claudio
  hace → opencito revisa → vuelve a claudio), y partirla por par de agentes
  la escondería. **Acá no se reparte nada**: pegar el mensaje en la terminal
  destino lo hace `main/loopDispatcher.js`. Este panel sólo muestra y postea.
  Nombrar una terminal ya abierta también le exporta `YBENTO_AGENT` al shell
  en ejecución — el entorno se fija al crear el pty, así que sin eso el CLI
  le diría "no sé quién sos".
- `core/theme.js` — tema claro/oscuro persistido en `localStorage`, y
  propagado a `nativeTheme.themeSource` (proceso main) para que los
  `<webview>` respeten el mismo `prefers-color-scheme`.
- `core/appLibrary.js` — fetch del catálogo dinámico de apps para el modal
  "Agregar al espacio" (`{ count, apps: [{ id, name, url, icon }] }`).
- `core/pexels.js` — wrapper delgado sobre `window.yusepe.pexels.search`
  para `components/wallpaperPicker.js`; la búsqueda real (y la API key)
  vive en `main/pexelsOps.js`, no acá.
- `core/tooltip.js` — tooltips de toda la app: **un** listener delegado en
  `document` y **un** nodo reutilizado. No se importa desde los componentes:
  se apodera del atributo `title` (lo mueve a `data-tip` en el hover y lo
  saca, así no salen los dos tooltips). Poner `title` sigue siendo la única
  API, y como el robo pasa en el hover funciona igual con DOM creado
  después — tiles, filas del explorador, mensajes del loop. El nativo de
  Chromium se reemplazó porque tarda ~1.5s y usa el estilo del SO: los devs
  de la beta directamente no lo veían. Opt-out con `data-no-tip` para texto
  que ya se ve en pantalla. Sin test: haría falta jsdom (hoy `environment:
  'node'`) y no vale una dependencia nueva — se verifica a mano.
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
- `src/main/loopOps.test.js` — motor del loop sobre disco real. A diferencia del resto del proyecto, acá escriben **varios procesos a la vez**: hay tests con N escritores concurrentes (fue lo que destapó que `EMPTY_STATUS` se compartía entre workspaces por una copia superficial).
- `src/main/loopDispatcher.test.js` — el repartidor con un pty falso: que un mensaje llegue **una sola vez**, a la terminal correcta, y **nunca** a un agente en `working`. Un fallo ahí se manifiesta como texto entrelazado en un TUI o un agente repitiendo la misma tarea — imposible de diagnosticar a mano.
- `src/main/loopShim.test.js` — que el wrapper de `ybento` sea ejecutable de verdad, incluso con espacios y comillas en la ruta (en macOS siempre hay uno: "Application Support"). Si falla, el agente ve `command not found` y el loop se corta sin explicación.
- `src/cli/run.test.js` — el CLI. Se afirma sobre **lo que imprime**, no sólo sobre el código de retorno: lo lee un modelo, y un mensaje de error que no dice qué hacer deja al agente trabado.
- `src/main/explorerFs.test.js` — escrituras del explorador sobre disco real: `createEntry`, `renameEntry`, `duplicateEntry`, `resolveEntryPath`. La regresión clave es que ninguna pise trabajo del usuario en silencio (`fs.rename` sí lo haría). Cubre además que `searchFiles` encuentre dotfiles/dotfolders: **el explorador muestra todos los archivos del proyecto a propósito** (decisión de producto), así que el buscador no debe esconder nada — lo único que no se recorre es `SEARCH_IGNORE`, que filtra por carpeta concreta (`.git`, `node_modules`, …), nunca por "empieza con punto".

## Notas de empaquetado

- `node-pty` (módulo nativo) se excluye del `asar` (`asarUnpack` en
  `electron-builder.yml`) porque sus binarios `.node` y el ejecutable
  `spawn-helper` necesitan existir como archivos reales en disco.
- macOS sin firma (`identity: null`, no hay cuenta Apple Developer) — el
  `.app` funciona pero Gatekeeper pide *click derecho → Abrir* la primera vez.
