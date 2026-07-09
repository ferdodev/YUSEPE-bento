/**
 * src/renderer/main.js
 * --------------------------------------------------------------
 * Entry point. Pantalla de perfiles al abrir + gestión CRUD.
 * Nombres de perfil únicos validados en create y rename.
 * --------------------------------------------------------------
 */
import { ProfileManager } from './core/profileManager.js';
import { state } from './core/state.js';
import { bus } from './core/eventBus.js';
import { renderBento, closeFocusedTile } from './components/bentoGrid.js';
import { TileFactory } from './components/tile.js';
import { openAddToSpace } from './components/addToSpace.js';
import { openSettings } from './components/settings.js';
import { openModal, promptModal, confirmModal } from './components/modal.js';
import { h } from './utils/dom.js';
import { svgIcon } from './utils/icons.js';
import { initTheme } from './core/theme.js';
import * as liveTiles from './core/liveTiles.js';
import { initFileTreeSidebar, toggleFileTreeSidebar } from './components/fileTreeSidebar.js';
import { openGitPanel } from './components/gitPanel.js';
import { openAgentPanel } from './components/agentPanel.js';
import { openWorkspaceManager } from './components/workspaceManager.js';
import { openCommandPalette } from './components/commandPalette.js';
import { initSnippetsSidebar, toggleSnippetsSidebar } from './components/snippetsSidebar.js';

const $ = (sel) => document.querySelector(sel);

const profileSelect = $('#profile-select');
const profileName = $('#profile-name');
const profileScreen = $('#profile-screen');
const profileList = $('#profile-list');
const bento = $('#bento');
const backBtn = $('#btn-back-profiles');
const runningWorkspacesEl = $('#running-workspaces');

const ADD_BTN_IDS = ['btn-add-to-space', 'btn-toggle-explorer', 'btn-git', 'btn-agents', 'btn-workspace-manager', 'btn-toggle-snippets'];

/** Abre el picker nativo de carpeta. Devuelve la ruta o null si se canceló. */
async function pickFolder() {
  return window.yusepe.dialog.pickFolder();
}

/* ---------- Switch entre pantalla de perfiles y bento ---------- */

function showView() {
  if (state.profile) {
    profileScreen.classList.add('hidden');
    backBtn.classList.remove('hidden');
    renderBento();
  } else {
    bento.classList.add('hidden');
    backBtn.classList.add('hidden');
    profileScreen.classList.remove('hidden');
    renderProfileList();
  }
  updateAddButtonsState();
}

function updateAddButtonsState() {
  const hasProfile = !!state.profile;
  for (const id of ADD_BTN_IDS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.disabled = !hasProfile;
    btn.title = hasProfile ? '' : 'Crea un workspace primero';
  }
}

/* ---------- Listado de perfiles ---------- */

const profileSearch = $('#profile-search');
let allProfiles = [];

async function renderProfileList() {
  allProfiles = await ProfileManager.refresh();
  renderFilteredProfiles();
}

function renderFilteredProfiles() {
  profileList.innerHTML = '';

  if (!allProfiles.length) {
    profileList.innerHTML =
      '<p class="text-sm text-fg-subtle">No hay workspaces. Crea el primero.</p>';
    return;
  }

  const query = (profileSearch?.value || '').trim().toLowerCase();
  // Orden: visitados más recientemente primero; los nunca abiertos, al final
  // por fecha de edición.
  const sorted = [...allProfiles].sort((a, b) =>
    (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0));
  const filtered = query
    ? sorted.filter((p) =>
      p.name.toLowerCase().includes(query) || (p.cwd || '').toLowerCase().includes(query))
    : sorted;

  if (!filtered.length) {
    profileList.innerHTML =
      '<p class="text-sm text-fg-subtle">Sin resultados para tu búsqueda.</p>';
    return;
  }

  for (const p of filtered) {
    profileList.append(createProfileRow(p));
  }
}

function createProfileRow(profile) {
  const visited = profile.lastOpenedAt
    ? `Última visita: ${formatRelative(profile.lastOpenedAt)}`
    : 'Nunca abierto';

  return h('div', {
    class:
      'group relative flex items-center gap-3 px-4 py-3 rounded-lg border border-line bg-bg-soft hover:bg-bg-elev transition cursor-pointer',
    onClick: async () => {
      await ProfileManager.load(profile.id);
      profileSelect.value = profile.id;
      profileName.textContent = profile.name;
      showView();
    },
  }, [
    h('div', { class: 'flex-1 min-w-0' }, [
      h('div', { class: 'text-sm text-fg truncate' }, profile.name),
      h('div', { class: 'text-xs text-fg-subtle truncate' }, profile.cwd || 'Sin carpeta de inicio'),
    ]),
    h('div', { class: 'text-[11px] text-fg-subtle whitespace-nowrap shrink-0 group-hover:hidden' }, visited),
    h('div', {
      class: 'hidden group-hover:flex gap-1 shrink-0',
    }, [
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-fg px-1.5 py-1 rounded',
        title: 'Carpeta de inicio',
        onClick: (e) => { e.stopPropagation(); changeCwd(profile); },
      }, svgIcon('folder', { size: 15 })),
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-fg px-1.5 py-1 rounded',
        title: 'Renombrar',
        onClick: (e) => { e.stopPropagation(); renameProfile(profile); },
      }, svgIcon('edit', { size: 15 })),
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-fg px-1.5 py-1 rounded',
        title: 'Exportar a un archivo .json',
        onClick: (e) => { e.stopPropagation(); exportProfile(profile); },
      }, svgIcon('export', { size: 15 })),
      h('button', {
        class: 'inline-flex items-center text-fg-muted hover:text-red-400 px-1.5 py-1 rounded',
        title: 'Eliminar',
        onClick: (e) => { e.stopPropagation(); deleteProfile(profile); },
      }, svgIcon('trash', { size: 15 })),
    ]),
  ]);
}

function formatRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `hace ${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `hace ${mo} mes${mo > 1 ? 'es' : ''}`;
  return `hace ${Math.floor(mo / 12)} año${Math.floor(mo / 12) > 1 ? 's' : ''}`;
}

/* ---------- Gestión CRUD de perfiles ---------- */

async function refreshProfileSelect(selectId = null) {
  await ProfileManager.refresh();
  profileSelect.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— Seleccionar —';
  profileSelect.append(blank);
  for (const p of state.profiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    profileSelect.append(opt);
  }
  if (selectId) profileSelect.value = selectId;
}

async function createNewProfile() {
  const name = await promptModal({
    title: 'Nuevo workspace',
    label: 'Nombre del workspace (debe ser único).',
    placeholder: 'ej. Trabajo',
    confirmLabel: 'Crear',
  });
  if (!name) return;
  try {
    if (await ProfileManager.exists(name)) {
      openModal({ title: 'Nombre duplicado', body: `Ya existe un workspace llamado "${name}".` });
      return;
    }
    const confirmed = await confirmModal({
      title: 'Carpeta de inicio',
      body: 'Elige la carpeta donde deben iniciarse las terminales de este espacio de trabajo (opcional).',
      confirmLabel: 'Elegir carpeta',
      cancelLabel: 'Omitir',
    });
    const cwd = confirmed ? await pickFolder() : null;

    const p = await ProfileManager.create(name, cwd);
    await refreshProfileSelect(p.id);
    await ProfileManager.load(p.id);
    profileName.textContent = p.name;
    showView();
  } catch (err) {
    openModal({ title: 'Error', body: `${err?.message || err}` });
  }
}

async function changeCwd(profile) {
  const cwd = await pickFolder();
  if (!cwd) return;
  await ProfileManager.setCwd(profile.id, cwd);
  renderProfileList();
}

async function renameProfile(profile) {
  const name = await promptModal({
    title: 'Renombrar workspace',
    label: 'Nuevo nombre (debe ser único).',
    defaultValue: profile.name,
    confirmLabel: 'Guardar',
  });
  if (!name || name === profile.name) return;
  try {
    if (await ProfileManager.exists(name)) {
      openModal({ title: 'Nombre duplicado', body: `Ya existe un workspace llamado "${name}".` });
      return;
    }
    await ProfileManager.rename(profile.id, name);
    await refreshProfileSelect();
    if (state.activeProfileId === profile.id) {
      profileName.textContent = name;
    }
    renderProfileList();
  } catch (err) {
    openModal({ title: 'Error', body: `${err?.message || err}` });
  }
}

async function deleteProfile(profile) {
  const confirmed = await confirmModal({
    title: 'Eliminar workspace',
    body: `¿Eliminar "${profile.name}"? Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!confirmed) return;
  await ProfileManager.remove(profile.id);
  await refreshProfileSelect();
  renderProfileList();
}

/** Exporta un perfil puntual a un .json (diálogo nativo de guardado). */
async function exportProfile(profile) {
  try {
    await ProfileManager.export(profile.id);
  } catch (err) {
    openModal({ title: 'Error al exportar', body: `${err?.message || err}` });
  }
}

/** Exporta el workspace activo (usado desde el Command Palette). */
async function exportActiveProfile() {
  if (!state.profile) return;
  await exportProfile(state.profile);
}

/** Importa un workspace desde un .json exportado previamente (id nuevo, nombre deduplicado). */
async function importProfile() {
  try {
    const result = await ProfileManager.import();
    if (result.canceled) return;
    renderProfileList();
    openModal({
      title: 'Workspace importado',
      body: `"${result.profile.name}" se agregó a tus workspaces.`,
    });
  } catch (err) {
    openModal({ title: 'Error al importar', body: `${err?.message || err}` });
  }
}

/* ---------- Workspaces corriendo en segundo plano ---------- */
// Un workspace queda "corriendo" cuando tiene terminales y/o webviews
// vivos (procesos reales) aunque ya no sea el perfil activo — ver
// core/liveTiles.js. Se listan acá para poder cerrarlos del todo.

function renderRunningWorkspaces() {
  if (!runningWorkspacesEl) return;
  const activeId = state.activeProfileId;
  const ids = [...liveTiles.runningProfileIds()].filter((id) => id !== activeId);

  runningWorkspacesEl.innerHTML = '';
  for (const id of ids) {
    const profile = state.profiles.find((p) => p.id === id);
    const name = profile?.name || 'Workspace';
    const count = liveTiles.countForProfile(id);
    runningWorkspacesEl.append(h('div', {
      class:
        'flex items-center gap-1.5 text-xs pl-2.5 pr-1.5 py-1 rounded-full border border-line bg-bg-elev/70 text-fg-subtle shrink-0',
      title: `${name} · ${count} tile(s) en segundo plano`,
    }, [
      h('span', { class: 'w-1.5 h-1.5 rounded-full bg-accent shrink-0' }),
      h('span', { class: 'truncate max-w-[8rem]' }, name),
      h('button', {
        class: 'inline-flex items-center text-fg-subtle hover:text-red-400 transition px-0.5',
        title: `Cerrar "${name}" (mata sus terminales/webviews en segundo plano)`,
        onClick: (e) => { e.stopPropagation(); killBackgroundWorkspace(id, name); },
      }, svgIcon('close', { size: 13 })),
    ]));
  }
}

async function killBackgroundWorkspace(profileId, name) {
  const count = liveTiles.countForProfile(profileId);
  const confirmed = await confirmModal({
    title: 'Cerrar espacio en segundo plano',
    body: `¿Cerrar "${name}"? Esto terminará ${count} tile(s) en segundo plano (terminales y/o webviews con procesos en ejecución).`,
    confirmLabel: 'Cerrar',
    danger: true,
  });
  if (!confirmed) return;
  liveTiles.killWorkspace(profileId);
}

/* ---------- Event handlers ---------- */

profileSelect.addEventListener('change', async (e) => {
  const id = e.target.value;
  if (!id) {
    ProfileManager.clear();
    return;
  }
  await ProfileManager.load(id);
  profileName.textContent = state.profile.name;
  showView();
});

$('#btn-new-profile').addEventListener('click', createNewProfile);
$('#btn-profile-new')?.addEventListener('click', createNewProfile);
$('#btn-profile-import')?.addEventListener('click', importProfile);
profileSearch?.addEventListener('input', renderFilteredProfiles);

backBtn.addEventListener('click', () => {
  profileSelect.value = '';
  ProfileManager.clear();
});

/* ---------- Topbar: añadir tiles / configuración ---------- */

$('#btn-add-to-space').addEventListener('click', openAddToSpace);
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-toggle-explorer').addEventListener('click', toggleFileTreeSidebar);
$('#btn-git').addEventListener('click', openGitPanel);
$('#btn-agents').addEventListener('click', openAgentPanel);
$('#btn-workspace-manager').addEventListener('click', openWorkspaceManager);
$('#btn-toggle-snippets').addEventListener('click', toggleSnippetsSidebar);

/* ---------- Menu accelerators (globales) ---------- */

window.yusepe.menu.onCloseTile(() => closeFocusedTile());
window.yusepe.menu.onCommandPalette(() => openCommandPalette());
window.yusepe.menu.onAddToSpace(() => openAddToSpace());
window.yusepe.menu.onNewTerminal(() => TileFactory.terminal(state.profile?.cwd));
window.yusepe.menu.onNewCalc(() => TileFactory.calculator());
window.yusepe.menu.onSettings(() => openSettings());

/* ---------- Command Palette: acciones que necesitan funciones privadas
   de este módulo (crear/exportar/importar workspace) ---------- */

bus.on('workspace:create-requested', createNewProfile);
bus.on('workspace:export-requested', exportActiveProfile);
bus.on('workspace:import-requested', importProfile);

/* ---------- Reactividad ---------- */

bus.on('profile:loaded', () => {
  profileName.textContent = state.profile?.name || 'Sin workspace';
  showView();
  renderRunningWorkspaces();
});

bus.on('profile:cleared', () => {
  profileName.textContent = 'Sin workspace';
  showView();
  renderRunningWorkspaces();
});

bus.on('profile:renamed', () => {
  refreshProfileSelect();
  renderRunningWorkspaces();
});

bus.on('live-tiles:changed', renderRunningWorkspaces);

bus.on('tile:added',   () => renderBento());
bus.on('tile:removed', () => renderBento());
bus.on('tile:updated', () => renderBento());

bus.on('calc:result', ({ value }) => {
  console.info('[bus] calc:result', value);
});

/* ---------- Bootstrap ---------- */

(async function init() {
  if (!window.yusepe) {
    profileScreen.classList.remove('hidden');
    profileList.innerHTML =
      '<p class="text-red-400 text-sm">El preload no cargó.</p>';
    return;
  }
  // Marca la plataforma para el CSS: en macOS reserva el hueco de los
  // traffic lights de la topbar (titleBarStyle:hiddenInset). En pantalla
  // completa los semáforos se ocultan, así que se libera ese hueco.
  if (window.yusepe.platform === 'darwin') {
    document.body.classList.add('platform-darwin');
    window.yusepe.window?.onFullscreen?.((isFs) => {
      document.body.classList.toggle('is-fullscreen', !!isFs);
    });
  }
  initTheme();
  initFileTreeSidebar();
  initSnippetsSidebar();
  await refreshProfileSelect();
  showView();
  renderRunningWorkspaces();
  bus.emit('app:ready');
})();
