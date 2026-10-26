import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runChain } from '../lib/chainRunner.js';
import { validateChain, isChainEntry } from '../lib/chainSchema.js';
import { removeAllListeners, on } from '../lib/runEmitter.js';

function chainEntry(steps, title = 'Test Chain') {
  return { id: 'chain-entry', title, metadata: { chain: { version: 1, steps } } };
}

describe('chainSchema', () => {
  it('normalizes entry-referenced and inline steps and drops invalid ones', () => {
    const chain = validateChain({
      steps: [
        { entryId: 'abc', varMap: { TOPIC: { source: 'chainInput' }, BAD: { source: 'nope' } } },
        { label: 'Inline', template: 'do a thing' },
        { template: '   ' },
        null,
      ],
    });
    expect(chain.steps).toHaveLength(2);
    expect(chain.steps[0].varMap.TOPIC.source).toBe('chainInput');
    expect(chain.steps[0].varMap.BAD).toBeUndefined();
    expect(chain.steps[1].label).toBe('Inline');
  });

  it('rejects empty chains and detects chain entries', () => {
    expect(validateChain({ steps: [] })).toBeNull();
    expect(isChainEntry({ metadata: { chain: { steps: [{ label: 'x', template: 'y' }] } } })).toBe(true);
    expect(isChainEntry({ metadata: {} })).toBe(false);
  });
});

describe('runChain', () => {
  beforeEach(() => removeAllListeners());

  it('pipes each step output into the next and returns the final output', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce('first-out')
      .mockResolvedValueOnce('second-out');
    const result = await runChain({
      chainEntry: chainEntry([
        { label: 'One', template: 'start with {{input}}' },
        { label: 'Two', template: 'refine: {{prev}}' },
      ]),
      resolveEntry: () => null,
      input: 'seed',
      execute,
    });
    expect(result.status).toBe('success');
    expect(execute.mock.calls[0][0].prompt).toBe('start with seed');
    expect(execute.mock.calls[1][0].prompt).toBe('refine: first-out');
    expect(result.output).toBe('second-out');
  });

  it('appends the previous output when an inline step lacks {{prev}}', async () => {
    const execute = vi.fn().mockResolvedValueOnce('alpha').mockResolvedValueOnce('omega');
    await runChain({
      chainEntry: chainEntry([
        { label: 'One', template: 'produce alpha' },
        { label: 'Two', template: 'summarize the input' },
      ]),
      resolveEntry: () => null,
      execute,
    });
    expect(execute.mock.calls[1][0].prompt).toBe('summarize the input\n\nINPUT:\nalpha');
  });

  it('fills entry-referenced steps through their varMap', async () => {
    const execute = vi.fn().mockResolvedValue('done');
    const library = {
      'entry-9': { id: 'entry-9', title: 'Mapper', enhanced: 'Use {{SOURCE}} and {{MODE}}', original: '' },
    };
    await runChain({
      chainEntry: chainEntry([{
        entryId: 'entry-9',
        varMap: {
          SOURCE: { source: 'chainInput' },
          MODE: { source: 'literal', value: 'strict' },
        },
      }]),
      resolveEntry: (id) => library[id] || null,
      input: 'the-input',
      execute,
    });
    expect(execute.mock.calls[0][0].prompt).toBe('Use the-input and strict');
  });

  describe('literal substitution', () => {
    // Every sequence String.prototype.replace treats as special in a replacement string.
    const DOLLARS = "cost $$5 | match $& | before $` | after $' | group $1 | named $<x>";

    it('keeps dollar sequences in the chain input exactly as typed', async () => {
      const execute = vi.fn().mockResolvedValue('ok');
      await runChain({
        chainEntry: chainEntry([{ label: 'One', template: 'start {{input}} end' }]),
        resolveEntry: () => null,
        input: DOLLARS,
        execute,
      });
      expect(execute.mock.calls[0][0].prompt).toBe(`start ${DOLLARS} end`);
    });

    it('keeps dollar sequences in the previous output exactly as returned', async () => {
      const execute = vi.fn().mockResolvedValueOnce(DOLLARS).mockResolvedValueOnce('ok');
      await runChain({
        chainEntry: chainEntry([
          { label: 'One', template: 'produce' },
          { label: 'Two', template: 'refine: {{ prev }} (done)' },
        ]),
        resolveEntry: () => null,
        execute,
      });
      expect(execute.mock.calls[1][0].prompt).toBe(`refine: ${DOLLARS} (done)`);
    });

    it('keeps dollar sequences in every mapped variable source', async () => {
      const execute = vi.fn().mockResolvedValueOnce(`prev ${DOLLARS}`).mockResolvedValueOnce('ok');
      const library = {
        mapper: { id: 'mapper', title: 'Mapper', enhanced: '[{{A}}] [{{B}}] [{{C}}]', original: '' },
      };
      await runChain({
        chainEntry: chainEntry([
          { label: 'One', template: 'produce' },
          {
            entryId: 'mapper',
            varMap: {
              A: { source: 'chainInput' },
              B: { source: 'prevOutput' },
              C: { source: 'literal', value: `lit ${DOLLARS}` },
            },
          },
        ]),
        resolveEntry: (id) => library[id] || null,
        input: `in ${DOLLARS}`,
        execute,
      });
      expect(execute.mock.calls[1][0].prompt)
        .toBe(`[in ${DOLLARS}] [prev ${DOLLARS}] [lit ${DOLLARS}]`);
    });

    it('does not expand placeholders that arrive inside substituted text', async () => {
      const execute = vi.fn()
        .mockResolvedValueOnce('model wrote {{input}} and {{B}}')
        .mockResolvedValueOnce('ok')
        .mockResolvedValueOnce('ok');
      const library = {
        mapper: { id: 'mapper', title: 'Mapper', enhanced: '{{A}} / {{B}}', original: '' },
      };
      await runChain({
        chainEntry: chainEntry([
          { label: 'One', template: 'produce' },
          { label: 'Two', template: '{{prev}} | {{input}}' },
          {
            entryId: 'mapper',
            varMap: {
              A: { source: 'literal', value: 'has {{B}}' },
              B: { source: 'chainInput' },
            },
          },
        ]),
        resolveEntry: (id) => library[id] || null,
        input: 'SEED',
        execute,
      });
      expect(execute.mock.calls[1][0].prompt).toBe('model wrote {{input}} and {{B}} | SEED');
      expect(execute.mock.calls[2][0].prompt).toBe('has {{B}} / SEED');
    });
  });

  it('stops with an error when a referenced entry is missing', async () => {
    const execute = vi.fn();
    const result = await runChain({
      chainEntry: chainEntry([{ entryId: 'gone', varMap: {} }]),
      resolveEntry: () => null,
      execute,
    });
    expect(result.status).toBe('error');
    expect(execute).not.toHaveBeenCalled();
  });

  it('blocks the chain when the PII scan flags a step', async () => {
    const execute = vi.fn();
    const result = await runChain({
      chainEntry: chainEntry([{ label: 'One', template: 'send ssn' }]),
      resolveEntry: () => null,
      execute,
      scan: () => ({ matches: [{ type: 'ssn' }] }),
    });
    expect(result.status).toBe('blocked');
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports canceled when the signal aborts mid-chain', async () => {
    const terminalEvents = [];
    on('run:error', (payload) => terminalEvents.push(payload));
    const controller = new AbortController();
    const execute = vi.fn().mockImplementation(async () => {
      controller.abort();
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    const result = await runChain({
      chainEntry: chainEntry([
        { label: 'One', template: 'a' },
        { label: 'Two', template: 'b' },
      ]),
      resolveEntry: () => null,
      execute,
      signal: controller.signal,
    });
    expect(result.status).toBe('canceled');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(terminalEvents).toHaveLength(2);
    expect(terminalEvents.every((event) => event.status === 'canceled')).toBe(true);
  });

  it('emits a parent chain run with per-step child spans sharing the trace', async () => {
    const events = [];
    on('run:end', (payload) => events.push(payload));
    const execute = vi.fn().mockResolvedValue('x');
    const result = await runChain({
      chainEntry: chainEntry([{ label: 'One', template: 'a' }, { label: 'Two', template: 'b' }]),
      resolveEntry: () => null,
      execute,
    });
    const chainEvents = events.filter((event) => event.run_type === 'chain');
    const llmEvents = events.filter((event) => event.run_type === 'llm');
    expect(chainEvents).toHaveLength(1);
    expect(llmEvents).toHaveLength(2);
    llmEvents.forEach((event) => {
      expect(event.trace_id).toBe(result.traceId);
      expect(event.parent_run_id).toBe(chainEvents[0].run_id);
    });
  });
});

describe('runPersistence', () => {
  it('persists terminal run events into the runs fallback store', async () => {
    localStorage.clear();
    removeAllListeners();
    const { resetRunPersistenceForTests, initRunPersistence } = await import('../lib/runPersistence.js');
    const { listRunsByTrace } = await import('../experimentStore.js');
    resetRunPersistenceForTests();
    initRunPersistence();
    const execute = vi.fn().mockResolvedValue('persisted');
    const result = await runChain({
      chainEntry: chainEntry([{ label: 'One', template: 'a' }]),
      resolveEntry: () => null,
      execute,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const records = await listRunsByTrace(result.traceId);
    expect(records.length).toBe(2);
    expect(records.map((row) => row.run_type).sort()).toEqual(['chain', 'llm']);
  });
});
