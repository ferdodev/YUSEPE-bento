/**
 * src/renderer/components/settings.js
 * --------------------------------------------------------------
 * Modal de Configuración: tema claro/oscuro, notificaciones del loop
 * y fondo de pantalla del workspace activo.
 * --------------------------------------------------------------
 */
import { h } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { openModal, closeModal } from './modal.js';
import { getTheme, applyTheme } from '../core/theme.js';
import { buildWallpaperSection } from './wallpaperPicker.js';
import { SOUNDS, getSound, setSound, playSound } from '../core/loopNotify.js';

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

  function buildSoundSection() {
    let currentId = getSound();

    const rows = SOUNDS.map((sound) => {
      const radio = h('input', {
        type: 'radio',
        name: 'loop-sound',
        value: sound.id,
        class: 'w-3 h-3 cursor-pointer',
        style: 'accent-color: var(--color-accent)',
      });
      if (sound.id === currentId) radio.checked = true;

      radio.addEventListener('change', () => {
        currentId = sound.id;
        setSound(sound.id);
      });

      const previewBtn = sound.id !== 'none'
        ? h('button', {
          class: 'ml-auto text-[10px] text-fg-muted hover:text-fg transition px-1',
          title: 'Escuchar',
          onClick: (e) => { e.preventDefault(); playSound(sound.id); },
        }, '▶')
        : null;

      return h('label', {
        class: 'flex items-center gap-2 py-1 cursor-pointer select-none',
      }, [radio, h('span', { class: 'text-xs text-fg' }, sound.label), ...(previewBtn ? [previewBtn] : [])]);
    });

    return h('div', {}, [
      h('div', { class: 'flex items-center justify-between mb-1' }, [
        h('span', { class: 'text-sm text-fg' }, 'Notificaciones del loop'),
      ]),
      h('p', { class: 'text-[11px] text-fg-subtle mb-2 leading-relaxed' },
        'Sonido cuando un agente te escribe a vos en el loop. Usá ▶ para preescuchar.'),
      h('div', { class: 'space-y-0.5' }, rows),
    ]);
  }

  const body = h('div', {}, [
    themeRow,
    h('div', { class: 'border-t border-line my-4' }),
    buildSoundSection(),
    h('div', { class: 'border-t border-line my-4' }),
    h('label', { class: 'text-sm text-fg block mb-1' }, 'Fondo de este espacio'),
    buildWallpaperSection(),
  ]);

  openModal({ title: 'Configuración', body, size: 'lg' });
}
