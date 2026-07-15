/**
 * src/renderer/components/tasksTile.js
 * --------------------------------------------------------------
 * Tile de Tareas: la lista de pendientes del workspace, viviendo en el
 * mosaico junto a las terminales.
 *
 * Las tareas NO se guardan en el perfil: son archivos `.md` reales en
 * `.ybento/tasks/` dentro del proyecto (ver src/main/tasksOps.js). O sea
 * que el disco es la fuente de verdad — se pueden editar a mano, se
 * versionan con git, y dos tiles de tareas del mismo workspace muestran
 * lo mismo.
 *
 * Por eso el tile relee después de cada operación en vez de mantener su
 * propio estado en memoria: es una lista corta, la lectura es barata, y
 * así nunca miente respecto del disco.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { state } from '../core/state.js';
import { bus } from '../core/eventBus.js';
import { toast } from './toast.js';
import { openTaskDetail } from './taskDetailModal.js';
import { openLaunchTemplate } from './launchTemplateModal.js';

export function createTasksTile(tile) {
  const listEl = h('div', { class: 'flex-1 min-h-0 overflow-y-auto px-1.5 pb-2' });
  const countEl = h('span', { class: 'text-[10px] text-fg-subtle shrink-0' }, '');

  const input = h('input', {
    type: 'text',
    placeholder: 'Nueva tarea…  (Enter)',
    class: 'w-full bg-bg-elev border border-line rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent',
  });

  const header = h('div', {
    class: 'flex items-center gap-1.5 pl-7 pr-1 py-1 border-b border-line shrink-0 text-xs',
  }, [
    svgIcon('tasks', { size: 13 }),
    h('span', { class: 'flex-1 min-w-0 truncate text-fg-muted' }, 'Tareas'),
    countEl,
    h('button', {
      class: 'inline-flex items-center justify-center rounded p-1 shrink-0 text-fg-muted hover:text-fg hover:bg-bg-elev transition',
      title: 'Editar la plantilla del launchText',
      onClick: () => openLaunchTemplate(cwd(), () => {}),
    }, svgIcon('settings', { size: 13 })),
    h('button', {
      class: 'inline-flex items-center justify-center rounded p-1 shrink-0 text-fg-muted hover:text-fg hover:bg-bg-elev transition',
      title: 'Recargar desde disco',
      onClick: () => load(),
    }, svgIcon('refresh', { size: 13 })),
  ]);

  // La raíz lleva class 'tile' + dataset.tileId como toda factoría de tiles
  // (ver el contrato en tile.js): sin eso no hay fondo ni handles de mover.
  const el = h('div', {
    class: 'tile',
    dataset: { tileId: tile.id, kind: 'tasks' },
  }, [
    h('div', { class: 'flex flex-col h-full' }, [
      header,
      h('div', { class: 'px-1.5 py-1.5 shrink-0' }, [input]),
      listEl,
    ]),
  ]);

  const cwd = () => state.profile?.cwd || null;

  function renderEmpty(msg) {
    listEl.innerHTML = '';
    listEl.append(h('p', { class: 'text-fg-subtle text-xs px-1.5 py-3 text-center' }, msg));
  }

  function renderTask(task) {
    // Caja de check dibujada a mano (no <input type=checkbox>) para que
    // siga el tema de la app en vez del control nativo del SO.
    const box = h('span', {
      class: 'w-3.5 h-3.5 rounded-[4px] border shrink-0 grid place-items-center transition ' +
        (task.done ? 'bg-accent border-accent text-white' : 'border-line text-transparent'),
    }, svgIcon('check', { size: 9 }));

    // Dos acciones distintas en la misma fila: el check completa, el título
    // abre el detalle. Van en elementos separados (y no en la fila entera)
    // para que no se pisen — el área de click de cada uno es su propio botón.
    const checkBtn = h('button', {
      class: 'shrink-0 pt-0.5 rounded',
      title: task.done ? 'Marcar como pendiente' : 'Marcar como hecha',
      onClick: () => toggle(task),
    }, [box]);

    const titleBtn = h('button', {
      class: 'flex-1 min-w-0 text-left text-xs leading-snug break-words ' +
        (task.done ? 'line-through text-fg-subtle' : 'text-fg'),
      title: 'Abrir detalle',
      onClick: () => openTaskDetail(task, cwd(), refreshAndNotify),
    }, [
      h('span', {}, task.title),
      // Señal de que la tarea tiene descripción: si no, no hay forma de
      // saber cuáles tienen contenido sin abrirlas una por una.
      task.notes
        ? h('span', { class: 'ml-1.5 align-middle inline-flex text-fg-subtle', title: 'Tiene descripción' },
          svgIcon('file', { size: 10 }))
        : null,
    ]);

    return h('div', {
      class: 'group flex items-start gap-2 rounded px-1.5 py-1 hover:bg-bg-elev',
      title: task.relPath,
    }, [
      checkBtn,
      titleBtn,
      h('button', {
        class: 'shrink-0 rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-accent/10 transition',
        title: 'Copiar launchText para el agente',
        onClick: () => copyLaunchText(task),
      }, svgIcon('copy', { size: 12 })),
      h('button', {
        class: 'shrink-0 rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition',
        title: 'Eliminar tarea',
        onClick: () => remove(task),
      }, svgIcon('trash', { size: 12 })),
    ]);
  }

  // La vigilancia sólo se puede armar si `.ybento/tasks` ya existe, y no la
  // creamos sólo por mirar. Así que se reintenta después de cada load: en
  // cuanto haya una primera tarea, queda armada.
  let watching = false;
  let watchPending = false;
  async function ensureWatching() {
    const root = cwd();
    // `watchPending` evita que dos load() seguidos pidan la vigilancia dos
    // veces: en el main se cuentan referencias, y un alta de más quedaría
    // sin su baja.
    if (watching || watchPending || !root) return;
    watchPending = true;
    try {
      watching = await window.yusepe.tasks.watch(root);
    } catch {
      /* si no se puede vigilar, queda el botón de recargar a mano */
    } finally {
      watchPending = false;
    }
  }

  async function load() {
    const root = cwd();
    input.disabled = !root;
    if (!root) {
      countEl.textContent = '';
      return renderEmpty('Este workspace no tiene carpeta asociada, así que no hay dónde guardar tareas.');
    }

    let tasks;
    try {
      tasks = await window.yusepe.tasks.list(root);
    } catch (err) {
      countEl.textContent = '';
      return renderEmpty(err?.message || String(err));
    }

    ensureWatching();

    const pending = tasks.filter((t) => !t.done).length;
    countEl.textContent = tasks.length ? `${pending}/${tasks.length}` : '';

    if (!tasks.length) return renderEmpty('Sin tareas todavía. Escribí arriba para agregar la primera.');

    listEl.innerHTML = '';
    for (const task of tasks) listEl.append(renderTask(task));
  }

  /** Relee del disco y avisa a los otros tiles de tareas del workspace. */
  async function refreshAndNotify() {
    await load();
    bus.emit('tasks:changed', { tileId: tile.id });
  }

  /** Corre una operación de escritura y refresca. */
  async function mutate(fn) {
    try {
      await fn();
      await refreshAndNotify();
    } catch (err) {
      toast.error(err?.message || String(err));
    }
  }

  function add(title) {
    return mutate(async () => {
      await window.yusepe.tasks.create(cwd(), title);
      input.value = '';
    });
  }

  function toggle(task) {
    return mutate(() => window.yusepe.tasks.setDone(cwd(), task.id, !task.done));
  }

  function remove(task) {
    return mutate(() => window.yusepe.tasks.remove(cwd(), task.id));
  }

  /**
   * Arma el launchText de la tarea con la plantilla del workspace y lo deja
   * en el portapapeles, listo para pegárselo al agente de código.
   * No pasa por mutate(): no escribe nada, así que no hay que releer.
   */
  async function copyLaunchText(task) {
    try {
      const text = await window.yusepe.tasks.launchText(cwd(), task.id);
      await window.yusepe.clipboard.writeText(text);
      toast.success('launchText copiado — pegáselo a tu agente');
    } catch (err) {
      toast.error(err?.message || String(err));
    }
  }

  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // que los atajos globales no se coman el tipeo
    if (e.key === 'Enter') {
      e.preventDefault();
      const title = input.value.trim();
      if (title) add(title);
    } else if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });

  load();

  // Otro tile de tareas del mismo workspace tocó el disco: este quedó viejo.
  // El que hizo el cambio ya releyó, así que se saltea a sí mismo.
  const offChanged = bus.on('tasks:changed', (payload) => {
    if (payload?.tileId !== tile.id) load();
  });

  // Los .md cambiaron por fuera de Bento — típicamente el agente marcando la
  // tarea como hecha al terminarla, o el usuario editándolos a mano.
  const offDisk = window.yusepe.tasks.onChangedOnDisk(({ cwd: changed }) => {
    if (changed === cwd()) load();
  });

  return {
    root: el,
    shutdown: () => {
      offChanged();
      offDisk();
      if (watching) window.yusepe.tasks.unwatch(cwd());
    },
  };
}
