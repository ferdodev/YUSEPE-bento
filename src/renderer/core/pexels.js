/**
 * src/renderer/core/pexels.js
 * --------------------------------------------------------------
 * Wrapper del buscador de fondos de pantalla (Pexels) para
 * components/wallpaperPicker.js. La búsqueda real ocurre en el
 * proceso main (ver main/pexelsOps.js) — acá solo se invoca IPC,
 * la API key nunca llega al renderer.
 * --------------------------------------------------------------
 */
export async function searchPhotos(query, page = 1) {
  return window.yusepe.pexels.search(query, page);
}
