export const ARTWORK_ICONS = ['FileText', 'Folder', 'Code', 'Wand2', 'FlaskConical', 'BookmarkPlus', 'Star', 'Layers', 'Braces', 'Zap'];
export const LIBRARY_LAYOUTS = ['list', 'tiles', 'compact', 'gallery'];
export const MAX_ARTWORK_BYTES = 64 * 1024;

export function safeArtwork(value) {
  const image = typeof value?.image === 'string' && value.image.length <= Math.ceil(MAX_ARTWORK_BYTES * 4 / 3) + 64
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.image) ? value.image : '';
  return { icon: ARTWORK_ICONS.includes(value?.icon) ? value.icon : '', image };
}
