/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{js,html}',
  ],
  // highlight.js genera clases `hljs-*` dinámicamente en tiempo de
  // ejecución (nunca aparecen como texto literal en el código fuente),
  // así que Tailwind las purgaba del CSS final al no "verlas" en el
  // escaneo de `content`. Este patrón las preserva siempre.
  safelist: [
    { pattern: /^hljs(-.*)?$/ },
  ],
  theme: {
    extend: {
      colors: {
        // Paleta minimalista: neutros + un acento.
        // Los tokens de superficie/texto son variables CSS (ver style.css)
        // para poder alternar claro/oscuro sin tocar cada clase de utilidad.
        bg: {
          DEFAULT: 'var(--color-bg)',
          soft: 'var(--color-bg-soft)',
          elev: 'var(--color-bg-elev)',
        },
        line: 'var(--color-line)',
        fg: {
          DEFAULT: 'var(--color-fg)',
          soft: 'var(--color-fg-soft)',
          muted: 'var(--color-fg-muted)',
          subtle: 'var(--color-fg-subtle)',
        },
        accent: {
          // Azul de sistema de macOS (#0A84FF dark / #007AFF light),
          // resuelto por tema vía variables CSS. Ver style.css.
          // Usamos los canales RGB + <alpha-value> (no el hex --color-accent)
          // para que los modificadores de opacidad de Tailwind funcionen:
          // `bg-accent/20` sobre un hex genera un color inválido y no pinta.
          // A opacidad plena da el mismo color (rgb(10,132,255) === #0a84ff).
          DEFAULT: 'rgb(var(--color-accent-rgb) / <alpha-value>)',
          soft: 'var(--color-accent-soft)',
        },
      },
      fontFamily: {
        // San Francisco real del sistema en macOS (system-ui / -apple-system);
        // fallback razonable en otras plataformas. Sin webfonts.
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Menlo', 'Cascadia Code', 'monospace'],
      },
      borderRadius: {
        bento: '18px',
      },
      boxShadow: {
        bento: '0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
};
