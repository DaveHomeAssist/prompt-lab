import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LibraryWorkspace from '../LibraryWorkspace.jsx';
import { inspectorMaxWidth } from '../lib/sidePane.js';

vi.mock('../icons.jsx', () => ({ default: () => null }));

const entry = { id: 'one', title: 'Handoff', original: 'Write a handoff.', enhanced: '', tags: [], collection: '', metadata: {}, versions: [] };

function makeLib() {
  return {
    library: [entry], trash: [], filtered: [entry], collections: [], allLibTags: [],
    search: '', setSearch: vi.fn(), sortBy: 'newest', setSortBy: vi.fn(),
    activeCollection: null, setActiveCollection: vi.fn(), activeTag: null, setActiveTag: vi.fn(),
    exportLib: vi.fn(), importLib: vi.fn(), updateEntries: vi.fn(), moveEntriesToCollection: vi.fn(),
    addTagToEntries: vi.fn(), deleteEntries: vi.fn(), restoreDeleted: vi.fn(), permanentlyDelete: vi.fn(),
    setFavorite: vi.fn(), duplicateEntry: vi.fn(), del: vi.fn(), restoreVersion: vi.fn(), trackRecentAccess: vi.fn(),
    saveFolders: vi.fn(),
  };
}

// jsdom has no layout. Give the workspace a width and let the drawer follow
// the stored drawer width (192 px when none is stored).
let workspaceWidth = 1440;
function fakeLayout() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth() {
    return this.classList?.contains('pl-library-workspace') ? workspaceWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    if (this.classList?.contains('pl-library-rail')) {
      const stored = parseFloat(this.parentElement.style.getPropertyValue('--pl-library-drawer-width'));
      const width = this.hidden ? 0 : (Number.isFinite(stored) ? stored : 192);
      return { left: 0, right: width, width, top: 0, bottom: 800, height: 800, x: 0, y: 0 };
    }
    if (this.classList?.contains('pl-library-workspace')) {
      return { left: 0, right: workspaceWidth, width: workspaceWidth, top: 0, bottom: 800, height: 800, x: 0, y: 0 };
    }
    return { left: 0, right: 0, width: 0, top: 0, bottom: 0, height: 0, x: 0, y: 0 };
  });
}

const renderLibrary = (props = {}) => render(<LibraryWorkspace m={{}} lib={makeLib()} loadEntry={vi.fn()} copy={vi.fn()} {...props} />);
const inspectorHandle = () => screen.getByRole('separator', { name: 'Resize prompt inspector' });
const drawerHandle = () => screen.queryByRole('separator', { name: 'Resize Library drawer' });
const workspace = () => document.querySelector('.pl-library-workspace');

beforeEach(() => { localStorage.clear(); workspaceWidth = 1440; fakeLayout(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('inspectorMaxWidth', () => {
  it('stops at 960 px, 70 percent of the workspace, or the room beside a 416 px list', () => {
    expect(inspectorMaxWidth(1920, 192)).toBe(960);
    expect(inspectorMaxWidth(1440, 0)).toBe(960);
    expect(inspectorMaxWidth(1440, 192)).toBe(800);
    expect(inspectorMaxWidth(1200, 0)).toBe(752);
    expect(inspectorMaxWidth(1000, 192)).toBe(360);
    expect(inspectorMaxWidth(600, 192)).toBe(260);
    expect(inspectorMaxWidth(0, 0)).toBe(960);
  });
});

describe('Library inspector width', () => {
  it('reaches the new cap by keyboard, keeping the results list at its minimum', () => {
    renderLibrary();
    expect(inspectorHandle()).toHaveAttribute('aria-valuemax', '800');
    expect(inspectorHandle()).toHaveAttribute('aria-valuenow', '336');
    fireEvent.keyDown(inspectorHandle(), { key: 'End' });
    expect(inspectorHandle()).toHaveAttribute('aria-valuenow', '800');
    expect(workspace().style.getPropertyValue('--pl-inspector-width')).toBe('800px');
    expect(JSON.parse(localStorage.getItem('pl2-inspector-width'))).toBe(800);

    // With the drawer hidden there is room for the full 960 px.
    fireEvent.click(screen.getByRole('button', { name: 'Hide Library drawer', expanded: true }));
    expect(inspectorHandle()).toHaveAttribute('aria-valuemax', '960');
    fireEvent.keyDown(inspectorHandle(), { key: 'End' });
    expect(inspectorHandle()).toHaveAttribute('aria-valuenow', '960');
    fireEvent.keyDown(inspectorHandle(), { key: 'ArrowLeft' });
    expect(inspectorHandle()).toHaveAttribute('aria-valuenow', '960');
    fireEvent.keyDown(inspectorHandle(), { key: 'ArrowRight' });
    expect(inspectorHandle()).toHaveAttribute('aria-valuenow', '936');
    fireEvent.keyDown(inspectorHandle(), { key: 'Home' });
    expect(inspectorHandle()).toHaveAttribute('aria-valuenow', '260');
    fireEvent.doubleClick(inspectorHandle());
    expect(inspectorHandle()).toHaveAttribute('aria-valuenow', '336');
  });

  it('reaches the cap by pointer on a narrower workspace', () => {
    workspaceWidth = 1200;
    localStorage.setItem('pl2-library-drawer', 'false');
    renderLibrary();
    const handle = inspectorHandle();
    const captured = new Set();
    Object.assign(handle, { setPointerCapture: (id) => captured.add(id), hasPointerCapture: (id) => captured.has(id), releasePointerCapture: (id) => captured.delete(id) });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 864 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });
    expect(handle).toHaveAttribute('aria-valuenow', '600');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10 });
    expect(handle).toHaveAttribute('aria-valuenow', '752');
    fireEvent.pointerUp(handle, { pointerId: 1 });
  });

  it('does not hold a floating inspector to the list width at 1100 px and below', () => {
    workspaceWidth = 1000;
    localStorage.setItem('pl2-inspector-width', '600');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query) => ({ matches: query === '(max-width: 1100px)', media: query }) });
    try {
      renderLibrary();
      expect(workspace().style.getPropertyValue('--pl-inspector-width')).toBe('600px');
    } finally {
      delete window.matchMedia;
    }
  });

  it('keeps a stored width but shows no more than the layout allows', () => {
    localStorage.setItem('pl2-inspector-width', '5000');
    renderLibrary();
    expect(inspectorHandle()).toHaveAttribute('aria-valuenow', '800');
    expect(workspace().style.getPropertyValue('--pl-inspector-width')).toBe('800px');
  });
});

describe('Library drawer width', () => {
  it('resizes by keyboard, persists, narrows the inspector cap, and resets on double-click', () => {
    const { unmount } = renderLibrary();
    expect(workspace()).toHaveClass('has-drawer-resizer');
    expect(drawerHandle()).toHaveAttribute('aria-valuenow', '192');
    expect(workspace().style.getPropertyValue('--pl-library-drawer-width')).toBe('');

    fireEvent.keyDown(drawerHandle(), { key: 'ArrowRight' });
    expect(drawerHandle()).toHaveAttribute('aria-valuenow', '216');
    expect(workspace().style.getPropertyValue('--pl-library-drawer-width')).toBe('216px');
    fireEvent.keyDown(drawerHandle(), { key: 'End' });
    expect(drawerHandle()).toHaveAttribute('aria-valuenow', '384');
    expect(JSON.parse(localStorage.getItem('pl2-library-drawer-width'))).toBe(384);
    expect(inspectorHandle()).toHaveAttribute('aria-valuemax', '608');

    unmount();
    renderLibrary();
    expect(drawerHandle()).toHaveAttribute('aria-valuenow', '384');
    expect(workspace().style.getPropertyValue('--pl-library-drawer-width')).toBe('384px');

    fireEvent.doubleClick(drawerHandle());
    expect(workspace().style.getPropertyValue('--pl-library-drawer-width')).toBe('');
    expect(JSON.parse(localStorage.getItem('pl2-library-drawer-width'))).toBeNull();
    expect(drawerHandle()).toHaveAttribute('aria-valuenow', '192');
  });

  it('follows the pointer from the drawer edge within its bounds', () => {
    renderLibrary();
    const handle = drawerHandle();
    const captured = new Set();
    Object.assign(handle, { setPointerCapture: (id) => captured.add(id), hasPointerCapture: (id) => captured.has(id), releasePointerCapture: (id) => captured.delete(id) });
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 192 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 250 });
    expect(handle).toHaveAttribute('aria-valuenow', '250');
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 40 });
    expect(handle).toHaveAttribute('aria-valuenow', '160');
  });

  it('has no handle while the drawer is hidden or on phone layouts', () => {
    localStorage.setItem('pl2-library-drawer', 'false');
    renderLibrary();
    expect(drawerHandle()).toBeNull();
    expect(workspace()).not.toHaveClass('has-drawer-resizer');
    cleanup();

    localStorage.setItem('pl2-library-mobile-drawer', 'true');
    renderLibrary({ compact: true });
    expect(screen.getByRole('dialog', { name: 'Library views' })).toBeInTheDocument();
    expect(drawerHandle()).toBeNull();
  });

  it('ignores an unusable stored drawer width', () => {
    localStorage.setItem('pl2-library-drawer-width', JSON.stringify('wide'));
    renderLibrary();
    expect(workspace().style.getPropertyValue('--pl-library-drawer-width')).toBe('');
  });
});
