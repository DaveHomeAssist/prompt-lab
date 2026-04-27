export const STORAGE_KEY = 'pl_mobile_app_state_v2';

export const tabMeta = {
  library: { label: 'Library', icon: 'L', title: 'Library', subtitle: 'Find and reuse saved prompts' },
  compose: { label: 'Compose', icon: '+', title: 'Compose', subtitle: 'Refine, run, and save' },
  pad: { label: 'Pad', icon: 'P', title: 'Pad', subtitle: 'Notes that become prompts' },
};

export const sampleVoiceCapture = 'Turn this quick product idea into a reusable launch checklist prompt with risks and owners.';

export const seedPrompts = [
  {
    id: 'p1',
    title: 'Code review - senior reviewer',
    collection: 'Engineering',
    tags: ['review', 'code'],
    uses: 47,
    body: 'Act as a senior engineer. Review the following code for correctness, clarity, maintainability, and hidden edge cases. Return findings by severity, then include a short patch strategy.',
    enhanced: 'Act as a senior engineer conducting a production-readiness review. Identify correctness bugs, security risks, maintainability issues, missing tests, and edge cases. Prioritize findings by severity and include concrete file-level fixes.',
  },
  {
    id: 'p2',
    title: 'Weekly digest summarizer',
    collection: 'Writing',
    tags: ['summary', 'weekly'],
    uses: 23,
    body: 'Summarize the following content into a punchy weekly digest with wins, risks, and next actions.',
    enhanced: 'Transform the following source material into a crisp weekly digest. Use sections for wins, risks, decisions, next actions, and open questions. Keep the tone direct and executive-readable.',
  },
  {
    id: 'p3',
    title: 'Bug repro extractor',
    collection: 'Engineering',
    tags: ['bug', 'qa'],
    uses: 12,
    body: 'Given a bug report, extract minimal reproduction steps, expected behavior, actual behavior, environment, and likely owner.',
    enhanced: 'Analyze this bug report and produce a minimal reproduction package: steps, preconditions, expected result, actual result, environment, suspected component, severity, and missing diagnostic data.',
  },
  {
    id: 'p4',
    title: 'Cold-email opener',
    collection: 'Sales',
    tags: ['email', 'b2b'],
    uses: 8,
    body: 'Write a warm opening line for a B2B outreach email based on this company context.',
    enhanced: 'Write three concise B2B outreach openers using the provided company context. Avoid hype, reference a concrete signal, and keep each opener under 28 words.',
  },
];

export const seedPads = [
  {
    id: 'n1',
    title: 'Q2 planning scratchpad',
    updated: 'Today',
    body: 'Mobile should feel capture-first. The quickest path is: capture idea -> refine prompt -> save result. Reorderable tabs should let power users put Pad first if that is their workflow.',
  },
  {
    id: 'n2',
    title: 'Research synthesis notes',
    updated: 'Yesterday',
    body: 'Try a Pad-to-Composer bridge. Long notes can become structured prompts without asking users to copy and paste between surfaces.',
  },
];

export function sanitizeTabOrder(order) {
  const valid = Object.keys(tabMeta);
  const next = Array.isArray(order) ? order.filter((id) => valid.includes(id)) : [];
  valid.forEach((id) => {
    if (!next.includes(id)) next.push(id);
  });
  return next;
}

export function defaultMobileState() {
  return {
    activeTab: 'library',
    tabOrder: ['library', 'compose', 'pad'],
    search: '',
    collection: 'All',
    detailPromptId: null,
    detailPadId: null,
    composerText: 'Turn these meeting notes into a decision log with owners, dates, and risks.',
    output: '',
    streaming: false,
    sheet: null,
    voiceStatus: 'idle',
    voiceTranscript: '',
    lastUsedPromptId: 'p1',
    lastComposerAction: 'refine',
    lastSavedTarget: 'library',
    lastProvider: '',
    lastModel: '',
    prompts: seedPrompts,
    pads: seedPads,
  };
}

export function loadMobileState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultMobileState();
    const parsed = JSON.parse(raw);
    return {
      ...defaultMobileState(),
      ...parsed,
      prompts: Array.isArray(parsed.prompts) && parsed.prompts.length ? parsed.prompts : seedPrompts,
      pads: Array.isArray(parsed.pads) && parsed.pads.length ? parsed.pads : seedPads,
      tabOrder: sanitizeTabOrder(parsed.tabOrder),
      streaming: false,
      sheet: null,
      voiceStatus: 'idle',
    };
  } catch (_error) {
    return defaultMobileState();
  }
}

export function persistMobileState(state) {
  const snapshot = {
    ...state,
    streaming: false,
    sheet: null,
    voiceStatus: 'idle',
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function shortText(value, length) {
  const text = String(value || '').trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

export function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractSection(text, heading) {
  const pattern = new RegExp(`(?:^|\\n)${heading}:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Task|Requirements|Constraints|Context|Output|Format):|$)`, 'i');
  return text.match(pattern)?.[1]?.trim() || '';
}

function parseBullets(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function parsePromptIntent(text) {
  const source = String(text || '').trim();
  const taskSection = extractSection(source, 'Task');
  const requirements = parseBullets(extractSection(source, 'Requirements'));
  const task = compact(taskSection || source.replace(/^You are helping produce a high-quality result\.\s*/i, ''));

  return {
    task: shortText(task, 150),
    requirements,
  };
}
