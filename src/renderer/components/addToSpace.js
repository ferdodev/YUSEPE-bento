/**
 * src/renderer/components/addToSpace.js
 * --------------------------------------------------------------
 * Modal único "Agregar al espacio": nueva terminal, terminal
 * precargada (ejecuta un comando al abrir), calculadora, URL manual
 * y un catálogo de webapps con UI tipo marketplace (buscador + filtro
 * por categoría + tarjetas, ver core/appLibrary.js).
 * --------------------------------------------------------------
 */
import { h, debounce } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { openModal, closeModal, promptModal } from './modal.js';
import { TileFactory } from './tile.js';
import { state } from '../core/state.js';
import { LIBRARY_APPS, CATEGORIES } from '../core/appLibrary.js';

function currentCwd() {
  return state.profile?.cwd || null;
}

function actionButton({ icon, label, onClick }) {
  return h('button', {
    class: 'w-full flex items-center gap-2 p-2 rounded-md border border-line hover:bg-bg-elev transition text-left',
    onClick,
  }, [
    h('span', { class: 'w-6 flex justify-center text-fg-muted' }, svgIcon(icon, { size: 17 })),
    h('span', { class: 'text-sm text-fg' }, label),
  ]);
}

export function openAddToSpace() {
  if (!state.profile) {
    openModal({
      title: 'Sin perfil',
      body: h('p', { class: 'text-sm text-fg-soft' },
        'Crea o selecciona un perfil antes de añadir tiles.'),
    });
    return;
  }

  const actions = h('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-1.5' }, [
    actionButton({
      icon: 'terminal',
      label: 'Terminal',
      onClick: async () => { await TileFactory.terminal(currentCwd()); closeModal(); },
    }),
    actionButton({
      icon: 'bolt',
      label: 'Precargada…',
      onClick: promptPreloadedTerminal,
    }),
    actionButton({
      icon: 'calculator',
      label: 'Calculadora',
      onClick: async () => { await TileFactory.calculator(); closeModal(); },
    }),
    actionButton({
      icon: 'link',
      label: 'URL manual…',
      onClick: promptManualUrl,
    }),
  ]);

  const toolsSection = h('div', { class: 'mt-3' });
  loadTools(toolsSection);

  const divider = h('div', { class: 'my-3 border-t border-line' });

  const marketplace = buildMarketplace();

  openModal({
    title: 'Agregar al espacio',
    body: h('div', {}, [actions, toolsSection, divider, marketplace]),
    size: 'lg',
  });
}

/**
 * Catálogo de webapps con UI tipo marketplace (App Store / Google Play):
 * buscador + pills de categoría + grid de tarjetas con icono, nombre y
 * bajada. Ver core/appLibrary.js para el catálogo y sus categorías.
 */
function buildMarketplace() {
  let query = '';
  let category = 'Todas';

  const searchInput = h('input', {
    type: 'text',
    placeholder: 'Buscar apps (ej. "notas", "diagramas")…',
    class: 'w-full bg-bg-elev border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent',
  });

  const pillsRow = h('div', { class: 'flex flex-wrap gap-1.5 mt-2.5' });
  const grid = h('div', { class: 'grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-3 max-h-[42vh] overflow-y-auto content-start pr-0.5' });

  function pill(label) {
    const active = label === category;
    return h('button', {
      class: `text-xs px-2.5 py-1 rounded-full border transition ${
        active
          ? 'border-accent bg-accent/20 text-accent-soft'
          : 'border-line hover:bg-bg-elev text-fg-soft'
      }`,
      onClick: () => { category = label; render(); },
    }, label);
  }

  function render() {
    pillsRow.innerHTML = '';
    pillsRow.append(pill('Todas'), ...CATEGORIES.map(pill));
    renderLibraryGrid(grid, { query, category });
  }

  searchInput.addEventListener('input', debounce(() => {
    query = searchInput.value.trim().toLowerCase();
    render();
  }, 200));

  render();

  return h('div', {}, [
    h('p', { class: 'text-xs text-fg-subtle mb-1' }, 'Catálogo de apps'),
    searchInput,
    pillsRow,
    grid,
  ]);
}

/**
 * Herramientas CLI detectadas en el sistema (claude, opencode, lazygit,
 * lazydocker, vim/nvim, btop, ver main/toolDetector.js). Si el dev ya las
 * tiene instaladas, seguro las quiere usar — un click abre una terminal
 * precargada con ese comando en vez de tener que tipearlo a mano.
 */
async function loadTools(container) {
  try {
    const tools = await window.yusepe.tools.detect();
    const available = tools.filter((t) => t.available);
    if (!available.length) return;

    container.append(
      h('p', { class: 'text-xs text-fg-subtle mb-1.5' }, 'Detectado en tu sistema'),
      h('div', { class: 'flex flex-wrap gap-1.5' },
        available.map((tool) => h('button', {
          class: 'text-xs px-2.5 py-1 rounded-full border border-line hover:bg-bg-elev transition',
          title: `Abrir terminal con "${tool.bin}"`,
          onClick: async () => {
            await TileFactory.terminalPreloaded(tool.bin, currentCwd());
            closeModal();
          },
        }, tool.label))
      )
    );
  } catch {
    // Si falla la detección, simplemente no se muestra la sección.
  }
}

/**
 * Catálogo de webapps sugeridas, como tarjetas de marketplace (ver
 * core/appLibrary.js). `query`/`category` filtran por nombre, URL,
 * descripción y categoría.
 */
function renderLibraryGrid(container, { query, category }) {
  container.innerHTML = '';

  const apps = LIBRARY_APPS.filter((app) => {
    if (category !== 'Todas' && app.category !== category) return false;
    if (!query) return true;
    const haystack = `${app.name} ${app.url} ${app.description}`.toLowerCase();
    return haystack.includes(query);
  });

  if (!apps.length) {
    container.append(h('p', { class: 'text-fg-subtle text-xs col-span-3 py-4 text-center' }, 'Sin resultados.'));
    return;
  }

  for (const app of apps) {
    const placeholder = h('span', { class: 'w-10 h-10 rounded-lg bg-bg-elev flex items-center justify-center shrink-0 text-fg-subtle' }, svgIcon('webview', { size: 20 }));
    let iconEl = placeholder;
    if (app.badge) {
      // Icono propio: badge cuadrado con emoji o texto en color.
      const styled = app.badge.bg
        ? { style: `background:${app.badge.bg};color:${app.badge.color || '#fff'}` }
        : {};
      iconEl = h('span', {
        class: 'w-10 h-10 rounded-lg bg-bg-elev flex items-center justify-center shrink-0 text-lg leading-none',
        ...styled,
      }, app.badge.text);
    } else if (app.icon) {
      const img = h('img', { src: app.icon, class: 'w-10 h-10 rounded-lg object-contain shrink-0 bg-bg-elev p-1.5', alt: '' });
      // Si el favicon no carga (sin red / bloqueado), caer al placeholder.
      img.addEventListener('error', () => img.replaceWith(placeholder), { once: true });
      iconEl = img;
    }
    container.append(h('button', {
      class: 'flex flex-col items-start gap-2 p-3 rounded-lg border border-line hover:border-accent hover:bg-bg-elev transition text-left',
      onClick: async () => { await TileFactory.fromApp(app); closeModal(); },
    }, [
      h('div', { class: 'flex items-center gap-2 w-full' }, [
        iconEl,
        h('div', { class: 'min-w-0 flex-1' }, [
          h('div', { class: 'text-sm text-fg font-medium truncate' }, app.name),
          h('div', { class: 'text-[10px] text-fg-subtle truncate' }, app.category),
        ]),
      ]),
      app.description ? h('p', { class: 'text-[11px] text-fg-subtle leading-snug line-clamp-2' }, app.description) : null,
    ]));
  }
}

function promptManualUrl() {
  closeModal();
  promptModal({
    title: 'Añadir URL',
    label: 'Pega cualquier URL para embeberla como un tile en tu Bento.',
    placeholder: 'https://ejemplo.com o ejemplo.com',
    confirmLabel: 'Añadir tile',
  }).then(async (value) => {
    if (!value) return;
    const tile = await TileFactory.fromUrl(value);
    if (!tile) {
      openModal({ title: 'URL inválida', body: 'Usa una URL con formato https://...' });
    }
  });
}

function promptPreloadedTerminal() {
  closeModal();
  promptModal({
    title: 'Terminal precargada',
    label: 'Comando a ejecutar automáticamente al abrir la terminal.',
    placeholder: 'ej. npm run dev',
    confirmLabel: 'Crear terminal',
  }).then(async (command) => {
    if (!command) return;
    await TileFactory.terminalPreloaded(command, currentCwd());
  });
}
