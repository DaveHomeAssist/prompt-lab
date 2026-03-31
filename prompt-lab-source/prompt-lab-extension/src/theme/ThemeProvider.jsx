import { createContext, useContext, useEffect, useMemo } from 'react';

const ThemeContext = createContext({
  mode: 'dark',
  getTagChipClass: () => '',
});

const TAG_STYLE_BY_MODE = {
  dark: {
    Writing: 'border-blue-500/40 bg-blue-500/20 text-blue-200',
    Code: 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200',
    Research: 'border-violet-500/40 bg-violet-500/20 text-violet-200',
    Analysis: 'border-amber-500/40 bg-amber-500/20 text-amber-200',
    Creative: 'border-pink-500/40 bg-pink-500/20 text-pink-200',
    System: 'border-rose-500/40 bg-rose-500/20 text-rose-200',
    'Role-play': 'border-orange-500/40 bg-orange-500/20 text-orange-200',
    Other: 'border-gray-500/40 bg-gray-500/20 text-gray-200',
    default: 'border-gray-500/40 bg-gray-500/20 text-gray-200',
    selectedRing: 'ring-2 ring-violet-300 ring-offset-1 ring-offset-gray-950',
  },
  light: {
    Writing: 'border-blue-300 bg-blue-50 text-blue-700',
    Code: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    Research: 'border-violet-300 bg-violet-50 text-violet-700',
    Analysis: 'border-amber-300 bg-amber-50 text-amber-700',
    Creative: 'border-pink-300 bg-pink-50 text-pink-700',
    System: 'border-rose-300 bg-rose-50 text-rose-700',
    'Role-play': 'border-orange-300 bg-orange-50 text-orange-700',
    Other: 'border-gray-300 bg-gray-50 text-gray-700',
    default: 'border-gray-300 bg-gray-50 text-gray-700',
    selectedRing: 'ring-2 ring-violet-400 ring-offset-1 ring-offset-white',
  },
};

function buildTagChipClass(mode, tag, selected, clickable) {
  const theme = TAG_STYLE_BY_MODE[mode] || TAG_STYLE_BY_MODE.dark;
  const tone = theme[tag] || theme.default;
  const selectedClass = selected ? `${theme.selectedRing} opacity-100` : 'opacity-80 hover:opacity-100';
  const cursorClass = clickable ? 'cursor-pointer' : '';
  return `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-all ${tone} ${selectedClass} ${cursorClass}`;
}

export function ThemeProvider({ mode = 'dark', children }) {
  const value = useMemo(() => ({
    mode,
    getTagChipClass: ({ tag, selected = false, clickable = false }) => buildTagChipClass(mode, tag, selected, clickable),
  }), [mode]);

  useEffect(() => {
    document.body.style.background = mode === 'light' ? '#e2e8f0' : '#030712';
  }, [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeTokens() {
  return useContext(ThemeContext);
}
