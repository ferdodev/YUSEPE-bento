/**
 * src/renderer/components/settings.js
 * --------------------------------------------------------------
 * Modal de Configuración: tema claro/oscuro y fondo de pantalla del
 * workspace activo (buscador de Pexels — ver components/wallpaperPicker.js;
 * la API key viene compilada en la app, no requiere configuración).
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { openModal, closeModal } from './modal.js';
import { getTheme, applyTheme } from '../core/theme.js';
import { buildWallpaperSection } from './wallpaperPicker.js';

export function openSettings() {
  function themeButton(mode, iconName, label) {
    const active = getTheme() === mode;
    return h('button', {
      class: `inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition ${
        active
          ? 'border-accent bg-accent/20 text-accent-soft'
          : 'border-line hover:bg-bg-elev text-fg-soft'
      }`,
      onClick: () => { applyTheme(mode); closeModal(); openSettings(); },
    }, [svgIcon(iconName, { size: 14 }), h('span', {}, label)]);
  }

  const themeRow = h('div', { class: 'flex items-center justify-between mb-4' }, [
    h('span', { class: 'text-sm text-fg' }, 'Tema'),
    h('div', { class: 'flex gap-1' }, [
      themeButton('dark', 'moon', 'Oscuro'),
      themeButton('light', 'sun', 'Claro'),
    ]),
  ]);

  const body = h('div', {}, [
    themeRow,
    h('div', { class: 'border-t border-line my-4' }),
    h('label', { class: 'text-sm text-fg block mb-1' }, 'Fondo de este espacio'),
    buildWallpaperSection(),
  ]);

  openModal({ title: 'Configuración', body, size: 'lg' });
}
