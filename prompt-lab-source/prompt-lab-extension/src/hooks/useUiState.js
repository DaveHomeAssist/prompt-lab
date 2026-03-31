import { useEffect, useState } from 'react';
import usePersistedState from '../usePersistedState.js';
import { deriveTab, resolveTabState } from '../lib/navigationRegistry.js';

export default function useUiState() {
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 420));
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 720));
  const [colorMode, setColorMode] = usePersistedState('pl2-mode', 'dark', {
    validate: value => (value === 'dark' || value === 'light') ? value : 'dark',
  });
  const [density, setDensity] = usePersistedState('pl2-density', 'comfortable', {
    validate: value => ['compact', 'comfortable', 'spacious'].includes(value) ? value : 'comfortable',
  });
  const [primaryView, setPrimaryView] = useState('create');
  const [workspaceView, setWorkspaceView] = useState('editor');
  const [runsView, setRunsView] = useState('history');
  const [toast, setToast] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');

  const tab = deriveTab(primaryView, workspaceView, runsView);

  const setTab = (nextTab) => {
    const nextState = resolveTabState(nextTab);
    if (nextState.primaryView) setPrimaryView(nextState.primaryView);
    if (nextState.workspaceView) setWorkspaceView(nextState.workspaceView);
    if (nextState.runsView) setRunsView(nextState.runsView);
  };

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return {
    viewportWidth,
    viewportHeight,
    colorMode,
    setColorMode,
    density,
    setDensity,
    primaryView,
    setPrimaryView,
    workspaceView,
    setWorkspaceView,
    runsView,
    setRunsView,
    tab,
    setTab,
    toast,
    setToast,
    notify: message => setToast(message),
    showSettings,
    setShowSettings,
    showCmdPalette,
    setShowCmdPalette,
    showShortcuts,
    setShowShortcuts,
    cmdQuery,
    setCmdQuery,
  };
}
