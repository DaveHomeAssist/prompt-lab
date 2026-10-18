export const ARTWORK_ICONS = ['FileText', 'Folder', 'Code', 'Wand2', 'FlaskConical', 'BookmarkPlus', 'Star', 'Layers', 'Braces', 'Zap'];
export const LIBRARY_LAYOUTS = ['list', 'tiles', 'compact', 'gallery'];
export const MAX_ARTWORK_BYTES = 64 * 1024;

export function safeArtwork(value) {
  const image = typeof value?.image === 'string' && value.image.length <= Math.ceil(MAX_ARTWORK_BYTES * 4 / 3) + 64
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.image) ? value.image : '';
  return { icon: ARTWORK_ICONS.includes(value?.icon) ? value.icon : '', image };
}

export function collectionContains(parent, path) {
  return path === parent || path?.startsWith(`${parent}/`);
}

export function collectionTree(collections) {
  const paths = new Set();
  for (const collection of collections) {
    const segments = collection.split('/');
    for (let index = 1; index <= segments.length; index += 1) paths.add(segments.slice(0, index).join('/'));
  }
  return [...paths].sort((a, b) => a.localeCompare(b)).map(path => ({
    path, label: path.split('/').at(-1), depth: path.split('/').length - 1,
    hasChildren: [...paths].some(other => other.startsWith(`${path}/`)),
  }));
}
