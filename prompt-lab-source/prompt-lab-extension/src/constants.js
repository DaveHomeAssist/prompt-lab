// ── Shared constants ─────────────────────────────────────────────────────────

export const APP_VERSION = '1.7.0';

export const DEFAULT_ENHANCE_MODEL = 'claude-sonnet-4-20250514';
export const DEFAULT_ENHANCE_MAX_TOKENS = 4096;
export const DEFAULT_ENHANCE_TEMPERATURE = 0.4;

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
    label: 'Balanced',
    sys: 'Improve clarity and specificity. Add role, task, format, or constraints only when genuinely absent and needed for execution. Prefer minimal changes over aggressive restructuring. If the prompt is already clear, make only light adjustments.',
  },
  {
    id: 'claude',
    label: 'Claude',
    sys: 'Optimize for Anthropic Claude models. Use XML tags (<instructions>, <context>, <output>) to structure the prompt where helpful. Make the output format explicit. Use direct, clear instructions. Avoid system-message tricks that only work on other models.',
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    sys: 'Optimize for OpenAI GPT-4/o models. Use system/user message structure idioms. Add chain-of-thought prompting ("think step by step") where it improves accuracy. Use JSON output format where appropriate. Avoid XML tags.',
  },
  {
    id: 'image',
    label: 'Image Gen',
    sys: 'Optimize for image generation models (DALL-E, Midjourney, Stable Diffusion). Add style, artistic medium, lighting, composition, camera angle, aspect ratio, and quality modifiers where missing. Keep the subject description faithful to the user\'s intent. Do not change what the user wants to see — only improve how it is described for the model.',
  },
  {
    id: 'code',
    label: 'Code Gen',
    sys: 'Optimize for code generation. Specify language, framework, and runtime where inferrable. Clarify input/output types, error handling expectations, and coding style. Add edge case notes only when they are likely to cause bugs. Do not add requirements the user did not ask for.',
  },
  {
    id: 'concise',
    label: 'Concise',
    sys: 'Make the prompt as short and direct as possible. Remove filler words, redundant instructions, and unnecessary politeness. Preserve all intent, meaning, and constraints exactly. Do not add anything new. The goal is compression, not expansion.',
  },
  {
    id: 'detailed',
    label: 'Detailed',
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
    tags: ['Writing', 'System'],
    collection: 'Handoff Templates',
  },
  // ── Code Generation ───────────────────────────────────────────────────────
  {
    title: 'Code Review',
    original: `You are a senior software engineer performing a thorough code review.

Review the code between <code> tags and provide feedback in these categories:

## Bugs & Correctness
Identify logic errors, off-by-one issues, null/undefined risks, race conditions.

## Security
Flag injection risks, unsafe inputs, missing validation, exposed secrets.

## Performance
Note unnecessary allocations, O(n²) where O(n) is possible, missing caching opportunities.

## Readability
Suggest naming improvements, structural simplifications, or clearer patterns.

## Summary
One paragraph: overall quality assessment and the single highest-priority fix.

Rules:
- Be specific. Reference line numbers or function names.
- Distinguish critical issues from suggestions.
- Do not rewrite the code unless asked.`,
    tags: ['Code', 'Analysis'],
    collection: 'Code',
  },
  {
    title: 'Function Generator',
    original: `Write a function that meets this specification:

Language: {{language}}
Function name: {{function name}}
Purpose: {{description}}

Requirements:
- Include input validation and error handling
- Add a JSDoc/docstring comment explaining parameters and return value
- Handle edge cases (empty input, null, out-of-range)
- Return meaningful error messages, not silent failures

Return only the function. No explanation unless the logic is non-obvious.`,
    tags: ['Code'],
    collection: 'Code',
  },
  // ── Writing & Content ─────────────────────────────────────────────────────
  {
    title: 'Technical Blog Post',
    original: `You are a technical writer creating content for a developer audience.

Write a blog post about {{topic}}.

Structure:
1. Hook — one sentence that frames why this matters now
2. Problem — what the reader is struggling with (2-3 sentences)
3. Solution — the approach, explained step by step with code examples where relevant
4. Tradeoffs — what this approach costs and when not to use it
5. Conclusion — one paragraph summarizing the key takeaway

Tone: Clear, direct, no filler. Write like you're explaining to a smart colleague, not a beginner.
Length: 800-1200 words.
Format: Markdown with code blocks.`,
    tags: ['Writing', 'Creative'],
    collection: 'Writing',
  },
  {
    title: 'Email Drafter',
    original: `Draft a professional email.

Context: {{context}}
Recipient: {{recipient}}
Goal: {{goal}}

Requirements:
- Subject line: clear and specific, under 60 characters
- Opening: one sentence, no pleasantries
- Body: concise, action-oriented, bulleted if multiple points
- Closing: explicit next step with timeline if applicable
- Tone: professional but not stiff

Return the email with Subject: header followed by the body.`,
    tags: ['Writing'],
    collection: 'Writing',
  },
  // ── Analysis & Research ───────────────────────────────────────────────────
  {
    title: 'Decision Matrix',
    original: `You are a strategic analyst helping evaluate options.

Compare the following options: {{options}}

For each option, evaluate against these criteria:
- Cost / effort
- Risk
- Time to implement
- Impact / value
- Reversibility

Output format:
1. Criteria × Options matrix (markdown table, score 1-5)
2. Weighted recommendation (state your assumed weights)
3. Key tradeoff: the single most important tension in this decision
4. Recommendation: one clear sentence

Be specific. Do not hedge unless genuinely uncertain.`,
    tags: ['Analysis', 'Research'],
    collection: 'Analysis',
  },
  {
    title: 'Root Cause Analysis',
    original: `You are a systems analyst investigating an incident.

Problem: {{problem description}}

Apply the "5 Whys" method:
1. State the problem clearly
2. Ask "Why?" and answer with evidence
3. Repeat until you reach a root cause (typically 3-5 levels)
4. Distinguish symptoms from causes at each level

Then provide:
## Root Cause
One sentence.

## Contributing Factors
Bulleted list of conditions that allowed this to happen.

## Recommended Fix
The single highest-leverage intervention.

## Preventive Measures
2-3 changes that would prevent recurrence.

Rules:
- Be specific, not generic
- Reference actual system components when possible
- Do not blame individuals`,
    tags: ['Analysis', 'System'],
    collection: 'Analysis',
  },
  // ── Creative & Ideation ───────────────────────────────────────────────────
  {
    title: 'Product Feature Spec',
    original: `You are a product manager writing a feature specification.

Feature: {{feature name}}
Context: {{product context}}

Write a one-page spec covering:

## Problem
What user pain does this solve? Include evidence or signal.

## Proposal
What we're building, in plain language. No jargon.

## User Stories
3-5 stories in "As a [user], I want [action] so that [benefit]" format.

## Scope
What's in v1. What's explicitly out.

## Success Metrics
2-3 measurable outcomes that prove this worked.

## Open Questions
Decisions that need input before engineering starts.

Keep it concise. One page max. Optimize for alignment, not completeness.`,
    tags: ['Creative', 'Analysis'],
    collection: 'Product',
  },
  {
    title: 'Brainstorm Facilitator',
    original: `You are a creative strategist facilitating a brainstorm session.

Topic: {{topic}}
Constraint: {{constraint}}

Generate ideas in three rounds:

## Round 1 — Obvious (5 ideas)
The straightforward approaches anyone would consider.

## Round 2 — Lateral (5 ideas)
Borrow from adjacent domains. What would [another industry] do?

## Round 3 — Contrarian (3 ideas)
Invert assumptions. What if the opposite of the obvious answer is correct?

For each idea: one sentence description + one sentence on why it might work.

End with: "Strongest signal" — which single idea has the most unexplored potential and why.`,
    tags: ['Creative'],
    collection: 'Creative',
  },
  // ── Prompt Engineering ────────────────────────────────────────────────────
  {
    title: 'System Prompt Builder',
    original: `You are an expert prompt engineer designing a system prompt.

Target model: {{model}}
Use case: {{use case}}
User type: {{audience}}

Build a system prompt that includes:
1. Role definition (who the model is)
2. Task scope (what it should and should not do)
3. Output format (how to structure responses)
4. Constraints (hard rules, safety boundaries)
5. Tone guidance (voice, formality level)

Rules for the system prompt you generate:
- Be specific over generic
- Include at least one "do not" constraint
- Define output format explicitly
- Keep under 500 tokens
- Test against edge cases mentally before finalizing

Return only the system prompt, ready to paste.`,
    tags: ['System', 'Writing'],
    collection: 'Prompt Engineering',
  },
].map(seed => ({
  ...seed,
  enhanced: seed.original,
  notes: seed.notes || `PromptLab starter prompt — ${seed.collection || 'General'}.`,
  tags: seed.tags || ['Other'],
  collection: seed.collection || '',
  variants: [],
}));

export const T = {
  dark: {
    bg: 'bg-[#06060a]', surface: 'bg-[#101018]', border: 'border-white/10', borderHov: 'hover:border-white/20',
    input: 'bg-[#14141d] border-white/10', text: 'text-[#f0ede6]', textSub: 'text-[#b3afaa]', textMuted: 'text-[#7c7a76]',
    textBody: 'text-[#d7d2cb]', textAlt: 'text-[#c7c2bb]', btn: 'bg-white/[0.04] hover:bg-white/[0.08]',
    header: 'bg-[#0a0a0f]/95 backdrop-blur-sm border-white/10', modalBg: 'bg-black/70', modal: 'bg-[#101018] border-white/10',
    notesBg: 'bg-[#c4a44a]/10 border-[#c4a44a]/25', notesText: 'text-[#d4bc73]', codeBlock: 'bg-[#06060a]',
    dangerBtn: 'bg-red-950 hover:bg-red-900 text-red-400',
    dangerGhost: 'border border-red-900/70 bg-transparent text-red-300 hover:border-red-500/60 hover:bg-red-950/40',
    scoreGood: 'text-green-400', scoreBad: 'text-gray-700',
    diffAdd: 'bg-green-900/60 text-green-200', diffDel: 'bg-red-900/60 text-red-300 line-through opacity-60', diffEq: 'text-gray-300',
    draggable: 'bg-[#14141d] border-white/10 hover:border-orange-400/50',
    dropZone: 'border-white/10 border-dashed bg-white/[0.02]', dropOver: 'border-orange-400/50 border-dashed bg-orange-500/10',
    composedBlock: 'bg-[#14141d] border-white/10', pill: 'bg-white/[0.04] text-[#d7d2cb]',
  },
  light: {
    bg: 'bg-slate-100', surface: 'bg-white', border: 'border-slate-300', borderHov: 'hover:border-slate-400',
    input: 'bg-white border-slate-300', text: 'text-slate-900', textSub: 'text-slate-600', textMuted: 'text-slate-500',
    textBody: 'text-slate-700', textAlt: 'text-slate-600', btn: 'bg-slate-100 hover:bg-slate-200',
    header: 'bg-slate-50/95 backdrop-blur-sm border-slate-200', modalBg: 'bg-black/40', modal: 'bg-white border-slate-200',
    notesBg: 'bg-amber-100/80 border-amber-300', notesText: 'text-amber-800', codeBlock: 'bg-slate-50',
    dangerBtn: 'bg-red-100 hover:bg-red-200 text-red-700',
    dangerGhost: 'border border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-50',
    scoreGood: 'text-emerald-700', scoreBad: 'text-slate-400',
    diffAdd: 'bg-emerald-100 text-emerald-800', diffDel: 'bg-red-100 text-red-600 line-through', diffEq: 'text-slate-700',
    draggable: 'bg-white border-slate-200 hover:border-orange-400',
    dropZone: 'border-slate-300 border-dashed bg-slate-100/60', dropOver: 'border-orange-400 border-dashed bg-orange-100/70',
    composedBlock: 'bg-white border-slate-200', pill: 'bg-slate-100 text-slate-700',
  },
};
