/**
 * Entrada del sitio. Cada módulo se autoinicializa al importarse: no hay
 * framework ni router, y la página ya viene entera en el HTML — el JS sólo
 * le agrega comportamiento a lo que ya está pintado.
 *
 * `palette.js` va último porque importa las acciones que ejecuta (tema,
 * barajar el bento, reproducir el loop) de los otros módulos.
 */
import './theme.js';
import './reveal.js';
import './bento.js';
import './loop.js';
import './tasks.js';
import './persist.js';
import './palette.js';
