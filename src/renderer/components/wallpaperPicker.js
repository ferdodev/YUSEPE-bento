/**
 * src/renderer/components/wallpaperPicker.js
 * --------------------------------------------------------------
 * Sección de fondo de pantalla del workspace activo, embebida dentro
 * del modal de Configuración (ver components/settings.js): imagen
 * propia (desde disco) o buscador de Pexels, + transparencia de
 * las terminales sobre esa imagen.
 * --------------------------------------------------------------
 */
import { h, debounce } from '../utils/dom.js';
import { svgIcon } from '../utils/icons.js';
import { state } from '../core/state.js';
import { ProfileManager } from '../core/profileManager.js';
import { searchPhotos } from '../core/pexels.js';

/** Devuelve el nodo de la sección. Si no hay workspace activo, un aviso. */
export function buildWallpaperSection() {
  const profile = state.profile;
  if (!profile) {
    return h('p', { class: 'text-xs text-fg-subtle' },
      'Abrí un espacio de trabajo para personalizar su fondo.');
  }

  const currentEl = h('div', {});
  const uploadError = h('p', { class: 'text-red-400 text-[10px] mt-1 hidden' });

  const uploadBtn = h('button', {
    class: 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-line hover:bg-bg-elev transition',
    onClick: doUploadLocal,
  }, [svgIcon('upload', { size: 14 }), h('span', {}, 'Subir imagen propia')]);

  const searchInput = h('input', {
    type: 'text',
    placeholder: 'Buscar en Pexels (ej. "forest", "minimal")…',
    class: 'w-full bg-bg-elev border border-line rounded-md px-3 py-2 text-sm mt-3 focus:outline-none focus:ring-1 focus:ring-accent',
  });
  const resultsEl = h('div', { class: 'grid grid-cols-4 gap-2 mt-2 max-h-[28vh] overflow-y-auto content-start' });

  searchInput.addEventListener('input', debounce(doSearch, 400));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  renderCurrent();

  return h('div', {}, [currentEl, uploadBtn, uploadError, searchInput, resultsEl]);

  async function doUploadLocal() {
    uploadError.classList.add('hidden');
    try {
      const picked = await window.yusepe.dialog.pickImage();
      if (!picked) return;
      await applyWallpaper({
        url: picked.dataUrl,
        photographerName: null,
        photographerUrl: null,
      });
    } catch (err) {
      uploadError.textContent = err?.message || String(err);
      uploadError.classList.remove('hidden');
    }
  }

  async function doSearch() {
    const query = searchInput.value.trim();
    resultsEl.innerHTML = '';
    if (!query) return;
    resultsEl.append(h('p', { class: 'text-fg-subtle text-xs col-span-4' }, 'Buscando…'));
    try {
      const photos = await searchPhotos(query);
      resultsEl.innerHTML = '';
      if (!photos.length) {
        resultsEl.append(h('p', { class: 'text-fg-subtle text-xs col-span-4' }, 'Sin resultados.'));
        return;
      }
      for (const photo of photos) {
        resultsEl.append(h('button', {
          class: 'aspect-video rounded-md overflow-hidden border border-line hover:ring-2 hover:ring-accent transition bg-bg-elev',
          title: `Foto de ${photo.photographerName} en Pexels`,
          onClick: () => applyPexelsPhoto(photo),
        }, [
          h('img', { src: photo.thumb, class: 'w-full h-full object-cover', alt: '' }),
        ]));
      }
    } catch (err) {
      resultsEl.innerHTML = '';
      resultsEl.append(h('p', { class: 'text-red-400 text-xs col-span-4' }, err?.message || String(err)));
    }
  }

  /**
   * La foto se pide al CDN de Pexels a la medida REAL de la pantalla
   * (resolución física: px CSS × devicePixelRatio). Las variantes fijas
   * (`large2x` = 1880px) quedan cortas en pantallas 2K/4K y el `cover`
   * las estira borrosas; el CDN redimensiona el original al ancho pedido
   * (sin upscalear más allá del original) y sirve un archivo mucho más
   * liviano que el original crudo.
   */
  function optimalUrl(photo) {
    if (!photo.original) return photo.full;
    const px = Math.ceil(window.screen.width * (window.devicePixelRatio || 1));
    return `${photo.original}?auto=compress&cs=tinysrgb&w=${px}`;
  }

  async function applyPexelsPhoto(photo) {
    await applyWallpaper({
      url: optimalUrl(photo),
      photographerName: photo.photographerName,
      photographerUrl: photo.photographerUrl,
    });
  }

  async function applyWallpaper({ url, photographerName, photographerUrl }) {
    const saved = await ProfileManager.setWallpaper(profile.id, {
      url,
      photographerName,
      photographerUrl,
      opacity: profile.wallpaper?.opacity ?? 0.55,
      zoom: profile.wallpaper?.zoom ?? 1,
    });
    profile.wallpaper = saved.wallpaper;
    renderCurrent();
  }

  function renderCurrent() {
    currentEl.innerHTML = '';
    const wp = profile.wallpaper;
    if (!wp) {
      currentEl.append(h('p', { class: 'text-xs text-fg-subtle mb-2' },
        'Este workspace no tiene fondo de pantalla configurado.'));
      return;
    }

    const preview = h('div', {
      class: 'w-full h-28 rounded-md bg-cover bg-center border border-line mb-2',
      style: `background-image: url(${wp.url})`,
    });
    currentEl.append(preview);

    if (wp.photographerName) {
      currentEl.append(h('a', {
        href: wp.photographerUrl,
        class: 'text-[10px] text-fg-subtle hover:underline',
        onClick: (e) => { e.preventDefault(); window.yusepe.shell.openExternal(wp.photographerUrl); },
      }, `Foto de ${wp.photographerName} en Pexels`));
    }

    const opacityLabel = h('span', { class: 'text-xs text-fg-subtle' },
      `Transparencia de terminales: ${Math.round(wp.opacity * 100)}%`);
    const opacitySlider = h('input', {
      type: 'range', min: '0.15', max: '1', step: '0.05', value: String(wp.opacity),
      class: 'w-full accent-accent',
    });
    opacitySlider.addEventListener('input', debounce(async () => {
      const opacity = Number(opacitySlider.value);
      opacityLabel.textContent = `Transparencia de terminales: ${Math.round(opacity * 100)}%`;
      const saved = await ProfileManager.setWallpaper(profile.id, { ...profile.wallpaper, opacity });
      profile.wallpaper = saved.wallpaper;
    }, 150));

    // Zoom sobre el encuadre `cover`: 100% = la imagen justa para cubrir
    // el grid (comportamiento de siempre); más = acercarse. Se aplica en
    // vivo por el mismo camino que la transparencia (setWallpaper emite
    // profile:wallpaper-changed y bentoGrid re-aplica).
    const zoom = Number(wp.zoom) || 1;
    const zoomLabel = h('span', { class: 'text-xs text-fg-subtle' },
      `Zoom del fondo: ${Math.round(zoom * 100)}%`);
    const zoomSlider = h('input', {
      type: 'range', min: '1', max: '2', step: '0.05', value: String(zoom),
      class: 'w-full accent-accent',
    });
    zoomSlider.addEventListener('input', debounce(async () => {
      const z = Number(zoomSlider.value);
      zoomLabel.textContent = `Zoom del fondo: ${Math.round(z * 100)}%`;
      const saved = await ProfileManager.setWallpaper(profile.id, { ...profile.wallpaper, zoom: z });
      profile.wallpaper = saved.wallpaper;
    }, 150));

    const removeBtn = h('button', {
      class: 'text-xs px-2.5 py-1 rounded-md border border-line hover:bg-bg-elev transition mt-2',
      onClick: async () => {
        const saved = await ProfileManager.setWallpaper(profile.id, null);
        profile.wallpaper = saved.wallpaper;
        renderCurrent();
      },
    }, 'Quitar fondo');

    currentEl.append(
      h('div', { class: 'mt-2' }, [opacityLabel, opacitySlider]),
      h('div', { class: 'mt-1' }, [zoomLabel, zoomSlider]),
      removeBtn,
    );
  }
}
