import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import TemplateVariablesModal from '../modals/TemplateVariablesModal.jsx';

vi.mock('../icons', () => ({ default: () => null }));

const theme = { modalBg: '', modal: '', text: '', textSub: '', textAlt: '', textBody: '', input: '', btn: '' };

function Harness({ inputs, applyTemplate, skipTemplate }) {
  const [varVals, setVarVals] = useState({ audience: '', tone: '' });
  return <TemplateVariablesModal m={theme} varVals={varVals} setVarVals={setVarVals}
    pendingTemplate={{ title: 'Launch brief' }} pendingTemplateInputMap={inputs}
    applyTemplate={applyTemplate} skipTemplate={skipTemplate} onClose={vi.fn()} />;
}

describe('TemplateVariablesModal required inputs', () => {
  it('keeps Apply disabled until every required input has a value, while Skip stays available', () => {
    const applyTemplate = vi.fn();
    const skipTemplate = vi.fn();
    render(<Harness applyTemplate={applyTemplate} skipTemplate={skipTemplate}
      inputs={{ audience: { label: 'Audience', required: true }, tone: { label: 'Tone' } }} />);

    const apply = screen.getByRole('button', { name: 'Apply Template' });
    expect(apply).toBeDisabled();
    expect(screen.getByText('Required: Audience')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Audience' })).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('textbox', { name: 'Tone' })).not.toHaveAttribute('aria-required');

    fireEvent.change(screen.getByRole('textbox', { name: 'Audience' }), { target: { value: '   ' } });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Audience' }), { target: { value: 'Board' } });
    expect(apply).toBeEnabled();
    expect(screen.queryByText(/^Required:/)).not.toBeInTheDocument();
    fireEvent.click(apply);
    expect(applyTemplate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(skipTemplate).toHaveBeenCalledTimes(1);
  });

  it('allows Apply immediately when no input is marked required', () => {
    render(<Harness applyTemplate={vi.fn()} skipTemplate={vi.fn()} inputs={{ audience: { label: 'Audience' } }} />);
    expect(screen.getByRole('button', { name: 'Apply Template' })).toBeEnabled();
  });
});
