import { useRef } from 'react';
import PanelResizer from './PanelResizer.jsx';
import { SIDE_PANE_WIDTH } from './lib/sidePane.js';

export default function MainWorkspace({
  m,
  compact,
  pageScroll,
  showEditorPane,
  showLibraryPane,
  editorPane,
  libraryPane,
  libraryIsWorkspace = false,
  // Optional panel beside the editor (Scratch or Prompts in Write). 'column'
  // places it in a resizable column; 'overlay' floats it over the editor on
  // narrow screens.
  sidePane = null,
  sidePaneMode = 'column',
  sidePaneWidth = SIDE_PANE_WIDTH.default,
  onSidePaneResize,
}) {
  const rootRef = useRef(null);
  const sideColumn = Boolean(sidePane) && showEditorPane && !showLibraryPane && sidePaneMode === 'column';
  const sideOverlay = Boolean(sidePane) && showEditorPane && !showLibraryPane && sidePaneMode === 'overlay';
  const dualPane = showEditorPane && showLibraryPane && !compact;
  const gridCols = dualPane ? 'grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]' : 'grid-cols-1';
  const singlePaneScrollFlow = (pageScroll || compact) && !dualPane;
  const rootClass = singlePaneScrollFlow
    ? `grid ${gridCols} min-h-0`
    : `grid ${gridCols} flex-1 min-h-0 overflow-hidden`;
  const paneOverflowClass = singlePaneScrollFlow ? '' : 'overflow-hidden';
  const rootStyle = sideColumn
    ? { gridTemplateColumns: `minmax(0, 1fr) auto ${Math.round(sidePaneWidth)}px` }
    : undefined;

  return (
    <div ref={rootRef} className={`${rootClass}${sideOverlay ? ' relative' : ''}`} style={rootStyle} data-side-pane={sideColumn ? 'column' : sideOverlay ? 'overlay' : undefined}>
      {showEditorPane && (
        <section
          className={`min-w-0 min-h-0 flex flex-col ${paneOverflowClass} ${
            showLibraryPane && !compact ? `border-r ${m.border}` : ''
          }`}
          aria-label="Prompt editor workspace"
        >
          {editorPane}
        </section>
      )}

      {sideColumn && (
        <>
          <PanelResizer
            label="Resize side panel"
            width={sidePaneWidth}
            min={SIDE_PANE_WIDTH.min}
            max={SIDE_PANE_WIDTH.max}
            defaultWidth={SIDE_PANE_WIDTH.default}
            onResize={(width) => onSidePaneResize?.(width)}
            side="end"
            getEdge={() => rootRef.current?.getBoundingClientRect().right}
          />
          <div className={`min-w-0 min-h-0 flex flex-col ${pageScroll ? 'pl-side-pane-sticky' : paneOverflowClass}`}>{sidePane}</div>
        </>
      )}

      {sideOverlay && sidePane}

      {showLibraryPane && (libraryIsWorkspace ? (
        <section className={`relative min-w-0 min-h-0 flex flex-col ${paneOverflowClass}`} aria-label="Prompt library workspace">
          {libraryPane}
        </section>
      ) : (
        <aside className={`min-w-0 min-h-0 flex flex-col ${paneOverflowClass}`} aria-label="Prompt library sidebar">
          {libraryPane}
        </aside>
      ))}
    </div>
  );
}
