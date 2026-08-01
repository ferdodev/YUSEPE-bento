/**
 * El bento del hero: la terminal que teclea sola y el barajado de tiles.
 *
 * Barajar reordena con `order` de CSS Grid en vez de mover nodos: el
 * navegador anima el cambio de posición con la transición de `transform`
 * que ya tienen los tiles, y el DOM no se toca.
 */
const CMDS = ['git status', 'npm test', 'claude "refactor the grid"', 'lazygit', 'ybento bandeja'];

const out = document.querySelector('[data-typed]');
const grid = document.querySelector('[data-bento]');
const tiles = [...grid.children];

let cmd = 0;

function type() {
  const text = CMDS[cmd++ % CMDS.length];
  let i = 0;
  const char = setInterval(() => {
    out.textContent = text.slice(0, ++i);
    if (i < text.length) return;
    clearInterval(char);
    setTimeout(type, 1900);
  }, 70);
}

export function shuffleBento() {
  const orders = tiles.map((_, i) => i + 1).sort(() => Math.random() - 0.5);
  tiles.forEach((t, i) => { t.style.order = orders[i]; });
}

document.querySelector('[data-shuffle]').addEventListener('click', shuffleBento);
type();
