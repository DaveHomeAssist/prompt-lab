// screens.jsx — PromptLab mobile screens (platform-neutral, fits inside iOS/Android frames)
// Exposes a single Screen component that switches on `route`. The frames provide their own
// chrome (status bar, home indicator, nav bar) — these screens render the *content* only,
// scaled to fit 402×~795 (iOS interior) or 412×~810 (Android interior).
//
// Routes:
//   library          — list of saved prompts with tabs/search
//   library-detail   — expanded prompt entry
//   composer         — write/edit + enhance bar
//   streaming        — provider response streaming in
//   voice            — full-screen mic capture with waveform
//   pad-list         — notebook pad index
//   pad-detail       — single pad with markdown body

const { useState, useEffect, useRef } = React;

// ── shared bits ──────────────────────────────────────────────────────────
function PLTopBar({ theme, title, leading, trailing, subtitle }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 16px 12px', minHeight: 48,
    }}>
      <div style={{ width: 40, display: 'flex', justifyContent: 'flex-start' }}>{leading}</div>
      <div style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column' }}>
        {title && <div style={{ fontSize: theme.type.h3, fontWeight: 600, color: theme.text, letterSpacing: -0.2 }}>{title}</div>}
        {subtitle && <div style={{ fontSize: theme.type.micro, color: theme.textMuted, marginTop: 1 }}>{subtitle}</div>}
      </div>
      <div style={{ width: 40, display: 'flex', justifyContent: 'flex-end' }}>{trailing}</div>
    </div>
  );
}

function PLTabBar({ theme, current, onChange }) {
  const items = [
    { id: 'library', label: 'Library', icon: PL_ICONS.library },
    { id: 'composer', label: 'Compose', icon: PL_ICONS.wand },
    { id: 'pad-list', label: 'Pad', icon: PL_ICONS.pad },
  ];
  return (
    <div style={{
      borderTop: `0.5px solid ${theme.border}`,
      background: theme.bgDeep,
      display: 'flex', justifyContent: 'space-around',
      padding: '6px 8px 8px',
    }}>
      {items.map(it => {
        const active = current === it.id || (it.id === 'pad-list' && current === 'pad-detail') || (it.id === 'library' && current === 'library-detail');
        return (
          <button key={it.id} onClick={() => onChange(it.id)} style={{
            flex: 1, background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            padding: '6px 0', color: active ? theme.accent.solid : theme.textMuted,
            fontSize: theme.type.micro - 1, fontWeight: 500, letterSpacing: 0.1,
          }}>
            {it.icon(20)}
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PLChip({ theme, active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 10px', borderRadius: 999,
      border: `0.5px solid ${active ? theme.accent.edge : theme.border}`,
      background: active ? theme.accent.soft : 'transparent',
      color: active ? theme.accent.ink : theme.textSub,
      fontSize: theme.type.cap, fontWeight: 500, letterSpacing: 0.1,
      cursor: 'pointer', whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}

function PLCard({ theme, children, onClick, style = {} }) {
  return (
    <button onClick={onClick} style={{
      ...theme.card, borderRadius: 14, padding: 14,
      textAlign: 'left', width: '100%', cursor: onClick ? 'pointer' : 'default',
      color: theme.text, font: 'inherit', display: 'block', ...style,
    }}>{children}</button>
  );
}

// ── Library list ─────────────────────────────────────────────────────────
const SAMPLE_PROMPTS = [
  { id: 'p1', title: 'Code review · senior reviewer', collection: 'Engineering', tags: ['review', 'code'], use: 47, vars: 2, draft: false, snippet: 'Act as a senior engineer. Review the following code for correctness, clarity, and maintainability…' },
  { id: 'p2', title: 'Weekly digest summarizer', collection: 'Writing', tags: ['summary', 'weekly'], use: 23, vars: 1, draft: false, snippet: 'Summarize the following content into a punchy weekly digest with three sections…' },
  { id: 'p3', title: 'Bug repro extractor', collection: 'Engineering', tags: ['bug', 'qa'], use: 12, vars: 0, draft: false, snippet: 'Given a bug report, extract minimal reproduction steps, expected vs actual…' },
  { id: 'p4', title: 'Cold-email opener (B2B)', collection: 'Sales', tags: ['email'], use: 8, vars: 3, draft: true, snippet: '' },
  { id: 'p5', title: 'Naming brainstorm', collection: 'Product', tags: ['naming'], use: 31, vars: 1, draft: false, snippet: 'Generate 12 candidate names for a new product. Each should be one or two words…' },
  { id: 'p6', title: 'Changelog → release notes', collection: 'Engineering', tags: ['notes'], use: 19, vars: 0, draft: false, snippet: 'Convert this technical changelog into customer-facing release notes…' },
];

function LibraryScreen({ theme, nav }) {
  const [coll, setColl] = useState('All');
  const collections = ['All', 'Engineering', 'Writing', 'Sales', 'Product'];
  const filtered = coll === 'All' ? SAMPLE_PROMPTS : SAMPLE_PROMPTS.filter(p => p.collection === coll);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bg, color: theme.text }}>
      <PLTopBar theme={theme}
        title="Library"
        subtitle={`${SAMPLE_PROMPTS.length} prompts · 4 collections`}
        leading={<div style={{ color: theme.accent.solid }}>{PL_ICONS.sparkle(18)}</div>}
        trailing={<button style={{ background: 'none', border: 'none', color: theme.textSub, cursor: 'pointer', padding: 6 }}>{PL_ICONS.more(18)}</button>}
      />
      <div style={{ padding: '0 16px 8px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', borderRadius: 12,
          background: theme.surface2,
          border: `0.5px solid ${theme.border}`,
        }}>
          <span style={{ color: theme.textMuted }}>{PL_ICONS.search(15)}</span>
          <span style={{ color: theme.textFaint, fontSize: theme.type.body }}>Search prompts, tags…</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '4px 16px 12px', overflowX: 'auto' }}>
        {collections.map(c => (
          <PLChip key={c} theme={theme} active={c === coll} onClick={() => setColl(c)}>{c}</PLChip>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map(p => (
          <PLCard key={p.id} theme={theme} onClick={() => nav('library-detail', p.id)}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: theme.type.h3, fontWeight: 600, color: theme.text, letterSpacing: -0.2 }}>{p.title}</span>
                  {p.draft && <span style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
                    color: 'oklch(0.75 0.13 65)', padding: '1px 5px', borderRadius: 3,
                    background: 'oklch(0.75 0.13 65 / 0.15)',
                  }}>draft</span>}
                </div>
                <div style={{ fontSize: theme.type.cap, color: theme.textMuted, marginBottom: 8, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {p.snippet || <em style={{ color: theme.textFaint }}>No content yet — tap to edit.</em>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: theme.type.micro, color: theme.textFaint }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>{PL_ICONS.library(11)}{p.collection}</span>
                  {p.use > 0 && <span style={{ color: theme.accent.ink }}>{p.use}×</span>}
                  {p.vars > 0 && <span style={{ color: 'oklch(0.78 0.13 70)' }}>{`{{${p.vars}}}`}</span>}
                </div>
              </div>
            </div>
          </PLCard>
        ))}
      </div>
      <PLTabBar theme={theme} current="library" onChange={(id) => nav(id)} />
    </div>
  );
}

// ── Library detail ───────────────────────────────────────────────────────
function LibraryDetailScreen({ theme, nav, promptId }) {
  const p = SAMPLE_PROMPTS.find(x => x.id === promptId) || SAMPLE_PROMPTS[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bg, color: theme.text }}>
      <PLTopBar theme={theme}
        title="Prompt"
        leading={<button onClick={() => nav('library')} style={{ background: 'none', border: 'none', color: theme.accent.solid, cursor: 'pointer', padding: 6 }}>{PL_ICONS.back(20)}</button>}
        trailing={<button style={{ background: 'none', border: 'none', color: theme.textSub, cursor: 'pointer', padding: 6 }}>{PL_ICONS.share(18)}</button>}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: theme.type.display, fontWeight: 700, color: theme.text, letterSpacing: -0.5, lineHeight: 1.15, marginBottom: 6 }}>{p.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: theme.type.cap, color: theme.textMuted, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{PL_ICONS.library(11)}{p.collection}</span>
            <span>·</span>
            <span>{p.use}× used</span>
            <span>·</span>
            <span>3 versions</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {p.tags.map(t => (
            <span key={t} style={{
              padding: '3px 8px', borderRadius: 999, fontSize: theme.type.micro,
              background: theme.surface2, color: theme.textSub, border: `0.5px solid ${theme.border}`,
            }}>#{t}</span>
          ))}
        </div>
        <div>
          <div style={{ fontSize: theme.type.micro, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: theme.textFaint, marginBottom: 6 }}>Enhanced</div>
          <div style={{
            ...theme.card, borderRadius: 12, padding: 14,
            fontSize: theme.type.cap, color: theme.textSub, lineHeight: 1.5,
          }}>
            {p.snippet} The reviewer should enumerate concrete suggestions with file:line references where possible, and flag anything that is unclear rather than guessing.
          </div>
        </div>
        <div>
          <div style={{ fontSize: theme.type.micro, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: theme.textFaint, marginBottom: 6 }}>Original</div>
          <div style={{
            ...theme.card, borderRadius: 12, padding: 14,
            fontSize: theme.type.cap, color: theme.textMuted, lineHeight: 1.5,
          }}>
            review this code
          </div>
        </div>
      </div>
      <div style={{
        padding: '12px 16px', borderTop: `0.5px solid ${theme.border}`,
        background: theme.bgDeep, display: 'flex', gap: 10,
      }}>
        <button onClick={() => nav('composer', promptId)} style={{
          flex: 1, background: theme.accent.solid, color: 'white',
          border: 'none', borderRadius: 12, padding: '12px 16px',
          fontSize: theme.type.body, fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>{PL_ICONS.wand(16)} Use prompt</button>
        <button style={{
          background: theme.surface2, color: theme.text,
          border: `0.5px solid ${theme.border}`, borderRadius: 12, padding: '12px 14px',
          cursor: 'pointer',
        }}>{PL_ICONS.copy(16)}</button>
      </div>
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────
function ComposerScreen({ theme, nav, promptId }) {
  const p = promptId ? SAMPLE_PROMPTS.find(x => x.id === promptId) : null;
  const initial = p?.snippet || '';
  const [text, setText] = useState(initial);
  const [showProvider, setShowProvider] = useState(false);
  const [provider, setProvider] = useState('Claude Sonnet 4');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bg, color: theme.text }}>
      <PLTopBar theme={theme}
        title={p ? p.title : 'New prompt'}
        subtitle={p ? p.collection : 'Untitled draft'}
        leading={p && <button onClick={() => nav('library-detail', promptId)} style={{ background: 'none', border: 'none', color: theme.accent.solid, cursor: 'pointer', padding: 6 }}>{PL_ICONS.back(20)}</button>}
        trailing={<button style={{ background: 'none', border: 'none', color: theme.textSub, cursor: 'pointer', padding: 6 }}>{PL_ICONS.more(18)}</button>}
      />
      <div style={{ padding: '0 16px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setShowProvider(s => !s)} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 999,
          background: theme.surface2, border: `0.5px solid ${theme.border}`,
          color: theme.textSub, fontSize: theme.type.cap, fontWeight: 500, cursor: 'pointer',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: theme.accent.solid }} />
          {provider}
          <span style={{ color: theme.textFaint, fontSize: theme.type.micro, marginLeft: 2 }}>▾</span>
        </button>
        <div style={{ flex: 1 }} />
        <button style={{
          padding: '6px 10px', borderRadius: 999,
          background: 'transparent', border: `0.5px solid ${theme.border}`,
          color: theme.textSub, fontSize: theme.type.cap, cursor: 'pointer',
        }}>3 vars</button>
      </div>
      {showProvider && (
        <div style={{ margin: '0 16px 8px', borderRadius: 12, ...theme.card, overflow: 'hidden' }}>
          {['Claude Sonnet 4', 'Claude Haiku 4.5', 'GPT-4 Turbo', 'Gemini 1.5 Pro', 'Llama 3 (Ollama)'].map((m, i) => (
            <button key={m} onClick={() => { setProvider(m); setShowProvider(false); }} style={{
              width: '100%', textAlign: 'left', padding: '10px 14px',
              background: 'none', border: 'none', cursor: 'pointer',
              borderTop: i === 0 ? 'none' : `0.5px solid ${theme.border}`,
              color: theme.text, fontSize: theme.type.body,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              {m}
              {m === provider && <span style={{ color: theme.accent.solid }}>{PL_ICONS.check(14)}</span>}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, padding: '4px 16px 0', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{
          flex: 1, minHeight: 0, padding: 14, borderRadius: 14,
          ...theme.card, overflow: 'auto',
        }}>
          {text ? (
            <div style={{ fontSize: theme.type.body, color: theme.text, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{text}</div>
          ) : (
            <div style={{ fontSize: theme.type.body, color: theme.textFaint, lineHeight: 1.55 }}>
              Write your prompt. Use <span style={{ color: 'oklch(0.78 0.13 70)' }}>{'{{variables}}'}</span> for placeholders. Tap the wand to enhance.
            </div>
          )}
        </div>
      </div>
      <div style={{
        padding: 12, display: 'flex', alignItems: 'center', gap: 10,
        borderTop: `0.5px solid ${theme.border}`, background: theme.bgDeep,
      }}>
        <button onClick={() => nav('voice')} style={{
          width: 44, height: 44, borderRadius: 22,
          background: theme.surface2, border: `0.5px solid ${theme.border}`,
          color: theme.textSub, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{PL_ICONS.mic(18)}</button>
        <button style={{
          flex: 1, height: 44, borderRadius: 22,
          background: theme.accent.soft, border: `0.5px solid ${theme.accent.edge}`,
          color: theme.accent.ink, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          fontSize: theme.type.body, fontWeight: 600,
        }}>{PL_ICONS.wand(16)} Enhance</button>
        <button onClick={() => nav('streaming')} style={{
          width: 44, height: 44, borderRadius: 22,
          background: theme.accent.solid, border: 'none',
          color: 'white', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{PL_ICONS.send(18)}</button>
      </div>
    </div>
  );
}

// ── Streaming ────────────────────────────────────────────────────────────
const STREAM_TEXT = `I'll review this code carefully.

**Correctness**
The early-return on \`!user\` is good, but \`fetchProfile\` can throw — wrap it in try/catch or the caller crashes silently.

**Clarity**
\`handleStuff\` is doing three things: parsing, validating, and persisting. Splitting it would make the data flow easier to follow and the unit tests less brittle.

**Maintainability**
The magic number \`30000\` should be a named constant — \`POLL_INTERVAL_MS\` — and probably configurable.`;

function StreamingScreen({ theme, nav }) {
  const [shown, setShown] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (shown >= STREAM_TEXT.length) { setDone(true); return; }
    const t = setTimeout(() => setShown(s => Math.min(s + 4, STREAM_TEXT.length)), 28);
    return () => clearTimeout(t);
  }, [shown]);
  const visible = STREAM_TEXT.slice(0, shown);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bg, color: theme.text }}>
      <PLTopBar theme={theme}
        title="Response"
        subtitle={done ? 'Claude Sonnet 4 · 1.4s' : 'Claude Sonnet 4 · streaming…'}
        leading={<button onClick={() => nav('composer')} style={{ background: 'none', border: 'none', color: theme.accent.solid, cursor: 'pointer', padding: 6 }}>{PL_ICONS.back(20)}</button>}
        trailing={!done && <div style={{
          width: 8, height: 8, borderRadius: 999, background: theme.accent.solid,
          animation: 'pl-pulse 1s ease-in-out infinite',
        }} />}
      />
      <style>{'@keyframes pl-pulse{0%,100%{opacity:1}50%{opacity:0.3}}'}</style>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{
          padding: 12, borderRadius: 12, background: theme.surface2,
          fontSize: theme.type.cap, color: theme.textMuted, lineHeight: 1.5,
          border: `0.5px solid ${theme.border}`,
        }}>
          <div style={{ fontSize: theme.type.micro, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: theme.textFaint, marginBottom: 4 }}>Prompt</div>
          Act as a senior engineer. Review the following code…
        </div>
        <div style={{
          padding: 14, borderRadius: 14, ...theme.card,
        }}>
          <div style={{ fontSize: theme.type.body, color: theme.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {visible.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
              seg.startsWith('**')
                ? <strong key={i} style={{ color: theme.accent.ink }}>{seg.slice(2, -2)}</strong>
                : <span key={i}>{seg}</span>
            )}
            {!done && <span style={{
              display: 'inline-block', width: 7, height: theme.type.body,
              background: theme.accent.solid, marginLeft: 2, verticalAlign: 'text-bottom',
              animation: 'pl-pulse 0.7s ease-in-out infinite',
            }} />}
          </div>
        </div>
      </div>
      <div style={{
        padding: 12, display: 'flex', gap: 10,
        borderTop: `0.5px solid ${theme.border}`, background: theme.bgDeep,
      }}>
        <button style={{
          flex: 1, padding: '11px 14px', borderRadius: 12,
          background: theme.surface2, border: `0.5px solid ${theme.border}`,
          color: theme.textSub, fontSize: theme.type.cap, fontWeight: 500, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>{PL_ICONS.copy(14)} Copy</button>
        <button style={{
          flex: 1, padding: '11px 14px', borderRadius: 12,
          background: theme.surface2, border: `0.5px solid ${theme.border}`,
          color: theme.textSub, fontSize: theme.type.cap, fontWeight: 500, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>{PL_ICONS.pad(14)} Save to Pad</button>
      </div>
    </div>
  );
}

// ── Voice capture ────────────────────────────────────────────────────────
function VoiceScreen({ theme, nav }) {
  const [t, setT] = useState(0);
  useEffect(() => { const i = setInterval(() => setT(x => x + 1), 80); return () => clearInterval(i); }, []);
  const bars = Array.from({ length: 32 }, (_, i) => {
    const phase = (t * 0.18 + i * 0.4) % (Math.PI * 2);
    const h = 6 + Math.abs(Math.sin(phase)) * 38 + Math.sin(t * 0.07 + i) * 6;
    return Math.max(4, h);
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bgDeep, color: theme.text }}>
      <PLTopBar theme={theme}
        title="Voice"
        subtitle="Tap to stop · 0:14"
        leading={<button onClick={() => nav('composer')} style={{ background: 'none', border: 'none', color: theme.textSub, cursor: 'pointer', padding: 6 }}>{PL_ICONS.close(20)}</button>}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', gap: 32 }}>
        <div style={{
          textAlign: 'center', fontSize: theme.type.h2, fontWeight: 500,
          color: theme.text, lineHeight: 1.4, letterSpacing: -0.2,
        }}>
          “Review the following Python function for correctness…”
          <span style={{ display: 'inline-block', width: 9, height: theme.type.h2 * 0.85, background: theme.accent.solid, marginLeft: 3, verticalAlign: 'text-bottom', animation: 'pl-pulse 0.7s ease-in-out infinite' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 64 }}>
          {bars.map((h, i) => (
            <div key={i} style={{
              width: 4, height: h, borderRadius: 4,
              background: theme.accent.solid, opacity: 0.7 + (i % 3) * 0.1,
            }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '0 24px 32px' }}>
        <button onClick={() => nav('composer')} style={{
          width: 84, height: 84, borderRadius: '50%',
          background: theme.accent.solid, border: 'none',
          boxShadow: `0 0 0 6px ${theme.accent.soft}, 0 0 0 1px ${theme.accent.edge}`,
          color: 'white', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 24, height: 24, borderRadius: 5, background: 'white' }} />
        </button>
      </div>
    </div>
  );
}

// ── Pad list ─────────────────────────────────────────────────────────────
const SAMPLE_PADS = [
  { id: 'd1', title: 'Onboarding research', body: 'Notes from week 3 user interviews. Three threads worth pulling on…', updated: 'Today', words: 412 },
  { id: 'd2', title: 'Q2 planning scratchpad', body: 'Revisit pricing model. Talk to legal about T&Cs. Map out…', updated: 'Yesterday', words: 1280 },
  { id: 'd3', title: 'Reading list', body: 'Designing Data-Intensive Apps · Working in Public · The Manager\'s Path…', updated: 'Mon', words: 88 },
  { id: 'd4', title: 'Talk outline · "Prompts as Code"', body: 'Open with the version-control story. Three case studies…', updated: 'Apr 17', words: 945 },
];

function PadListScreen({ theme, nav }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bg, color: theme.text }}>
      <PLTopBar theme={theme}
        title="Pad"
        subtitle={`${SAMPLE_PADS.length} notebooks`}
        leading={<div style={{ color: theme.accent.solid }}>{PL_ICONS.pad(18)}</div>}
        trailing={<button style={{ background: 'none', border: 'none', color: theme.accent.solid, cursor: 'pointer', padding: 6 }}>{PL_ICONS.plus(20)}</button>}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SAMPLE_PADS.map(d => (
          <PLCard key={d.id} theme={theme} onClick={() => nav('pad-detail', d.id)}>
            <div style={{ fontSize: theme.type.h3, fontWeight: 600, color: theme.text, letterSpacing: -0.2, marginBottom: 4 }}>{d.title}</div>
            <div style={{ fontSize: theme.type.cap, color: theme.textMuted, lineHeight: 1.45, marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{d.body}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: theme.type.micro, color: theme.textFaint }}>
              <span>{d.updated}</span>
              <span>·</span>
              <span>{d.words} words</span>
            </div>
          </PLCard>
        ))}
      </div>
      <PLTabBar theme={theme} current="pad-list" onChange={(id) => nav(id)} />
    </div>
  );
}

// ── Pad detail ───────────────────────────────────────────────────────────
function PadDetailScreen({ theme, nav, padId }) {
  const d = SAMPLE_PADS.find(x => x.id === padId) || SAMPLE_PADS[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bg, color: theme.text }}>
      <PLTopBar theme={theme}
        title=""
        subtitle={`${d.updated} · ${d.words} words`}
        leading={<button onClick={() => nav('pad-list')} style={{ background: 'none', border: 'none', color: theme.accent.solid, cursor: 'pointer', padding: 6 }}>{PL_ICONS.back(20)}</button>}
        trailing={<button style={{ background: 'none', border: 'none', color: theme.textSub, cursor: 'pointer', padding: 6 }}>{PL_ICONS.more(18)}</button>}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
        <div style={{ fontSize: theme.type.display, fontWeight: 700, color: theme.text, letterSpacing: -0.5, lineHeight: 1.15, marginBottom: 16 }}>{d.title}</div>
        <div style={{ fontSize: theme.type.body, color: theme.textSub, lineHeight: 1.65 }}>
          <p style={{ margin: '0 0 12px' }}>{d.body}</p>
          <p style={{ margin: '0 0 12px' }}>The clearest pattern across the conversations was a desire for <strong style={{ color: theme.text }}>auditable prompt history</strong> — not just versioning, but the ability to rewind to a specific moment and see what changed.</p>
          <p style={{ margin: '0 0 12px' }}>Three follow-ups worth scheduling:</p>
          <ul style={{ margin: '0 0 12px', paddingLeft: 22 }}>
            <li style={{ marginBottom: 6 }}>How does <span style={{ color: theme.accent.ink, fontWeight: 500 }}>side-by-side diff</span> feel on a phone-sized canvas?</li>
            <li style={{ marginBottom: 6 }}>Voice capture for free-form notes — tested, worth a closer look.</li>
            <li>Sharing is mostly internal. URL-only is fine for now.</li>
          </ul>
          <p style={{ margin: '0 0 12px', color: theme.textMuted }}>—</p>
          <p style={{ margin: 0 }}>Pull this into a Composer prompt next week and run an A/B against the existing "research synthesis" template.</p>
        </div>
      </div>
      <div style={{
        padding: 10, display: 'flex', gap: 8, alignItems: 'center',
        borderTop: `0.5px solid ${theme.border}`, background: theme.bgDeep,
      }}>
        <button style={{
          padding: '8px 12px', borderRadius: 999,
          background: theme.surface2, border: `0.5px solid ${theme.border}`,
          color: theme.textSub, fontSize: theme.type.cap, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>{PL_ICONS.wand(13)} To prompt</button>
        <button style={{
          padding: '8px 12px', borderRadius: 999,
          background: theme.surface2, border: `0.5px solid ${theme.border}`,
          color: theme.textSub, fontSize: theme.type.cap, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>{PL_ICONS.share(13)} Share</button>
        <div style={{ flex: 1 }} />
        <button style={{
          width: 38, height: 38, borderRadius: 999,
          background: theme.accent.solid, border: 'none', color: 'white', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{PL_ICONS.plus(16)}</button>
      </div>
    </div>
  );
}

// ── Screen switcher ──────────────────────────────────────────────────────
function PLScreen({ route, params, nav, theme }) {
  switch (route) {
    case 'library': return <LibraryScreen theme={theme} nav={nav} />;
    case 'library-detail': return <LibraryDetailScreen theme={theme} nav={nav} promptId={params} />;
    case 'composer': return <ComposerScreen theme={theme} nav={nav} promptId={params} />;
    case 'streaming': return <StreamingScreen theme={theme} nav={nav} />;
    case 'voice': return <VoiceScreen theme={theme} nav={nav} />;
    case 'pad-list': return <PadListScreen theme={theme} nav={nav} />;
    case 'pad-detail': return <PadDetailScreen theme={theme} nav={nav} padId={params} />;
    default: return <LibraryScreen theme={theme} nav={nav} />;
  }
}

Object.assign(window, { PLScreen, PLTabBar, PLTopBar, PLChip, PLCard, SAMPLE_PROMPTS, SAMPLE_PADS });
