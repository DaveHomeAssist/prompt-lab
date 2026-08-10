import { describe, expect, it } from 'vitest';
import { buildGraphDataset } from '../runs/buildGraphDataset.js';

describe('buildGraphDataset', () => {
  it('renders raw run-emitter records without requiring a second schema conversion', () => {
    const dataset = buildGraphDataset([{
      run_id: 'chain-1',
      parent_run_id: null,
      trace_id: 'trace-1',
      run_type: 'chain',
      status: 'canceled',
      started_at: 1_000,
      ended_at: 1_250,
      provider: 'chain',
      model: 'Demo chain',
    }], { traceId: 'trace-1', rootRunId: 'chain-1' });
    expect(dataset.nodes[0]).toMatchObject({
      label: 'Chain:Demo chain',
      status: 'canceled',
      meta: { runtime: '250ms', tags: ['chain', 'Demo chain'] },
    });
  });

  it('maps run records into the graph dataset contract deterministically', () => {
    const runs = [
      {
        run_id: 'r_root',
        parent_run_id: null,
        trace_id: 't_123',
        run_type: 'trace',
        name: 'User request',
        status: 'success',
        start_ts: '2026-03-17T01:21:00.000Z',
        end_ts: '2026-03-17T01:21:01.200Z',
        inputs: {},
        outputs: {},
        error: null,
        meta: { provider: 'promptlab', model: 'router-v1', tokens: 32, cost: 0, prompt_hash: 'hash-root' },
        variant_id: 'main',
      },
      {
        run_id: 'r_llm',
        parent_run_id: 'r_root',
        trace_id: 't_123',
        run_type: 'llm',
        name: 'Claude call',
        status: 'success',
        start_ts: '2026-03-17T01:21:00.100Z',
        end_ts: '2026-03-17T01:21:00.500Z',
        inputs: {},
        outputs: {},
        error: null,
        meta: { provider: 'anthropic', model: 'claude-3.7', tokens: 128, cost: 0.014, prompt_hash: 'hash-llm' },
        variant_id: 'main',
      },
      {
        run_id: 'r_tool',
        parent_run_id: 'r_root',
        trace_id: 't_123',
        run_type: 'tool',
        name: 'PII scan',
        status: 'success',
        start_ts: '2026-03-17T01:21:00.600Z',
        end_ts: '2026-03-17T01:21:01.100Z',
        inputs: {},
        outputs: {},
        error: null,
        meta: {},
        variant_id: 'main',
      },
    ];

    expect(buildGraphDataset(runs, {
      traceId: 't_123',
      rootRunId: 'r_root',
      variantId: 'main',
    })).toEqual({
      version: 1,
      meta: {
        id: 'trace_t_123__variant_main__2026-03-17T01-21-01-200Z',
        name: 'Trace t_123 (main)',
        description: 'Run tree snapshot exported from PromptLab Dexie',
        traceId: 't_123',
        rootRunId: 'r_root',
        variantId: 'main',
        exportedAt: '2026-03-17T01:21:01.200Z',
        source: 'promptlab:dexie:runs',
      },
      nodes: [
        {
          id: 'r_root',
          label: 'Trace:User request',
          type: 'trace',
          layer: 'Trace',
          status: 'success',
          meta: {
            traceId: 't_123',
            parentRunId: null,
            variantId: 'main',
            runtimeMs: 1200,
            runtime: '1.2s',
            tags: ['promptlab', 'router-v1'],
            desc: 'success. 2 child runs.',
            owner: 'promptlab',
            tokens: 32,
            cost: 0,
            promptHash: 'hash-root',
          },
        },
        {
          id: 'r_llm',
          label: 'LLM:Claude call',
          type: 'llm',
          layer: 'LLM',
          status: 'success',
          meta: {
            traceId: 't_123',
            parentRunId: 'r_root',
            variantId: 'main',
            runtimeMs: 400,
            runtime: '400ms',
            tags: ['anthropic', 'claude-3.7'],
            desc: 'success. 0 child runs.',
            owner: 'anthropic',
            tokens: 128,
            cost: 0.014,
            promptHash: 'hash-llm',
          },
        },
        {
          id: 'r_tool',
          label: 'Tool:PII scan',
          type: 'tool',
          layer: 'Tool',
          status: 'success',
          meta: {
            traceId: 't_123',
            parentRunId: 'r_root',
            variantId: 'main',
            runtimeMs: 500,
            runtime: '500ms',
            tags: [],
            desc: 'success. 0 child runs.',
            owner: 'unknown',
            tokens: null,
            cost: null,
            promptHash: null,
          },
        },
      ],
      edges: [
        { from: 'r_root', to: 'r_llm', type: 'calls', meta: { label: 'calls' } },
        { from: 'r_root', to: 'r_tool', type: 'calls', meta: { label: 'calls' } },
      ],
    });
  });
});
