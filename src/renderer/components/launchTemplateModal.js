/**
 * src/renderer/components/launchTemplateModal.js
 * --------------------------------------------------------------
 * Editor de la plantilla del launchText: el texto que el botón de cada
 * tarea copia para pegarle al agente de código.
 *
 * La plantilla es del proyecto, no del perfil de Bento: vive en
 * `.ybento/launch-template.md` (ver src/main/tasksOps.js). Viaja con el
 * repo, así que un equipo comparte también *cómo* se lanzan sus tareas.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { openModal, closeModal } from './modal.js';
import { toast } from './toast.js';

// Espejo de LAUNCH_VARIABLES en src/main/tasksOps.js — si agregás una
// variable allá, sumala acá o el usuario no se entera de que existe.
const VARIABLES = [
  { name: 'task_title', hint: 'Título de la tarea' },
  { name: 'task_route', hint: 'Ruta de la tarea, relativa al proyecto' },
  { name: 'task_notes', hint: 'Descripción completa de la tarea' },
  { name: 'project_root', hint: 'Ruta absoluta del workspace' },
];

export async function openLaunchTemplate(cwd, onSaved) {
  let current = '';
  try {
    current = await window.yusepe.tasks.launchTemplate(cwd);
  } catch (err) {
    return toast.error(err?.message || String(err));
  }

  const textarea = h('textarea', {
    class: 'w-full h-[32vh] bg-bg-elev border border-line rounded-md p-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent resize-none',
    spellcheck: false,
  });
  textarea.value = current;

  /** Inserta la variable donde está el cursor (más cómodo que tipearla). */
  function insert(name) {
    const token = `{{${name}}}`;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.value = textarea.value.slice(0, start) + token + textarea.value.slice(end);
    textarea.focus();
    textarea.setSelectionRange(start + token.length, start + token.length);
  }

  const chips = h('div', { class: 'flex flex-wrap gap-1.5 mt-2' },
    VARIABLES.map((v) => h('button', {
      class: 'text-[10px] font-mono px-1.5 py-0.5 rounded border border-line text-fg-muted hover:bg-bg-elev hover:text-fg transition',
      title: `${v.hint} — clic para insertar`,
      onClick: () => insert(v.name),
    }, `{{${v.name}}}`)));

  async function save() {
    try {
      await window.yusepe.tasks.setLaunchTemplate(cwd, textarea.value);
      closeModal();
      onSaved?.();
      toast.success('Plantilla guardada');
    } catch (err) {
      toast.error(err?.message || String(err));
    }
  }

  textarea.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
    if (e.key === 'Escape') e.stopPropagation();
  });

  const body = h('div', {}, [
    h('p', { class: 'text-sm text-fg-soft mb-2' },
      'Texto que copia el botón de cada tarea para pasárselo a tu agente de código. Se guarda en el proyecto, así que viaja con el repo.'),
    textarea,
    h('p', { class: 'text-[10px] text-fg-subtle mt-2' }, 'Variables disponibles (clic para insertar):'),
    chips,
    h('div', { class: 'flex items-center gap-2 mt-4' }, [
      h('button', {
        class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-accent hover:bg-accent-soft text-white transition',
        onClick: save,
      }, [svgIcon('save', { size: 13 }), h('span', {}, 'Guardar')]),
      h('button', {
        class: 'text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition',
        onClick: () => closeModal(),
      }, 'Cancelar'),
      h('span', { class: 'flex-1' }),
      h('span', { class: 'text-[10px] text-fg-subtle' }, '.ybento/launch-template.md'),
    ]),
  ]);

  openModal({ title: 'Plantilla del launchText', body, size: 'lg' });
  setTimeout(() => textarea.focus(), 0);
}
