/**
 * Demo de persistencia: cambiás de workspace y el contador del proceso
 * sigue subiendo. El contador es único y global a propósito — es
 * justamente lo que se quiere mostrar: el tiempo no se reinicia porque
 * el proceso nunca murió.
 */
const WS = [
  {
    name: 'frontend-app', live: true, tick: '[hmr] update',
    lines: [['u', '~/dev/app ❯ npm run dev'], ['ok', '✓ compiled · watching…'], ['dim', '[hmr] update /src/layout.js']],
  },
  {
    name: 'api-server', live: true, tick: 'GET /health 200',
    lines: [['u', '~/dev/api ❯ node server.js'], ['ok', '✓ API on :4000'], ['dim', 'GET /health 200 · 3ms']],
  },
  {
    name: 'notas', live: false, tick: null,
    lines: [['u', '~/notes ❯ vim ideas.md'], ['dim', '-- INSERT --']],
  },
];

const COLOR = { u: 'var(--accent)', ok: 'var(--green)', dim: 'var(--fg-dim)' };

const tabsEl = document.querySelector('[data-ws-tabs]');
const viewEl = document.querySelector('[data-ws-view]');
let cur = 0;
let secs = 0;

function renderTabs() {
  tabsEl.innerHTML = WS.map((w, i) => `
    <button class="ws${i === cur ? ' on' : ''}" data-i="${i}">
      ${w.live ? '<span class="live"></span>' : ''}${w.name}
    </button>`).join('');
}

function renderView() {
  const w = WS[cur];
  const lines = w.lines.map(([c, t]) => `<div style="color:${COLOR[c]}">${t}</div>`).join('');
  const tick = w.tick
    ? `<div style="color:var(--fg-dim)">${w.tick} · <span class="grn">+${secs}s</span>
         <span style="color:var(--fg-faint)">(vivo en background)</span></div>`
    : '';
  viewEl.innerHTML = `${lines}${tick}<div style="color:var(--accent)">❯ <span class="cursor blu"></span></div>`;
}

tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.ws');
  if (!btn) return;
  cur = Number(btn.dataset.i);
  renderTabs();
  renderView();
});

setInterval(() => { secs++; renderView(); }, 1000);
renderTabs();
renderView();
