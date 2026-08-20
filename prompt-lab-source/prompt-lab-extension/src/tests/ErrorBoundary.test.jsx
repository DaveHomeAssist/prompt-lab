import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ErrorBoundary from '../ErrorBoundary.jsx';

describe('ErrorBoundary', () => {
  it('links Report issue to the current PromptLab repository', () => {
    const boundary = createRef();
    render(<ErrorBoundary ref={boundary} />);
    act(() => boundary.current.setState({ error: new Error('Cannot read properties of null') }));

    expect(screen.getByRole('link', { name: 'Report issue' })).toHaveAttribute(
      'href',
      'https://github.com/DaveHomeAssist/prompt-lab/issues/new',
    );
  });
});
