import Ic from './icons.jsx';

export default function MobileNavigation({ primaryView, workspaceView, openCreateView, openSection, setPrimaryView }) {
  return (
    <nav className="pl-mobile-nav" aria-label="Primary mobile navigation">
      <button type="button" aria-current={primaryView === 'create' && workspaceView === 'editor' ? 'page' : undefined} onClick={() => openCreateView('editor')}><Ic n="Wand2" size={16} /><span>Write</span></button>
      <button type="button" data-testid="nav-library" aria-current={primaryView === 'create' && workspaceView === 'library' ? 'page' : undefined} onClick={() => openCreateView('library')}><Ic n="FolderOpen" size={16} /><span>Library</span></button>
      <button type="button" aria-current={primaryView === 'create' && workspaceView === 'composer' ? 'page' : undefined} onClick={() => openCreateView('composer')}><Ic n="Layers" size={16} /><span>Compose</span></button>
      <button type="button" aria-current={primaryView === 'create' && workspaceView === 'split' ? 'page' : undefined} onClick={() => openCreateView('split')}><Ic n="PanelRight" size={16} /><span>Dual</span></button>
      <button type="button" aria-current={primaryView === 'runs' ? 'page' : undefined} onClick={() => openSection('evaluate')}><Ic n="FlaskConical" size={16} /><span>Evaluate</span></button>
      <button type="button" aria-current={primaryView === 'notebook' ? 'page' : undefined} onClick={() => setPrimaryView('notebook')}><Ic n="FileText" size={16} /><span>Scratch</span></button>
    </nav>
  );
}
