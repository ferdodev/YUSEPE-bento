/**
 * Aparición al hacer scroll: agrega `in` a cada `.reveal` que entra en
 * pantalla y lo deja de observar (es de una sola vez).
 *
 * El delay escalonado se corta a los 6 elementos: más que eso y el último
 * de una sección aparece cuando ya dejaste de mirarla.
 */
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('in');
    io.unobserve(e.target);
  }
}, { threshold: 0.15 });

document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${Math.min(i, 6) * 40}ms`;
  io.observe(el);
});
