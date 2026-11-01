import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactTitle, suggestTitleAlternatives } from '../lib/titleSuggestions.js';
import { suggestTitleFromText } from '../lib/promptSchema.js';
import SavePanel from '../SavePanel.jsx';

afterEach(cleanup);

describe('local title alternatives', () => {
  it('starts with the existing automatic suggestion, then a compact and a role-qualified idea', () => {
    const text = 'You are a senior product editor. Summarize the following meeting notes into action items for the team.';
    const ideas = suggestTitleAlternatives(text);
    expect(ideas[0]).toBe(suggestTitleFromText(text));
    expect(ideas[0]).toBe('Summarize the following meeting notes into action items for…');
    expect(ideas[1]).toBe('Summarize Meeting Notes Action Items');
    expect(ideas[2]).toBe('Senior Product Editor: Summarize Meeting Notes Action Items');
  });

  it('keeps acronyms and short titles, and skips duplicates of the current title', () => {
    expect(compactTitle('Review the API PR for v2 regressions')).toBe('Review API PR v2 Regressions');
    expect(compactTitle('Fix login')).toBe('');
    expect(suggestTitleAlternatives('# Release notes\nWrite them.', { current: 'release notes' })).toEqual([]);
    expect(suggestTitleAlternatives('Title: Weekly status digest\nCollect updates.')).toEqual(['Weekly status digest']);
  });

  it('offers nothing for empty input and never more than the limit', () => {
    expect(suggestTitleAlternatives('')).toEqual([]);
    expect(suggestTitleAlternatives('   ')).toEqual([]);
    expect(suggestTitleAlternatives('You are a careful analyst. Compare these two vendor proposals on cost and risk.', { limit: 2 })).toHaveLength(2);
  });
});

describe('Save panel title suggestions', () => {
  const theme = new Proxy({}, { get: () => '' });
  function Panel({ text, initial = '' }) {
    const [title, setTitle] = useState(initial);
    return <SavePanel m={theme} primaryModKey="Ctrl" saveTargetId={null} saveTitle={title} setSaveTitle={setTitle}
      saveCollection="" setSaveCollection={vi.fn()} saveTags={[]} setSaveTags={vi.fn()} changeNote="" setChangeNote={vi.fn()}
      collections={[]} showNewColl={false} setShowNewColl={vi.fn()} newCollName="" setNewCollName={vi.fn()}
      commitNewCollection={vi.fn()} doSave={vi.fn()} doSaveAsNew={vi.fn()} closeSavePanel={vi.fn()} canSavePanel
      titleSourceText={text} />;
  }

  it('fills the title only when a suggestion is picked and keeps typed titles', () => {
    render(<Panel text="You are a code reviewer. Review the pull request for security regressions." initial="My own name" />);
    const title = screen.getByLabelText('Title');
    expect(title).toHaveValue('My own name');
    const group = screen.getByRole('group', { name: 'Title suggestions' });
    fireEvent.click(within(group).getByRole('button', { name: 'Use title: Review Pull Request Security Regressions' }));
    expect(title).toHaveValue('Review Pull Request Security Regressions');
    expect(title).toHaveFocus();
    expect(within(group).queryByRole('button', { name: 'Use title: Review Pull Request Security Regressions' })).not.toBeInTheDocument();
  });

  it('hides the suggestion row when there is no prompt text', () => {
    render(<Panel text="" />);
    expect(screen.queryByRole('group', { name: 'Title suggestions' })).not.toBeInTheDocument();
  });
});

describe('title suggestions with standalone punctuation', () => {
  it('does not throw on a standalone colon or semicolon', () => {
    expect(() => compactTitle('Review this code : find bugs ; fast')).not.toThrow();
    expect(() => suggestTitleAlternatives('Review this code : find bugs ; and report them')).not.toThrow();
    expect(compactTitle('Review this code : find bugs ; fast')).toBe('Review Code Find Bugs Fast');
  });
});
