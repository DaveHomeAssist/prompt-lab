import Ic from './icons.jsx';
import { SUBVIEWS } from './lib/navigationRegistry.js';

const ICONS = {
  editor: 'Wand2',
  library: 'FolderOpen',
  composer: 'Layers',
  evaluate: 'FlaskConical',
  scratch: 'FileText',
};

// The phone bar only renders below the dual-pane breakpoint (compact < 720).
// Dual Pane is marked hideCompact in the navigation registry, so it stays off
// this bar: six labels at ~8px were unreadable, and the split workspace is
// not usable at phone width.
export default function MobileNavigation({ primaryView, workspaceView, openCreateView, openSection, setPrimaryView }) {
  const items = [
    ...SUBVIEWS.create.filter((item) => !item.hideCompact).map((item) => ({
      id: item.id,
      label: item.label,
      icon: ICONS[item.id],
      current: primaryView === 'create' && workspaceView === item.id,
      onClick: () => openCreateView(item.id),
      testId: item.id === 'library' ? 'nav-library' : undefined,
    })),
    {
      id: 'evaluate',
      label: 'Evaluate',
      icon: ICONS.evaluate,
      current: primaryView === 'runs',
      onClick: () => openSection('evaluate'),
    },
    {
      id: 'scratch',
      label: 'Scratch',
      icon: ICONS.scratch,
      current: primaryView === 'notebook',
      onClick: () => setPrimaryView('notebook'),
    },
  ];

  return (
    <nav className="pl-mobile-nav" aria-label="Primary mobile navigation">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-testid={item.testId}
          aria-current={item.current ? 'page' : undefined}
          onClick={item.onClick}
        >
          <Ic n={item.icon} size={16} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
