// Desktop highlight shortcut. The same parser feeds Settings and the Rust
// registrar (highlight.rs). Canonical form is lowercase modifiers, then one
// letter or digit: "alt+command+E" or "alt+control+E".

export const HIGHLIGHT_SETTINGS_KEY = 'pl2-highlight-shortcut';

const MODIFIERS = new Map([
  ['alt', 'alt'],
  ['option', 'alt'],
  ['shift', 'shift'],
  ['ctrl', 'control'],
  ['control', 'control'],
  ['cmd', 'command'],
  ['command', 'command'],
  ['meta', 'command'],
  ['super', 'command'],
  ['commandorcontrol', 'commandorcontrol'],
]);

const ORDER = ['alt', 'shift', 'control', 'command'];

export function isMacPlatform(platform = '') {
  return /Mac|iPhone|iPad/i.test(String(platform || ''));
}

export function defaultHighlightAccelerator(mac) {
  return mac ? 'alt+command+E' : 'alt+control+E';
}

export function formatHighlightAccelerator(accelerator) {
  return String(accelerator || '').split('+').map((part) => {
    if (part === 'alt') return 'Alt';
    if (part === 'shift') return 'Shift';
    if (part === 'control') return 'Ctrl';
    if (part === 'command') return 'Command';
    return part;
  }).join('+');
}

export function parseHighlightAccelerator(input, { mac = false } = {}) {
  const parts = String(input || '').split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { ok: false, error: 'Use a modifier plus a key, such as Alt+Command+E.' };
  }
  const keyRaw = parts[parts.length - 1];
  if (keyRaw.length !== 1 || !/[a-z0-9]/i.test(keyRaw)) {
    return { ok: false, error: 'The shortcut key must be a single letter or digit.' };
  }
  const mods = [];
  for (const part of parts.slice(0, -1)) {
    const mapped = MODIFIERS.get(part.toLowerCase());
    if (!mapped) return { ok: false, error: `Unknown modifier "${part}".` };
    const mod = mapped === 'commandorcontrol' ? (mac ? 'command' : 'control') : mapped;
    if (!mods.includes(mod)) mods.push(mod);
  }
  if (!mods.length) return { ok: false, error: 'Add at least one modifier.' };
  const accelerator = [...ORDER.filter((mod) => mods.includes(mod)), keyRaw.toUpperCase()].join('+');
  return { ok: true, accelerator, mods, key: keyRaw.toUpperCase() };
}

export function readHighlightSettings(storage = globalThis.localStorage, platform) {
  const mac = typeof platform === 'boolean' ? platform : isMacPlatform(platform ?? globalThis.navigator?.platform);
  const fallback = defaultHighlightAccelerator(mac);
  let stored = {};
  try {
    stored = JSON.parse(storage?.getItem(HIGHLIGHT_SETTINGS_KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  const parsed = parseHighlightAccelerator(stored.accelerator || fallback, { mac });
  return {
    enabled: stored.enabled !== false,
    accelerator: parsed.ok ? parsed.accelerator : fallback,
  };
}

export function writeHighlightSettings(value, storage = globalThis.localStorage) {
  const mac = isMacPlatform(globalThis.navigator?.platform);
  const parsed = parseHighlightAccelerator(value?.accelerator || defaultHighlightAccelerator(mac), { mac });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const next = { enabled: value?.enabled !== false, accelerator: parsed.accelerator };
  try {
    storage?.setItem(HIGHLIGHT_SETTINGS_KEY, JSON.stringify(next));
    return { ok: true, value: next };
  } catch {
    return { ok: false, error: 'The shortcut could not be saved on this device.', value: next };
  }
}
