/**
 * Chain definition schema — a chain lives on a library entry as metadata.chain.
 *
 * Two step shapes:
 *   { entryId, varMap }    — run a library prompt; varMap fills its {{vars}}:
 *                            { VAR: { source: 'prevOutput'|'chainInput'|'literal', value? } }
 *   { label, template }    — inline prompt text. Conventions: {{prev}} is replaced
 *                            with the previous step's output ({{input}} with the
 *                            chain input); a non-first inline step without {{prev}}
 *                            gets the previous output appended as an INPUT block.
 */
import { ensureString } from './utils.js';

export const CHAIN_VERSION = 1;
const VAR_SOURCES = ['prevOutput', 'chainInput', 'literal'];

function normalizeVarMap(value) {
  if (!value || typeof value !== 'object') return {};
  const map = {};
  Object.entries(value).forEach(([name, spec]) => {
    const varName = ensureString(name).trim();
    if (!varName || !spec || typeof spec !== 'object') return;
    const source = VAR_SOURCES.includes(spec.source) ? spec.source : null;
    if (!source) return;
    map[varName] = source === 'literal'
      ? { source, value: ensureString(spec.value) }
      : { source };
  });
  return map;
}

export function normalizeChainStep(step) {
  if (!step || typeof step !== 'object') return null;
  const entryId = ensureString(step.entryId).trim();
  if (entryId) {
    return { entryId, varMap: normalizeVarMap(step.varMap) };
  }
  const template = ensureString(step.template);
  if (!template.trim()) return null;
  return {
    label: ensureString(step.label).trim() || 'Step',
    template,
  };
}

export function validateChain(value) {
  if (!value || typeof value !== 'object') return null;
  const steps = (Array.isArray(value.steps) ? value.steps : [])
    .map(normalizeChainStep)
    .filter(Boolean)
    .slice(0, 20);
  if (steps.length === 0) return null;
  return { version: CHAIN_VERSION, steps };
}

export function isChainEntry(entry) {
  return Boolean(validateChain(entry?.metadata?.chain));
}
