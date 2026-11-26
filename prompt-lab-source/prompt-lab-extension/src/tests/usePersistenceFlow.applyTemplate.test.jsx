import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import usePersistenceFlow from '../hooks/usePersistenceFlow.js';
import PostEnhanceResults from '../PostEnhanceResults.jsx';

vi.mock('../lib/platform.js', () => ({
  sessionGet: vi.fn((_key, cb) => cb(null)),
  sessionSet: vi.fn(),
}));
vi.mock('../icons.jsx', () => ({ default: () => null }));

const TEMPLATE_TEXT = 'Write to {{customer_name}} at {{company}} about {{product}}.';

function makeTemplate() {
  return {
    id: 'followup',
    title: 'Customer follow-up email',
    original: TEMPLATE_TEXT,
    enhanced: TEMPLATE_TEXT,
    variants: [{ id: 'tighter', label: 'Tighter', content: 'Note for {{customer_name}}.' }],
    resultMeta: {
      candidates: [{ id: 'improved', label: 'Improved', content: TEMPLATE_TEXT }],
      selectedCandidateId: 'improved',
    },
    inputs: [
      { key: 'customer_name', label: 'Customer name', type: 'text', required: true },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'product', label: 'Product', type: 'text' },
    ],
    tags: ['template'],
    collection: 'Outreach',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    currentVersionId: 'followup-v1',
    versions: [{ id: 'followup-v1', original: TEMPLATE_TEXT, enhanced: TEMPLATE_TEXT, savedAt: '2026-11-20T00:00:00.000Z' }],
  };
}

function Harness({ library, flowRef, savedPayloads = [] }) {
  const [raw, setRaw] = useState('');
  const [enhanced, setEnhanced] = useState('');
  const [resultMeta, setResultMeta] = useState(null);
  const [variants, setVariants] = useState([]);
  const [notes, setNotes] = useState('');
  const flow = usePersistenceFlow({
    ui: { notify: vi.fn(), setTab: vi.fn(), tab: 'library' },
    lib: {
      library,
      bumpUse: vi.fn(),
      trackRecentAccess: vi.fn(),
      doSave: (payload) => {
        savedPayloads.push(payload);
        if (payload.editingId) {
          const target = library.find((entry) => entry.id === payload.editingId);
          if (target) {
            target.original = payload.raw;
            target.enhanced = payload.enhanced;
            target.versions = [...(target.versions || []), { id: 'saved-over', original: payload.raw, enhanced: payload.enhanced }];
          }
          return { id: payload.editingId, title: payload.title || target?.title, versionId: 'saved-over' };
        }
        const created = {
          id: 'created-from-fill',
          title: payload.title,
          original: payload.raw,
          enhanced: payload.enhanced,
        };
        library.unshift(created);
        return { id: created.id, title: created.title, versionId: 'v1' };
      },
    },
    editor: {
      raw, enhanced, variants, notes, resultMeta, enhMode: 'expanded',
      setRaw, setEnhanced, setVariants, setNotes, setResultMeta, setEnhMode: vi.fn(), setComposerBlocks: vi.fn(),
    },
  });
  flowRef.current = flow;
  const currentEntry = flow.editingId ? library.find((entry) => entry.id === flow.editingId) || null : null;
  return (
    <>
      <textarea data-testid="prompt-input" aria-label="Prompt input" value={raw} readOnly />
      <PostEnhanceResults
        m={{ diffAdd: 'add', diffDel: 'del', diffEq: 'same' }}
        raw={raw}
        enhanced={enhanced}
        setEnhanced={setEnhanced}
        variants={variants}
        resultMeta={resultMeta}
        setResultMeta={setResultMeta}
        copy={vi.fn()}
        enhance={vi.fn()}
        dismiss={vi.fn()}
        editingId={flow.editingId}
        lib={{}}
        evalRuns={[]}
        showInlineSaveBar
        saveTitle={flow.saveTitle}
        setSaveTitle={flow.setSaveTitle}
        suggestedSaveTitle="Customer follow-up email"
        canSavePanel
        quickSave={() => flow.doSave()}
        quickSaveAsNew={(selected) => flow.doSave(undefined, { copyAsNew: true, enhancedOverride: selected?.content })}
        openSavePanel={vi.fn()}
        currentEntry={currentEntry}
      />
    </>
  );
}

describe('Apply Template display', () => {
  beforeEach(() => { localStorage.clear(); });

  it('shows the filled prompt in Write and saves a new draft instead of the template', async () => {
    const template = makeTemplate();
    const library = [template];
    const flowRef = { current: null };
    render(<Harness library={library} flowRef={flowRef} />);

    await act(async () => { await flowRef.current.loadEntry(template); });
    expect(flowRef.current.showVarForm).toBe(true);

    act(() => {
      flowRef.current.setVarVals({ customer_name: 'Maya', company: 'Acme', product: 'Prompt Lab' });
      flowRef.current.applyTemplate();
    });

    const filled = 'Write to Maya at Acme about Prompt Lab.';
    expect(screen.getByTestId('prompt-input')).toHaveValue(filled);
    expect(screen.getByTestId('output-textarea')).toHaveValue(filled);
    expect(screen.getByTestId('save-to-library')).toHaveTextContent('Save as new prompt');
    expect(screen.getByTestId('save-to-library')).not.toHaveTextContent('Save new version');
    expect(flowRef.current.editingId).toBeNull();

    await act(async () => { await flowRef.current.doSave(); });

    expect(template.original).toBe(TEMPLATE_TEXT);
    expect(template.enhanced).toBe(TEMPLATE_TEXT);
    expect(template.versions).toHaveLength(1);
    expect(library.find((entry) => entry.id === 'created-from-fill')).toMatchObject({
      original: filled,
      enhanced: filled,
    });
  });

  it('fills revert spans and does not reparent the template experiment', async () => {
    const template = makeTemplate();
    template.original = 'Address {{customer_name}} formally.';
    template.enhanced = 'Address {{customer_name}} formally.';
    template.resultMeta = {
      runId: 'run-template',
      selectedCandidateId: 'improved',
      candidates: [{ id: 'improved', label: 'Improved', content: 'Address {{customer_name}} formally.' }],
      assumptions: [{ id: 'a1', text: 'The greeting names the customer.', addedText: '{{customer_name}}', candidateId: 'improved' }],
      reversibleEdits: [{
        id: 'edit-address', label: 'Formal address', operation: 'replace', candidateId: 'improved', reverted: false,
        before: 'Hello {{customer_name}}', after: 'Address {{customer_name}} formally.',
      }],
    };
    const library = [template];
    const flowRef = { current: null };
    const savedPayloads = [];
    render(<Harness library={library} flowRef={flowRef} savedPayloads={savedPayloads} />);

    await act(async () => { await flowRef.current.loadEntry(template); });
    act(() => {
      flowRef.current.setVarVals({ customer_name: 'Maya', company: 'Acme', product: 'Prompt Lab' });
      flowRef.current.applyTemplate();
    });

    expect(screen.getByTestId('output-textarea')).toHaveValue('Address Maya formally.');
    const assumptions = screen.getByRole('heading', { name: 'Review what the model inferred' }).closest('section');
    expect(within(assumptions).getByRole('button', { name: 'Managed below' })).toBeInTheDocument();
    const edit = screen.getByText('Formal address').closest('.pl-reversible-row');
    fireEvent.click(within(edit).getByRole('button', { name: 'Revert' }));
    expect(screen.getByTestId('output-textarea')).toHaveValue('Hello Maya');

    await act(async () => { await flowRef.current.doSave(); });
    expect(savedPayloads.at(-1).resultMeta.runId).toBe('');
    expect(template.resultMeta.runId).toBe('run-template');
    expect(template.resultMeta.reversibleEdits[0].after).toBe('Address {{customer_name}} formally.');
    expect(template.enhanced).toBe('Address {{customer_name}} formally.');
  });
});
