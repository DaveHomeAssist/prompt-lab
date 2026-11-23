import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PromptVariableDialog from '../modals/PromptVariableDialog.jsx';

const theme = { modalBg: 'bg', modal: 'modal', text: 'text', textAlt: 'alt', textMuted: 'muted', input: 'input', btn: 'btn' };

describe('PromptVariableDialog', () => {
  it('names each variable, offers recent values, and submits or cancels', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const onChange = vi.fn();
    render(
      <PromptVariableDialog
        m={theme}
        request={{
          manual: [{ name: 'topic', defaultValue: null }, { name: 'audience', defaultValue: 'the team' }],
          values: { topic: 'launch', audience: 'the team' },
          recent: { topic: { last: 'launch', recent: ['launch', 'retro'] } },
        }}
        onChange={onChange}
        onSubmit={onSubmit}
        onSkip={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Fill in prompt variables' });
    expect(dialog).toHaveAccessibleDescription(/remembered for this prompt/);
    expect(screen.getByLabelText('{{topic}}')).toHaveValue('launch');
    expect(screen.getByLabelText('{{audience}}')).toHaveValue('the team');
    fireEvent.change(screen.getByLabelText('{{topic}}'), { target: { value: 'retro' } });
    expect(onChange).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use these values' }));
    expect(onSubmit).toHaveBeenCalledWith({ topic: 'launch', audience: 'the team' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
