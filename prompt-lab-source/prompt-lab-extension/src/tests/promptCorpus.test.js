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
import { lintPrompt } from '../promptLint.js';

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

  it('includes a lint-clean case and a case firing every rule', () => {
    const ruleCounts = corpus.map((entry) => entry.expected.lintRuleIds.length);
    expect(Math.min(...ruleCounts)).toBe(0);

    const allFired = new Set(corpus.flatMap((entry) => entry.expected.lintRuleIds));
    const worstCase = corpus.find(
      (entry) => entry.expected.lintRuleIds.length === allFired.size,
    );
    expect(worstCase, 'a case firing every rule the corpus knows about').toBeTruthy();
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

  it('carries no credential-shaped or personal text', () => {
    // The corpus must stay safe to run anywhere: no keys, no addresses.
    const forbidden = /sk-[a-z0-9-]{8,}|@[a-z0-9.-]+\.[a-z]{2,}|BEGIN [A-Z ]*PRIVATE KEY/i;
    for (const entry of corpus) {
      expect(forbidden.test(entry.prompt), `${entry.id} contains credential-shaped text`).toBe(false);
    }
  });
});
