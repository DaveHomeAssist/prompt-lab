export default function MainWorkspace({
  m,
  compact,
  pageScroll,
  showEditorPane,
  showLibraryPane,
  editorPane,
  libraryPane,
}) {
  const dualPane = showEditorPane && showLibraryPane && !compact;
  const gridCols = dualPane ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-1';
  const rootClass = (pageScroll && !dualPane)
    ? `grid ${gridCols} min-h-0`
    : `grid ${gridCols} flex-1 min-h-0 overflow-hidden`;
  const paneOverflowClass = pageScroll && !dualPane ? '' : 'overflow-hidden';

  return (
    <div className={rootClass}>
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

      {showLibraryPane && (
        <aside className={`min-w-0 min-h-0 flex flex-col ${paneOverflowClass}`} aria-label="Prompt library sidebar">
          {libraryPane}
        </aside>
      )}
    </div>
  );
}
