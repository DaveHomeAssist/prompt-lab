import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FollowUpPanel from '../FollowUpPanel.jsx';

vi.mock('../icons.jsx', () => ({
  default: () => null,
}));

const m = {
  surface: 'surface',
  border: 'border',
  textSub: 'text-sub',
  textMuted: 'text-muted',
  textAlt: 'text-alt',
  btn: 'button',
  codeBlock: 'code',
};

describe('FollowUpPanel', () => {
  it('shows provenance and exposes use, chain, save, and copy actions', () => {
    const handlers = {
      onFetch: vi.fn(),
      onUse: vi.fn(),
      onChain: vi.fn(),
      onSave: vi.fn(),
      onCopy: vi.fn(),
    };
    const suggestion = { title: 'Audit gaps', prompt: 'Audit this output for missing risks.' };

    render(
      <FollowUpPanel
        m={m}
        source={{ label: 'Actual output from openai' }}
        canSuggest
        suggestions={[suggestion]}
        {...handlers}
      />,
    );

    expect(screen.getByTestId('follow-up-source')).toHaveTextContent('Actual output from openai');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chain' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy follow-up: Audit gaps' }));

    expect(handlers.onFetch).toHaveBeenCalledTimes(1);
    expect(handlers.onUse).toHaveBeenCalledWith(suggestion);
    expect(handlers.onChain).toHaveBeenCalledWith(suggestion);
    expect(handlers.onSave).toHaveBeenCalledWith(suggestion);
    expect(handlers.onCopy).toHaveBeenCalledWith(suggestion.prompt);
  });

  it('stays hidden when there is no valid source', () => {
    render(<FollowUpPanel m={m} canSuggest={false} onFetch={vi.fn()} />);
    expect(screen.queryByTestId('follow-up-panel')).not.toBeInTheDocument();
  });
});
