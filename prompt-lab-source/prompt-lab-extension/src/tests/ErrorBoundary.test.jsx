import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '../ErrorBoundary.jsx';

describe('ErrorBoundary', () => {
  it('opens the reviewable report flow without immediately navigating to GitHub', () => {
    const showReport = vi.fn();
    window.addEventListener('promptlab:report-problem', showReport);
    const boundary = createRef();
    render(<ErrorBoundary ref={boundary} />);
    act(() => boundary.current.setState({ error: new Error('Cannot read properties of null') }));

    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }));
    expect(showReport).toHaveBeenCalledOnce();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    window.removeEventListener('promptlab:report-problem', showReport);
  });
});
