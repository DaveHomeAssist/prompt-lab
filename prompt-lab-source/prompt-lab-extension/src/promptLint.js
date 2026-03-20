const COMPLEX_THRESHOLD = 420;

export const LINT_FIXES = {
  role_section: '\nRole:\nYou are an expert assistant for this task.\n',
  goal_section: '\nGoal:\nState the exact outcome you want in one sentence.\n',
  constraints_section: '\nConstraints:\n- Keep response concise.\n- Follow user tone.\n- Include only relevant details.\n',
  output_format_section: '\nOutput Format:\n- Use markdown headings.\n- Provide bullets for key points.\n',
  example_block: '\nExample:\nInput: <short sample input>\nOutput: <short sample output>\n',
};

function lineFromIndex(text, idx) {
  if (typeof text !== 'string' || idx <= 0) return 1;
  return text.slice(0, idx).split('\n').length;
}

function hasGoalNearTop(text) {
  const top = text.split('\n').slice(0, 6).join(' ').toLowerCase();
  return /\b(goal|intent|objective|task|outcome|i need|i want|please|create|generate|write|explain|analyze)\b/.test(top);
}

function hasRole(text) {
  return /\b(you are|act as|your role|persona|as an expert|as a)\b/i.test(text);
}

function hasConstraints(text) {
  return /\b(constraints?|must|must not|do not|don't|avoid|limit|max(?:imum)?|minimum|exactly|only|never|always)\b/i.test(text);
}

function hasOutputFormat(text) {
  return /\b(output format|respond with|return as|json|markdown|table|list|bullet points|sections?)\b/i.test(text);
}

function hasExample(text) {
  return /\b(example|sample input|sample output|few-shot|input:\s|output:\s)\b/i.test(text);
}

function issue(id, message, severity, text, idx = 0) {
  const line = lineFromIndex(text, idx);
  return {
    id,
    message,
    severity,
    line,
    range: { start: idx, end: idx },
  };
}

export function lintPrompt(prompt, opts = {}) {
  const text = typeof prompt === 'string' ? prompt : '';
  const trimmed = text.trim();
  if (!trimmed) return [];

  const complexityThreshold = Number.isFinite(opts.complexityThreshold)
    ? Math.max(180, opts.complexityThreshold)
    : COMPLEX_THRESHOLD;

  const issues = [];

  if (!hasGoalNearTop(text)) {
    issues.push(issue(
      'goal_near_top',
      'Add an explicit goal/intent sentence near the top.',
      'warning',
      text,
      0,
    ));
  }

  const nonTrivial = text.length > 140 || text.split('\n').length > 4;
  if (nonTrivial && !hasRole(text)) {
    issues.push(issue(
      'role_definition',
      'Consider defining a role (for example: "You are ...") for this task.',
      'info',
      text,
      0,
    ));
  }

  if (!hasConstraints(text)) {
    issues.push(issue(
      'constraints',
      'Add constraints (length, style, guardrails, or required/forbidden content).',
      'info',
      text,
      0,
    ));
  }

  if (!hasOutputFormat(text)) {
    issues.push(issue(
      'output_format',
      'Describe the expected output format (list, JSON, markdown sections, etc.).',
      'warning',
      text,
      0,
    ));
  }

  if (text.length > complexityThreshold && !hasExample(text)) {
    issues.push(issue(
      'example_io',
      'Complex prompts benefit from at least one example input/output block.',
      'info',
      text,
      text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length,
    ));
  }

  return issues;
}

export function applyLintQuickFix(text, ruleId) {
  const base = typeof text === 'string' ? text : '';
  const map = {
    goal_near_top: LINT_FIXES.goal_section,
    role_definition: LINT_FIXES.role_section,
    constraints: LINT_FIXES.constraints_section,
    output_format: LINT_FIXES.output_format_section,
    example_io: LINT_FIXES.example_block,
  };
  const patch = map[ruleId];
  if (!patch) return base;

  if (ruleId === 'goal_near_top' || ruleId === 'role_definition') {
    return `${patch.trim()}\n\n${base}`.trim();
  }
  return `${base.trim()}\n${patch}`.trim();
}
