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
          DEFAULT: '#7c5cff',
          soft: '#a48bff',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
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
