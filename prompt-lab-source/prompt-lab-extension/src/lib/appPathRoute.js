/**
 * The hosted app is a hash router (/app/#/library). Vercel rewrites every
 * /app/* path to the same index.html, so a typed or shared path link such as
 * /app/compare used to render Write while the address bar kept the path
 * (V-03). Convert the path into the matching hash route before the router
 * mounts. Unknown views still become a hash route, where useRouteSync shows
 * its "Page not found" notice instead of swapping silently.
 */
const PATH_ALIASES = Object.freeze({
  write: '',
  editor: '',
  create: '',
  notebook: 'scratch',
  pad: 'scratch',
  history: 'evaluate',
  runs: 'evaluate',
  compose: 'composer',
  dual: 'split',
});

export function appPathToHashUrl({ pathname = '', search = '', hash = '' } = {}, base = '/app') {
  const prefix = `${base}/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/+$/, '');
  if (!rest || rest === 'index.html') return null;
  // An explicit hash route wins over the path, e.g. /app/foo#/library.
  if (/^#\/./.test(hash)) return `${prefix}${search}${hash}`;
  const [first, ...tail] = rest.split('/').map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const head = Object.prototype.hasOwnProperty.call(PATH_ALIASES, first.toLowerCase())
    ? PATH_ALIASES[first.toLowerCase()]
    : first.toLowerCase();
  const route = [head, ...tail].filter(Boolean).map(encodeURIComponent).join('/');
  return `${prefix}${search}#/${route}`;
}

export function redirectAppPathToHash(win = typeof window !== 'undefined' ? window : null) {
  if (!win?.location || !win.history?.replaceState) return false;
  const next = appPathToHashUrl(win.location);
  if (!next) return false;
  try {
    win.history.replaceState(win.history.state, '', next);
    return true;
  } catch {
    return false;
  }
}
