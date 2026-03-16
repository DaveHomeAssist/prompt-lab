// ── Shared constants ─────────────────────────────────────────────────────────

export const TAG_COLORS = {
  Writing: 'bg-blue-600', Code: 'bg-green-600', Research: 'bg-purple-600',
  Analysis: 'bg-yellow-600', Creative: 'bg-pink-600', System: 'bg-red-600',
  'Role-play': 'bg-orange-600', Other: 'bg-gray-500',
};
export const ALL_TAGS = Object.keys(TAG_COLORS);

// ── Enhancement mode policy ──────────────────────────────────────────────────
// INTENT_POLICY is prepended to every mode's system prompt. It guards against
// the engine inventing medium, audience, tone, or subject when the user's
// prompt doesn't specify them. Keep it short — it competes for attention with
// the mode-specific instruction.
const INTENT_POLICY = [
  'Preserve the user\'s original intent, subject, and scope exactly.',
  'Do not invent or assume a medium (email, blog, Notion, etc.), audience, or tone the user did not specify.',
  'If the prompt uses contextual references like "the", "this", or "that", keep them — do not replace with placeholders.',
  'Only add structure the prompt genuinely lacks. Shorter prompts are not automatically worse.',
].join(' ');

export const MODES = [
  {
    id: 'balanced',
    label: '⚖️ Balanced',
    sys: 'Improve clarity and specificity. Add role, task, format, or constraints only when genuinely absent and needed for execution. Prefer minimal changes over aggressive restructuring. If the prompt is already clear, make only light adjustments.',
  },
  {
    id: 'claude',
    label: '🟣 Claude',
    sys: 'Optimize for Anthropic Claude models. Use XML tags (<instructions>, <context>, <output>) to structure the prompt where helpful. Make the output format explicit. Use direct, clear instructions. Avoid system-message tricks that only work on other models.',
  },
  {
    id: 'chatgpt',
    label: '🟢 ChatGPT',
    sys: 'Optimize for OpenAI GPT-4/o models. Use system/user message structure idioms. Add chain-of-thought prompting ("think step by step") where it improves accuracy. Use JSON output format where appropriate. Avoid XML tags.',
  },
  {
    id: 'image',
    label: '🎨 Image Gen',
    sys: 'Optimize for image generation models (DALL-E, Midjourney, Stable Diffusion). Add style, artistic medium, lighting, composition, camera angle, aspect ratio, and quality modifiers where missing. Keep the subject description faithful to the user\'s intent. Do not change what the user wants to see — only improve how it is described for the model.',
  },
  {
    id: 'code',
    label: '💻 Code Gen',
    sys: 'Optimize for code generation. Specify language, framework, and runtime where inferrable. Clarify input/output types, error handling expectations, and coding style. Add edge case notes only when they are likely to cause bugs. Do not add requirements the user did not ask for.',
  },
  {
    id: 'concise',
    label: '✂️ Concise',
    sys: 'Make the prompt as short and direct as possible. Remove filler words, redundant instructions, and unnecessary politeness. Preserve all intent, meaning, and constraints exactly. Do not add anything new. The goal is compression, not expansion.',
  },
  {
    id: 'detailed',
    label: '📝 Detailed',
    sys: 'Expand the prompt with richer context, concrete examples, explicit edge cases, and clear constraints. Ground every addition in what the user actually asked for — do not introduce new goals, audiences, or requirements. The expansion should make the existing intent more executable, not change the intent.',
  },
];

/**
 * Build the full system prompt for an enhancement request.
 * Centralizes assembly so it can be tested independently of the hook.
 */
export function buildSystemPrompt(modeId, tags) {
  const modeObj = MODES.find((item) => item.id === modeId) || MODES[0];
  const tagList = Array.isArray(tags) ? tags.join(', ') : tags;
  return `You are an expert prompt engineer. ${INTENT_POLICY} ${modeObj.sys}
Return ONLY valid JSON, no markdown, no backticks:
{"enhanced":"...","variants":[{"label":"...","content":"..."}],"notes":"...","assumptions":["..."],"tags":["..."]}
Produce 2 variants. In "notes", explain what you changed and why. In "assumptions", list anything you added that was not explicitly stated in the original prompt (medium, audience, tone, structure, constraints). If you added nothing, return an empty array. Available tags: ${tagList}.`;
}

export { INTENT_POLICY };

export const DEFAULT_LIBRARY_SEEDS = [
  {
    title: 'Transcript Summary - Markdown',
    original: `You are a conversation analyst specializing in context extraction and knowledge transfer.

Task:
Read the transcript between <transcript> tags and produce a structured context summary so a new assistant can continue seamlessly.

Output requirements:
- Use markdown headings (##) exactly as section titles.
- Omit any section with no relevant content.
- Be concise, but preserve concrete specifics (exact names, versions, values, tools, dates when present).
- Use the user's terminology.
- Do not add facts not present in the transcript.
- Do not speculate or editorialize.
- Preserve chronology when it affects understanding.

Sections:
## Identity & Background
## Project / Topic
## Key Decisions Made
## Current State
## Open Items & Next Steps
## Preferences & Constraints
## Important Context & Nuance

For "Key Decisions Made" and "Open Items & Next Steps," use single-level bullet points.`,
  },
  {
    title: 'Transcript Summary - Strict JSON',
    original: `You are a conversation analyst specializing in context extraction and knowledge transfer.

Task:
Read the transcript between <transcript> tags and extract continuation-ready context.

Return ONLY valid JSON with this schema:
{
  "identity_background": string | null,
  "project_topic": string | null,
  "key_decisions_made": string[] | null,
  "current_state": string | null,
  "open_items_next_steps": string[] | null,
  "preferences_constraints": string | null,
  "important_context_nuance": string | null
}

Rules:
- Use exact terms from the transcript.
- Include concrete specifics (names, versions, values, tools, dates) when present.
- No invented facts, no interpretation beyond explicit content.
- If a section has no content, set it to null.
- Preserve chronology where relevant.`,
  },
  {
    title: 'Transcript Summary - High Recall',
    original: `You are a conversation continuity analyst.

Goal:
Produce a handoff summary that minimizes context loss across sessions.

Input:
Transcript between <transcript> tags.

Output:
Use markdown with these headings (omit empty sections):
## Identity & Background
## Project / Topic
## Key Decisions Made
## Current State
## Open Items & Next Steps
## Preferences & Constraints
## Important Context & Nuance

Priority:
1) Completeness of actionable context
2) Exact technical details (names, versions, commands, constraints)
3) Chronology where decision flow matters

Hard rules:
- Do not add information not explicitly in the transcript.
- Do not paraphrase away project-specific terminology.
- Keep writing concise and professional.`,
  },
  {
    title: 'Transcript Summary - Engineering Brief',
    original: `You are a conversation analyst creating an engineer-ready continuation brief.

Read <transcript> and produce a structured summary with these sections (omit empty):
## Identity & Background
## Project / Topic
## Key Decisions Made
## Current State
## Open Items & Next Steps
## Preferences & Constraints
## Important Context & Nuance

Emphasize:
- Technical stack, files, versions, commands, and architecture details
- Confirmed decisions vs pending decisions
- Risks, edge cases, corrected mistakes, and clarified assumptions
- Exact wording for project-specific terms

Rules:
- No invented facts
- No speculation
- Concise but specific
- Preserve chronological order when it affects implementation context`,
  },
  {
    title: 'Transcript Summary - Ultra Concise',
    original: `You are a context-transfer analyst.

From <transcript>, generate a minimal but sufficient bootstrap summary for a new session.

Format:
## Identity & Background
## Project / Topic
## Key Decisions Made
## Current State
## Open Items & Next Steps
## Preferences & Constraints
## Important Context & Nuance

Constraints:
- Omit empty sections
- Keep each section short and dense
- Include exact names/versions/values
- Use user terminology
- No assumptions, no added facts`,
  },
].map(seed => ({
  ...seed,
  enhanced: seed.original,
  notes: 'Default PromptLab library seed for transcript/context handoff.',
  tags: ['Writing', 'System'],
  collection: 'Handoff Templates',
  variants: [],
}));

export const T = {
  dark: {
    bg: 'bg-gray-950', surface: 'bg-gray-900', border: 'border-gray-800', borderHov: 'hover:border-gray-700',
    input: 'bg-gray-900 border-gray-700', text: 'text-gray-100', textSub: 'text-gray-500', textMuted: 'text-gray-600',
    textBody: 'text-gray-300', textAlt: 'text-gray-400', btn: 'bg-gray-800 hover:bg-gray-700',
    header: 'bg-gray-900 border-gray-800', modalBg: 'bg-black/70', modal: 'bg-gray-900 border-gray-700',
    notesBg: 'bg-amber-950/40 border-amber-900/50', notesText: 'text-amber-400', codeBlock: 'bg-gray-950',
    dangerBtn: 'bg-red-950 hover:bg-red-900 text-red-400',
    scoreGood: 'text-green-400', scoreBad: 'text-gray-700',
    diffAdd: 'bg-green-900/60 text-green-200', diffDel: 'bg-red-900/60 text-red-300 line-through opacity-60', diffEq: 'text-gray-300',
    draggable: 'bg-gray-800 border-gray-700 hover:border-violet-500',
    dropZone: 'border-gray-700 border-dashed bg-gray-900/30', dropOver: 'border-violet-500 border-dashed bg-violet-950/20',
    composedBlock: 'bg-gray-800 border-gray-700', pill: 'bg-gray-800 text-gray-300',
  },
  light: {
    bg: 'bg-gray-50', surface: 'bg-white', border: 'border-gray-200', borderHov: 'hover:border-gray-300',
    input: 'bg-white border-gray-300', text: 'text-gray-900', textSub: 'text-gray-500', textMuted: 'text-gray-400',
    textBody: 'text-gray-700', textAlt: 'text-gray-500', btn: 'bg-gray-100 hover:bg-gray-200',
    header: 'bg-white border-gray-200', modalBg: 'bg-black/40', modal: 'bg-white border-gray-200',
    notesBg: 'bg-amber-50 border-amber-200', notesText: 'text-amber-600', codeBlock: 'bg-gray-50',
    dangerBtn: 'bg-red-50 hover:bg-red-100 text-red-600',
    scoreGood: 'text-green-600', scoreBad: 'text-gray-300',
    diffAdd: 'bg-green-100 text-green-700', diffDel: 'bg-red-100 text-red-500 line-through', diffEq: 'text-gray-700',
    draggable: 'bg-gray-50 border-gray-200 hover:border-violet-400',
    dropZone: 'border-gray-300 border-dashed bg-gray-100/50', dropOver: 'border-violet-400 border-dashed bg-violet-50',
    composedBlock: 'bg-gray-50 border-gray-200', pill: 'bg-gray-100 text-gray-600',
  },
};
