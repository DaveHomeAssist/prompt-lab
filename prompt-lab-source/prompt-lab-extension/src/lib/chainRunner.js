/**
 * Chain runner — sequential multi-step prompt execution wired into the
 * (previously dormant) run-emitter trace layer. Each chain run is one parent
 * RunRecord (run_type 'chain') with one child span per step (run_type 'llm').
 */
import { startRun, recordBlockedRun } from './runEmitter.js';
import { validateChain } from './chainSchema.js';
import { ensureString } from './utils.js';

const PREVIEW_LIMIT = 4000;
const INLINE_PLACEHOLDER = /\{\{\s*(prev|input)\s*\}\}/gi;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Placeholders are filled in one pass, and each value comes from a callback.
// A string replacement would read `$&`, `$$`, `` $` `` and `$'` inside chain
// input or model output as replacement syntax, and a second pass would expand
// any `{{...}}` text a value happens to contain.
function fillTemplate(template, { varMap = {}, prevOutput, chainInput, stepIndex, isInline }) {
  let text = ensureString(template);
  if (isInline) {
    const hadPrev = /\{\{\s*prev\s*\}\}/i.test(text);
    text = text.replace(INLINE_PLACEHOLDER, (_token, name) => (
      name.toLowerCase() === 'prev' ? prevOutput : chainInput
    ));
    if (!hadPrev && stepIndex > 0 && prevOutput.trim()) {
      text = `${text}\n\nINPUT:\n${prevOutput}`;
    }
    return text;
  }
  const values = new Map(Object.entries(varMap).map(([name, spec]) => [
    `{{${name}}}`,
    spec.source === 'prevOutput'
      ? prevOutput
      : spec.source === 'chainInput'
        ? chainInput
        : ensureString(spec.value),
  ]));
  if (values.size === 0) return text;
  const tokens = [...values.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return text.replace(new RegExp(tokens.join('|'), 'g'), (token) => values.get(token));
}

/**
 * @param {object} opts
 * @param {object} opts.chainEntry     library entry carrying metadata.chain
 * @param {(id: string) => object|null} opts.resolveEntry
 * @param {string} [opts.input]        chain input text
 * @param {(req: {prompt, provider, model, signal}) => Promise<string>} opts.execute
 * @param {(payload: {prompt?, variables?}) => {matches: Array}} [opts.scan]  PII gate
 * @param {AbortSignal} [opts.signal]
 * @param {(index: number, update: object) => void} [opts.onStepUpdate]
 */
export async function runChain({
  chainEntry,
  resolveEntry,
  input = '',
  execute,
  scan,
  signal,
  onStepUpdate,
}) {
  const chain = validateChain(chainEntry?.metadata?.chain);
  if (!chain) {
    return { status: 'error', error: 'This entry has no valid chain definition.', results: [], traceId: null };
  }
  if (typeof execute !== 'function') {
    return { status: 'error', error: 'Chain runner needs an execute function.', results: [], traceId: null };
  }

  const parent = startRun({
    run_type: 'chain',
    provider: 'chain',
    model: ensureString(chainEntry.title) || 'chain',
  });
  const results = [];
  let prevOutput = '';

  for (let index = 0; index < chain.steps.length; index += 1) {
    const step = chain.steps[index];
    const isInline = !step.entryId;
    const sourceEntry = isInline ? null : resolveEntry?.(step.entryId);
    const label = isInline
      ? step.label
      : ensureString(sourceEntry?.title) || `Step ${index + 1}`;

    if (!isInline && !sourceEntry) {
      const error = `Chain step ${index + 1} references a prompt that no longer exists.`;
      onStepUpdate?.(index, { status: 'error', label, error });
      results.push({ index, label, status: 'error', error });
      parent.error(new Error(error));
      return { status: 'error', error, results, traceId: parent.trace_id };
    }

    const template = isInline
      ? step.template
      : ensureString(sourceEntry.enhanced).trim() || ensureString(sourceEntry.original);
    const prompt = fillTemplate(template, {
      varMap: step.varMap,
      prevOutput,
      chainInput: ensureString(input),
      stepIndex: index,
      isInline,
    });

    if (signal?.aborted) {
      const error = 'Chain canceled.';
      onStepUpdate?.(index, { status: 'canceled', label });
      results.push({ index, label, status: 'canceled' });
      parent.cancel({ reason: error });
      return { status: 'canceled', results, traceId: parent.trace_id };
    }

    if (typeof scan === 'function') {
      const { matches } = scan({ prompt });
      if (Array.isArray(matches) && matches.length > 0) {
        const error = `Chain step ${index + 1} blocked: sensitive data detected.`;
        recordBlockedRun({
          run_type: 'llm',
          trace_id: parent.trace_id,
          parent_run_id: parent.run_id,
          reason: error,
        });
        onStepUpdate?.(index, { status: 'blocked', label, error });
        results.push({ index, label, status: 'blocked', error });
        parent.error(new Error(error));
        return { status: 'blocked', error, results, traceId: parent.trace_id };
      }
    }

    const stepRun = startRun({
      run_type: 'llm',
      trace_id: parent.trace_id,
      parent_run_id: parent.run_id,
      provider: ensureString(step.provider) || 'default',
      model: ensureString(step.model) || 'default',
    });
    onStepUpdate?.(index, { status: 'running', label, prompt });

    try {
      const output = ensureString(await execute({
        prompt,
        provider: step.provider,
        model: step.model,
        signal,
      }));
      stepRun.end({ name: label, outputs: { text: output.slice(0, PREVIEW_LIMIT) } });
      onStepUpdate?.(index, { status: 'success', label, output });
      results.push({ index, label, status: 'success', prompt, output });
      prevOutput = output;
    } catch (caught) {
      const canceled = signal?.aborted || caught?.name === 'AbortError';
      const error = canceled ? 'Chain canceled.' : (caught?.message || 'Chain step failed.');
      if (canceled) stepRun.cancel({ name: label, reason: error });
      else stepRun.error(caught, { name: label });
      onStepUpdate?.(index, { status: canceled ? 'canceled' : 'error', label, error });
      results.push({ index, label, status: canceled ? 'canceled' : 'error', error });
      if (canceled) parent.cancel({ reason: error });
      else parent.error(caught);
      return { status: canceled ? 'canceled' : 'error', error, results, traceId: parent.trace_id };
    }
  }

  parent.end({ outputs: { steps: results.length } });
  return { status: 'success', results, output: prevOutput, traceId: parent.trace_id };
}
