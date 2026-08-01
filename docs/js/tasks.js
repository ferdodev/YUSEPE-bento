/**
 * Demo de tareas → launchText.
 *
 * Simula el loop real: copiás el launchText, se lo pegás a tu agente, y
 * el agente marca `done: true` en el frontmatter al terminar. Acá el
 * "agente trabaja" es un timer, pero el texto que se copia al portapapeles
 * es el de verdad, resuelto con la tarea elegida.
 */
const TASKS = [
  { id: 'panel-git-pull.md', title: 'Panel de git: fetch + pull', done: true },
  { id: 'fijar-pdf-como-tile.md', title: 'Fijar PDF como tile', done: false },
  { id: 'dotfiles-en-buscador.md', title: 'El buscador encuentra dotfiles', done: false },
];

const listEl = document.querySelector('[data-tasklist]');
const textEl = document.querySelector('[data-launch-text]');
const barEl = document.querySelector('[data-launch-bar]');

let sel = 1;
let done = new Set(TASKS.filter((t) => t.done).map((t) => t.id));
let phase = 'idle'; // idle | copied | done
let timer = null;

const routeOf = (t) => `.ybento/tasks/${t.id}`;

const launchText = (t) =>
  `Ejecuta la siguiente tarea: ${t.title}\n\n` +
  `La descripción completa está en ${routeOf(t)} — leela antes de empezar.\n\n` +
  `Al finalizar la tarea, marcala como completada: poné done: true en el frontmatter de ${routeOf(t)}.`;

function render() {
  const t = TASKS[sel];
  const route = routeOf(t);

  listEl.innerHTML = TASKS.map((task, i) => `
    <button class="trow${i === sel ? ' on' : ''}${done.has(task.id) ? ' done' : ''}" data-i="${i}">
      <span class="box">${done.has(task.id) ? '[x]' : '[ ]'}</span>
      <span class="txt">${task.title}</span>
      <span class="route">${task.id}</span>
    </button>`).join('');

  textEl.innerHTML =
    `Ejecuta la siguiente tarea: <span class="v">${t.title}</span>\n\n` +
    `La descripción completa está en <span class="v">${route}</span> — leela antes de empezar.\n\n` +
    `Al finalizar la tarea, marcala como completada: poné <span class="code">done: true</span> ` +
    `en el frontmatter de <span class="v">${route}</span>.`;

  barEl.innerHTML = `
    <button class="tbtn" data-copy ${phase === 'copied' ? 'disabled' : ''}>
      ${phase === 'copied' ? 'copiado ✓ — el agente trabaja…' : 'copiar launchText'}
    </button>
    ${phase === 'done' ? '<button class="winbtn" data-reset>reiniciar demo</button>' : ''}
    ${phase === 'done' ? `
      <div class="agentmsg">
        <b>✓ el agente marcó la tarea como completada</b> — escribió
        <span class="grn">done: true</span> en el frontmatter de ${route}. La lista se mantiene sola.
      </div>` : ''}`;
}

listEl.addEventListener('click', (e) => {
  const row = e.target.closest('.trow');
  if (!row) return;
  clearTimeout(timer);
  phase = 'idle';
  sel = Number(row.dataset.i);
  render();
});

barEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-reset]')) {
    clearTimeout(timer);
    done = new Set(TASKS.filter((t) => t.done).map((t) => t.id));
    phase = 'idle';
    return render();
  }
  if (!e.target.closest('[data-copy]')) return;

  navigator.clipboard?.writeText(launchText(TASKS[sel])).catch(() => { /* sin permiso: la demo igual sigue */ });
  clearTimeout(timer);
  phase = 'copied';
  render();
  timer = setTimeout(() => {
    done.add(TASKS[sel].id);
    phase = 'done';
    render();
  }, 1700);
});

render();
