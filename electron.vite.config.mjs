import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, defineConfig, externalizeDepsPlugin } from 'electron-vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Sin prefijo (no VITE_) para que loadEnv() de Vite no lo descarte —
// electron-vite solo trae automáticamente los prefijados. Se inyecta acá
// mismo, "a mano", en el bundle del proceso main vía `define`.
const env = loadEnv('production', __dirname, '');

/**
 * Configuración de electron-vite.
 *  - main / preload: electron-vite ya los compila como lib (CJS) por defecto.
 *    Solo indicamos el `input` y dejamos el resto al plugin oficial.
 *  - renderer: Vite estándar con Tailwind vía PostCSS (tailwindcss/postcss.config.js).
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // La API key de Pexels se "quema" en el bundle compilado del proceso
    // main (nunca llega al renderer) — ver src/main/pexelsOps.js. Así el
    // usuario final no necesita configurar nada: viene lista desde el
    // .env con el que se compiló la app.
    define: {
      'process.env.APIKEY_PEXELS': JSON.stringify(env.APIKEY_PEXELS || ''),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.js'),
        },
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.js'),
        },
      },
    },
  },

  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/renderer/shared'),
      },
    },
  },
});
