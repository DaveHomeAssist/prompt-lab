import { describe, expect, it } from 'vitest';
import {
  PROMPT_CORPUS_VERSION,
  getPromptCorpus,
  getPromptCorpusCase,
  getPromptCorpusMeta,
  getScoreSignals,
  validatePromptCorpus,
} from '../lib/promptCorpus.js';
import { extractVars, scorePrompt } from '../promptUtils.js';
import { LINT_QUICK_FIX_META, lintPrompt } from '../promptLint.js';

// DHA-11: the corpus records objective, computed properties. These tests
// assert the recorded values back against the real functions, so a change to
// scoring or lint fails here instead of silently invalidating the corpus.

const corpus = getPromptCorpus();

function lintRuleIdsFor(prompt) {
  return lintPrompt(prompt).map((issue) => issue.ruleId ?? issue.id).sort();
}

describe('corpus shape', () => {
  it('is structurally well-formed', () => {
    expect(validatePromptCorpus()).toEqual([]);
  });

  it('is versioned and non-empty', () => {
    const meta = getPromptCorpusMeta();
    expect(PROMPT_CORPUS_VERSION).toBeGreaterThanOrEqual(1);
    expect(meta.caseCount).toBe(corpus.length);
    expect(meta.selectionCriteria.length).toBeGreaterThan(0);
  });

  it('documents a rationale for every case', () => {
    for (const entry of corpus) {
      expect(entry.rationale, `${entry.id} rationale`).toBeTruthy();
    }
  });

  it('resolves a case by id and returns null for an unknown one', () => {
    expect(getPromptCorpusCase('complete-well-formed')?.id).toBe('complete-well-formed');
    expect(getPromptCorpusCase('no-such-case')).toBeNull();
  });
});

describe('recorded expectations match the real functions', () => {
  it.each(corpus.map((entry) => [entry.id, entry]))('scorePrompt matches for %s', (_id, entry) => {
    const actual = scorePrompt(entry.prompt);
    expect(actual).not.toBeNull();

    for (const signal of getScoreSignals()) {
      expect(actual[signal], `${entry.id}.${signal}`).toBe(entry.expected.score[signal]);
    }
    expect(actual.points, `${entry.id}.points`).toBe(entry.expected.score.points);
    expect(actual.maxPoints).toBe(5);
  });

  it.each(corpus.map((entry) => [entry.id, entry]))('lintPrompt matches for %s', (_id, entry) => {
    expect(lintRuleIdsFor(entry.prompt)).toEqual([...entry.expected.lintRuleIds].sort());
  });

  it.each(corpus.map((entry) => [entry.id, entry]))('extractVars matches for %s', (_id, entry) => {
    expect(extractVars(entry.prompt)).toEqual(entry.expected.vars);
  });
});

describe('coverage the selection criteria promise', () => {
  it('spans every points value from 1 to 5', () => {
    const points = new Set(corpus.map((entry) => entry.expected.score.points));
    expect([...points].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('includes a lint-clean case and a case firing every rule that exists', () => {
    const ruleCounts = corpus.map((entry) => entry.expected.lintRuleIds.length);
    expect(Math.min(...ruleCounts)).toBe(0);

    // Compared against the product's own rule inventory, not against the rules
    // the corpus happens to mention. Deriving the target from the corpus made
    // the assertion circular: `example_io` only fires above 420 characters, no
    // case was that long, and "fires every rule" passed against four of five.
    const inventory = Object.keys(LINT_QUICK_FIX_META).sort();
    const covered = [...new Set(corpus.flatMap((entry) => entry.expected.lintRuleIds))].sort();
    expect(covered, 'every lint rule is exercised by some case').toEqual(inventory);

    const worstCase = corpus.find(
      (entry) => [...entry.expected.lintRuleIds].sort().join() === inventory.join(),
    );
    expect(worstCase, 'a single case firing every rule in the inventory').toBeTruthy();
  });

  it('isolates each score signal in at least one case', () => {
    for (const signal of getScoreSignals()) {
      const isolated = corpus.some((entry) => {
        const score = entry.expected.score;
        return score[signal] === true
          && getScoreSignals().filter((other) => score[other] === true).length === 1;
      });
      expect(isolated, `a case where ${signal} is the only signal present`).toBe(true);
    }
  });

  it('exercises variable extraction', () => {
    expect(corpus.some((entry) => entry.expected.vars.length > 0)).toBe(true);
  });

  it('carries no credential-shaped or personal text anywhere in a case', () => {
    // The corpus must stay safe to run anywhere: no keys, no addresses.
    // Scanning only `entry.prompt` left titles, rationales, and expected
    // metadata unchecked, so a key pasted into a rationale would have passed
    // while the docs promised the whole corpus was clean. Serialize the case.
    const forbidden = [
      // Anchored: without \b this matched the substring "sk-no-structure"
      // inside the case id "task-no-structure" once the whole case was scanned.
      /\bsk-[a-z0-9-]{8,}/i,
      /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
      /BEGIN [A-Z ]*PRIVATE KEY/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bghp_[A-Za-z0-9]{20,}\b/,
      /\b(?:\d[ -]?){13,16}\b/,
    ];
    for (const entry of corpus) {
      const serialized = JSON.stringify(entry);
      for (const pattern of forbidden) {
        expect(pattern.test(serialized), `${entry.id} matches ${pattern}`).toBe(false);
      }
    }
  });
});

// The shape test above only ever validated the already-valid checked-in
// corpus, so every failure branch was unexercised: the validator could have
// regressed to accepting malformed cases and the suite would still pass.
describe('validatePromptCorpus rejects malformed input', () => {
  const validCase = () => ({
    id: 'ok',
    title: 'Fine',
    rationale: 'Fine',
    prompt: 'You are an editor. Summarize this.',
    expected: {
      score: {
        role: true, task: false, format: false, constraints: false, context: false, points: 1,
      },
      lintRuleIds: [],
      vars: [],
    },
  });
  const wrap = (cases, overrides = {}) => ({
    version: 1,
    selectionCriteria: ['something'],
    cases,
    ...overrides,
  });

  it('accepts the well-formed control', () => {
    expect(validatePromptCorpus(wrap([validCase()]))).toEqual([]);
  });

  it('rejects a non-positive version', () => {
    expect(validatePromptCorpus(wrap([validCase()], { version: 0 })))
      .toContain('version must be a positive integer');
  });

  it('rejects empty selection criteria', () => {
    expect(validatePromptCorpus(wrap([validCase()], { selectionCriteria: [] })))
      .toContain('selectionCriteria must be a non-empty array');
  });

  it('rejects an empty case list', () => {
    expect(validatePromptCorpus(wrap([]))).toContain('cases must be a non-empty array');
  });

  it('rejects duplicate ids', () => {
    const problems = validatePromptCorpus(wrap([validCase(), validCase()]));
    expect(problems.some((problem) => problem.includes('duplicate id'))).toBe(true);
  });

  it.each([
    ['id', 'missing id'],
    ['title', 'missing title'],
    ['rationale', 'missing rationale'],
  ])('rejects a case missing %s', (field, expected) => {
    const entry = validCase();
    delete entry[field];
    const problems = validatePromptCorpus(wrap([entry]));
    expect(problems.some((problem) => problem.includes(expected))).toBe(true);
  });

  it('rejects a blank prompt', () => {
    const entry = { ...validCase(), prompt: '   ' };
    const problems = validatePromptCorpus(wrap([entry]));
    expect(problems.some((problem) => problem.includes('prompt must be a non-empty string'))).toBe(true);
  });

  it('rejects points that disagree with the case signals', () => {
    const entry = validCase();
    entry.expected.score.points = 4;
    const problems = validatePromptCorpus(wrap([entry]));
    expect(problems.some((problem) => problem.includes('does not match its own signals'))).toBe(true);
  });

  it('rejects a non-boolean signal', () => {
    const entry = validCase();
    entry.expected.score.role = 'yes';
    const problems = validatePromptCorpus(wrap([entry]));
    expect(problems.some((problem) => problem.includes('must be a boolean'))).toBe(true);
  });

  it('rejects a case with no expected.score at all', () => {
    const entry = validCase();
    delete entry.expected.score;
    const problems = validatePromptCorpus(wrap([entry]));
    expect(problems.some((problem) => problem.includes('missing expected.score'))).toBe(true);
  });
});
