// {{name}} and {{name|default}} placeholders.
// Names match the characters fillTemplateVars already replaces. A leading
// space ({{ name }}) is not a placeholder. Defaults apply to every use of
// that name, including a bare {{name}} later in the same text.

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;

export function parsePromptVariables(text) {
  if (typeof text !== 'string' || !text.includes('{{')) return [];
  const byName = new Map();
  for (const match of text.matchAll(PLACEHOLDER)) {
    const inner = match[1];
    const bar = inner.indexOf('|');
    const rawName = bar === -1 ? inner : inner.slice(0, bar);
    if (!rawName || rawName[0] === ' ' || rawName.includes('\n')) continue;
    const name = rawName.trimEnd();
    if (!name) continue;
    const defaultValue = bar === -1 ? null : inner.slice(bar + 1);
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, { name, defaultValue });
    } else if (existing.defaultValue == null && defaultValue != null) {
      existing.defaultValue = defaultValue;
    }
  }
  return [...byName.values()];
}

export function variableNames(text) {
  return parsePromptVariables(text).map((variable) => variable.name);
}

const STORAGE_KEY = 'pl2-prompt-variable-values';
const MAX_RECENT = 5;

function hashString(value) {
  let hash = 5381;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export function variablePromptKey(promptId, template) {
  if (promptId) return `id:${promptId}`;
  return `text:${hashString(template)}`;
}

function memoryStorage() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function readAll(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function readRecentVariables(promptKey, storage = memoryStorage()) {
  if (!storage || !promptKey) return {};
  const row = readAll(storage)[promptKey];
  if (!row || typeof row !== 'object') return {};
  const out = {};
  for (const [name, entry] of Object.entries(row)) {
    if (!entry || typeof entry !== 'object') continue;
    const recent = Array.isArray(entry.recent)
      ? entry.recent.filter((value) => typeof value === 'string').slice(0, MAX_RECENT)
      : [];
    out[name] = {
      last: typeof entry.last === 'string' ? entry.last : (recent[0] || ''),
      recent,
    };
  }
  return out;
}

export function rememberVariableValues(promptKey, values, storage = memoryStorage()) {
  if (!storage || !promptKey) return;
  const all = readAll(storage);
  const row = { ...(all[promptKey] || {}) };
  for (const [name, value] of Object.entries(values || {})) {
    const text = String(value ?? '');
    const prev = Array.isArray(row[name]?.recent) ? row[name].recent.filter((item) => typeof item === 'string') : [];
    row[name] = { last: text, recent: [text, ...prev.filter((item) => item !== text)].slice(0, MAX_RECENT) };
  }
  all[promptKey] = row;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // A full or blocked store must not stop the run or copy that already has values.
  }
}

export function initialVariableValues(variables, recent = {}) {
  const values = {};
  for (const variable of variables || []) {
    const saved = recent[variable.name];
    if (saved && typeof saved.last === 'string') values[variable.name] = saved.last;
    else values[variable.name] = variable.defaultValue ?? '';
  }
  return values;
}

// Empty fields fall back to the declared default. A typed value, including one
// remembered from last time, wins.
export function valuesForFill(variables, entered = {}) {
  const out = {};
  for (const variable of variables || []) {
    const typed = entered[variable.name];
    if (typeof typed === 'string' && typed.length > 0) out[variable.name] = typed;
    else if (variable.defaultValue != null) out[variable.name] = variable.defaultValue;
    else out[variable.name] = '';
  }
  return out;
}
