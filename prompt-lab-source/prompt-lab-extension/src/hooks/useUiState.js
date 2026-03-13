import { useEffect, useState } from 'react';
import usePersistedState from '../usePersistedState.js';

export default function useUiState() {
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 420));
  const [colorMode, setColorMode] = usePersistedState('pl2-mode', 'dark', {
    validate: value => (value === 'dark' || value === 'light') ? value : 'dark',
  });
  const [tab, setTab] = useState('editor');
  const [toast, setToast] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return {
    viewportWidth,
    colorMode,
    setColorMode,
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
