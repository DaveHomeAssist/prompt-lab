import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import PanelResizer, { clampWidth } from '../PanelResizer.jsx';

function Harness({ side = 'start', initial = 240 }) {
  const [width, setWidth] = useState(initial);
  return <PanelResizer label="Resize panel" width={width} min={180} max={480} defaultWidth={240} onResize={setWidth} side={side} getEdge={() => 0} />;
}

const handle = () => screen.getByRole('separator', { name: 'Resize panel' });

describe('PanelResizer', () => {
  it('exposes its width and bounds to assistive technology', () => {
    render(<Harness />);
    expect(handle()).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle()).toHaveAttribute('aria-valuemin', '180');
    expect(handle()).toHaveAttribute('aria-valuemax', '480');
    expect(handle()).toHaveAttribute('aria-valuenow', '240');
    expect(handle()).toHaveAttribute('tabindex', '0');
  });

  it('grows a start-side panel with ArrowRight and shrinks it with ArrowLeft', () => {
    render(<Harness side="start" />);
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(handle()).toHaveAttribute('aria-valuenow', '264');
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(handle()).toHaveAttribute('aria-valuenow', '216');
  });

  it('grows an end-side panel with ArrowLeft', () => {
    render(<Harness side="end" />);
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(handle()).toHaveAttribute('aria-valuenow', '264');
  });

  it('jumps to the bounds with Home and End, clamps, and resets on double-click', () => {
    render(<Harness initial={470} />);
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(handle()).toHaveAttribute('aria-valuenow', '480');
    fireEvent.keyDown(handle(), { key: 'Home' });
    expect(handle()).toHaveAttribute('aria-valuenow', '180');
    fireEvent.keyDown(handle(), { key: 'End' });
    expect(handle()).toHaveAttribute('aria-valuenow', '480');
    fireEvent.doubleClick(handle());
    expect(handle()).toHaveAttribute('aria-valuenow', '240');
  });

  it('clamps invalid widths to the minimum', () => {
    expect(clampWidth(Number.NaN, 100, 200)).toBe(100);
    expect(clampWidth(150.6, 100, 200)).toBe(151);
    expect(clampWidth(999, 100, 200)).toBe(200);
  });
});
