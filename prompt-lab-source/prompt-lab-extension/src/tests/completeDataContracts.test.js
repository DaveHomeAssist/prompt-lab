import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildResultCandidates,
  normalizeResultMeta,
} from '../lib/enhancementResult.js';
import { normalizeEvalRunRecord } from '../lib/evalSchema.js';
import {
  createPromptEntry,
  normalizeEntry,
  updatePromptEntry,
} from '../lib/promptSchema.js';
import {
  SAVE_LABELS,
  createSaveReceipt,
  getPrimarySaveLabel,
} from '../lib/promptLifecycle.js';
import { linkScratchNoteToPrompt } from '../lib/sourceLink.js';

describe('complete post-enhance data contracts', () => {
  it('assigns every generated candidate its canonical role, label, and stable id', () => {
    expect(buildResultCandidates('Improved body', [
      { label: 'Provider concise', content: 'Tighter body' },
      { label: 'Provider machine', content: '{"answer":"Strict body"}' },
    ])).toEqual([
      { id: 'improved', label: 'Improved', role: 'improved', content: 'Improved body' },
      { id: 'tighter', label: 'Tighter', role: 'tighter', content: 'Tighter body' },
      {
        id: 'strict-json',
        label: 'Strict JSON',
        role: 'strict-json',
        content: '{"answer":"Strict body"}',
      },
    ]);
  });

  it('preserves selection, reversible edits, normalized tags, and computed token totals', () => {
    const normalized = normalizeResultMeta({
      candidates: [
        { id: 'provider-a', label: 'A', content: 'Improved body' },
        { id: 'provider-b', label: 'B', content: 'Tighter body' },
        { id: 'provider-c', label: 'C', content: '{"answer":"Strict body"}' },
      ],
      selectedCandidateId: 'strict-json',
      change_summary: 'Made the output deterministic.',
      assumptions: [{ id: 'assumption-1', text: 'Audience is technical.' }],
      reversible_edits: [{
        id: 'edit-1',
        label: 'Add audience assumption',
        operation: 'add',
        before: '',
        after: 'Audience: technical.',
        candidate_id: 'improved',
      }],
      tags: ['code', 'CODING', 'handoff'],
      usage: { inputTokens: 31, outputTokens: 17 },
    });

    expect(normalized.candidates.map(({ id, label, role }) => ({ id, label, role }))).toEqual([
      { id: 'improved', label: 'Improved', role: 'improved' },
      { id: 'tighter', label: 'Tighter', role: 'tighter' },
      { id: 'strict-json', label: 'Strict JSON', role: 'strict-json' },
    ]);
    expect(normalized.selectedCandidateId).toBe('strict-json');
    expect(normalized.reversibleEdits).toEqual([
      expect.objectContaining({
        id: 'edit-1',
        operation: 'add',
        after: 'Audience: technical.',
        candidateId: 'improved',
        reverted: false,
      }),
    ]);
    expect(normalized.tags).toEqual(['Code', 'handoff']);
    expect(normalized.usage).toEqual({ input: 31, output: 17, total: 48 });
  });

  it('round-trips the selected candidate and structured result fields through run history', () => {
    const run = normalizeEvalRunRecord({
      id: 'run-1',
      promptId: 'prompt-1',
      promptVersionId: 'version-3',
      candidates: [
        { id: 'improved', label: 'Improved', content: 'Improved body' },
        { id: 'tighter', label: 'Tighter', content: 'Tighter body' },
        { id: 'strict-json', label: 'Strict JSON', content: '{"answer":"Strict body"}' },
      ],
      selectedCandidateId: 'tighter',
      assumptions: [{ id: 'assumption-1', text: 'Audience is technical.' }],
      reversibleEdits: [{
        id: 'edit-1',
        label: 'Add audience assumption',
        operation: 'add',
        after: 'Audience: technical.',
        candidateId: 'improved',
      }],
      changes: [{ id: 'change-1', type: 'added', label: 'Added output schema' }],
      tags: ['Writing'],
      usage: { input: 40, output: 10, total: 50 },
    });

    expect(run).toEqual(expect.objectContaining({
      id: 'run-1',
      promptId: 'prompt-1',
      promptVersionId: 'version-3',
      selectedCandidateId: 'tighter',
      usage: { input: 40, output: 10, total: 50 },
      tags: ['Writing'],
    }));
    expect(run.candidates.map((candidate) => candidate.id)).toEqual([
      'improved',
      'tighter',
      'strict-json',
    ]);
    expect(run.reversibleEdits[0]).toEqual(expect.objectContaining({
      id: 'edit-1',
      candidateId: 'improved',
    }));
  });
});

describe('prompt record lifecycle fields', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves favorite, completeness, tombstone, and Scratch source-link fields on update', () => {
    const created = createPromptEntry({
      id: 'prompt-1',
      title: 'Release checklist',
      original: 'Draft checklist',
      enhanced: 'Verified checklist',
      tags: ['Operations'],
      favorite: true,
      sourceNoteId: 'scratch-1',
      tombstoneVersion: 4,
      metadata: {
        purpose: 'Verify a release',
        status: 'active',
      },
    }, { now: '2026-08-20T12:00:00.000Z' });

    expect(created).toEqual(expect.objectContaining({
      favorite: true,
      sourceNoteId: 'scratch-1',
      tombstoneVersion: 4,
      completeness: expect.objectContaining({ complete: true, missing: [] }),
    }));

    const updated = updatePromptEntry(created, {
      enhanced: 'Verified checklist version two',
    }, { now: '2026-08-20T13:00:00.000Z' });

    expect(updated).toEqual(expect.objectContaining({
      favorite: true,
      sourceNoteId: 'scratch-1',
      tombstoneVersion: 4,
      completeness: expect.objectContaining({ complete: true, missing: [] }),
    }));
  });

  it('migrates legacy records with safe defaults without dropping their source link', () => {
    const legacy = normalizeEntry({
      id: 'legacy-prompt',
      prompt: 'Legacy prompt body',
      type: 'template',
      metadata: { sourceNoteId: 'legacy-note' },
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    expect(legacy).toEqual(expect.objectContaining({
      id: 'legacy-prompt',
      enhanced: 'Legacy prompt body',
      favorite: false,
      kind: 'template',
      sourceNoteId: 'legacy-note',
      deletedAt: null,
      tombstoneVersion: 0,
      completeness: expect.objectContaining({
        complete: false,
        missing: expect.arrayContaining(['tags', 'purpose', 'status']),
      }),
    }));
  });

  it('writes the prompt id back to its source Scratch note and advances the note revision', () => {
    localStorage.setItem('pl2-pads', JSON.stringify({
      revision: 2,
      pads: [
        { id: 'scratch-1', title: 'Release note', content: 'Draft' },
        { id: 'scratch-2', title: 'Other note', content: 'Keep me' },
      ],
    }));

    expect(linkScratchNoteToPrompt('scratch-1', 'prompt-1')).toBe(true);

    const stored = JSON.parse(localStorage.getItem('pl2-pads'));
    expect(stored.revision).toBe(3);
    expect(stored.pads[0]).toEqual(expect.objectContaining({
      id: 'scratch-1',
      linkedPromptId: 'prompt-1',
      updatedAt: expect.any(Number),
      timestamp: expect.any(Number),
    }));
    expect(stored.pads[1]).toEqual({ id: 'scratch-2', title: 'Other note', content: 'Keep me' });
  });
});

describe('save language and receipts', () => {
  it('uses unambiguous labels for new prompts, versions, and copies', () => {
    expect(SAVE_LABELS).toEqual({
      newPrompt: 'Save as new prompt',
      newVersion: 'Save new version',
      saveCopy: 'Save as new prompt',
    });
    expect(getPrimarySaveLabel(null)).toBe('Save as new prompt');
    expect(getPrimarySaveLabel('prompt-1')).toBe('Save new version');
  });

  it('creates a receipt that identifies the entry and exact saved version', () => {
    const receipt = createSaveReceipt({
      id: 'prompt-1',
      title: 'Release checklist',
      versionId: 'version-3',
      versionNumber: 3,
    }, {
      action: 'version',
      sourceNoteId: 'scratch-1',
    });

    expect(receipt).toEqual(expect.objectContaining({
      entryId: 'prompt-1',
      title: 'Release checklist',
      versionId: 'version-3',
      versionNumber: 3,
      action: 'version',
      sourceNoteId: 'scratch-1',
      savedAt: expect.any(String),
    }));
  });
});
