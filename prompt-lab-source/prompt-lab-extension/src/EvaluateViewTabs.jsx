import { SUBVIEWS } from './lib/navigationRegistry.js';
import { handleTabArrowKeys } from './hooks/useDialogA11y.js';
import ProBadge from './ProBadge.jsx';

/**
 * Underline sub-tabs for Evaluate, rendered in the page body.
 * The header workspace tabs stay pills; these stay a separate tablist so
 * History and Compare are not a second highlighted copy of the main tabs.
 */
export default function EvaluateViewTabs({ runsView, openRunsView, lockedRunsViews = {} }) {
  return (
    <div
      role="tablist"
      aria-label="Evaluate views"
      className="pl-subtabs"
      onKeyDown={(event) => handleTabArrowKeys(event, runsView, openRunsView)}
    >
      {SUBVIEWS.runs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          id={`evaluate-tab-${id}`}
          data-tab-id={id}
          role="tab"
          aria-selected={runsView === id}
          aria-controls={`evaluate-panel-${id}`}
          tabIndex={runsView === id ? 0 : -1}
          onClick={() => openRunsView(id)}
        >
          {label}
          {lockedRunsViews?.[id] && <ProBadge />}
        </button>
      ))}
    </div>
  );
}
