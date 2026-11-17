// Fuzzy match for the command palette. A contiguous hit outranks a
// subsequence, and a hit in the label outranks one that only appears later
// in the detail text. Score 0 means "not a match".

export function fuzzyScore(query, text) {
  const q = String(query || '').trim().toLowerCase();
  const raw = String(text || '');
  const t = raw.toLowerCase();
  if (!q || !t) return 0;
  const label = t.split('\n')[0];
  let score = 0;
  if (t.includes(q)) score += 120;
  if (label.includes(q)) score += 80;
  let qi = 0;
  let streak = 0;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] === q[qi]) {
      streak += 1;
      score += 2 + streak;
      if (i === 0 || /[\s/([{-]/.test(t[i - 1])) score += 3;
      qi += 1;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : 0;
}

export function buildPaletteCatalog({ actions = [], prompts = [], settings = [] } = {}) {
  const items = [];
  for (const action of actions) {
    if (!action || typeof action.action !== 'function') continue;
    items.push({
      kind: 'action',
      label: action.label,
      hint: action.hint || '',
      detail: '',
      haystack: action.label,
      action: action.action,
    });
  }
  const seen = new Set();
  for (const prompt of prompts) {
    if (!prompt || seen.has(prompt.id)) continue;
    seen.add(prompt.id);
    const title = String(prompt.title || 'Untitled prompt');
    const detail = String(prompt.enhanced || prompt.original || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const tags = Array.isArray(prompt.tags) ? prompt.tags.join(' ') : '';
    items.push({
      kind: 'prompt',
      id: prompt.id,
      label: title,
      hint: '',
      detail,
      haystack: `${title}\n${detail}\n${tags}\n${prompt.original || ''}`,
      action: prompt.action,
    });
  }
  for (const setting of settings) {
    if (!setting || typeof setting.action !== 'function') continue;
    items.push({
      kind: 'setting',
      label: setting.label,
      hint: setting.hint || '',
      detail: setting.detail || '',
      haystack: `${setting.label}\n${setting.detail || ''}\n${setting.keywords || ''}`,
      action: setting.action,
    });
  }
  return items;
}

const KIND_ORDER = { action: 0, prompt: 1, setting: 2 };

export function searchPaletteItems(items, query) {
  const list = Array.isArray(items) ? items : [];
  const q = String(query || '').trim();
  if (!q) {
    const actions = list.filter((item) => item.kind === 'action');
    const prompts = list.filter((item) => item.kind === 'prompt').slice(0, 8);
    const settings = list.filter((item) => item.kind === 'setting');
    return [...actions, ...prompts, ...settings];
  }
  return list
    .map((item) => ({ item, score: fuzzyScore(q, item.haystack || item.label) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.item.label.localeCompare(b.item.label))
    .slice(0, 40)
    .map((row) => row.item);
}

export const PALETTE_GROUP_LABELS = Object.freeze([
  ['action', 'Actions'],
  ['prompt', 'Prompts'],
  ['setting', 'Settings'],
]);
