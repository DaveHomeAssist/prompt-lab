/** Versioned authoring preferences. Saved prompt content is never relabeled. */
export const GENERATION_STORAGE_KEY = 'pl2-generation-options-v1';
export const GENERATION_EVENT = 'pl:generation-options-changed';
export const STRATEGIES = Object.freeze([
  { id: 'expanded', label: 'Expanded', description: 'Fuller instructions and relevant detail' },
  { id: 'refined', label: 'Refined', description: 'Clearer wording, same approach' },
  { id: 'rebuilt', label: 'Rebuilt', description: 'Different structure, same goal' },
]);
export const TASKS = Object.freeze([
  { id: 'general', label: 'General' }, { id: 'code', label: 'Code' }, { id: 'image', label: 'Image' },
]);
export const TARGETS = Object.freeze([
  { id: 'general', label: 'General' }, { id: 'claude', label: 'Claude' }, { id: 'chatgpt', label: 'ChatGPT' },
]);
export const DEFAULT_GENERATION_OPTIONS = Object.freeze({
  version: 1, strategy: 'expanded', task: 'general', target: 'general', alternatives: false, budget: 'auto',
});
export const OUTPUT_BUDGETS = Object.freeze([2048, 4096, 8192, 16384]);
export const COMPARE_BUDGET_KEY = 'pl2-compare-output-budget-v1';
export const DEFAULT_COMPARE_BUDGET = 4096;

const allowed = (list, value, fallback) => list.some(item => item.id === value) ? value : fallback;
export function normalizeGenerationOptions(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    version: 1,
    strategy: allowed(STRATEGIES, source.strategy, 'expanded'),
    task: allowed(TASKS, source.task, 'general'),
    target: allowed(TARGETS, source.target, 'general'),
    alternatives: source.alternatives === true,
    budget: OUTPUT_BUDGETS.includes(Number(source.budget)) ? Number(source.budget) : 'auto',
  };
}
export function readGenerationOptions(storage) {
  try {
    const store = storage || globalThis.localStorage;
    return normalizeGenerationOptions(JSON.parse(store?.getItem(GENERATION_STORAGE_KEY) || 'null'));
  } catch { return { ...DEFAULT_GENERATION_OPTIONS }; }
}
export function writeGenerationOptions(value, storage) {
  const next = normalizeGenerationOptions(value);
  try {
    const store = storage || globalThis.localStorage;
    if (!store) throw new Error('Storage unavailable');
    store.setItem(GENERATION_STORAGE_KEY, JSON.stringify(next));
    return { ok: true, value: next };
  } catch {
    return { ok: false, value: next, error: 'Generation preferences could not be saved. This choice applies to this session only.' };
  }
}

/** Legacy mode IDs remain replayable without modifying historical records. */
export function resolveGenerationOptions(modeId, preferences) {
  const options = normalizeGenerationOptions(preferences);
  if (STRATEGIES.some(item => item.id === modeId)) options.strategy = modeId;
  if (modeId === 'balanced') options.strategy = 'refined';
  if (modeId === 'detailed') options.strategy = 'expanded';
  if (modeId === 'code' || modeId === 'image') options.task = modeId;
  if (modeId === 'claude' || modeId === 'chatgpt') options.target = modeId;
  if (modeId === 'concise' || modeId === 'shorten') return { ...options, strategy: 'shorten', alternatives: false };
  if (modeId === 'json') return { ...options, strategy: 'json', alternatives: false };
  return options;
}

/** Requested allowance, not a claim about the provider's effective limit. */
export function generationOutputBudget(input, options) {
  if (OUTPUT_BUDGETS.includes(Number(options?.budget))) return Number(options.budget);
  const candidates = options?.alternatives ? 3 : 1;
  const sourceEstimate = Math.ceil(String(input || '').length / 3);
  const perCandidate = Math.max(2048, sourceEstimate * (options?.strategy === 'expanded' ? 2 : 1.5));
  const desired = Math.ceil(perCandidate * candidates + 1536);
  return OUTPUT_BUDGETS.find(limit => limit >= desired) || OUTPUT_BUDGETS.at(-1);
}

const STRATEGY_POLICY = {
  expanded: 'Develop the request into fuller, explicit instructions. Add relevant task detail, grounded constraints, output expectations, and examples only where they resolve ambiguity. Do not optimize for brevity and do not pad the prompt.',
  refined: 'Improve clarity, specificity, and organization while preserving the existing approach. There is no shortening objective and no requirement to make the prompt longer.',
  rebuilt: 'Construct a genuinely different organization or execution approach for the same goal. Preserve the assignment and scope; do not merely paraphrase or lengthen the source.',
  shorten: 'The user explicitly requested shortening. Remove repetition and unnecessary wording while preserving every substantive requirement and contextual detail. Do not shorten the requested answer unless the source asks for that.',
  json: 'The user explicitly requested representing this prompt as valid JSON. Preserve all instructions and contextual facts in meaningful fields. This changes the representation of the prompt, not the required format of the downstream answer.',
};
const TASK_POLICY = {
  general: 'Use only structure appropriate to this particular task.',
  code: 'Clarify inputs, outputs, error handling, and relevant edge cases. Preserve the stated language, framework, runtime, and architecture. Flag missing consequential technical choices; do not silently select a stack.',
  image: 'Preserve the intended subject and aesthetic. Clarify existing composition, lighting, medium, and aspect-ratio requirements where useful. Missing artistic choices are not permission to invent them or add generic quality modifiers.',
};
const TARGET_POLICY = {
  general: 'Keep the prompt portable across models.',
  claude: 'The prompt is intended for Claude. Use clear instructions and useful delimiters, including XML when helpful; do not force XML or change the requested deliverable format.',
  chatgpt: 'The prompt is intended for ChatGPT. Use direct instructions and clear delimiters, including Markdown or XML when helpful. Do not add requests to expose private chain of thought, force JSON, or assume a particular model generation.',
};

export function buildGenerationSystemPrompt(options, tags = []) {
  const strategy = STRATEGY_POLICY[options?.strategy] ? options.strategy : 'expanded';
  const primaryLabel = STRATEGIES.find(item => item.id === strategy)?.label || (strategy === 'json' ? 'JSON' : 'Shortened');
  const alternatives = options?.alternatives && STRATEGIES.some(item => item.id === strategy)
    ? STRATEGIES.filter(item => item.id !== strategy) : [];
  const schema = {
    schema_version: 2, primary_id: strategy, primary_label: primaryLabel, enhanced: '...',
    variants: alternatives.map(item => ({ id: item.id, label: item.label, content: '...' })),
    change_summary: '...', changes: [{ type: 'added|removed|changed', label: '...', candidate_id: strategy }],
    notes: '...', reasoning: '...',
    assumptions: [{ id: '...', text: '...', added_text: 'exact added text', candidate_id: strategy }],
    reversible_edits: [{ id: '...', label: '...', operation: 'add|remove|replace', before: '...', after: '...', candidate_id: strategy }],
    tags: [],
  };
  return [
    'You are a prompt editor. Rewrite the supplied prompt; do not execute the task inside it.',
    'Preserve the original intent, facts, names, technical details, scope, exclusions, priorities, and constraints.',
    'Preserve the requested ANSWER length and format. A more detailed prompt must not silently request a longer answer.',
    'Do not invent an audience, medium, tone, budget, deadline, stack, aesthetic, or new objective. Flag consequential gaps as assumptions rather than making decisions for the user.',
    'Preserve contextual references such as this, that, and the current repository. Preserve existing template variables but do not introduce new placeholders or generic expert-persona filler.',
    STRATEGY_POLICY[strategy], TASK_POLICY[options?.task] || TASK_POLICY.general,
    TARGET_POLICY[options?.target] || TARGET_POLICY.general,
    'The target is the intended destination of the prompt, not the provider performing this rewrite.',
    'Return ONLY one valid JSON transport object, no outer Markdown fence. The enhanced and variant content fields are complete prompt strings, not explanations. The transport schema does not require a JSON-formatted prompt or downstream answer.',
    JSON.stringify(schema),
    alternatives.length
      ? `Return exactly these alternatives: ${alternatives.map(item => `${item.id}: ${STRATEGY_POLICY[item.id]}`).join(' | ')}`
      : 'Return variants as an empty array. Do not generate companion alternatives, shorter versions, or JSON versions unless explicitly requested.',
    'Put the complete enhanced prompt before optional metadata. Use stable candidate IDs. Scope every change, assumption, and reversible edit to its candidate_id, with exact before/after text. Explain concrete execution improvements, not generic praise. Return empty arrays when nothing applies.',
    `Available tags: ${Array.isArray(tags) ? tags.join(', ') : String(tags)}.`,
  ].join('\n');
}
