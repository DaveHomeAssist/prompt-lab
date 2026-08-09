/**
 * Chain runner — sequential multi-step prompt execution wired into the
 * (previously dormant) run-emitter trace layer. Each chain run is one parent
 * RunRecord (run_type 'chain') with one child span per step (run_type 'llm').
 */
import { startRun, recordBlockedRun } from './runEmitter.js';
import { validateChain } from './chainSchema.js';
import { ensureString } from './utils.js';

const PREVIEW_LIMIT = 4000;

function fillTemplate(template, { varMap = {}, prevOutput, chainInput, stepIndex, isInline }) {
  let text = ensureString(template);
  if (isInline) {
    const hadPrev = /\{\{\s*prev\s*\}\}/i.test(text);
    text = text
      .replace(/\{\{\s*prev\s*\}\}/gi, prevOutput)
      .replace(/\{\{\s*input\s*\}\}/gi, chainInput);
    if (!hadPrev && stepIndex > 0 && prevOutput.trim()) {
      text = `${text}\n\nINPUT:\n${prevOutput}`;
    }
    return text;
  }
  Object.entries(varMap).forEach(([name, spec]) => {
    const value = spec.source === 'prevOutput'
      ? prevOutput
      : spec.source === 'chainInput'
        ? chainInput
        : ensureString(spec.value);
    text = text.replaceAll(`{{${name}}}`, value);
  });
  return text;
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
      parent.error(new Error(error));
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
      stepRun.error(caught, { name: label });
      onStepUpdate?.(index, { status: canceled ? 'canceled' : 'error', label, error });
      results.push({ index, label, status: canceled ? 'canceled' : 'error', error });
      parent.error(caught);
      return { status: canceled ? 'canceled' : 'error', error, results, traceId: parent.trace_id };
    }
  }

  parent.end({ outputs: { steps: results.length } });
  return { status: 'success', results, output: prevOutput, traceId: parent.trace_id };
}
