import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanTypedTag, suggestTags, tagChoices } from '../lib/tagSuggestions.js';
import SavePanel from '../SavePanel.jsx';

afterEach(cleanup);

describe('local tag suggestions', () => {
  it('ranks existing library tags found in the text before built-in tags', () => {
    const text = 'Act as a reviewer. Refactor the Garden OS planner code and debug the save bug.';
    expect(suggestTags(text, { libraryTags: ['garden-os', 'Code', 'travel'] })).toEqual(['garden-os', 'Code', 'Role-play']);
  });

  it('skips selected tags case-insensitively, empty text and the limit', () => {
    const text = 'Write a blog post draft and proofread the email.';
    expect(suggestTags(text, { selected: ['writing'] })).toEqual([]);
    expect(suggestTags('')).toEqual([]);
    expect(suggestTags('Analyze metrics, write the email, debug the API, brainstorm a slogan.', { limit: 2 })).toHaveLength(2);
  });

  it('normalizes typed tags through the existing tag rules', () => {
    expect(cleanTypedTag('  #coding ')).toBe('Code');
    expect(cleanTypedTag('stream deck')).toBe('stream deck');
    expect(cleanTypedTag('x'.repeat(33))).toBe('');
    expect(cleanTypedTag('   ')).toBe('');
    expect(tagChoices({ builtIn: ['Code'], libraryTags: ['code', 'notion'], selected: ['custom'] })).toEqual(['Code', 'notion', 'custom']);
  });
});

describe('Save panel tags', () => {
  const theme = new Proxy({}, { get: () => '' });
  function Panel({ text = '', initialTags = [], libraryTags = [] }) {
    const [tags, setTags] = useState(initialTags);
    return <><SavePanel m={theme} primaryModKey="Ctrl" saveTargetId={null} saveTitle="T" setSaveTitle={vi.fn()}
      saveCollection="" setSaveCollection={vi.fn()} saveTags={tags} setSaveTags={setTags} changeNote="" setChangeNote={vi.fn()}
      collections={[]} showNewColl={false} setShowNewColl={vi.fn()} newCollName="" setNewCollName={vi.fn()}
      commitNewCollection={vi.fn()} doSave={vi.fn()} doSaveAsNew={vi.fn()} closeSavePanel={vi.fn()} canSavePanel
      libraryTags={libraryTags} tagSourceText={text} /><output>{JSON.stringify(tags)}</output></>;
  }
  const tags = () => JSON.parse(document.querySelector('output').textContent);

  it('shows library and already-selected custom tags so they can be kept or removed', () => {
    render(<Panel initialTags={['legacy-custom']} libraryTags={['notion']} />);
    const group = screen.getByRole('group', { name: 'Tags' });
    expect(within(group).getByRole('button', { name: 'legacy-custom' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'notion' }));
    fireEvent.click(within(group).getByRole('button', { name: 'legacy-custom' }));
    expect(tags()).toEqual(['notion']);
  });

  it('adds a suggestion only when picked and adds typed tags with Enter', () => {
    render(<Panel text="Debug the regex in this script." libraryTags={['regex']} />);
    expect(tags()).toEqual([]);
    const ideas = screen.getByRole('group', { name: 'Suggested tags' });
    fireEvent.click(within(ideas).getByRole('button', { name: 'Add suggested tag regex' }));
    expect(tags()).toEqual(['regex']);
    expect(within(ideas).queryByRole('button', { name: 'Add suggested tag regex' })).not.toBeInTheDocument();
    const input = screen.getByLabelText('Add a tag');
    fireEvent.change(input, { target: { value: 'stream deck' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(tags()).toEqual(['regex', 'stream deck']);
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'STREAM DECK' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(tags()).toEqual(['regex', 'stream deck']);
    fireEvent.change(input, { target: { value: 'y'.repeat(40) } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('status')).toHaveTextContent('up to 32 characters');
    expect(tags()).toEqual(['regex', 'stream deck']);
  });
});
