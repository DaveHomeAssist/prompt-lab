import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WriteSidePanel from '../WriteSidePanel.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));

function Harness({ onClose = vi.fn(), ...props }) {
  const [tab, setTab] = useState('scratch');
  return (
    <WriteSidePanel m={{}} tab={tab} onTabChange={setTab} onClose={onClose} {...props}>
      <textarea aria-label={`${tab} content`} data-side-autofocus />
    </WriteSidePanel>
  );
}

afterEach(() => cleanup());

describe('WriteSidePanel', () => {
  it('switches between Scratch and Prompts by click and arrow keys, keeping focus on the tabs', () => {
    render(<Harness />);
    expect(screen.getByRole('complementary', { name: 'Scratch notes beside Write' })).toBeInTheDocument();
    const scratch = screen.getByRole('tab', { name: 'Scratch' });
    expect(scratch).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', scratch.id);

    fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
    expect(screen.getByRole('complementary', { name: 'Prompts beside Write' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'prompts content' })).toBeInTheDocument();

    const prompts = screen.getByRole('tab', { name: 'Prompts' });
    prompts.focus();
    fireEvent.keyDown(prompts, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Scratch' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Scratch' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Prompts' })).toHaveAttribute('tabindex', '-1');
  });

  it('closes from its close button, and on Escape only when it floats over the editor', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close side panel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const floating = vi.fn();
    render(<Harness onClose={floating} overlay />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(floating).toHaveBeenCalledTimes(1);
  });

  it('takes focus when it opens as a floating panel, but not as a column or on tab switches', async () => {
    render(<Harness />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body).toHaveFocus();
    cleanup();

    render(<Harness overlay />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole('textbox', { name: 'scratch content' })).toHaveFocus();
    const prompts = screen.getByRole('tab', { name: 'Prompts' });
    prompts.focus();
    fireEvent.click(prompts);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prompts).toHaveFocus();
  });

  it('floats above the phone navigation bar only when it floats', () => {
    const { rerender } = render(<WriteSidePanel m={{}} overlay aboveMobileNav width={400} />);
    const panel = screen.getByRole('complementary');
    expect(panel).toHaveClass('is-overlay', 'is-above-mobile-nav');
    rerender(<WriteSidePanel m={{}} aboveMobileNav />);
    expect(panel).not.toHaveClass('is-overlay');
    expect(panel).not.toHaveClass('is-above-mobile-nav');
  });
});
