/**
 * Prompt-quality corpus loader (DHA-11).
 *
 * A small, versioned set of representative raw prompts, each carrying the
 * objective properties `scorePrompt` and `lintPrompt` should produce for it.
 * Expectations are values computed from those functions, not prose judgements,
 * so a scoring or lint change fails the corpus test rather than drifting.
 *
 * Every case is synthetic: no user data, no credentials, no provider text, and
 * nothing that requires a network call — the corpus is safe to run anywhere.
 */

import corpusV1 from '../corpus/prompt-quality-corpus.v1.json';

export const PROMPT_CORPUS_VERSION = corpusV1.version;

const SCORE_SIGNALS = Object.freeze(['role', 'task', 'format', 'constraints', 'context']);

/** Signals `scorePrompt` reports, in a stable order. */
export function getScoreSignals() {
  return [...SCORE_SIGNALS];
}

/** Every case in the corpus, in file order. */
export function getPromptCorpus() {
  return corpusV1.cases.map((entry) => ({ ...entry }));
}

export function getPromptCorpusCase(id) {
  return getPromptCorpus().find((entry) => entry.id === id) || null;
}

export function getPromptCorpusMeta() {
  return {
    id: corpusV1.id,
    version: corpusV1.version,
    description: corpusV1.description,
    selectionCriteria: [...corpusV1.selectionCriteria],
    caseCount: corpusV1.cases.length,
  };
}

/**
 * Structural check on the corpus file itself, kept separate from the
 * behavioural assertions so a malformed case reports as a shape problem rather
 * than as a scoring failure.
 *
 * @returns {string[]} problems found; empty means the corpus is well-formed
 */
export function validatePromptCorpus(corpus = corpusV1) {
  const problems = [];

  if (!Number.isInteger(corpus?.version) || corpus.version < 1) {
    problems.push('version must be a positive integer');
  }
  if (!Array.isArray(corpus?.selectionCriteria) || corpus.selectionCriteria.length === 0) {
    problems.push('selectionCriteria must be a non-empty array');
  }
  if (!Array.isArray(corpus?.cases) || corpus.cases.length === 0) {
    problems.push('cases must be a non-empty array');
    return problems;
  }

  const seen = new Set();
  corpus.cases.forEach((entry, index) => {
    const where = entry?.id || `case[${index}]`;
    if (!entry?.id) problems.push(`${where}: missing id`);
    else if (seen.has(entry.id)) problems.push(`${where}: duplicate id`);
    else seen.add(entry.id);

    if (!entry?.title) problems.push(`${where}: missing title`);
    if (!entry?.rationale) problems.push(`${where}: missing rationale`);
    if (typeof entry?.prompt !== 'string' || !entry.prompt.trim()) {
      problems.push(`${where}: prompt must be a non-empty string`);
    }

    const score = entry?.expected?.score;
    if (!score) {
      problems.push(`${where}: missing expected.score`);
    } else {
      for (const signal of SCORE_SIGNALS) {
        if (typeof score[signal] !== 'boolean') {
          problems.push(`${where}: expected.score.${signal} must be a boolean`);
        }
      }
      const derived = SCORE_SIGNALS.filter((signal) => score[signal] === true).length;
      if (score.points !== derived) {
        problems.push(`${where}: expected.score.points ${score.points} does not match its own signals (${derived})`);
      }
    }

    if (!Array.isArray(entry?.expected?.lintRuleIds)) {
      problems.push(`${where}: expected.lintRuleIds must be an array`);
    }
    if (!Array.isArray(entry?.expected?.vars)) {
      problems.push(`${where}: expected.vars must be an array`);
    }
  });

  return problems;
}
