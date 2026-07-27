/**
 * src/renderer/components/loopSidebar.js
 * --------------------------------------------------------------
 * Panel lateral del loop multiagente: quiénes están en el loop y qué se
 * están diciendo. Flota del lado derecho, mismo patrón que el panel de
 * snippets (ver snippetsSidebar.js).
 *
 * Es una conversación **grupal**: todos los mensajes del workspace en un
 * solo hilo, con `de -> para` visible en cada uno. No hay hilos separados
 * por par de agentes a propósito — el valor de mirar esto es entender la
 * cadena completa (el usuario pide, claudio hace, opencito revisa, vuelve
 * a claudio), y partirla en conversaciones sueltas la escondería.
 *
 * Los mensajes del usuario van alineados a la derecha y los de los agentes
 * a la izquierda, que es la convención de cualquier chat: se lee de un
 * vistazo quién habló sin tener que leer el encabezado.
 *
 * Ojo con la división de responsabilidades: acá NO se reparte nada. Pegar
 * el mensaje en la terminal destino lo hace el proceso main
 * (main/loopDispatcher.js), porque los mensajes los postean también otros
 * procesos (el CLI de cada agente) y hace falta alguien vigilando el disco.
 * Este panel sólo muestra y postea.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { state } from '../core/state.js';
import { bus } from '../core/eventBus.js';
import { openModal, closeModal, confirmModal } from './modal.js';
import { ProfileManager } from '../core/profileManager.js';
import * as liveTiles from '../core/liveTiles.js';
import { focusTileById } from './bentoGrid.js';
import { labelFor } from './workspaceManager.js';
import { applySavedWidth, makeResizeHandle } from '../utils/resizableSidebar.js';
import { toast } from './toast.js';

const WIDTH_OPTS = {
  storageKey: 'yusepe:loop-width',
  // El panel está pegado al borde derecho, así que su borde "interior" —
  // por donde se agarra para agrandarlo — es el izquierdo.
  edge: 'left',
  min: 300,
  max: 900,
  defaultWidth: 384,
};

/**
 * A partir de acá un mensaje se colapsa. Los reportes de QA entre agentes
 * son largos *y* necesarios, pero tres seguidos tapan la conversación
 * entera: se muestra el principio y se despliega a pedido.
 */
const LONG_MESSAGE_CHARS = 420;

/**
 * Mensajes que el usuario desplegó a mano.
 *
 * Vive fuera del render porque `refresh()` redibuja el hilo completo cada
 * vez que algo cambia en disco — sin esto, un mensaje que acabás de abrir
 * se volvería a cerrar solo apenas otro agente postee.
 */
const expanded = new Set();

let panelEl = null;
let rosterEl = null;
let streamEl = null;
let composerEl = null;
let emptyEl = null;
let isOpen = false;

/** A quién le escribe el usuario. Se recuerda entre mensajes. */
let target = null;

const cwd = () => state.profile?.cwd || null;

export function initLoopSidebar() {
  panelEl = document.getElementById('loop-sidebar');
  if (!panelEl) return;

  applySavedWidth(panelEl, WIDTH_OPTS);
  buildChrome();

  // El repartidor vive en main y vigila el disco: se arranca al entrar a un
  // workspace y se corta al salir, tenga o no el panel abierto — el loop
  // tiene que seguir andando con el panel cerrado.
  bus.on('profile:loaded', () => {
    target = null;
    if (cwd()) window.yusepe.loop.start(cwd());
    if (isOpen) refresh();
  });
  bus.on('workspace:left', () => window.yusepe.loop.stop());
  bus.on('profile:cleared', () => { closeSidebar(); window.yusepe.loop.stop(); });

  // Cambios en disco (los postea el CLI de cada agente, desde otro proceso).
  window.yusepe.loop.onChanged(() => { if (isOpen) refresh(); });
  window.yusepe.loop.onDelivered(() => { if (isOpen) refresh(); });
  // Un agente que se cae no genera ningún cambio en disco, así que sin
  // este aviso el panel lo seguiría mostrando en verde.
  window.yusepe.loop.onPresence(({ agent, present }) => {
    if (isOpen) refresh();
    if (!present) {
      toast.warning(`@${agent} dejó de correr en su terminal — sus mensajes quedan pendientes`);
    }
  });
}

export function isLoopSidebarOpen() {
  return isOpen;
}

export function toggleLoopSidebar() {
  if (!state.profile) return;
  if (isOpen) closeSidebar();
  else openSidebar();
}

function openSidebar() {
  if (!panelEl) return;
  if (!cwd()) {
    toast.error('Este workspace no tiene carpeta asignada — el loop guarda sus mensajes en .ybento/loop/');
    return;
  }
  isOpen = true;
  panelEl.classList.remove('hidden');
  refresh();
}

function closeSidebar() {
  if (!panelEl) return;
  isOpen = false;
  panelEl.classList.add('hidden');
}

/* ---------- Estructura ---------- */

function buildChrome() {
  panelEl.innerHTML = '';

  const title = h('div', { class: 'text-xs text-fg-soft flex-1 flex items-center gap-1.5' }, [
    h('span', { class: 'text-accent-soft flex items-center' }, svgIcon('loop', { size: 14 })),
    h('span', {}, 'Loop'),
  ]);

  const header = h('div', { class: 'flex items-center gap-1.5 px-2 py-1.5 border-b border-line shrink-0' }, [
    title,
    h('button', {
      class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg px-1 shrink-0',
      title: 'Protocolo que leen los agentes (.ybento/loop/skill.md)',
      onClick: openSkillEditor,
    }, svgIcon('file', { size: 14 })),
    h('button', {
      class: 'inline-flex items-center justify-center text-fg-muted hover:text-fg px-1 shrink-0',
      title: 'Cerrar loop',
      onClick: closeSidebar,
    }, svgIcon('close', { size: 15 })),
  ]);

  rosterEl = h('div', { class: 'shrink-0 border-b border-line px-1.5 py-1.5' });
  streamEl = h('div', { class: 'flex-1 overflow-y-auto px-2 py-2 space-y-2' });
  emptyEl = h('div', { class: 'hidden px-3 py-6 text-center text-[11px] text-fg-subtle leading-relaxed' });
  composerEl = h('div', { class: 'shrink-0 border-t border-line p-2' });

  panelEl.append(
    header, rosterEl, streamEl, emptyEl, composerEl,
    makeResizeHandle({ panel: panelEl, ...WIDTH_OPTS }),
  );
  panelEl.classList.add('flex', 'flex-col');
}

async function refresh() {
  if (!cwd()) return;
  try {
    const [agents, messages, presence] = await Promise.all([
      window.yusepe.loop.agents(cwd()),
      window.yusepe.loop.messages(cwd(), { limit: 200 }),
      window.yusepe.loop.presence(),
    ]);
    renderRoster(agents, presence || {});
    renderStream(messages, agents);
    renderComposer(agents);
  } catch (err) {
    streamEl.innerHTML = '';
    streamEl.append(h('p', { class: 'text-xs text-red-400 px-1' }, err?.message || String(err)));
  }
}

/* ---------- Roster de terminales ---------- */

/**
 * Verde = libre, ámbar = ocupado, rojo = su terminal volvió al prompt.
 *
 * El rojo es el caso que más importa: significa que el proceso del agente
 * terminó, así que no se le entrega nada y sus mensajes quedan pendientes.
 * Sin este aviso, el loop se ve normal mientras nadie contesta.
 */
function stateDot(agent, presence) {
  if (presence && presence.present === false) {
    return h('span', {
      class: 'w-1.5 h-1.5 rounded-full shrink-0 bg-red-400',
      title: `Su terminal volvió al prompt (${presence.foreground}): el agente ya no está corriendo. `
        + 'Los mensajes le quedan pendientes hasta que lo vuelvas a levantar.',
    });
  }
  const working = agent.state === 'working';
  return h('span', {
    class: `w-1.5 h-1.5 rounded-full shrink-0 ${working ? 'bg-amber-400' : 'bg-emerald-400'}`,
    title: working
      ? 'Ocupado: los mensajes le quedan en la bandeja hasta que se libere'
      : 'Libre: recibe mensajes en su terminal',
  });
}

/** Hace cuánto que no cambia de estado, en texto corto. */
function sinceLabel(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h`;
}

/**
 * A partir de acá, un agente en `working` probablemente se colgó o murió a
 * mitad de la tarea. No se toca solo — se avisa y se ofrece liberarlo,
 * porque un agente que de verdad está trabajando duro no debería perder su
 * turno por un umbral arbitrario.
 */
const STUCK_WORKING_MS = 15 * 60 * 1000;

function renderRoster(agents, presence = {}) {
  rosterEl.innerHTML = '';

  if (!agents.length) {
    rosterEl.append(h('p', { class: 'text-[10px] text-fg-subtle px-1.5 py-1 leading-relaxed' },
      'Ninguna terminal está en el loop todavía.'));
  }

  for (const agent of agents) rosterEl.append(agentRow(agent, presence[agent.name]));

  rosterEl.append(h('button', {
    class: 'w-full mt-1 text-[11px] px-2 py-1.5 rounded-md border border-line hover:bg-bg-elev transition text-fg-muted',
    onClick: openAddAgent,
  }, '+ Sumar una terminal al loop'));
}

function agentRow(agent, presence) {
  const tile = (state.profile?.tiles || []).find((t) => t.id === agent.tileId);
  const absent = presence?.present === false;
  const stuck = agent.state === 'working'
    && Date.now() - new Date(agent.updatedAt).getTime() > STUCK_WORKING_MS;

  // Segunda línea: normalmente el rol, pero si algo anda mal eso pasa a ser
  // lo importante — un rol prolijo no sirve de nada si el agente está caído.
  let subtitle;
  if (absent) {
    subtitle = h('div', { class: 'text-[10px] text-red-400/90 truncate' },
      `terminal en el prompt (${presence.foreground}) — no recibe`);
  } else if (stuck) {
    subtitle = h('div', { class: 'text-[10px] text-amber-400/90 truncate' },
      `ocupado ${sinceLabel(agent.updatedAt)} — ¿se colgó?`);
  } else if (agent.role) {
    subtitle = h('div', { class: 'text-[10px] text-fg-subtle truncate' }, agent.role);
  } else {
    subtitle = h('div', { class: 'text-[10px] text-fg-subtle/60 italic truncate' }, 'sin rol descrito');
  }

  return h('div', {
    class: 'group flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-bg-elev transition cursor-pointer',
    title: tile ? 'Ir a su terminal' : 'Su terminal ya no está en este workspace',
    onClick: () => { if (tile) focusTileById(tile.id); },
  }, [
    stateDot(agent, presence),
    h('div', { class: 'flex-1 min-w-0' }, [
      h('div', { class: 'text-xs text-fg truncate' }, `@${agent.name}`),
      subtitle,
    ]),
    h('div', { class: 'hidden group-hover:flex gap-0.5 shrink-0' }, [
      // Sólo aparece cuando hace falta: liberar a mano un agente que quedó
      // colgado en `working`, para que su bandeja vuelva a fluir.
      ...(stuck ? [h('button', {
        class: 'inline-flex items-center text-amber-400 hover:text-fg px-1',
        title: `Marcar a @${agent.name} como libre (su bandeja está frenada)`,
        onClick: async (e) => {
          e.stopPropagation();
          await window.yusepe.loop.setState(cwd(), agent.name, 'waiting');
          refresh();
        },
      }, svgIcon('refresh', { size: 12 }))] : []),
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-fg px-1',
        title: 'Editar nombre y rol',
        onClick: (e) => { e.stopPropagation(); openAgentEditor(agent, tile); },
      }, svgIcon('edit', { size: 12 })),
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-red-400 px-1',
        title: 'Sacar del loop',
        onClick: (e) => { e.stopPropagation(); removeAgent(agent, tile); },
      }, svgIcon('close', { size: 12 })),
    ]),
  ]);
}

/* ---------- Hilo de mensajes ---------- */

function renderStream(messages, agents) {
  // Si el usuario está leyendo historial más arriba, no lo arrastramos al
  // fondo porque otro agente acaba de postear. Convención de chat: sólo
  // sigue solo cuando ya estabas mirando lo último.
  const atBottom = streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight < 40;

  streamEl.innerHTML = '';

  if (!messages.length) {
    emptyEl.classList.remove('hidden');
    emptyEl.textContent = agents.length
      ? 'Sin mensajes todavía. Escribile a una terminal desde abajo y arranca el loop.'
      : 'Sumá al menos una terminal para empezar.';
    return;
  }
  emptyEl.classList.add('hidden');

  for (const msg of messages) streamEl.append(messageRow(msg));
  if (atBottom) {
    queueMicrotask(() => { streamEl.scrollTop = streamEl.scrollHeight; });
  }
}

function messageRow(msg) {
  const mine = msg.from === 'usuario';
  const forMe = msg.to === 'usuario';

  const who = mine
    ? `vos → @${msg.to}`
    : (forMe ? `@${msg.from} → vos` : `@${msg.from} → @${msg.to}`);

  const body = h('div', { class: 'text-xs text-fg whitespace-pre-wrap break-words' }, msg.text);

  const parts = [
    h('div', { class: 'text-[10px] text-fg-subtle mb-0.5 flex items-center gap-1' }, [
      h('span', { class: 'truncate' }, who),
      h('span', { class: 'text-fg-subtle/60 shrink-0' }, formatTime(msg.createdAt)),
    ]),
    body,
  ];

  if (msg.text.length > LONG_MESSAGE_CHARS) parts.push(collapseToggle(msg, body));

  const bubble = h('div', {
    class: [
      'max-w-[85%] rounded-lg px-2.5 py-1.5 border',
      mine
        ? 'bg-accent/15 border-accent/30'
        : (forMe ? 'bg-bg-elev border-accent/20' : 'bg-bg-elev border-line'),
    ].join(' '),
  }, parts);

  return h('div', { class: `flex ${mine ? 'justify-end' : 'justify-start'}` }, [bubble]);
}

/**
 * Botón "Ver más / Ver menos" de un mensaje largo.
 *
 * Alterna en el lugar en vez de redibujar el hilo: desplegar un reporte de
 * QA no debería hacerte perder la posición del scroll en la conversación.
 */
function collapseToggle(msg, body) {
  const lines = msg.text.split('\n').length;
  const hint = lines > 3 ? `${lines} líneas` : `${Math.round(msg.text.length / 100) / 10}k caracteres`;

  const button = h('button', {
    class: 'mt-1 text-[10px] text-accent-soft hover:text-fg transition',
  });

  const paint = () => {
    const isOpen = expanded.has(msg.id);
    body.classList.toggle('loop-msg-clamp', !isOpen);
    button.textContent = isOpen ? 'Ver menos' : `Ver más (${hint})`;
  };

  button.addEventListener('click', () => {
    if (expanded.has(msg.id)) expanded.delete(msg.id);
    else expanded.add(msg.id);
    paint();
  });

  paint();
  return button;
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ---------- Composer ---------- */

/**
 * Redibuja el composer conservando el foco y lo escrito.
 *
 * `refresh()` corre sola cada vez que cambia algo en disco (otro agente
 * posteó), y sin esto el usuario perdería el cursor y el texto a medio
 * escribir en mitad de una frase.
 */
function renderComposer(agents) {
  const previous = composerEl.querySelector('textarea');
  const draft = previous?.value || '';
  const hadFocus = previous && document.activeElement === previous;

  composerEl.innerHTML = '';

  if (!agents.length) {
    composerEl.append(h('p', { class: 'text-[10px] text-fg-subtle px-1' },
      'Sumá una terminal al loop para poder escribirle.'));
    return;
  }

  // El destino sigue siendo válido sólo si ese agente sigue en el loop.
  if (!agents.some((a) => a.name === target)) target = agents[0].name;

  const pills = h('div', { class: 'flex flex-wrap gap-1 mb-1.5' },
    agents.map((agent) => h('button', {
      class: [
        'text-[10px] px-1.5 py-0.5 rounded-full border transition',
        agent.name === target
          ? 'bg-accent/20 border-accent/40 text-fg'
          : 'border-line text-fg-muted hover:bg-bg-elev',
      ].join(' '),
      title: agent.role || `Escribirle a @${agent.name}`,
      onClick: () => {
        target = agent.name;
        renderComposer(agents);
        composerEl.querySelector('textarea')?.focus();
      },
    }, `@${agent.name}`)));

  const input = h('textarea', {
    rows: '2',
    placeholder: `Mensaje para @${target}…  (Enter envía)`,
    class: 'w-full bg-bg-elev border border-line rounded-md px-2 py-1.5 text-xs resize-none '
      + 'focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-fg-subtle/70',
    spellcheck: 'false',
  });

  const send = async () => {
    const raw = input.value.trim();
    if (!raw) return;

    // Un `@nombre` al principio manda sobre la pill elegida: escribir
    // "@opencito revisá esto" es más rápido que cambiar de destino.
    const match = raw.match(/^@([a-z0-9][a-z0-9_-]*)\s+([\s\S]+)$/i);
    const to = match && agents.some((a) => a.name === match[1].toLowerCase())
      ? match[1].toLowerCase()
      : target;
    const text = match && to === match[1].toLowerCase() ? match[2] : raw;

    input.value = '';
    try {
      await window.yusepe.loop.post(cwd(), { from: 'usuario', to, text });
      target = to;
      await refresh();
    } catch (err) {
      input.value = raw; // no le comemos lo que escribió
      toast.error(err?.message || String(err));
    }
  };

  input.addEventListener('keydown', (e) => {
    // Enter envía; Shift+Enter hace salto de línea (convención de chat).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  const sendBtn = h('button', {
    class: 'mt-1.5 w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-md '
      + 'bg-accent hover:bg-accent-soft text-white transition',
    onClick: send,
  }, [svgIcon('send', { size: 12 }), h('span', {}, `Enviar a @${target}`)]);

  input.value = draft;
  composerEl.append(pills, input, sendBtn);
  if (hadFocus) {
    input.focus();
    input.setSelectionRange(draft.length, draft.length);
  }
}

/* ---------- Alta y edición de agentes ---------- */

/* ---------- Cómo distinguir una terminal de otra ---------- */

/**
 * Mini-mapa del mosaico con este tile marcado.
 *
 * Varias terminales en la misma carpeta y sin comando precargado se ven
 * idénticas en una lista ("Terminal 1", "Terminal 2"…). Lo único que el
 * usuario tiene en la cabeza es *dónde* está cada una en pantalla, así que
 * eso es lo que hay que mostrar.
 */
function miniMap(tile) {
  const tiles = state.profile?.tiles || [];
  const rows = Math.max(4, ...tiles.map((t) => (t.row || 0) + (t.rowSpan || 1)));

  const cells = tiles.map((other) => {
    const isThis = other.id === tile.id;
    return h('div', {
      class: isThis ? 'rounded-[1px] bg-accent' : 'rounded-[1px] bg-fg-subtle/25',
      style: `grid-column: ${(other.col || 0) + 1} / span ${other.colSpan || 1};`
        + `grid-row: ${(other.row || 0) + 1} / span ${other.rowSpan || 1};`,
    });
  });

  return h('div', {
    class: 'shrink-0 grid gap-[1px] w-12 h-9 p-[2px] rounded border border-line bg-bg-elev',
    style: `grid-template-columns: repeat(12, 1fr); grid-template-rows: repeat(${rows}, 1fr);`,
  }, cells);
}

/**
 * Última línea con contenido de la terminal.
 *
 * Es lo más identificatorio que hay: el prompt, el comando que corrió, o el
 * banner del agente que tiene adentro. Se lee del buffer de xterm (ver el
 * `meta.term` que registra terminal.js).
 */
function lastOutputLine(tile) {
  const entry = liveTiles.get(tile.id);
  const term = entry?.meta?.term;

  let text = '';
  try {
    const buf = term?.buffer?.active;
    if (buf) {
      const from = buf.baseY + buf.cursorY;
      for (let i = from; i >= 0 && i > from - 60; i--) {
        const line = buf.getLine(i)?.translateToString(true).trim();
        if (line) { text = line; break; }
      }
    }
  } catch { /* si xterm cambia de API, no vale romper el picker por esto */ }

  return h('div', {
    class: `text-[10px] truncate mt-0.5 font-mono ${text ? 'text-fg-subtle' : 'text-fg-subtle/50 italic'}`,
  }, text || 'sin salida todavía');
}

/** Terminales del workspace que todavía no están en el loop. */
function freeTerminals(agents) {
  const taken = new Set(agents.map((a) => a.tileId).filter(Boolean));
  return (state.profile?.tiles || []).filter((t) => t.kind === 'terminal' && !taken.has(t.id));
}

async function openAddAgent() {
  const agents = await window.yusepe.loop.agents(cwd());
  const candidates = freeTerminals(agents);

  if (!candidates.length) {
    toast.error('No hay terminales libres en este workspace. Abrí una terminal primero.');
    return;
  }

  // Con una sola candidata no tiene sentido hacer elegir: se va derecho al
  // formulario que importa (nombre y rol).
  if (candidates.length === 1) {
    openAgentEditor(null, candidates[0]);
    return;
  }

  const list = h('div', { class: 'space-y-1' }, candidates.map((tile) => h('button', {
    class: 'w-full text-left px-3 py-2 rounded-md border border-line hover:bg-bg-elev transition flex items-center gap-3',
    onClick: () => { closeModal(); openAgentEditor(null, tile); },
  }, [
    miniMap(tile),
    h('div', { class: 'flex-1 min-w-0' }, [
      h('div', { class: 'text-sm text-fg flex items-center gap-1.5' }, [
        h('span', { class: 'text-accent-soft flex items-center shrink-0' }, svgIcon('terminal', { size: 13 })),
        h('span', { class: 'truncate' }, labelFor(tile)),
        h('span', { class: 'text-[10px] text-fg-subtle shrink-0' }, `${tile.colSpan}x${tile.rowSpan}`),
      ]),
      lastOutputLine(tile),
    ]),
  ])));

  openModal({
    title: 'Elegí la terminal que entra al loop',
    body: h('div', {}, [
      h('p', { class: 'text-xs text-fg-subtle mb-3' },
        'El recuadro marca dónde está cada una en el mosaico, y abajo se ve su última línea.'),
      list,
    ]),
  });
}

/**
 * Alta/edición de un agente. El rol no es decorativo: los otros agentes lo
 * leen para saber a quién dirigirse, así que el formulario lo pide con un
 * ejemplo en vez de dejarlo como un campo opcional cualquiera.
 */
function openAgentEditor(existing, tile) {
  const nameInput = h('input', {
    type: 'text',
    value: existing?.name || '',
    placeholder: 'claudio',
    class: 'w-full bg-bg-elev border border-line rounded-md px-3 py-2 text-sm mb-1 focus:outline-none focus:ring-1 focus:ring-accent',
  });
  const roleInput = h('input', {
    type: 'text',
    value: existing?.role || '',
    placeholder: 'codifica y gestiona archivos',
    class: 'w-full bg-bg-elev border border-line rounded-md px-3 py-2 text-sm mb-1 focus:outline-none focus:ring-1 focus:ring-accent',
  });
  const error = h('div', { class: 'text-xs text-red-400 mt-2 hidden' });

  const save = async () => {
    const name = nameInput.value.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) {
      error.textContent = 'El nombre va sin espacios ni acentos: letras, números, guiones. Ej: claudio';
      error.classList.remove('hidden');
      return;
    }

    try {
      // Renombrar es dar de baja y de alta: el nombre ES la identidad en el
      // mailbox, así que el viejo no puede quedar colgado recibiendo.
      if (existing && existing.name !== name) {
        await window.yusepe.loop.unregister(cwd(), existing.name);
      }

      await window.yusepe.loop.register(cwd(), {
        name, role: roleInput.value.trim(), tileId: tile?.id || existing?.tileId || null,
      });
      // El protocolo tiene que existir antes del primer mensaje: es la ruta
      // que el repartidor le pasa al agente al pegarle en la terminal.
      await window.yusepe.loop.ensureSkill(cwd());

      if (tile) await bindTerminal(tile, name);

      closeModal();
      if (isOpen) refresh();
      else toggleLoopSidebar();
      toast.success(`@${name} está en el loop`);
    } catch (err) {
      error.textContent = err?.message || String(err);
      error.classList.remove('hidden');
    }
  };

  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') roleInput.focus(); });
  roleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

  openModal({
    title: existing ? `Editar @${existing.name}` : 'Sumar terminal al loop',
    body: h('div', {}, [
      h('label', { class: 'text-xs text-fg-subtle block mb-1' }, 'Nombre'),
      nameInput,
      h('p', { class: 'text-[10px] text-fg-subtle/70 mb-3' },
        'Así la llaman las otras terminales: "@claudio revisá esto".'),

      h('label', { class: 'text-xs text-fg-subtle block mb-1' }, 'Rol'),
      roleInput,
      h('p', { class: 'text-[10px] text-fg-subtle/70 mb-3' },
        'Qué se encarga de hacer. Lo leen los otros agentes para saber a quién dirigirse, '
        + 'así que conviene ser concreto: "valida código fuente" dice más que "ayudante".'),

      error,
      h('button', {
        class: 'mt-3 w-full bg-accent hover:bg-accent-soft text-white text-sm py-2 rounded-md transition',
        onClick: save,
      }, existing ? 'Guardar cambios' : 'Sumar al loop'),
    ]),
  });
  setTimeout(() => nameInput.focus(), 0);
}

/**
 * Deja la terminal lista para actuar como agente.
 *
 * La asociación nombre->pty se le avisa a main (que es quien reparte), y
 * además se exporta la identidad dentro del shell que ya está corriendo:
 * las variables de entorno se fijan al crear el pty, así que una terminal
 * que ya estaba abierta cuando la sumaste no las tendría y el CLI le diría
 * "no sé quién sos".
 */
async function bindTerminal(tile, name) {
  await ProfileManager.updateTile(tile.id, { loopAgent: name });
  bus.emit('loop:binding-changed', { tileId: tile.id, name });

  const entry = liveTiles.get(tile.id);
  const ptyId = entry?.kind === 'terminal' ? entry.meta?.ptyId : null;
  if (!ptyId) return;

  await window.yusepe.loop.bind(name, ptyId);

  // El `export` sólo si la terminal está en el prompt del shell. Si adentro
  // ya hay un agente corriendo, ese texto le entra como si fuera un mensaje
  // del usuario — y encima no queda seteado, porque las herramientas del
  // agente lanzan sus propios procesos hijos del suyo, no del shell.
  // Pasó en campo: un agente terminó prefijando YBENTO_AGENT a mano en cada
  // comando sin entender por qué no persistía.
  const atPrompt = await window.yusepe.loop.atPrompt(ptyId);
  if (atPrompt) {
    window.yusepe.pty.input(ptyId,
      `export YBENTO_AGENT=${name} YBENTO_ROOT=${JSON.stringify(cwd())}\r`);
    return;
  }

  toast.warning(
    `@${name} quedó en el loop, pero su terminal ya tiene un agente corriendo: `
    + 'no va a heredar su identidad. Reinicialo para que la tome.',
    { duration: 9000 },
  );
}

async function removeAgent(agent, tile) {
  const confirmed = await confirmModal({
    title: 'Sacar del loop',
    body: `¿Sacar a @${agent.name} del loop? Su terminal sigue abierta, pero deja de recibir mensajes.`,
    confirmLabel: 'Sacar',
    danger: true,
  });
  if (!confirmed) return;

  await window.yusepe.loop.unregister(cwd(), agent.name);
  if (tile) {
    await ProfileManager.updateTile(tile.id, { loopAgent: null });
    bus.emit('loop:binding-changed', { tileId: tile.id, name: null });
  }
  refresh();
}

/* ---------- skill.md ---------- */

async function openSkillEditor() {
  const content = await window.yusepe.loop.skill(cwd());

  const area = h('textarea', {
    class: 'w-full h-80 bg-bg-elev border border-line rounded-md p-3 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent',
    spellcheck: 'false',
  });
  area.value = content;

  openModal({
    title: 'Protocolo del loop (.ybento/loop/skill.md)',
    size: 'lg',
    body: h('div', {}, [
      h('p', { class: 'text-xs text-fg-subtle mb-3' },
        'Lo leen los agentes para saber cómo mandarse mensajes. Al pegarles un mensaje en '
        + 'la terminal se les pasa la ruta de este archivo, no su contenido.'),
      area,
      h('button', {
        class: 'mt-3 w-full bg-accent hover:bg-accent-soft text-white text-sm py-2 rounded-md transition',
        onClick: async () => {
          await window.yusepe.loop.setSkill(cwd(), area.value);
          closeModal();
          toast.success('Protocolo guardado');
        },
      }, 'Guardar'),
    ]),
  });
}
