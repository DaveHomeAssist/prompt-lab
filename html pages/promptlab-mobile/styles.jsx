// styles.jsx — PromptLab mobile design tokens + theme map.
// Exposes: makeTheme(tweaks), ACCENTS, ICONS

const PL_ACCENTS = {
  violet: { hue: 268, name: 'Violet' },
  teal:   { hue: 175, name: 'Teal'   },
  amber:  { hue: 35,  name: 'Amber'  },
  mono:   { hue: 0,   name: 'Mono', mono: true },
};

const PL_TYPE_SCALES = {
  small:  { base: 14, step: 2,  display: 28 },
  medium: { base: 15, step: 2,  display: 32 },
  large:  { base: 16, step: 2,  display: 36 },
};

// makeTheme builds a token map for the current Tweaks combo.
// Keeps every color in oklch except where iOS/Android system surfaces
// demand exact values (status bar, home indicator) — those live in the frame.
function makeTheme({ accent = 'violet', dark = true, type = 'medium', cardStyle = 'flat' } = {}) {
  const acc = PL_ACCENTS[accent] || PL_ACCENTS.violet;
  const ts = PL_TYPE_SCALES[type] || PL_TYPE_SCALES.medium;
  const isDark = dark;

  const accentSolid = acc.mono
    ? (isDark ? 'oklch(0.85 0 0)' : 'oklch(0.25 0 0)')
    : `oklch(0.66 0.18 ${acc.hue})`;
  const accentSoft = acc.mono
    ? (isDark ? 'oklch(0.85 0 0 / 0.16)' : 'oklch(0.25 0 0 / 0.10)')
    : `oklch(0.66 0.18 ${acc.hue} / 0.16)`;
  const accentEdge = acc.mono
    ? (isDark ? 'oklch(0.85 0 0 / 0.32)' : 'oklch(0.25 0 0 / 0.22)')
    : `oklch(0.66 0.18 ${acc.hue} / 0.36)`;
  const accentInk = acc.mono
    ? (isDark ? 'oklch(0.92 0 0)' : 'oklch(0.18 0 0)')
    : `oklch(0.78 0.16 ${acc.hue})`;

  const bg     = isDark ? 'oklch(0.16 0.012 280)' : 'oklch(0.985 0.003 280)';
  const bgDeep = isDark ? 'oklch(0.13 0.012 280)' : 'oklch(0.965 0.004 280)';
  const surface= isDark ? 'oklch(0.21 0.014 280)' : 'oklch(1 0 0)';
  const surface2=isDark ? 'oklch(0.245 0.014 280)': 'oklch(0.975 0.004 280)';
  const border = isDark ? 'oklch(1 0 0 / 0.08)'   : 'oklch(0 0 0 / 0.06)';
  const borderStrong = isDark ? 'oklch(1 0 0 / 0.14)' : 'oklch(0 0 0 / 0.10)';
  const text   = isDark ? 'oklch(0.98 0.003 280)' : 'oklch(0.16 0.012 280)';
  const textMuted = isDark ? 'oklch(0.72 0.01 280)' : 'oklch(0.45 0.01 280)';
  const textSub   = isDark ? 'oklch(0.85 0.01 280)' : 'oklch(0.32 0.01 280)';
  const textFaint = isDark ? 'oklch(0.55 0.01 280)' : 'oklch(0.62 0.01 280)';

  // Card styling presets
  const card = (() => {
    if (cardStyle === 'outlined') return {
      background: surface,
      border: `1px solid ${borderStrong}`,
      boxShadow: 'none',
    };
    if (cardStyle === 'elevated') return {
      background: surface,
      border: `1px solid ${border}`,
      boxShadow: isDark
        ? '0 1px 2px oklch(0 0 0 / 0.5), 0 8px 24px oklch(0 0 0 / 0.35)'
        : '0 1px 2px oklch(0 0 0 / 0.06), 0 8px 24px oklch(0 0 0 / 0.06)',
    };
    return { // flat
      background: surface,
      border: `0.5px solid ${border}`,
      boxShadow: 'none',
    };
  })();

  return {
    accent: { solid: accentSolid, soft: accentSoft, edge: accentEdge, ink: accentInk, name: acc.name },
    bg, bgDeep, surface, surface2, border, borderStrong,
    text, textMuted, textSub, textFaint,
    card,
    type: {
      base: ts.base,
      step: ts.step,
      display: ts.display,
      // utilities
      h1: ts.display,
      h2: ts.base + 8,
      h3: ts.base + 4,
      body: ts.base,
      cap: ts.base - 2,
      micro: ts.base - 3,
    },
    isDark,
    cardStyle,
    accentName: accent,
  };
}

// Inline SVG icons sized to currentColor. Lightweight so screens stay snappy.
const PL_ICONS = {
  search: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m11 11 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  wand: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="m3 13 8-8M11 3l2 2M9.5 4.5 11.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5 2v2M4 3h2M13 9v2M12 10h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  library: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="3" height="10" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="6.5" y="3" width="3" height="10" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="m11.5 4.5 2.3 8.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  pad: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M3.5 2h7l2.5 2.5V14H3.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  mic: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <rect x="6" y="2" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14M5.5 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  send: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M2.5 8 13.5 3 11 13l-3.5-3.5L2.5 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  plus: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  back: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  more: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <circle cx="3" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="13" cy="8" r="1.2" fill="currentColor" />
    </svg>
  ),
  close: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  share: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M8 2v8m0-8L5 5m3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 9v4a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  filter: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  copy: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 11V3a1 1 0 0 1 1-1h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  sparkle: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M8 2 9.2 6.8 14 8l-4.8 1.2L8 14l-1.2-4.8L2 8l4.8-1.2L8 2Z" fill="currentColor" />
    </svg>
  ),
  check: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  link: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M6.5 9.5 9.5 6.5M6.5 4.5 8 3a3 3 0 0 1 4.2 4.2L10.5 9M9.5 11.5 8 13a3 3 0 0 1-4.2-4.2L5.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

Object.assign(window, { makeTheme: makeTheme, PL_ACCENTS, PL_ICONS, PL_TYPE_SCALES });
