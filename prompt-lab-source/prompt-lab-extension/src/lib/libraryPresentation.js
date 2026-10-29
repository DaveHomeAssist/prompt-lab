export const ARTWORK_ICONS = ['FileText', 'Folder', 'Code', 'Wand2', 'FlaskConical', 'BookmarkPlus', 'Star', 'Layers', 'Braces', 'Zap', 'Clock', 'GitBranch', 'Quote', 'Pin', 'Eye', 'Keyboard', 'LayoutGrid', 'Share2', 'Sun', 'Moon', 'FolderOpen', 'Check'];
export const LIBRARY_LAYOUTS = ['list', 'tiles', 'compact', 'gallery'];
export const MAX_ARTWORK_BYTES = 64 * 1024;

export function safeEmoji(value) {
  if (typeof value !== 'string' || value.length > 64) return '';
  const emoji = value.trim();
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(emoji)];
  return segments.length === 1 && /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)/u.test(emoji) ? emoji : '';
}

export function safeArtwork(value) {
  const image = typeof value?.image === 'string' && value.image.length <= Math.ceil(MAX_ARTWORK_BYTES * 4 / 3) + 64
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.image) ? value.image : '';
  const emoji = safeEmoji(value?.emoji);
  return { icon: ARTWORK_ICONS.includes(value?.icon) ? value.icon : '', image, ...(emoji ? { emoji } : {}) };
}
