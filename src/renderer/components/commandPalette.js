/**
 * src/renderer/components/commandPalette.js
 * --------------------------------------------------------------
 * Command Palette global (Cmd/Ctrl+P): un único buscador para saltar a
 * otro workspace, enfocar un tile del workspace activo, o disparar
 * acciones rápidas (nueva terminal, paneles, tema, import/export...).
 *
 * Reutiliza el modal genérico (ver modal.js): input propio arriba +
 * lista de resultados, navegación con ↑/↓/Enter dentro del input.
 * Antes de ejecutar una acción SIEMPRE se hace closeModal() primero —
 * varias acciones abren su propio modal (openSettings, openGitPanel...)
 * y modal.js reutiliza el mismo #modal-root, así que hay que soltarlo
 * limpio en vez de pisarlo mientras sigue "abierto" por la paleta.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { state } from '../core/state.js';
import { bus } from '../core/eventBus.js';
import { openModal, closeModal } from './modal.js';
import { ProfileManager } from '../core/profileManager.js';
import { TileFactory } from './tile.js';
import { openAddToSpace } from './addToSpace.js';
import { openSettings } from './settings.js';
import { openGitPanel } from './gitPanel.js';
import { openAgentPanel } from './agentPanel.js';
import { openWorkspaceManager, labelFor } from './workspaceManager.js';
import { toggleFileTreeSidebar } from './fileTreeSidebar.js';
import { toggleSnippetsSidebar } from './snippetsSidebar.js';
import { focusTileById } from './bentoGrid.js';
import { getTheme, applyTheme } from '../core/theme.js';

const TILE_ICON = { terminal: 'terminal', webview: 'webview', calculator: 'calculator' };

function buildActions() {
  const actions = [];
  const hasProfile = !!state.profile;

  for (const p of state.profiles) {
    if (p.id === state.activeProfileId) continue;
    actions.push({
      group: 'Workspaces', icon: 'folder', label: p.name, hint: 'Cambiar de workspace',
      run: async () => {
        await ProfileManager.load(p.id);
        const sel = document.getElementById('profile-select');
        if (sel) sel.value = p.id;
      },
    });
  }

  if (hasProfile) {
    for (const tile of state.profile.tiles || []) {
      actions.push({
        group: 'Ir a tile', icon: TILE_ICON[tile.kind] || 'square',
        label: labelFor(tile), hint: `${tile.colSpan || 1}x${tile.rowSpan || 1}`,
        run: () => focusTileById(tile.id),
      });
    }
  }

  actions.push(
    { group: 'Acciones', icon: 'terminal', label: 'Nueva terminal', run: () => TileFactory.terminal(state.profile?.cwd), enabled: hasProfile },
    { group: 'Acciones', icon: 'calculator', label: 'Nueva calculadora', run: () => TileFactory.calculator(), enabled: hasProfile },
    { group: 'Acciones', icon: 'plus', label: 'Agregar al espacio…', run: () => openAddToSpace(), enabled: hasProfile },
    { group: 'Acciones', icon: 'folder', label: 'Árbol de archivos', run: () => toggleFileTreeSidebar(), enabled: hasProfile },
    { group: 'Acciones', icon: 'snippets', label: 'Snippets', run: () => toggleSnippetsSidebar(), enabled: hasProfile },
    { group: 'Acciones', icon: 'git', label: 'Git', run: () => openGitPanel(), enabled: hasProfile },
    { group: 'Acciones', icon: 'agents', label: 'Agentes', run: () => openAgentPanel(), enabled: hasProfile },
    { group: 'Acciones', icon: 'grid', label: 'Administrador del workspace', run: () => openWorkspaceManager(), enabled: hasProfile },
    { group: 'Acciones', icon: 'export', label: 'Exportar workspace activo…', run: () => bus.emit('workspace:export-requested'), enabled: hasProfile },
    { group: 'Acciones', icon: 'import', label: 'Importar workspace…', run: () => bus.emit('workspace:import-requested') },
    { group: 'Acciones', icon: 'plus', label: 'Nuevo workspace…', run: () => bus.emit('workspace:create-requested') },
    { group: 'Acciones', icon: 'settings', label: 'Configuración', run: () => openSettings() },
    {
      group: 'Acciones',
      icon: getTheme() === 'dark' ? 'sun' : 'moon',
      label: getTheme() === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',
      run: () => applyTheme(getTheme() === 'dark' ? 'light' : 'dark'),
    },
  );

  return actions.filter((a) => a.enabled !== false);
}

export function openCommandPalette() {
  const allActions = buildActions();
  let filtered = allActions;
  let selected = 0;

  const input = h('input', {
    type: 'text',
    placeholder: 'Buscar workspace, tile o acción…',
    class: 'w-full bg-bg-elev border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent',
  });
  const list = h('div', { class: 'mt-2 max-h-[50vh] overflow-y-auto' });

  openModal({ title: '⌘ Command Palette', body: h('div', {}, [input, list]), size: 'md' });
  render();
  setTimeout(() => input.focus(), 0);

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    filtered = !q
      ? allActions
      : allActions.filter((a) => `${a.label} ${a.group} ${a.hint || ''}`.toLowerCase().includes(q));
    selected = 0;
    render();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, filtered.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); execute(filtered[selected]); }
  });

  function execute(action) {
    if (!action) return;
    closeModal();
    action.run();
  }

  function render() {
    list.innerHTML = '';
    if (!filtered.length) {
      list.append(h('p', { class: 'text-fg-subtle text-xs py-4 text-center' }, 'Sin resultados.'));
      return;
    }
    let lastGroup = null;
    filtered.forEach((action, i) => {
      if (action.group !== lastGroup) {
        lastGroup = action.group;
        list.append(h('p', { class: 'text-[10px] text-fg-subtle uppercase tracking-wide px-1 mt-2 mb-1 first:mt-0' }, action.group));
      }
      const active = i === selected;
      list.append(h('div', {
        class: `flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm transition ${
          active ? 'bg-accent/20 text-fg' : 'text-fg-soft hover:bg-bg-elev'
        }`,
        onClick: () => execute(action),
        onMouseenter: () => { selected = i; render(); },
      }, [
        h('span', { class: `w-5 flex justify-center shrink-0 ${active ? 'text-fg' : 'text-fg-muted'}` }, svgIcon(action.icon, { size: 15 })),
        h('span', { class: 'flex-1 min-w-0 truncate' }, action.label),
        action.hint ? h('span', { class: 'text-[10px] text-fg-subtle shrink-0' }, action.hint) : null,
      ]));
    });
  }
}
