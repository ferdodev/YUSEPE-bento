/**
 * Demo del loop multiagente: el roster con sus estados y el hilo grupal.
 *
 * Es una reproducción guionada de una iteración real (uno implementa, el
 * otro prueba, vuelve el reporte). Lo que se muestra son las tres cosas
 * que hacen que el loop funcione y que no se ven en una captura: el color
 * de identidad por agente, el estado waiting/working —al que está working
 * no se le entrega nada— y el sello de commit de cada mensaje.
 */
const AGENTS = [
  { name: 'usuario', role: 'vos, dando el norte', color: '#94a3b8' },
  { name: 'claudio', role: 'implementa', color: '#4aa3f0' },
  { name: 'opencito', role: 'revisa y prueba', color: '#a78bfa' },
];

const SCRIPT = [
  {
    from: 'usuario', to: 'claudio', head: 'a1b2c3d',
    text: 'Agregá fetch y pull al panel de git. Cuando esté, pasáselo a @opencito.',
    working: ['claudio'],
  },
  {
    from: 'claudio', to: 'opencito', head: 'a1b2c3d',
    text: 'Listo: gitOps.fetch() y gitOps.pull(), con toast de error.\nProbá también el repo sin remoto.',
    working: ['opencito'],
  },
  {
    from: 'opencito', to: 'claudio', head: 'e4f5a6b',
    text: 'Sin remoto configurado el pull tira "fatal: no upstream" y el toast sale vacío.\nFalta pasar stderr al mensaje.',
    warn: '⚠ el árbol avanzó desde que se escribió este mensaje (a1b2c3d → e4f5a6b)',
    working: ['claudio'],
  },
  {
    from: 'claudio', to: 'opencito', head: 'e4f5a6b',
    text: 'Arreglado: el toast ahora muestra stderr tal cual. Volvé a probar los tres casos.',
    working: ['opencito'],
  },
  {
    from: 'opencito', to: 'usuario', head: '9c8d7e6',
    text: '✓ probado con remoto, sin remoto y sin upstream. Los tres avisan bien.\nListo para commitear.',
    working: [],
  },
];

const rosterEl = document.querySelector('[data-roster]');
const threadEl = document.querySelector('[data-thread]');
const playBtn = document.querySelector('[data-loop-play]');
const statusEl = document.querySelector('[data-loop-status]');

const colorOf = (name) => AGENTS.find((a) => a.name === name)?.color || 'var(--line-2)';

let working = new Set();
let timer = null;

function renderRoster() {
  rosterEl.innerHTML = AGENTS.map((a) => `
    <div class="rw${working.has(a.name) ? ' working' : ''}" style="border-left-color:${a.color}">
      <div style="min-width:0">
        <div class="nm" style="color:color-mix(in srgb, ${a.color} 75%, var(--fg))">@${a.name}</div>
        <div class="role">${a.role}</div>
      </div>
      <div class="st"><i></i>${working.has(a.name) ? 'working' : 'waiting'}</div>
    </div>`).join('');
}

function appendMessage(m) {
  const color = colorOf(m.from);
  const msg = document.createElement('div');
  msg.className = 'msg';
  msg.style.borderLeftColor = color;
  msg.style.background = `color-mix(in srgb, ${color} 9%, transparent)`;
  msg.innerHTML = `
    <div class="hd">
      <span class="who" style="color:color-mix(in srgb, ${color} 75%, var(--fg))">@${m.from}</span>
      → @${m.to}
      <span class="stamp">[sobre ${m.head}]</span>
    </div>
    <div class="tx">${m.text}</div>
    ${m.warn ? `<div class="warn">${m.warn}</div>` : ''}`;
  threadEl.append(msg);
  threadEl.scrollTop = threadEl.scrollHeight;
}

function reset() {
  clearTimeout(timer);
  working = new Set();
  threadEl.innerHTML = '<div class="hint">el hilo es grupal: todo el workspace en una sola conversación</div>';
  statusEl.textContent = '';
  renderRoster();
}

export function playLoop() {
  clearTimeout(timer);
  threadEl.innerHTML = '';
  working = new Set();
  renderRoster();

  const step = (i) => {
    if (i >= SCRIPT.length) {
      statusEl.textContent = '— iteración cerrada, todos libres';
      return;
    }
    const m = SCRIPT[i];
    appendMessage(m);
    working = new Set(m.working);
    renderRoster();
    statusEl.textContent = m.working.length
      ? `repartiendo a @${m.to}…`
      : '';
    timer = setTimeout(() => step(i + 1), 2100);
  };
  step(0);
}

playBtn.addEventListener('click', playLoop);
reset();
