// Width bounds for the panel beside the Write editor (Scratch), in pixels.
export const SIDE_PANE_WIDTH = Object.freeze({ min: 280, max: 720, default: 360 });

// Views of the panel beside Write. Scratch shows notes; the other three list
// prompts with the Library's smart-view rules.
export const WRITE_SIDE_VIEWS = Object.freeze(['scratch', 'all', 'recent', 'favorites']);
export const WRITE_PROMPT_VIEWS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'recent', label: 'Recent' },
  { id: 'favorites', label: 'Favorites' },
]);

// Library folder drawer. Without a stored width the drawer keeps the width the
// layout gives it at each breakpoint.
export const LIBRARY_DRAWER_WIDTH = Object.freeze({ min: 160, max: 384, default: 192 });

// Library inspector: at most 960 px or 70 percent of the workspace, and never
// so wide that the results list drops below its minimum width (26rem, where
// result cards still show a readable title beside their actions).
export const INSPECTOR_WIDTH = Object.freeze({ min: 260, max: 960, ratio: 0.7, default: 336 });
export const LIBRARY_LIST_MIN_WIDTH = 416;
// Room kept for the two resize handles (wider on touch screens). The CSS cap
// in index.css subtracts the same 28rem (list minimum plus handles).
export const LIBRARY_HANDLE_ALLOWANCE = 32;

export function inspectorMaxWidth(workspaceWidth, drawerWidth = 0) {
  if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) return INSPECTOR_WIDTH.max;
  const besideList = workspaceWidth - (Number.isFinite(drawerWidth) ? drawerWidth : 0) - LIBRARY_LIST_MIN_WIDTH - LIBRARY_HANDLE_ALLOWANCE;
  return Math.max(INSPECTOR_WIDTH.min, Math.floor(Math.min(INSPECTOR_WIDTH.max, workspaceWidth * INSPECTOR_WIDTH.ratio, besideList)));
}
