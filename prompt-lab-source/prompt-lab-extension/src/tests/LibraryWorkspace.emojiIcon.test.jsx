import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LibraryWorkspace from '../LibraryWorkspace.jsx';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { onLocalWrite, storageKeys } from '../lib/storage.js';

const EDITOR_DRAFT = 'Unsaved editor draft with extra words';
const entry = {
  id: 'handoff',
  title: 'Handoff',
  original: 'Saved prompt text',
  enhanced: 'Saved prompt text',
  notes: 'Saved notes',
  tags: ['writing'],
  collection: 'Ops',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
  currentVersionId: 'ver-current',
  useCount: 2,
  versions: [{
    id: 'ver-1',
    original: 'Older prompt text',
    enhanced: 'Older prompt text',
    savedAt: '2026-08-01T00:00:00.000Z',
    changeNote: 'First save',
    source: 'manual_save',
  }],
  metadata: {
    purpose: 'Saved purpose',
    owner: 'Saved owner',
    status: 'active',
    artwork: { icon: 'Star', image: '' },
  },
};

const storedLibrary = () => JSON.parse(localStorage.getItem(storageKeys.library));
const promptBody = (row) => ({
  id: row.id,
  title: row.title,
  original: row.original,
  enhanced: row.enhanced,
  notes: row.notes,
  currentVersionId: row.currentVersionId,
  versionIds: (row.versions || []).map((version) => version.id),
  purpose: row.metadata?.purpose,
  owner: row.metadata?.owner,
});

function Harness({ loadEntry }) {
  const lib = usePromptLibrary(vi.fn());
  const [draft, setDraft] = useState('Unsaved editor draft');
  if (!lib.libReady) return <p>Loading library</p>;
  return (
    <>
      <textarea aria-label="Prompt editor" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <LibraryWorkspace m={{}} lib={lib} loadEntry={loadEntry} copy={vi.fn()} />
    </>
  );
}

async function mount(loadEntry = vi.fn()) {
  const view = render(<Harness loadEntry={loadEntry} />);
  await screen.findByRole('button', { name: 'Change artwork for Handoff' });
  fireEvent.change(screen.getByLabelText('Prompt editor'), { target: { value: EDITOR_DRAFT } });
  return { ...view, loadEntry };
}

describe('prompt emoji icon persistence', () => {
  const writes = [];
  let unsubscribe = () => {};
  beforeEach(() => {
    localStorage.clear();
    writes.length = 0;
    unsubscribe = onLocalWrite((key) => writes.push(key));
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  });
  afterEach(() => { unsubscribe(); cleanup(); vi.restoreAllMocks(); });

  it('picked emoji persists after reload', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([entry]));
    const view = await mount();
    const before = promptBody(storedLibrary()[0]);
    const updatedAt = storedLibrary()[0].updatedAt;
    const marked = writes.length;
    fireEvent.click(screen.getByRole('button', { name: 'Change artwork for Handoff' }));
    const dialog = screen.getByRole('dialog', { name: 'Artwork for Handoff' });
    fireEvent.change(within(dialog).getByLabelText('Prompt artwork emoji'), { target: { value: '🧪' } });
    await waitFor(() => expect(storedLibrary()[0].metadata.artwork.emoji).toBe('🧪'));
    const saved = storedLibrary();
    expect(saved).toHaveLength(1);
    expect(promptBody(saved[0])).toEqual(before);
    expect(Date.parse(saved[0].updatedAt)).toBeGreaterThan(Date.parse(updatedAt));
    expect(writes.slice(marked)).toContain(storageKeys.library);
    expect(screen.getByLabelText('Prompt editor')).toHaveValue(EDITOR_DRAFT);
    expect(view.loadEntry).not.toHaveBeenCalled();
    view.unmount();
    render(<Harness loadEntry={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change artwork for Handoff' })).toHaveTextContent('🧪'));
    expect(storedLibrary()[0].metadata.artwork.emoji).toBe('🧪');
    expect(promptBody(storedLibrary()[0])).toEqual(before);
  });

  it('cleared emoji persists after reload', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([{
      ...entry,
      metadata: { ...entry.metadata, artwork: { icon: '', image: '', emoji: '🧪' } },
    }]));
    const view = await mount();
    const before = promptBody(storedLibrary()[0]);
    const updatedAt = storedLibrary()[0].updatedAt;
    const marked = writes.length;
    fireEvent.click(screen.getByRole('button', { name: 'Change artwork for Handoff' }));
    const dialog = screen.getByRole('dialog', { name: 'Artwork for Handoff' });
    fireEvent.change(within(dialog).getByLabelText('Prompt artwork emoji'), { target: { value: '' } });
    await waitFor(() => expect(storedLibrary()[0].metadata.artwork.emoji).toBeUndefined());
    expect(promptBody(storedLibrary()[0])).toEqual(before);
    expect(Date.parse(storedLibrary()[0].updatedAt)).toBeGreaterThan(Date.parse(updatedAt));
    expect(writes.slice(marked)).toContain(storageKeys.library);
    expect(screen.getByLabelText('Prompt editor')).toHaveValue(EDITOR_DRAFT);
    expect(view.loadEntry).not.toHaveBeenCalled();
    view.unmount();
    render(<Harness loadEntry={vi.fn()} />);
    const card = await screen.findByRole('button', { name: 'Change artwork for Handoff' });
    expect(card).not.toHaveTextContent('🧪');
    expect(storedLibrary()[0].metadata.artwork.emoji).toBeUndefined();
    expect(promptBody(storedLibrary()[0])).toEqual(before);
  });

  it('editor draft text stays untouched when an emoji is picked from the inspector', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([entry]));
    const view = await mount();
    const before = promptBody(storedLibrary()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Handoff' }));
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Draft purpose that must stay unsaved' } });
    fireEvent.click(screen.getByText('Prompt artwork', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Prompt artwork emoji'), { target: { value: '🧪' } });
    await waitFor(() => expect(storedLibrary()[0].metadata.artwork.emoji).toBe('🧪'));
    expect(promptBody(storedLibrary()[0])).toEqual(before);
    expect(storedLibrary()).toHaveLength(1);
    expect(storedLibrary()[0].versions).toHaveLength(1);
    expect(screen.getByLabelText('Prompt editor')).toHaveValue(EDITOR_DRAFT);
    expect(screen.getByLabelText('Purpose')).toHaveValue('Draft purpose that must stay unsaved');
    expect(view.loadEntry).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save details', exact: true })).toBeEnabled();
  });
});
