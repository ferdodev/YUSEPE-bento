/**
 * src/renderer/components/gitPanel.js
 * --------------------------------------------------------------
 * Panel de Git en un modal (independiente del Bento Grid, igual que
 * el explorador de archivos): status, diff, stage/unstage, commit,
 * push y cambio de rama del workspace activo.
 *
 * Alcance a propósito acotado a "lo del día a día" — ver cambios,
 * subirlos y moverse entre ramas. Para rebase, merges o stash, seguí
 * usando lazygit en una terminal (ya lo detectamos como herramienta
 * disponible en "Agregar al espacio").
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { state } from '../core/state.js';
import { openModal } from './modal.js';
import { highlightCode } from '../core/codeHighlight.js';

export function openGitPanel() {
  const cwd = state.profile?.cwd;
  if (!cwd) {
    openModal({
      title: 'Git',
      body: h('p', { class: 'text-sm text-fg-soft' },
        'Este workspace no tiene una carpeta de inicio configurada. Elegí una carpeta en la lista de perfiles para usar el panel de Git.'),
    });
    return;
  }

  let currentStatus = null;

  const branchLabel = h('div', { class: 'text-xs text-fg-subtle' }, 'Cargando…');
  const branchSelect = h('select', {
    class: 'text-xs bg-bg-elev border border-line rounded-md px-1.5 py-1 max-w-[10rem] focus:outline-none focus:ring-1 focus:ring-accent hidden',
    onChange: () => doSwitchBranch(branchSelect.value),
  });
  const newBranchBtn = h('button', {
    class: 'text-xs px-2 py-1 rounded-md border border-line hover:bg-bg-elev transition',
    title: 'Crear rama nueva',
    onClick: () => toggleNewBranchInput(),
  }, '+ rama');
  const newBranchInput = h('input', {
    type: 'text',
    placeholder: 'nombre-de-rama',
    class: 'text-xs bg-bg-elev border border-line rounded-md px-2 py-1 hidden',
    onKeydown: (e) => {
      if (e.key === 'Enter') doCreateBranch();
      if (e.key === 'Escape') toggleNewBranchInput(false);
    },
  });
  const refreshBtn = h('button', {
    class: 'text-xs px-2 py-1 rounded-md border border-line hover:bg-bg-elev transition',
    title: 'Refrescar',
    onClick: () => refresh(),
  }, '⟳');
  const stageAllBtn = h('button', {
    class: 'text-[10px] text-accent-soft hover:underline',
    onClick: doStageAll,
  }, 'Preparar todos');

  const fileListEl = h('div', { class: 'w-56 shrink-0 overflow-y-auto border-r border-line pr-2' });
  const diffEl = h('div', { class: 'flex-1 min-w-0 overflow-auto pl-3' }, [
    h('p', { class: 'text-fg-subtle text-xs' }, 'Elegí un archivo para ver el diff.'),
  ]);

  const messageInput = h('textarea', {
    placeholder: 'Mensaje del commit…',
    class: 'w-full bg-bg-elev border border-line rounded-md px-2 py-1.5 text-xs h-16 resize-none focus:outline-none focus:ring-1 focus:ring-accent',
  });
  const errorEl = h('p', { class: 'text-red-400 text-[10px] mt-1 hidden' });
  const commitBtn = h('button', {
    class: 'text-xs px-2.5 py-1.5 rounded-md bg-accent hover:bg-accent-soft text-white transition disabled:opacity-40 disabled:cursor-not-allowed',
    onClick: doCommit,
  }, 'Commit');
  const pushBtn = h('button', {
    class: 'text-xs px-2.5 py-1.5 rounded-md border border-line hover:bg-bg-elev transition',
    onClick: doPush,
  }, '⇧ Subir cambios');
  commitBtn.disabled = true;

  const header = h('div', { class: 'flex items-center gap-2 mb-2' }, [
    branchLabel, branchSelect, newBranchInput, newBranchBtn,
    h('div', { class: 'flex-1' }), refreshBtn,
  ]);
  const columns = h('div', { class: 'flex h-[52vh]' }, [fileListEl, diffEl]);
  const footer = h('div', { class: 'mt-3 pt-3 border-t border-line' }, [
    messageInput,
    errorEl,
    h('div', { class: 'flex gap-2 mt-2' }, [commitBtn, pushBtn]),
  ]);

  openModal({ title: '⎇ Git', body: h('div', {}, [header, columns, footer]), size: 'lg' });

  messageInput.addEventListener('input', updateCommitBtn);

  function updateCommitBtn() {
    const hasStaged = currentStatus?.files.some((f) => f.staged);
    commitBtn.disabled = !hasStaged || !messageInput.value.trim();
  }

  async function refresh() {
    branchLabel.textContent = 'Cargando…';
    try {
      currentStatus = await window.yusepe.git.status(cwd);
    } catch (err) {
      branchLabel.textContent = '';
      fileListEl.innerHTML = '';
      fileListEl.append(h('p', { class: 'text-red-400 text-xs px-1' }, err?.message || String(err)));
      return;
    }
    const { branch, ahead, behind } = currentStatus;
    branchLabel.textContent = `⎇` + (ahead ? ` ↑${ahead}` : '') + (behind ? ` ↓${behind}` : '');
    renderFileList(currentStatus.files);
    updateCommitBtn();
    await refreshBranches(branch);
  }

  async function refreshBranches(currentBranch) {
    try {
      const branches = await window.yusepe.git.branches(cwd);
      branchSelect.innerHTML = '';
      for (const b of branches) {
        branchSelect.append(h('option', {
          value: b.name,
          selected: b.name === currentBranch ? '' : undefined,
        }, b.remote ? `${b.name} (remota)` : b.name));
      }
      branchSelect.classList.remove('hidden');
    } catch {
      branchSelect.classList.add('hidden');
    }
  }

  function toggleNewBranchInput(force) {
    const show = force ?? newBranchInput.classList.contains('hidden');
    newBranchInput.classList.toggle('hidden', !show);
    if (show) {
      newBranchInput.value = '';
      newBranchInput.focus();
    }
  }

  async function doSwitchBranch(branch) {
    const previous = currentStatus?.branch;
    try {
      await window.yusepe.git.switchBranch(cwd, branch);
      await refresh();
    } catch (err) {
      showError(err);
      if (previous) branchSelect.value = previous;
    }
  }

  async function doCreateBranch() {
    const name = newBranchInput.value.trim();
    if (!name) return;
    try {
      await window.yusepe.git.createBranch(cwd, name);
      toggleNewBranchInput(false);
      await refresh();
    } catch (err) {
      showError(err);
    }
  }

  function renderFileList(files) {
    fileListEl.innerHTML = '';
    const staged = files.filter((f) => f.staged);
    const unstaged = files.filter((f) => !f.staged);

    fileListEl.append(h('div', { class: 'text-[10px] text-fg-subtle uppercase px-1 mb-1' },
      `Preparados (${staged.length})`));
    if (!staged.length) {
      fileListEl.append(h('p', { class: 'text-[10px] text-fg-subtle px-1 mb-2' }, 'Nada preparado.'));
    }
    for (const f of staged) fileListEl.append(fileRow(f, true));

    fileListEl.append(h('div', { class: 'flex items-center justify-between px-1 mt-3 mb-1' }, [
      h('span', { class: 'text-[10px] text-fg-subtle uppercase' }, `Sin preparar (${unstaged.length})`),
      unstaged.length ? stageAllBtn : null,
    ]));
    if (!unstaged.length) {
      fileListEl.append(h('p', { class: 'text-[10px] text-fg-subtle px-1' }, 'Todo limpio ✓'));
    }
    for (const f of unstaged) fileListEl.append(fileRow(f, false));
  }

  function fileRow(f, staged) {
    const discardBtn = (!staged && !f.untracked) ? h('button', {
      class: 'opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-red-400 px-1 shrink-0 text-[10px]',
      title: 'Descartar cambios (click de nuevo para confirmar)',
      onClick: (e) => {
        e.stopPropagation();
        if (discardBtn.dataset.confirm === '1') {
          doDiscard(f);
        } else {
          discardBtn.dataset.confirm = '1';
          discardBtn.textContent = '¿Seguro?';
          discardBtn.classList.remove('opacity-0');
          setTimeout(() => {
            discardBtn.dataset.confirm = '';
            discardBtn.textContent = '⨯';
          }, 2500);
        }
      },
    }, '⨯') : null;

    return h('div', {
      class: 'flex items-center gap-1 px-1 py-1 rounded hover:bg-bg-elev cursor-pointer text-xs truncate group',
      title: f.path,
      onClick: () => showDiff(f, staged),
    }, [
      h('span', { class: `${statusColor(f)} w-4 shrink-0 font-mono text-[10px]` }, statusLabel(f)),
      h('span', { class: 'truncate flex-1' }, f.path),
      h('button', {
        class: 'opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-fg px-1 shrink-0',
        title: staged ? 'Quitar del stage' : 'Preparar',
        onClick: (e) => { e.stopPropagation(); staged ? doUnstage(f) : doStage(f); },
      }, staged ? '−' : '+'),
      discardBtn,
    ]);
  }

  function statusLabel(f) {
    if (f.untracked) return '??';
    return (f.staged ? f.index : f.workTree) || '?';
  }
  function statusColor(f) {
    if (f.untracked) return 'text-fg-subtle';
    const code = f.staged ? f.index : f.workTree;
    if (code === 'D') return 'text-red-400';
    if (code === 'A' || code === 'M') return 'text-accent-soft';
    return 'text-fg-subtle';
  }

  async function showDiff(f, staged) {
    diffEl.innerHTML = '';
    diffEl.append(h('p', { class: 'text-fg-subtle text-xs' }, 'Cargando diff…'));
    try {
      const diffText = await window.yusepe.git.diff(cwd, f.path, staged);
      diffEl.innerHTML = '';
      if (!diffText.trim()) {
        diffEl.append(h('p', { class: 'text-fg-subtle text-xs' },
          '(sin diferencias de texto — puede ser binario o un archivo nuevo vacío)'));
        return;
      }
      const pre = h('pre', { class: 'hljs' });
      const code = h('code');
      code.innerHTML = highlightCode(diffText, 'diff');
      pre.append(code);
      diffEl.append(pre);
    } catch (err) {
      diffEl.innerHTML = '';
      diffEl.append(h('p', { class: 'text-red-400 text-xs' }, err?.message || String(err)));
    }
  }

  async function doStage(f) {
    try { await window.yusepe.git.stage(cwd, f.path); await refresh(); }
    catch (err) { showError(err); }
  }
  async function doUnstage(f) {
    try { await window.yusepe.git.unstage(cwd, f.path); await refresh(); }
    catch (err) { showError(err); }
  }
  async function doStageAll() {
    try { await window.yusepe.git.stageAll(cwd); await refresh(); }
    catch (err) { showError(err); }
  }
  async function doDiscard(f) {
    try { await window.yusepe.git.discard(cwd, f.path); await refresh(); }
    catch (err) { showError(err); }
  }
  async function doCommit() {
    try {
      await window.yusepe.git.commit(cwd, messageInput.value.trim());
      messageInput.value = '';
      await refresh();
    } catch (err) { showError(err); }
  }
  async function doPush() {
    pushBtn.disabled = true;
    const original = pushBtn.textContent;
    pushBtn.textContent = 'Subiendo…';
    try {
      await window.yusepe.git.push(cwd);
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      pushBtn.disabled = false;
      pushBtn.textContent = original;
    }
  }

  function showError(err) {
    errorEl.textContent = err?.message || String(err);
    errorEl.classList.remove('hidden');
    setTimeout(() => errorEl.classList.add('hidden'), 6000);
  }

  refresh();
}
