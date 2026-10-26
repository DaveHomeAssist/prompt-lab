// Vertical splitter for a side panel whose width the user controls.
// `side` says where the panel sits relative to the handle: a 'start' panel
// (left of the handle) grows when the pointer or ArrowRight moves right; an
// 'end' panel (right of the handle) grows when they move left.

export function clampWidth(width, min, max) {
  if (!Number.isFinite(width)) return min;
  return Math.round(Math.max(min, Math.min(max, width)));
}

export default function PanelResizer({
  label,
  width,
  min,
  max,
  defaultWidth,
  onResize,
  side = 'start',
  getEdge,
  // Optional. Double-click calls this instead of resizing to defaultWidth, for
  // panels whose default comes from the layout rather than a fixed number.
  onReset,
  step = 24,
  className = '',
}) {
  const resize = (next) => onResize(clampWidth(next, min, max));
  const grow = side === 'start' ? 'ArrowRight' : 'ArrowLeft';
  const shrink = side === 'start' ? 'ArrowLeft' : 'ArrowRight';

  const onKeyDown = (event) => {
    if (event.key === grow) resize(width + step);
    else if (event.key === shrink) resize(width - step);
    else if (event.key === 'Home') resize(min);
    else if (event.key === 'End') resize(max);
    else return;
    event.preventDefault();
  };

  const widthAt = (clientX) => {
    const edge = getEdge?.();
    if (!Number.isFinite(edge)) return width;
    return side === 'start' ? clientX - edge : edge - clientX;
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      title={`${label}. Drag or use arrow keys; double-click to reset.`}
      className={`pl-panel-resizer ${className}`.trim()}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault(); }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
        resize(widthAt(event.clientX));
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)}
      onDoubleClick={() => (onReset ? onReset() : resize(defaultWidth))}
    >
      <span aria-hidden="true" />
    </div>
  );
}
