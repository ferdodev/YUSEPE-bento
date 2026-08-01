/**
 * Command palette de la web (⌘K / ⌘⇧P), estilo fzf.
 *
 * Ninguna entrada es decorativa: o navega a la sección que la explica
 * (`href`), o ejecuta algo de verdad en esta página (`run`). Si fuera un
 * menú falso sería el peor lugar para mentir, porque es justo la feature
 * que se está mostrando.
 */
import { toggleTheme } from './theme.js';
import { shuffleBento } from './bento.js';
import { playLoop } from './loop.js';

const ACTIONS = [
  { ic: '→', t: 'workspace: frontend-app', k: '⌘1', href: '#persist',
    d: 'Cambia de workspace desde la tira de tabs o con ⌘1…9. Las terminales y webviews del workspace que dejas no se destruyen: siguen vivos en segundo plano y vuelven tal cual.' },
  { ic: '▤', t: 'nueva terminal', k: '⌘T', href: '#features',
    d: 'Abre una terminal real vía node-pty — un shell de verdad, no un emulador — en el cwd del workspace, con xterm.js y scrollback completo.' },
  { ic: '⇄', t: 'loop: poner dos agentes a hablar', k: '', run: playLoop, to: '#loop', act: 'reproducir el loop acá abajo',
    d: 'Cada terminal aloja un agente con nombre y rol. Bento reparte los mensajes escribiéndolos en el pty del destinatario, uno por vuelta y sólo cuando está libre.' },
  { ic: '☑', t: 'tareas del workspace', k: '', href: '#tasks',
    d: 'La lista de pendientes del workspace, respaldada en archivos .md reales en .ybento/tasks/. Sin índice ni base de datos: el estado es el directorio, y las tareas viajan con el repo.' },
  { ic: '▸', t: 'copiar launchText de una tarea', k: '', href: '#tasks',
    d: 'Arma el prompt listo para pegarle a tu agente de código desde .ybento/launch-template.md. Al terminar, el agente pone done: true y la lista se mantiene sola.' },
  { ic: '◇', t: 'ir a archivo (quick open)', k: '⌘P', href: '#shortcuts',
    d: 'Fuzzy-find de archivos del workspace, estilo VSCode. Ojo: en la app ⌘P es esto, y el Command Palette vive en ⌘⇧P.' },
  { ic: '◈', t: 'fijar archivo como tile', k: '', href: '#features',
    d: 'Deja cualquier archivo como un tile del mosaico: código con resaltado, Markdown renderizado, CSV como tabla, SVG, imágenes y PDF.' },
  { ic: '◱', t: 'agregar webapp por URL', k: '⌘K', href: '#features',
    d: 'Cualquier URL vive como un tile aislado, con su propia partición de sesión y zoom a nivel Chromium — incluso donde el sitio bloquea el zoom.' },
  { ic: '⑂', t: 'git: fetch · pull · push', k: '', href: '#features',
    d: 'Status, diff, stage/unstage, descartar, commit, ramas y el ciclo de sync completo — sin salir a lazygit ni a la terminal.' },
  { ic: '✦', t: 'panel de agentes', k: '', href: '#features',
    d: 'Detecta y edita los archivos de instrucciones que leen los asistentes de IA (CLAUDE.md, AGENTS.md, .cursorrules…) y lista tus subagentes de .claude/agents/.' },
  { ic: '{}', t: 'ejecutar snippet: deploy', k: '', href: '#features',
    d: 'Librería de comandos y rutinas multi-línea, global a la app. Un click lo tipea y ejecuta línea por línea en la terminal enfocada, como si lo escribieras a mano.' },
  { ic: '◐', t: 'cambiar tema claro/oscuro', k: '⌘,', run: toggleTheme, act: 'cambiar el tema de esta web',
    d: 'En la app, el toggle repinta la UI, la paleta de xterm.js y — vía nativeTheme — el prefers-color-scheme de todos los webviews embebidos. Acá podés probarlo en vivo.' },
  { ic: '⟳', t: 'reorganizar el grid', k: '', run: shuffleBento, to: '#bento', act: 'barajar el bento del inicio',
    d: 'En el mosaico, al mover o cerrar un tile los demás se reacomodan solos y compactan sin dejar huecos. Acá baraja el bento del inicio para que lo veas.' },
  { ic: '?', t: 'cheatsheet de atajos', k: '⌘/', href: '#shortcuts',
    d: 'Todos los atajos en un modal. La cheatsheet es la fuente de verdad de cara al usuario; los accelerators reales viven en el menú de Electron.' },
];

const overlay = document.querySelector('[data-overlay]');
const input = document.querySelector('[data-cmdk-input]');
const listEl = document.querySelector('[data-cmdk-list]');
const previewEl = document.querySelector('[data-cmdk-preview]');
const countEl = document.querySelector('[data-cmdk-count]');

let shown = ACTIONS;
let sel = 0;

function render() {
  const q = input.value.toLowerCase();
  shown = ACTIONS.filter((a) => a.t.toLowerCase().includes(q));
  if (sel >= shown.length) sel = 0;

  listEl.innerHTML = shown.length
    ? shown.map((a, i) => `
        <div class="item${i === sel ? ' sel' : ''}" data-i="${i}">
          <span class="marker">❯</span>
          <span class="ic">${a.ic}</span>
          <span>${a.t}</span>
          ${a.k ? `<span class="k">${a.k}</span>` : ''}
        </div>`).join('')
    : '<div class="empty">sin resultados</div>';

  const active = shown[sel];
  previewEl.innerHTML = active ? `
    <div class="d">${active.d}</div>
    <div class="act"><span class="key">↵</span> ${active.act || 'ir a la sección que lo explica'}</div>` : '';

  countEl.textContent = `${shown.length}/${ACTIONS.length}`;
  listEl.querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' });
}

function open() {
  overlay.classList.add('open');
  input.value = '';
  sel = 0;
  render();
  setTimeout(() => input.focus(), 20);
}

function close() { overlay.classList.remove('open'); }

function exec(a) {
  if (!a) return;
  close();
  // Primero se navega y después se ejecuta: si la acción anima algo, hay
  // que estar mirándolo. El scroll es suave, así que la espera es real.
  const target = a.href || a.to;
  if (target) document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: a.to ? 'center' : 'start' });
  if (a.run) setTimeout(a.run, target ? 450 : 0);
}

input.addEventListener('input', () => { sel = 0; render(); });

input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(shown.length, 1); render(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + shown.length) % Math.max(shown.length, 1); render(); }
  else if (e.key === 'Enter') { e.preventDefault(); exec(shown[sel]); }
});

listEl.addEventListener('mousemove', (e) => {
  const item = e.target.closest('.item');
  if (!item || Number(item.dataset.i) === sel) return;
  sel = Number(item.dataset.i);
  render();
});
listEl.addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (item) exec(shown[Number(item.dataset.i)]);
});

overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

// ⌘K y ⌘⇧P, igual que en la app (⌘P allá es Quick Open de archivos).
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && (k === 'k' || (e.shiftKey && k === 'p'))) {
    e.preventDefault();
    overlay.classList.contains('open') ? close() : open();
  } else if (e.key === 'Escape') {
    close();
  }
});

document.querySelectorAll('[data-open-cmdk]').forEach((b) => b.addEventListener('click', open));
