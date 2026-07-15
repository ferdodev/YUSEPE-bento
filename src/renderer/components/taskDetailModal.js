/**
 * src/renderer/components/taskDetailModal.js
 * --------------------------------------------------------------
 * Detalle de una tarea: título + descripción larga en Markdown.
 *
 * La descripción es el cuerpo del `.md` de la tarea
 * (`.ybento/tasks/<id>.md`, ver src/main/tasksOps.js), así que lo que se
 * escribe acá es exactamente lo que queda en el archivo del proyecto —
 * y al revés: si el usuario editó el .md a mano, esto lo muestra.
 *
 * Se abre desde el tile de Tareas al clickear el título de una tarea
 * (el checkbox queda para completar, que es la otra acción).
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { openModal, closeModal } from './modal.js';
import { toast } from './toast.js';
import { renderTextInto } from './fileViewer.js';

/**
 * @param task  la tarea tal como la devuelve tasks:list
 * @param cwd   carpeta del workspace
 * @param onSaved  callback tras guardar (el tile relee y avisa a sus hermanos)
 */
export function openTaskDetail(task, cwd, onSaved) {
  const titleInput = h('input', {
    type: 'text',
    class: 'w-full bg-bg-elev border border-line rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent',
    placeholder: 'Título de la tarea',
    spellcheck: false,
  });
  titleInput.value = task.title;

  const notesInput = h('textarea', {
    class: 'w-full h-[40vh] bg-bg-elev border border-line rounded-md p-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent resize-none',
    placeholder: 'Descripción de la tarea. Acepta Markdown.\n\nEs el cuerpo del .md, así que también podés editarlo fuera de Bento.',
    spellcheck: false,
  });
  notesInput.value = task.notes || '';

  // Vista previa: lo escrito es Markdown, y se renderiza con el mismo
  // módulo que el modal de archivos y el tile fijado (fileViewer.js).
  const preview = h('div', { class: 'hidden h-[40vh] overflow-auto border border-line rounded-md p-3' });
  let previewing = false;

  const editorArea = h('div', {}, [notesInput, preview]);

  const previewBtn = h('button', {
    class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition',
    onClick: () => {
      previewing = !previewing;
      notesInput.classList.toggle('hidden', previewing);
      preview.classList.toggle('hidden', !previewing);
      previewBtn.querySelector('span').textContent = previewing ? 'Editar' : 'Vista previa';
      if (previewing) {
        // El nombre .md hace que fileViewer lo trate como Markdown.
        renderTextInto(preview, { name: 'task.md', raw: notesInput.value || '_(sin descripción)_' });
      }
    },
  }, [svgIcon('file', { size: 13 }), h('span', {}, 'Vista previa')]);

  const status = h('span', { class: 'text-[10px] text-fg-subtle' }, 'Cmd/Ctrl+S para guardar');

  async function save() {
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      return toast.error('La tarea necesita un título');
    }
    try {
      await window.yusepe.tasks.update(cwd, task.id, { title, notes: notesInput.value });
      closeModal();
      onSaved?.();
      toast.success('Tarea guardada');
    } catch (err) {
      toast.error(err?.message || String(err));
    }
  }

  const body = h('div', {}, [
    titleInput,
    h('div', { class: 'flex items-center gap-2 mt-3 mb-2' }, [
      previewBtn,
      h('span', { class: 'flex-1' }),
      status,
    ]),
    editorArea,
    h('div', { class: 'flex items-center gap-2 mt-3' }, [
      h('button', {
        class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-accent hover:bg-accent-soft text-white transition',
        onClick: save,
      }, [svgIcon('save', { size: 13 }), h('span', {}, 'Guardar')]),
      h('button', {
        class: 'text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition',
        onClick: () => closeModal(),
      }, 'Cancelar'),
      h('span', { class: 'flex-1' }),
      // Dónde vive en el proyecto: la tarea es un archivo, no una fila de
      // una base de datos escondida.
      h('span', { class: 'text-[10px] text-fg-subtle truncate', title: task.relPath }, task.relPath),
    ]),
  ]);

  // Cmd/Ctrl+S guarda desde cualquiera de los dos campos; Escape no cierra
  // el modal desde adentro del textarea (se perdería lo escrito sin querer).
  for (const field of [titleInput, notesInput]) {
    field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
      if (e.key === 'Escape') e.stopPropagation();
    });
  }
  // En el título, Enter guarda (es un input de una línea).
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  });

  openModal({ title: 'Detalle de la tarea', body, size: 'lg' });
  setTimeout(() => notesInput.focus(), 0);
}
