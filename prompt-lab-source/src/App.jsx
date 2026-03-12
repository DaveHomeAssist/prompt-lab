import { useState, useEffect, useRef } from 'react';
import Ic from './icons';
import { callAnthropic } from './api';
import { lintPrompt, applyLintQuickFix } from './promptLint';
import {
  detectSensitiveData,
  defaultRedactionSettings,
  loadRedactionSettings,
  saveRedactionSettings,
  redactPayloadStrings,
} from './sensitiveData';
import { normalizeError } from './errorTaxonomy';
import {
  loadExperimentHistory,
  filterExperimentHistory,
  createExperimentRecord,
  addExperimentRecord,
} from './experimentHistory';
import {
  wordDiff,
  scorePrompt,
  extractVars,
  encodeShare,
  decodeShare,
  extractTextFromAnthropic,
  parseEnhancedPayload,
  ensureString,
  suggestTitleFromText,
  normalizeEntry,
  normalizeLibrary,
  looksSensitive,
  isTransientError,
} from './promptUtils';

// ── Constants ─────────────────────────────────────────────────────────────────
const TAG_COLORS = {
  Writing: 'bg-blue-600', Code: 'bg-green-600', Research: 'bg-purple-600',
  Analysis: 'bg-yellow-600', Creative: 'bg-pink-600', System: 'bg-red-600',
  'Role-play': 'bg-orange-600', Other: 'bg-gray-500',
};
const ALL_TAGS = Object.keys(TAG_COLORS);

const MODES = [
  { id: 'balanced', label: '⚖️ Balanced', sys: 'Improve clarity, specificity, and structure. Add role, task, format, and constraints where missing.' },
  { id: 'claude', label: '🟣 Claude', sys: 'Optimize for Claude. Use XML tags, clear instructions, explicit output format.' },
  { id: 'chatgpt', label: '🟢 ChatGPT', sys: 'Optimize for GPT-4/o. Use system/user cues, chain-of-thought prompting, JSON output where appropriate.' },
  { id: 'image', label: '🎨 Image Gen', sys: 'Optimize for image generation. Include style, medium, lighting, composition, aspect ratio, quality modifiers.' },
  { id: 'code', label: '💻 Code Gen', sys: 'Optimize for code generation. Specify language, framework, input/output types, error handling, coding style.' },
  { id: 'concise', label: '✂️ Concise', sys: 'Make the prompt as short and direct as possible while preserving all intent.' },
  { id: 'detailed', label: '📝 Detailed', sys: 'Expand with rich context, examples, edge cases, explicit constraints. Make it comprehensive.' },
];

const PROVIDER_DEFAULTS = {
  anthropic: { model: 'claude-sonnet-4-20250514', label: 'Anthropic' },
  openai: { model: 'gpt-4o', label: 'OpenAI' },
  gemini: { model: 'gemini-2.5-flash-preview-04-17', label: 'Gemini' },
  openrouter: { model: 'anthropic/claude-sonnet-4-20250514', label: 'OpenRouter' },
  ollama: { model: 'llama3.2:3b', label: 'Ollama' },
};

const DEFAULT_LIBRARY_SEEDS = [
  {
    title: 'Transcript Summary - Markdown',
    original: `You are a conversation analyst specializing in context extraction and knowledge transfer.

Task:
Read the transcript between <transcript> tags and produce a structured context summary so a new assistant can continue seamlessly.

Output requirements:
- Use markdown headings (##) exactly as section titles.
- Omit any section with no relevant content.
- Be concise, but preserve concrete specifics (exact names, versions, values, tools, dates when present).
- Use the user's terminology.
- Do not add facts not present in the transcript.
- Do not speculate or editorialize.
- Preserve chronology when it affects understanding.

Sections:
## Identity & Background
## Project / Topic
## Key Decisions Made
## Current State
## Open Items & Next Steps
## Preferences & Constraints
## Important Context & Nuance

For “Key Decisions Made” and “Open Items & Next Steps,” use single-level bullet points.`,
  },
  {
    title: 'Transcript Summary - Strict JSON',
    original: `You are a conversation analyst specializing in context extraction and knowledge transfer.

Task:
Read the transcript between <transcript> tags and extract continuation-ready context.

Return ONLY valid JSON with this schema:
{
  "identity_background": string | null,
  "project_topic": string | null,
  "key_decisions_made": string[] | null,
  "current_state": string | null,
  "open_items_next_steps": string[] | null,
  "preferences_constraints": string | null,
  "important_context_nuance": string | null
}

Rules:
- Use exact terms from the transcript.
- Include concrete specifics (names, versions, values, tools, dates) when present.
- No invented facts, no interpretation beyond explicit content.
- If a section has no content, set it to null.
- Preserve chronology where relevant.`,
  },
  {
    title: 'Transcript Summary - High Recall',
    original: `You are a conversation continuity analyst.

Goal:
Produce a handoff summary that minimizes context loss across sessions.

Input:
Transcript between <transcript> tags.

Output:
Use markdown with these headings (omit empty sections):
## Identity & Background
## Project / Topic
## Key Decisions Made
## Current State
## Open Items & Next Steps
## Preferences & Constraints
## Important Context & Nuance

Priority:
1) Completeness of actionable context
2) Exact technical details (names, versions, commands, constraints)
3) Chronology where decision flow matters

Hard rules:
- Do not add information not explicitly in the transcript.
- Do not paraphrase away project-specific terminology.
- Keep writing concise and professional.`,
  },
  {
    title: 'Transcript Summary - Engineering Brief',
    original: `You are a conversation analyst creating an engineer-ready continuation brief.

Read <transcript> and produce a structured summary with these sections (omit empty):
## Identity & Background
## Project / Topic
## Key Decisions Made
## Current State
## Open Items & Next Steps
## Preferences & Constraints
## Important Context & Nuance

Emphasize:
- Technical stack, files, versions, commands, and architecture details
- Confirmed decisions vs pending decisions
- Risks, edge cases, corrected mistakes, and clarified assumptions
- Exact wording for project-specific terms

Rules:
- No invented facts
- No speculation
- Concise but specific
- Preserve chronological order when it affects implementation context`,
  },
  {
    title: 'Transcript Summary - Ultra Concise',
    original: `You are a context-transfer analyst.

From <transcript>, generate a minimal but sufficient bootstrap summary for a new session.

Format:
## Identity & Background
## Project / Topic
## Key Decisions Made
## Current State
## Open Items & Next Steps
## Preferences & Constraints
## Important Context & Nuance

Constraints:
- Omit empty sections
- Keep each section short and dense
- Include exact names/versions/values
- Use user terminology
- No assumptions, no added facts`,
  },
].map(seed => ({
  ...seed,
  enhanced: seed.original,
  notes: 'Default PromptLab library seed for transcript/context handoff.',
  tags: ['Writing', 'System'],
  collection: 'Handoff Templates',
  variants: [],
}));

const ONBOARDING_DONE_KEY = 'pl2-onboarding-complete';
const LINT_DEBOUNCE_MS = 280;
const STARTER_TEMPLATES = [
  {
    id: 'coding',
    label: 'Coding',
    prompt: `You are a senior software engineer.

Goal:
Help me implement the requested feature with clear, production-ready code.

Constraints:
- Keep changes minimal and safe.
- Explain assumptions briefly.

Output format:
- Summary
- Patch plan
- Updated code snippets`,
  },
  {
    id: 'writing',
    label: 'Writing',
    prompt: `You are an expert editor.

Goal:
Rewrite the draft for clarity and stronger structure.

Constraints:
- Preserve original intent.
- Keep tone professional and concise.

Output format:
- Revised draft
- Bullet list of notable changes`,
  },
  {
    id: 'support',
    label: 'Support',
    prompt: `You are a customer support specialist.

Goal:
Provide a clear, empathetic response that resolves the issue.

Constraints:
- Keep it under 180 words.
- Include one next step.

Output format:
- Final response
- Internal notes`,
  },
  {
    id: 'research',
    label: 'Research',
    prompt: `You are a research assistant.

Goal:
Summarize the topic and highlight actionable findings.

Constraints:
- Cite uncertainty where needed.
- Keep to 5 concise bullets.

Output format:
- Key findings
- Risks or open questions`,
  },
];

const T = {
  dark: {
    bg: 'bg-gray-950', surface: 'bg-gray-900', border: 'border-gray-800', borderHov: 'hover:border-gray-700',
    input: 'bg-gray-900 border-gray-700', text: 'text-gray-100', textSub: 'text-gray-500', textMuted: 'text-gray-600',
    textBody: 'text-gray-300', textAlt: 'text-gray-400', btn: 'bg-gray-800 hover:bg-gray-700',
    header: 'bg-gray-900 border-gray-800', modalBg: 'bg-black/70', modal: 'bg-gray-900 border-gray-700',
    notesBg: 'bg-amber-950/40 border-amber-900/50', notesText: 'text-amber-400', codeBlock: 'bg-gray-950',
    dangerBtn: 'bg-red-950 hover:bg-red-900 text-red-400',
    scoreGood: 'text-green-400', scoreBad: 'text-gray-700',
    diffAdd: 'bg-green-900/60 text-green-200', diffDel: 'bg-red-900/60 text-red-300 line-through opacity-60', diffEq: 'text-gray-300',
    draggable: 'bg-gray-800 border-gray-700 hover:border-violet-500',
    dropZone: 'border-gray-700 border-dashed bg-gray-900/30', dropOver: 'border-violet-500 border-dashed bg-violet-950/20',
    composedBlock: 'bg-gray-800 border-gray-700', pill: 'bg-gray-800 text-gray-300',
  },
  light: {
    bg: 'bg-gray-50', surface: 'bg-white', border: 'border-gray-200', borderHov: 'hover:border-gray-300',
    input: 'bg-white border-gray-300', text: 'text-gray-900', textSub: 'text-gray-500', textMuted: 'text-gray-400',
    textBody: 'text-gray-700', textAlt: 'text-gray-500', btn: 'bg-gray-100 hover:bg-gray-200',
    header: 'bg-white border-gray-200', modalBg: 'bg-black/40', modal: 'bg-white border-gray-200',
    notesBg: 'bg-amber-50 border-amber-200', notesText: 'text-amber-600', codeBlock: 'bg-gray-50',
    dangerBtn: 'bg-red-50 hover:bg-red-100 text-red-600',
    scoreGood: 'text-green-600', scoreBad: 'text-gray-300',
    diffAdd: 'bg-green-100 text-green-700', diffDel: 'bg-red-100 text-red-500 line-through', diffEq: 'text-gray-700',
    draggable: 'bg-gray-50 border-gray-200 hover:border-violet-400',
    dropZone: 'border-gray-300 border-dashed bg-gray-100/50', dropOver: 'border-violet-400 border-dashed bg-violet-50',
    composedBlock: 'bg-gray-50 border-gray-200', pill: 'bg-gray-100 text-gray-600',
  },
};

// ── Sub-components ────────────────────────────────────────────────────────────
function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, []);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-violet-700 text-white px-4 py-2 rounded-lg shadow-2xl z-50 text-sm font-medium">
      {message}
    </div>
  );
}

function TagChip({ tag, onRemove, onClick, selected }) {
  const color = TAG_COLORS[tag] || 'bg-gray-500';
  return (
    <span onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full text-white font-medium transition-all px-2 py-0.5 text-xs ${color} ${onClick ? 'cursor-pointer' : ''} ${selected ? 'ring-2 ring-violet-300 ring-offset-1 opacity-100' : 'opacity-70 hover:opacity-90'}`}>
      {tag}
      {onRemove && <Ic n="X" size={10} className="cursor-pointer" onClick={e => { e.stopPropagation(); onRemove(tag); }} />}
    </span>
  );
}

function ErrorPanel({ errorState, showErrorDetails, setShowErrorDetails, onDismiss, onAction }) {
  if (!errorState) return null;
  return (
    <div className="text-xs bg-red-950/40 border border-red-900 rounded-lg p-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-red-300 font-semibold">{errorState.userMessage}</p>
          <p className="text-red-200/80">{errorState.category} · {errorState.code}</p>
        </div>
        <button onClick={onDismiss} className="text-red-300 hover:text-red-100">Dismiss</button>
      </div>
      {Array.isArray(errorState.suggestions) && errorState.suggestions.length > 0 && (
        <div className="flex flex-col gap-1">
          {errorState.suggestions.map(step => <p key={step} className="text-red-100/90">Try this: {step}</p>)}
        </div>
      )}
      {Array.isArray(errorState.actions) && errorState.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {errorState.actions.map(action => (
            <button key={action} onClick={() => onAction(action)} className="px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-red-100 transition-colors">
              {action === 'open_provider_settings' ? 'Open provider settings' : action === 'shorten_request' ? 'Shorten request' : 'Retry'}
            </button>
          ))}
        </div>
      )}
      <button onClick={() => setShowErrorDetails(p => !p)} className="text-red-200 hover:text-red-50 text-left">
        {showErrorDetails ? 'Hide details' : 'Show details'}
      </button>
      {showErrorDetails && <pre className="whitespace-pre-wrap text-red-100/80">{errorState.details}</pre>}
    </div>
  );
}

function PadTab({ m, notify }) {
  const PAD_KEY = 'pl-pad';
  const [text, setText] = useState(() => { try { return localStorage.getItem(PAD_KEY) || ''; } catch { return ''; } });
  const [stamp, setStamp] = useState(() => { try { return localStorage.getItem(PAD_KEY + '_meta') || ''; } catch { return ''; } });
  const timerRef = useRef(null);
  const wc = text.trim() ? text.trim().split(/\s+/).length : 0;

  const onChange = e => {
    const v = e.target.value;
    setText(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(PAD_KEY, v);
        const s = 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        localStorage.setItem(PAD_KEY + '_meta', s);
        setStamp(s);
      } catch {}
    }, 600);
  };

  const insertDate = () => {
    const d = new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const entry = `\n── ${d} ──\n`;
    const ta = document.getElementById('plPadArea');
    const pos = ta.selectionStart;
    const next = text.slice(0, pos) + entry + text.slice(ta.selectionEnd);
    setText(next);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + entry.length; ta.focus(); }, 0);
    try { localStorage.setItem(PAD_KEY, next); } catch {}
  };

  const copyPad = () => {
    if (!text.trim()) return;
    try { navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement('textarea'); el.value = text;
      el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(el); el.focus(); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    notify('Pad copied!');
  };

  const clearPad = () => {
    if (!window.confirm('Clear all notes?')) return;
    setText(''); setStamp('');
    try { localStorage.removeItem(PAD_KEY); localStorage.removeItem(PAD_KEY + '_meta'); } catch {}
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ height: 'calc(100vh - 44px)' }}>
      <div className={`flex items-center justify-between px-4 py-2 border-b ${m.border} shrink-0`}>
        <span className={`text-xs font-mono ${m.textMuted}`}>{wc} word{wc !== 1 ? 's' : ''} · {text.length} chars</span>
        <div className="flex gap-2">
          <button onClick={insertDate} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`}>📅 Date</button>
          <button onClick={copyPad} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`}><Ic n="Copy" size={11} />Copy</button>
          <button onClick={clearPad} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors text-red-400 hover:bg-red-950/30"><Ic n="Trash2" size={11} />Clear</button>
        </div>
      </div>
      <div className="flex-1 p-4 flex flex-col gap-2 overflow-hidden">
        <textarea id="plPadArea"
          className={`flex-1 w-full resize-none rounded-xl border ${m.input} border p-4 text-sm leading-relaxed focus:outline-none focus:border-violet-500 transition-colors ${m.text}`}
          placeholder={'Notes, ideas, prompt snippets…\n\nUse 📅 Date to timestamp entries.'}
          value={text} onChange={onChange} spellCheck />
        <div className={`text-xs font-mono text-right ${m.textMuted}`}>{stamp}</div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [colorMode, setColorMode] = useState('dark');
  const m = T[colorMode];
  const [tab, setTab] = useState('editor');
  const [raw, setRaw] = useState('');
  const [enhanced, setEnhanced] = useState('');
  const [variants, setVariants] = useState([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveTags, setSaveTags] = useState([]);
  const [saveCollection, setSaveCollection] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [enhMode, setEnhMode] = useState('balanced');
  const [showNotes, setShowNotes] = useState(true);
  const [showNewColl, setShowNewColl] = useState(false);
  const [newCollName, setNewCollName] = useState('');
  const [varVals, setVarVals] = useState({});
  const [showVarForm, setShowVarForm] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState(null);
  const [library, setLibrary] = useState([]);
  const [libReady, setLibReady] = useState(false);
  const [collections, setCollections] = useState([]);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [activeCollection, setActiveCollection] = useState(null);
  const [sortBy, setSortBy] = useState('newest');
  const [expandedId, setExpandedId] = useState(null);
  const [expandedVersionId, setExpandedVersionId] = useState(null);
  const [shareId, setShareId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [editorLayout, setEditorLayout] = useState('split');
  const [draggingLibraryId, setDraggingLibraryId] = useState(null);
  const [dragOverLibraryId, setDragOverLibraryId] = useState(null);
  const [composerBlocks, setComposerBlocks] = useState([]);
  const [dragOverComposer, setDragOverComposer] = useState(false);
  const [draggingLibId, setDraggingLibId] = useState(null);
  const [dragOverBlockIdx, setDragOverBlockIdx] = useState(null);
  const [abA, setAbA] = useState({ prompt: '', response: '', loading: false });
  const [abB, setAbB] = useState({ prompt: '', response: '', loading: false });
  const [abWinner, setAbWinner] = useState(null);
  const [abPendingWinner, setAbPendingWinner] = useState(null);
  const [abNoteDraft, setAbNoteDraft] = useState('');
  const [showWinnerNoteModal, setShowWinnerNoteModal] = useState(false);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showChecklist, setShowChecklist] = useState(true);
  const [lintIssues, setLintIssues] = useState([]);
  const [promptDismissals, setPromptDismissals] = useState({});
  const [redactionSettings, setRedactionSettings] = useState(() => loadRedactionSettings());
  const [redactionModal, setRedactionModal] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardProvider, setWizardProvider] = useState('anthropic');
  const [wizardModel, setWizardModel] = useState('claude-sonnet-4-20250514');
  const [wizardTemplateId, setWizardTemplateId] = useState('coding');
  const [wizardConnectivity, setWizardConnectivity] = useState({ status: 'idle', message: '' });
  const [wizardDontShowAgain, setWizardDontShowAgain] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [toast, setToast] = useState(null);
  const enhanceReqRef = useRef(0);
  const abReqRef = useRef({ a: 0, b: 0 });
  const lintTimerRef = useRef(null);
  const redactionResolverRef = useRef(null);
  const notify = msg => setToast(msg);
  const hasSavablePrompt = raw.trim() || enhanced.trim();

  const openSavePanel = (entry = null) => {
    const source = entry?.enhanced || enhanced || raw;
    setSaveTitle(entry?.title || suggestTitleFromText(source));
    if (entry) {
      setEditingId(entry.id);
      setSaveTags(entry.tags || []);
      setSaveCollection(entry.collection || '');
    } else {
      setEditingId(null);
      if (!enhanced.trim()) setSaveTags([]);
    }
    setShowSave(true);
  };

  const clearEditor = () => {
    enhanceReqRef.current += 1;
    setLoading(false);
    setRaw('');
    setEnhanced('');
    setVariants([]);
    setNotes('');
    setShowSave(false);
    setEditingId(null);
    setErrorState(null);
    setPromptDismissals({});
  };

  const openOptions = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      notify('Options page is only available in the extension.');
    }
  };

  // ── Persistence (localStorage) ────────────────────────────────────────────
  useEffect(() => {
    try {
      const l = localStorage.getItem('pl2-library');
      const hasStoredLibrary = Boolean(l);
      if (l) {
        setLibrary(normalizeLibrary(JSON.parse(l)));
      } else {
        setLibrary(normalizeLibrary(DEFAULT_LIBRARY_SEEDS));
      }
      const c = localStorage.getItem('pl2-collections');
      if (c) {
        const parsed = JSON.parse(c);
        setCollections(Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string' && x.trim()) : []);
      } else if (!hasStoredLibrary) {
        setCollections(['Handoff Templates']);
      }
      const md = localStorage.getItem('pl2-mode');
      if (md === 'dark' || md === 'light') setColorMode(md);
      setHistoryRecords(loadExperimentHistory());
      setRedactionSettings(loadRedactionSettings());
      const onboardingDone = localStorage.getItem(ONBOARDING_DONE_KEY) === '1';
      if (!onboardingDone) setShowWizard(true);
      const hash = window.location.hash;
      if (hash.startsWith('#share=')) {
        const d = decodeShare(hash.slice(7));
        if (d) {
          const normalized = normalizeEntry({ ...d, id: crypto.randomUUID() });
          if (normalized) {
            setRaw(normalized.original);
            setEnhanced(normalized.enhanced);
            setVariants(normalized.variants || []);
            setNotes(normalized.notes || '');
            setSaveTags(normalized.tags || []);
            setPromptDismissals(Object.fromEntries((normalized.lintDismissals || []).map(rule => [rule, true])));
            setSaveTitle(normalized.title || '');
            setShowSave(true);
            notify('Shared prompt loaded!');
          } else {
            notify('Shared prompt is invalid.');
          }
        }
      }
    } catch {}
    setLibReady(true);
  }, []);
  useEffect(() => { if (libReady) { try { localStorage.setItem('pl2-library', JSON.stringify(library)); } catch {} } }, [library, libReady]);
  useEffect(() => { try { localStorage.setItem('pl2-collections', JSON.stringify(collections)); } catch {} }, [collections]);
  useEffect(() => { try { localStorage.setItem('pl2-mode', colorMode); } catch {} }, [colorMode]);
  useEffect(() => { saveRedactionSettings(redactionSettings); }, [redactionSettings]);
  useEffect(() => {
    clearTimeout(lintTimerRef.current);
    lintTimerRef.current = setTimeout(() => {
      const issues = lintPrompt(raw).filter(issue => !promptDismissals[issue.id]);
      setLintIssues(issues);
    }, LINT_DEBOUNCE_MS);
    return () => clearTimeout(lintTimerRef.current);
  }, [raw, promptDismissals]);

  // ── Clipboard ─────────────────────────────────────────────────────────────
  const copy = async (text, msg = 'Copied!') => {
    const value = ensureString(text);
    if (!value) { notify('Nothing to copy'); return; }
    try { await navigator.clipboard.writeText(value); }
    catch {
      try {
        const el = document.createElement('textarea'); el.value = value;
        el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(el); el.focus(); el.select();
        document.execCommand('copy'); document.body.removeChild(el);
      } catch { notify('Copy unavailable'); return; }
    }
    notify(msg);
  };

  const runWizardConnectivityCheck = async () => {
    setWizardConnectivity({ status: 'loading', message: 'Checking provider connectivity…' });
    try {
      const payload = {
        model: wizardModel,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      };
      const data = await callAnthropic(payload);
      const txt = extractTextFromAnthropic(data).toLowerCase();
      if (!txt.includes('ok')) throw new Error('Unexpected response from provider.');
      setWizardConnectivity({ status: 'ok', message: 'Provider connectivity verified.' });
    } catch (e) {
      const normalized = normalizeError(e);
      setWizardConnectivity({ status: 'error', message: normalized.userMessage });
    }
  };

  const closeRedactionModal = decision => {
    const resolve = redactionResolverRef.current;
    redactionResolverRef.current = null;
    setRedactionModal(null);
    if (resolve) resolve(decision);
  };

  const applySensitiveGate = async (payload, textToScan) => {
    const matches = detectSensitiveData(textToScan, redactionSettings);
    if (!redactionSettings.enabled || matches.length === 0) return payload;

    const decision = await new Promise((resolve) => {
      redactionResolverRef.current = resolve;
      setRedactionModal({ matches });
    });

    if (decision === 'edit') {
      const err = new Error('Request canceled so you can edit the prompt.');
      err.userCanceled = true;
      throw err;
    }
    if (decision === 'send') return payload;

    const redacted = redactPayloadStrings(payload, redactionSettings);
    return redacted.payload;
  };

  const runErrorAction = action => {
    if (action === 'open_provider_settings') {
      openOptions();
      return;
    }
    if (action === 'retry') {
      if (tab === 'abtest') {
        runAB('a');
        runAB('b');
      } else {
        enhance();
      }
      return;
    }
    if (action === 'shorten_request') {
      if (tab === 'abtest') {
        setAbA(p => ({ ...p, prompt: p.prompt.slice(0, Math.max(120, Math.floor(p.prompt.length * 0.75))) }));
        setAbB(p => ({ ...p, prompt: p.prompt.slice(0, Math.max(120, Math.floor(p.prompt.length * 0.75))) }));
      } else {
        setRaw(p => p.slice(0, Math.max(140, Math.floor(p.length * 0.75))));
      }
      notify('Request shortened.');
    }
  };

  const finalizeWinner = (noteOverride) => {
    if (!abPendingWinner) return;
    const winnerId = abPendingWinner === 'A' ? 'A' : 'B';
    const labelSource = saveTitle || raw || abA.prompt || abB.prompt;
    const record = createExperimentRecord({
      label: suggestTitleFromText(labelSource),
      winnerId,
      notes: typeof noteOverride === 'string' ? noteOverride : abNoteDraft,
      provider: wizardProvider,
      model: wizardModel,
      variantA: {
        name: 'Variant A',
        prompt: abA.prompt,
        response: abA.response,
      },
      variantB: {
        name: 'Variant B',
        prompt: abB.prompt,
        response: abB.response,
      },
    });
    const saved = addExperimentRecord(record);
    if (saved) {
      setHistoryRecords(loadExperimentHistory());
      setSelectedHistoryId(saved.id);
      notify('Experiment saved to history.');
    }
    setAbWinner(`Variant ${winnerId}`);
    setShowWinnerNoteModal(false);
    setAbPendingWinner(null);
    setAbNoteDraft('');
  };

  const pickWinner = side => {
    setAbPendingWinner(side);
    setAbNoteDraft('');
    setShowWinnerNoteModal(true);
  };

  const callAnthropicWithRetry = async (payload, retries = 1) => {
    let attempt = 0;
    let lastError = null;
    while (attempt <= retries) {
      try {
        return await callAnthropic(payload);
      } catch (e) {
        lastError = e;
        if (attempt >= retries || !isTransientError(e)) {
          break;
        }
        await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
      }
      attempt += 1;
    }
    throw lastError || new Error('Request failed.');
  };

  // ── Enhance ───────────────────────────────────────────────────────────────
  const enhance = async () => {
    if (!raw.trim()) return;
    const reqId = enhanceReqRef.current + 1;
    enhanceReqRef.current = reqId;
    setLoading(true); setErrorState(null); setShowErrorDetails(false); setEnhanced(''); setVariants([]); setNotes('');
    setShowSave(false); setShowDiff(false); setEditingId(null);
    const modeObj = MODES.find(x => x.id === enhMode) || MODES[0];
    const sys = `You are an expert prompt engineer. ${modeObj.sys}\nReturn ONLY valid JSON, no markdown, no backticks:\n{"enhanced":"...","variants":[{"label":"...","content":"..."}],"notes":"...","tags":["..."]}\nProduce 2 variants. Available tags: ${ALL_TAGS.join(', ')}.`;
    try {
      const basePayload = {
        model: wizardModel, max_tokens: 1500,
        system: sys, messages: [{ role: 'user', content: raw }],
      };
      const payload = await applySensitiveGate(basePayload, `${raw}\n${sys}`);
      const data = await callAnthropicWithRetry(payload);
      if (reqId !== enhanceReqRef.current) return;
      const txt = extractTextFromAnthropic(data);
      const p = parseEnhancedPayload(txt);
      setEnhanced(p.enhanced || ''); setVariants(p.variants || []); setNotes(p.notes || '');
      setSaveTags(p.tags || []);
      setSaveTitle(suggestTitleFromText(p.enhanced || raw));
      setShowSave(true);
    } catch (e) {
      if (reqId === enhanceReqRef.current) {
        if (e?.userCanceled) {
          notify('Request canceled. Edit prompt and retry.');
        } else {
          setErrorState(normalizeError(e));
        }
      }
    }
    if (reqId === enhanceReqRef.current) setLoading(false);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const doSave = (enh = enhanced, vars = variants, nts = notes, tags = saveTags, title = saveTitle, col = saveCollection) => {
    const cleanTitle = ensureString(title).trim() || suggestTitleFromText(enh || raw);
    const normalizedTags = Array.isArray(tags) ? tags.filter(t => typeof t === 'string' && t.trim()) : [];
    const effectiveEnhanced = ensureString(enh).trim() ? ensureString(enh) : ensureString(raw);
    const lintDismissalList = Object.keys(promptDismissals).filter(rule => promptDismissals[rule]);
    const now = new Date().toISOString();
    setLibrary(prev => {
      if (editingId) {
        let updated = false;
        const next = prev.map(e => {
          if (e.id !== editingId) return e;
          updated = true;
          return {
            ...e,
            title: cleanTitle,
            original: ensureString(raw),
            enhanced: effectiveEnhanced,
            variants: Array.isArray(vars) ? vars : [],
            notes: ensureString(nts),
            tags: normalizedTags,
            lintDismissals: lintDismissalList,
            collection: ensureString(col),
            versions: [...(e.versions || []), { enhanced: e.enhanced, variants: e.variants, savedAt: e.updatedAt || e.createdAt }].slice(-10),
            updatedAt: now,
          };
        });
        if (updated) return next;
      }
      return [{
        id: crypto.randomUUID(),
        title: cleanTitle,
        original: ensureString(raw),
        enhanced: effectiveEnhanced,
        variants: Array.isArray(vars) ? vars : [],
        notes: ensureString(nts),
        tags: normalizedTags,
        lintDismissals: lintDismissalList,
        collection: ensureString(col),
        createdAt: now,
        useCount: 0,
        versions: [],
      }, ...prev];
    });
    notify(editingId ? 'Prompt updated!' : 'Saved!');
    setShowSave(false);
    setEditingId(null);
  };
  const del = id => {
    if (!window.confirm('Delete this prompt?')) return;
    setLibrary(prev => prev.filter(e => e.id !== id));
    notify('Prompt deleted.');
  };
  const bumpUse = id => setLibrary(prev => prev.map(e => e.id === id ? { ...e, useCount: e.useCount + 1 } : e));

  const loadEntry = entry => {
    const vars = extractVars(entry?.enhanced);
    if (vars.length > 0) { setPendingTemplate(entry); setVarVals(Object.fromEntries(vars.map(v => [v, '']))); setShowVarForm(true); }
    else applyEntry(entry);
  };
  const applyEntry = entry => {
    const normalized = normalizeEntry(entry);
    if (!normalized) return;
    setEditingId(normalized.id);
    setRaw(normalized.original);
    setEnhanced(normalized.enhanced);
    setVariants(normalized.variants || []);
    setNotes(normalized.notes || '');
    setPromptDismissals(Object.fromEntries((normalized.lintDismissals || []).map(rule => [rule, true])));
    setSaveTags(normalized.tags || []);
    setSaveTitle(normalized.title);
    setSaveCollection(normalized.collection || '');
    setShowSave(false);
    setShowDiff(false);
    bumpUse(normalized.id); setTab('editor'); notify('Loaded into editor!');
  };
  const applyTemplate = () => {
    if (!pendingTemplate) return;
    let text = ensureString(pendingTemplate.enhanced);
    Object.entries(varVals).forEach(([k, v]) => { text = text.replaceAll(`{{${k}}}`, v); });
    applyEntry({ ...pendingTemplate, enhanced: text });
    setShowVarForm(false); setPendingTemplate(null);
  };

  // ── Export/Import ─────────────────────────────────────────────────────────
  const exportLib = () => {
    if (library.length === 0) {
      notify('Library is empty.');
      return;
    }
    if (library.some(e => looksSensitive(e.original) || looksSensitive(e.enhanced) || looksSensitive(e.notes))
      && !window.confirm('Export may include sensitive prompt content. Continue?')) {
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: 'prompt-library.json',
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const importLib = e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      notify('Import failed: file is too large.');
      e.target.value = '';
      return;
    }
    const r = new FileReader();
    r.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        const normalized = normalizeLibrary(d);
        if (!normalized.length) {
          notify('Import failed: no valid prompts found.');
          return;
        }
        setLibrary(prev => normalizeLibrary([...normalized, ...prev]));
        notify(`Imported ${normalized.length} prompts!`);
      }
      catch { notify('Import failed'); }
    };
    r.readAsText(file); e.target.value = '';
  };
  const getShareUrl = entry => {
    if (!entry) return null;
    const c = encodeShare(entry);
    return c ? `${window.location.origin}${window.location.pathname}#share=${c}` : null;
  };

  const moveLibraryEntry = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setLibrary(prev => {
      const from = prev.findIndex(e => e.id === sourceId);
      const to = prev.findIndex(e => e.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  // ── Composer ──────────────────────────────────────────────────────────────
  const addToComposer = entry => {
    setComposerBlocks(prev => [...prev, { id: crypto.randomUUID(), label: entry.title, content: entry.enhanced, sourceId: entry.id }]);
    bumpUse(entry.id); notify('Added to Composer!');
  };
  const composedPrompt = composerBlocks.map(b => `# ${b.label}\n${b.content}`).join('\n\n---\n\n');

  // ── A/B Test ──────────────────────────────────────────────────────────────
  const runAB = async side => {
    const state = side === 'a' ? abA : abB, setter = side === 'a' ? setAbA : setAbB;
    const reqKey = side === 'a' ? 'a' : 'b';
    const reqId = abReqRef.current[reqKey] + 1;
    abReqRef.current = { ...abReqRef.current, [reqKey]: reqId };
    if (!state.prompt.trim()) return;
    setter(p => ({ ...p, loading: true, response: '' }));
    try {
      const basePayload = { model: wizardModel, max_tokens: 800, messages: [{ role: 'user', content: state.prompt }] };
      const payload = await applySensitiveGate(basePayload, state.prompt);
      const data = await callAnthropicWithRetry(payload);
      if (abReqRef.current[reqKey] !== reqId) return;
      setter(p => ({ ...p, response: extractTextFromAnthropic(data), loading: false }));
    } catch (e) {
      if (abReqRef.current[reqKey] !== reqId) return;
      if (e?.userCanceled) {
        setter(p => ({ ...p, loading: false }));
        notify('Request canceled. Edit prompt and retry.');
        return;
      }
      const normalized = normalizeError(e);
      setter(p => ({ ...p, response: `${normalized.userMessage}\n\n${normalized.suggestions.map(s => `- ${s}`).join('\n')}`, loading: false }));
      setErrorState(normalized);
    }
  };

  const dismissLintRule = ruleId => {
    if (!ruleId) return;
    setPromptDismissals(prev => ({ ...prev, [ruleId]: true }));
  };

  const applyLintFix = ruleId => {
    setRaw(prev => applyLintQuickFix(prev, ruleId));
  };

  const completeWizard = () => {
    const selected = STARTER_TEMPLATES.find(t => t.id === wizardTemplateId) || STARTER_TEMPLATES[0];
    setRaw(selected.prompt);
    setTab('editor');
    setShowWizard(false);
    setWizardStep(0);
    try { localStorage.setItem(ONBOARDING_DONE_KEY, '1'); } catch {}
    notify('Onboarding complete.');
  };

  const relaunchWizard = () => {
    setWizardStep(0);
    setShowWizard(true);
  };

  const filteredHistory = filterExperimentHistory(historyRecords, {
    query: historyQuery,
    from: historyFrom,
    to: historyTo,
  });
  const selectedHistory = filteredHistory.find(r => r.id === selectedHistoryId) || filteredHistory[0] || null;

  const loadHistoryWinner = record => {
    if (!record) return;
    const winner = (record.variantMetadata || []).find(v => v.id === record.outcome);
    if (!winner) return;
    setRaw(winner.promptText || '');
    setEnhanced(winner.promptText || '');
    setTab('editor');
    notify('Winning variant loaded.');
  };

  // ── Derived state ─────────────────────────────────────────────────────────
  const allLibTags = [...new Set(library.flatMap(e => e.tags || []))];
  const filtered = [...library]
    .filter(e => {
      const q = search.toLowerCase();
      const title = ensureString(e.title).toLowerCase();
      return (!q || title.includes(q) || (e.tags || []).some(t => t.toLowerCase().includes(q)))
        && (!activeTag || (e.tags || []).includes(activeTag))
        && (!activeCollection || e.collection === activeCollection);
    })
    .sort((a, b) => {
      if (sortBy === 'manual') return 0;
      if (sortBy === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortBy === 'most-used') return b.useCount - a.useCount;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  const quickInject = [...library].sort((a, b) => b.useCount - a.useCount).slice(0, 5);
  const score = scorePrompt(raw);
  const wc = typeof raw === 'string' && raw.trim() ? raw.trim().split(/\s+/).length : 0;
  const inp = `w-full ${m.input} border rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-violet-500 transition-colors placeholder-gray-400 ${m.text}`;
  const showEditorPane = tab !== 'editor' || editorLayout !== 'library';
  const showLibraryPane = tab !== 'editor' || editorLayout !== 'editor';

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const h = e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); if (!loading && raw.trim()) enhance(); }
      if (mod && e.key === 's') {
        e.preventDefault();
        if (hasSavablePrompt && !showSave) openSavePanel();
        else if (hasSavablePrompt && showSave) doSave();
      }
      if (mod && e.key === 'k') { e.preventDefault(); setShowCmdPalette(p => !p); setCmdQuery(''); }
      if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) setShowShortcuts(p => !p);
      if (e.key === 'Escape') {
        setShowCmdPalette(false);
        setShowShortcuts(false);
        setShowSettings(false);
        setShareId(null);
        if (redactionModal) closeRedactionModal('edit');
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [loading, raw, showSave, hasSavablePrompt, redactionModal]);

  // ── Command palette actions ───────────────────────────────────────────────
  const CMD_ACTIONS = [
    { label: 'Enhance Prompt', hint: '⌘↵', action: () => { if (!loading && raw.trim()) enhance(); setShowCmdPalette(false); } },
    { label: 'Save Prompt', hint: '⌘S', action: () => { if (hasSavablePrompt) openSavePanel(); setShowCmdPalette(false); } },
    { label: 'Clear Editor', hint: '', action: () => { clearEditor(); setShowCmdPalette(false); } },
    { label: 'Go to Editor', hint: '', action: () => { setTab('editor'); setShowCmdPalette(false); } },
    { label: 'Go to Composer', hint: '', action: () => { setTab('composer'); setShowCmdPalette(false); } },
    { label: 'Go to A/B Test', hint: '', action: () => { setTab('abtest'); setShowCmdPalette(false); } },
    { label: 'Go to History', hint: '', action: () => { setTab('history'); setShowCmdPalette(false); } },
    { label: 'Go to Pad', hint: '', action: () => { setTab('pad'); setShowCmdPalette(false); } },
    { label: 'Toggle Light / Dark', hint: '', action: () => { setColorMode(p => p === 'dark' ? 'light' : 'dark'); setShowCmdPalette(false); } },
    { label: 'Export Library', hint: '', action: () => { exportLib(); setShowCmdPalette(false); } },
    { label: 'Open Settings', hint: '', action: () => { setShowSettings(true); setShowCmdPalette(false); } },
    { label: 'Extension Options (API Key)', hint: '', action: () => { openOptions(); setShowCmdPalette(false); } },
    { label: 'Getting Started Wizard', hint: '', action: () => { relaunchWizard(); setShowCmdPalette(false); } },
    { label: 'Show Keyboard Shortcuts', hint: '?', action: () => { setShowShortcuts(true); setShowCmdPalette(false); } },
  ];
  const filteredCmds = CMD_ACTIONS.filter(a => !cmdQuery || a.label.toLowerCase().includes(cmdQuery.toLowerCase()));

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen ${m.bg} ${m.text} flex flex-col`} style={{ fontFamily: 'system-ui,sans-serif' }}>

      {/* Header */}
      <header className={`flex items-center justify-between px-4 py-2 ${m.header} border-b shrink-0`}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Ic n="Wand2" size={15} className="text-violet-500" />
            <span className="font-bold text-sm">Prompt Lab</span>
          </div>
          <div className="flex items-center gap-1">
            {[['editor', 'Editor'], ['composer', 'Composer'], ['abtest', 'A/B Test'], ['history', 'History'], ['pad', 'Pad']].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-2 py-1.5 font-semibold rounded-lg transition-colors whitespace-nowrap ${tab === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}
                style={{ fontSize: '0.6rem', letterSpacing: '0.03em' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className={`text-xs ${m.textMuted} mr-1 hidden sm:inline`}>{library.length} saved</span>
          <button onClick={() => { setShowCmdPalette(true); setCmdQuery(''); }} className={`px-1.5 py-1 rounded-lg ${m.btn} ${m.textAlt} text-xs font-mono hover:text-violet-400 transition-colors`}>⌘K</button>
          <button onClick={() => setColorMode(p => p === 'dark' ? 'light' : 'dark')} className={`p-1 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}>
            {colorMode === 'dark' ? <Ic n="Sun" size={13} /> : <Ic n="Moon" size={13} />}
          </button>
          <button onClick={() => setShowShortcuts(true)} className={`p-1 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}><Ic n="Keyboard" size={13} /></button>
          <button onClick={() => setShowSettings(true)} className={`p-1 rounded-lg ${m.btn} ${m.textAlt} hover:text-violet-400 transition-colors`}><Ic n="Settings" size={13} /></button>
        </div>
      </header>

      {/* ══ EDITOR TAB ══ */}
      {tab === 'editor' && (
        <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 44px)' }}>
          {showEditorPane && (
          <div className={`${showLibraryPane ? `w-1/2 border-r ${m.border}` : 'w-full'} flex flex-col overflow-y-auto`}>
            <div className="p-4 flex flex-col gap-3">
              <div className="flex gap-1">
                {[
                  ['split', 'Split'],
                  ['editor', 'Focus Editor'],
                  ['library', 'Focus Library'],
                ].map(([id, label]) => (
                  <button key={id} onClick={() => setEditorLayout(id)}
                    className={`text-xs px-2 py-1 rounded-lg transition-colors ${editorLayout === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                    {label}
                  </button>
                ))}
              </div>
              {/* Input */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold`}>Input</span>
                    <button onClick={() => setShowChecklist(p => !p)} className={`text-xs px-2 py-0.5 rounded ${m.btn} ${m.textAlt} transition-colors`}>
                      Prompt Checklist {lintIssues.length > 0 ? `(${lintIssues.length})` : ''}
                    </button>
                  </div>
                  <span className={`text-xs ${m.textMuted}`}>{wc}w · {raw.length}c{score ? ` · ~${score.tokens} tok` : ''}</span>
                </div>
                <textarea rows={5} className={inp} placeholder="Paste or write your prompt here…" value={raw} onChange={e => setRaw(e.target.value)} />
                {lintIssues.length > 0 && (
                  <div className={`mt-2 border ${m.border} rounded-lg p-2 ${m.surface}`}>
                    <p className={`text-[11px] ${m.textSub} font-semibold uppercase tracking-wider mb-1`}>Inline markers</p>
                    <div className="flex flex-wrap gap-1">
                      {lintIssues.map(issue => (
                        <span key={issue.id} className={`text-[11px] px-2 py-0.5 rounded ${issue.severity === 'warning' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>
                          L{issue.line}: {issue.id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {showChecklist && (
                  <div className={`mt-2 border ${m.border} rounded-lg p-2 ${m.surface} flex flex-col gap-1.5`}>
                    <div className="flex items-center justify-between">
                      <p className={`text-[11px] ${m.textSub} font-semibold uppercase tracking-wider`}>Prompt Checklist</p>
                      <button onClick={() => setPromptDismissals({})} className={`text-[11px] ${m.textAlt} hover:text-white transition-colors`}>Reset dismissals</button>
                    </div>
                    {lintIssues.length === 0 && <p className={`text-xs ${m.textAlt}`}>No active issues.</p>}
                    {lintIssues.map(issue => (
                      <div key={issue.id} className={`border ${m.border} rounded p-2 text-xs flex flex-col gap-1`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={issue.severity === 'warning' ? 'text-amber-400 font-semibold' : 'text-blue-400 font-semibold'}>
                            {issue.severity.toUpperCase()} · Line {issue.line}
                          </span>
                          <div className="flex items-center gap-2">
                            <button onClick={() => applyLintFix(issue.id)} className="text-violet-400 hover:text-violet-300 transition-colors">Quick fix</button>
                            <button onClick={() => dismissLintRule(issue.id)} className={`${m.textAlt} hover:text-white transition-colors`}>Dismiss</button>
                          </div>
                        </div>
                        <p className={m.textBody}>{issue.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Scoring */}
              {score && (() => {
                const checks = [['Role', score.role], ['Task', score.task], ['Format', score.format], ['Constraints', score.constraints], ['Context', score.context]];
                const cnt = checks.filter(c => c[1]).length;
                return (
                  <div className={`${m.surface} border ${m.border} rounded-lg p-3`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Prompt Quality</span>
                      <span className={`text-xs font-bold ${cnt >= 4 ? 'text-green-500' : cnt >= 2 ? 'text-yellow-500' : 'text-red-500'}`}>{cnt}/5</span>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                      {checks.map(([lbl, ok]) => (
                        <span key={lbl} className={`flex items-center gap-1 text-xs ${ok ? m.scoreGood : m.scoreBad}`}>
                          {ok ? <Ic n="Check" size={9} /> : <Ic n="X" size={9} />}{lbl}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* Mode + Enhance */}
              <div className="flex gap-2">
                <select value={enhMode} onChange={e => setEnhMode(e.target.value)}
                  className={`${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.text} focus:outline-none shrink-0 max-w-36`}>
                  {MODES.map(md => <option key={md.id} value={md.id}>{md.label}</option>)}
                </select>
                <button onClick={enhance} disabled={loading || !raw.trim()}
                  className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-semibold transition-colors">
                  {loading ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Enhancing…</> : <><Ic n="Wand2" size={13} />Enhance ⌘↵</>}
                </button>
                <button onClick={() => openSavePanel()} disabled={!hasSavablePrompt}
                  className="px-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors">Save</button>
                <button onClick={clearEditor} disabled={loading}
                  className="px-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors">Clear</button>
              </div>
              <ErrorPanel
                errorState={errorState}
                showErrorDetails={showErrorDetails}
                setShowErrorDetails={setShowErrorDetails}
                onDismiss={() => setErrorState(null)}
                onAction={runErrorAction}
              />
              {/* Enhanced */}
              {enhanced && <>
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs text-violet-400 uppercase tracking-widest font-semibold">Enhanced</span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setShowDiff(p => !p)} className={`flex items-center gap-1 text-xs transition-colors ${showDiff ? 'text-violet-400' : `${m.textSub} hover:text-white`}`}>
                        <Ic n="GitBranch" size={10} />{showDiff ? 'Hide Diff' : 'Show Diff'}
                      </button>
                      <button onClick={() => copy(enhanced)} className={`flex items-center gap-1 text-xs ${m.textSub} hover:text-white transition-colors`}><Ic n="Copy" size={10} />Copy</button>
                    </div>
                  </div>
                  {showDiff ? (
                    <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-sm leading-loose`}>
                      {wordDiff(raw, enhanced).map((d, i) => (
                        <span key={i} className={`${d.t === 'add' ? m.diffAdd : d.t === 'del' ? m.diffDel : m.diffEq} px-0.5 rounded mr-0.5`}>{d.v}</span>
                      ))}
                    </div>
                  ) : (
                    <textarea rows={5} className={`${inp} border-violet-500/40`} value={enhanced} onChange={e => setEnhanced(e.target.value)} />
                  )}
                </div>
                {/* Variants */}
                {variants.length > 0 && (
                  <div>
                    <span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold block mb-2`}>Variants</span>
                    <div className="flex flex-col gap-2">
                      {variants.map((v, i) => (
                        <div key={i} className={`${m.surface} border ${m.border} ${m.borderHov} rounded-lg p-3 transition-colors`}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-violet-400">{v.label}</span>
                            <div className="flex gap-3">
                              <button onClick={() => setEnhanced(v.content)} className={`text-xs ${m.textAlt} hover:text-violet-400 transition-colors`}>Use</button>
                              <button onClick={() => { setAbA(p => ({ ...p, prompt: enhanced })); setAbB(p => ({ ...p, prompt: v.content })); setAbWinner(null); setTab('abtest'); notify('Loaded into A/B Test!'); }}
                                className={`text-xs ${m.textAlt} hover:text-violet-400 transition-colors`}>A/B</button>
                              <button onClick={() => copy(v.content)} className={`${m.textAlt} hover:text-white transition-colors`}><Ic n="Copy" size={10} /></button>
                            </div>
                          </div>
                          <p className={`text-xs ${m.textAlt} leading-relaxed line-clamp-2`}>{v.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {showNotes && notes && (
                  <div className={`${m.notesBg} border rounded-lg p-3`}>
                    <p className={`text-xs font-bold ${m.notesText} mb-1`}>Enhancement Notes</p>
                    <p className={`text-xs ${m.textBody} leading-relaxed`}>{notes}</p>
                  </div>
                )}
              </>}
              {/* Save panel */}
              {showSave && (
                <div className={`${m.surface} border ${m.border} rounded-lg p-3 flex flex-col gap-2`}>
                  <span className={`text-xs ${m.textAlt} font-semibold uppercase tracking-wider`}>{editingId ? 'Update Prompt' : 'Save to Library'}</span>
                  <input className={`${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 ${m.text}`}
                    placeholder="Prompt title…" value={saveTitle} onChange={e => setSaveTitle(e.target.value)} />
                  <div className="flex gap-2">
                    <select value={saveCollection} onChange={e => setSaveCollection(e.target.value)}
                      className={`flex-1 ${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.text} focus:outline-none`}>
                      <option value="">No Collection</option>
                      {collections.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {showNewColl ? (
                      <div className="flex gap-1">
                        <input autoFocus className={`w-28 ${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.text} focus:outline-none focus:border-violet-500`}
                          placeholder="Name…" value={newCollName} onChange={e => setNewCollName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { const n = newCollName.trim(); if (n && !collections.includes(n)) { setCollections(p => [...p, n]); setSaveCollection(n); } setNewCollName(''); setShowNewColl(false); }
                            if (e.key === 'Escape') setShowNewColl(false);
                          }} />
                        <button onClick={() => { const n = newCollName.trim(); if (n && !collections.includes(n)) { setCollections(p => [...p, n]); setSaveCollection(n); } setNewCollName(''); setShowNewColl(false); }}
                          className="px-2 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs transition-colors"><Ic n="Check" size={11} /></button>
                      </div>
                    ) : (
                      <button onClick={() => setShowNewColl(true)} className={`px-2.5 ${m.btn} rounded-lg ${m.textAlt} text-xs transition-colors flex items-center gap-1`}><Ic n="Plus" size={11} /></button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_TAGS.map(t => <TagChip key={t} tag={t} selected={saveTags.includes(t)} onClick={() => setSaveTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])} />)}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => doSave()} disabled={!hasSavablePrompt} className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg py-1.5 text-sm font-semibold transition-colors"><Ic n="Save" size={12} />Save ⌘S</button>
                    <button onClick={() => { setShowSave(false); setEditingId(null); }} className={`px-4 ${m.btn} rounded-lg text-sm ${m.textBody} transition-colors`}>Cancel</button>
                  </div>
                </div>
              )}
              {/* Quick Inject */}
              {quickInject.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2"><Ic n="Zap" size={10} className="text-yellow-500" /><span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold`}>Quick Inject</span></div>
                  {quickInject.map(e => (
                    <div key={e.id} className={`flex items-center justify-between ${m.surface} border ${m.border} ${m.borderHov} rounded-lg px-3 py-2 gap-2 mb-1 transition-colors`}>
                      <span className={`text-xs ${m.textBody} truncate flex-1`}>{e.title}</span>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => { copy(e.enhanced, `Copied: ${e.title}`); bumpUse(e.id); }} className={`${m.textSub} hover:text-violet-400 transition-colors`}><Ic n="Copy" size={11} /></button>
                        <button onClick={() => loadEntry(e)} className="text-xs text-violet-400 hover:text-violet-300 font-semibold transition-colors">Load</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          )}

          {/* Right — Library */}
          {showLibraryPane && (
          <div className={`${showEditorPane ? 'w-1/2' : 'w-full'} flex flex-col overflow-hidden`}>
            <div className={`p-3 border-b ${m.border} flex flex-col gap-2 shrink-0`}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Ic n="Search" size={11} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${m.textMuted}`} />
                  <input className={`w-full ${m.input} border rounded-lg pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:border-violet-500 ${m.text}`}
                    placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  className={`${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.textBody} focus:outline-none`}>
                  <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="most-used">Most Used</option><option value="manual">Manual</option>
                </select>
                <button onClick={exportLib} className={`px-2.5 rounded-lg text-xs ${m.btn} ${m.textAlt} transition-colors`}>Export</button>
              </div>
              {collections.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  <button onClick={() => setActiveCollection(null)} className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${!activeCollection ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>All</button>
                  {collections.map(c => (
                    <button key={c} onClick={() => setActiveCollection(p => p === c ? null : c)}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${activeCollection === c ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                      <Ic n="FolderOpen" size={9} />{c}
                    </button>
                  ))}
                </div>
              )}
              {allLibTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {allLibTags.map(t => <TagChip key={t} tag={t} selected={activeTag === t} onClick={() => setActiveTag(p => p === t ? null : t)} />)}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                  <Ic n="Wand2" size={24} className={m.textMuted} />
                  <p className={`text-sm ${m.textSub}`}>{library.length === 0 ? 'No saved prompts yet.' : 'No results found.'}</p>
                </div>
              )}
              {filtered.map(entry => {
                const manual = sortBy === 'manual';
                const shareUrl = shareId === entry.id ? getShareUrl(entry) : null;
                return (
                  <div key={entry.id}
                    draggable={manual}
                    onDragStart={e => { if (!manual) return; e.dataTransfer.setData('libraryEntryId', entry.id); setDraggingLibraryId(entry.id); }}
                    onDragEnd={() => { setDraggingLibraryId(null); setDragOverLibraryId(null); }}
                    onDragOver={e => { if (!manual) return; e.preventDefault(); setDragOverLibraryId(entry.id); }}
                    onDrop={e => { if (!manual) return; e.preventDefault(); moveLibraryEntry(e.dataTransfer.getData('libraryEntryId'), entry.id); setDragOverLibraryId(null); }}
                    className={`${m.surface} border ${m.border} ${m.borderHov} rounded-lg overflow-hidden transition-colors ${manual ? 'cursor-grab active:cursor-grabbing' : ''} ${dragOverLibraryId === entry.id ? 'border-violet-500' : ''} ${draggingLibraryId === entry.id ? 'opacity-50' : ''}`}>
                    <div className="flex items-start justify-between px-3 py-2.5 gap-2">
                      <div className="flex-1 min-w-0">
                        {renamingId === entry.id ? (
                          <div className="flex gap-1.5">
                            <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                              className={`flex-1 ${m.input} border rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-violet-500 ${m.text}`} />
                            <button onClick={() => {
                              const nextTitle = renameValue.trim();
                              if (!nextTitle) return;
                              setLibrary(prev => prev.map(e => e.id === entry.id ? { ...e, title: nextTitle } : e));
                              if (editingId === entry.id) setSaveTitle(nextTitle);
                              setRenamingId(null);
                              setRenameValue('');
                              notify('Renamed.');
                            }} className="px-2 py-1 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors">Save</button>
                            <button onClick={() => { setRenamingId(null); setRenameValue(''); }} className={`px-2 py-1 text-xs ${m.btn} ${m.textAlt} rounded-lg transition-colors`}>Cancel</button>
                          </div>
                        ) : (
                          <p className={`text-sm font-semibold ${m.text} truncate`}>{entry.title}</p>
                        )}
                        <div className={`flex items-center gap-2 text-xs ${m.textMuted} mt-0.5 flex-wrap`}>
                          {entry.collection && <span className="flex items-center gap-1"><Ic n="FolderOpen" size={8} />{entry.collection}</span>}
                          <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                          {entry.useCount > 0 && <span className="text-violet-400">{entry.useCount}×</span>}
                          {(entry.versions || []).length > 0 && <span className="flex items-center gap-0.5 text-blue-400"><Ic n="Clock" size={8} />{entry.versions.length}v</span>}
                          {extractVars(entry.enhanced).length > 0 && <span className="text-amber-400">{'{{vars}}'}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {manual && <Ic n="GripVertical" size={12} className={m.textMuted} />}
                        <button onClick={() => { copy(entry.enhanced); bumpUse(entry.id); }} className={`p-1.5 rounded ${m.btn} ${m.textSub} hover:text-violet-400 transition-colors`}><Ic n="Copy" size={12} /></button>
                        <button onClick={() => loadEntry(entry)} className={`px-2 py-1 rounded ${m.btn} text-violet-400 text-xs font-semibold transition-colors`}>Load</button>
                        <button onClick={() => addToComposer(entry)} className={`p-1.5 rounded ${m.btn} ${m.textSub} hover:text-violet-400 transition-colors`}><Ic n="Layers" size={12} /></button>
                        <button onClick={() => {
                          if ((looksSensitive(entry.original) || looksSensitive(entry.enhanced) || looksSensitive(entry.notes))
                            && !window.confirm('This shared link may include sensitive content. Continue?')) {
                            return;
                          }
                          setShareId(p => p === entry.id ? null : entry.id);
                        }} className={`p-1.5 rounded ${m.btn} ${m.textSub} hover:text-violet-400 transition-colors`}><Ic n="Share2" size={12} /></button>
                        <button onClick={() => openSavePanel(entry)} className={`px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors`}>Edit</button>
                        <button onClick={() => { setRenamingId(entry.id); setRenameValue(entry.title); }} className={`px-2 py-1 rounded ${m.btn} ${m.textAlt} text-xs transition-colors`}>Rename</button>
                        <button onClick={() => setExpandedId(p => p === entry.id ? null : entry.id)} className={`p-1.5 rounded ${m.btn} ${m.textSub} transition-colors`}>
                          {expandedId === entry.id ? <Ic n="ChevronUp" size={12} /> : <Ic n="ChevronDown" size={12} />}
                        </button>
                        <button onClick={() => del(entry.id)} className="p-1.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"><Ic n="Trash2" size={12} /></button>
                      </div>
                    </div>
                    {(entry.tags || []).length > 0 && <div className="flex flex-wrap gap-1 px-3 pb-2">{entry.tags.map(t => <TagChip key={t} tag={t} />)}</div>}
                    {shareId === entry.id && (
                      <div className={`border-t ${m.border} px-3 py-2 flex gap-2`}>
                        <input readOnly className={`flex-1 ${m.input} border rounded-lg px-2 py-1 text-xs focus:outline-none ${m.text} font-mono`} value={shareUrl || 'Unable to create share URL'} />
                        <button onClick={() => copy(shareUrl || '')} className="px-2 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-medium transition-colors">Copy URL</button>
                      </div>
                    )}
                    {expandedId === entry.id && (
                      <div className={`border-t ${m.border} px-3 py-3 flex flex-col gap-3`}>
                        {[['Original', m.textSub, entry.original], ['Enhanced', 'text-violet-400', entry.enhanced]].map(([lbl, col, txt]) => (
                          <div key={lbl}><p className={`text-xs ${col} font-semibold mb-1 uppercase tracking-wider`}>{lbl}</p><p className={`text-xs ${m.textBody} leading-relaxed ${m.codeBlock} rounded-lg p-2`}>{txt}</p></div>
                        ))}
                        {entry.notes && <div><p className={`text-xs ${m.notesText} font-semibold mb-1 uppercase tracking-wider`}>Notes</p><p className={`text-xs ${m.textAlt} leading-relaxed`}>{entry.notes}</p></div>}
                        {(entry.variants || []).length > 0 && (
                          <div><p className={`text-xs ${m.textSub} font-semibold mb-1.5 uppercase tracking-wider`}>Variants</p>
                            {entry.variants.map((v, i) => <div key={i} className="mb-1.5"><span className="text-xs text-violet-400 font-bold">{v.label}: </span><span className={`text-xs ${m.textAlt}`}>{v.content}</span></div>)}
                          </div>
                        )}
                        {(entry.versions || []).length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-xs text-blue-400 font-semibold uppercase tracking-wider flex items-center gap-1"><Ic n="Clock" size={9} />Version History ({entry.versions.length})</p>
                              <button onClick={() => setExpandedVersionId(p => p === entry.id ? null : entry.id)} className={`text-xs ${m.textSub} hover:text-white transition-colors`}>
                                {expandedVersionId === entry.id ? 'Collapse' : 'Expand'}
                              </button>
                            </div>
                            {expandedVersionId === entry.id && (
                              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                                {[...entry.versions].reverse().map((v, i) => (
                                  <div key={i} className={`${m.codeBlock} border ${m.border} rounded-lg p-2`}>
                                    <div className="flex justify-between items-center mb-1">
                                      <span className={`text-xs ${m.textMuted}`}>{new Date(v.savedAt).toLocaleString()}</span>
                                      <button onClick={() => { setLibrary(prev => prev.map(e => e.id === entry.id ? { ...e, enhanced: v.enhanced, variants: v.variants || [] } : e)); notify('Restored!'); }}
                                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"><Ic n="RotateCcw" size={9} />Restore</button>
                                    </div>
                                    <p className={`text-xs ${m.textAlt} line-clamp-2`}>{v.enhanced}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}
        </div>
      )}

      {/* ══ COMPOSER TAB ══ */}
      {tab === 'composer' && (
        <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 44px)' }}>
          <div className={`w-64 shrink-0 flex flex-col border-r ${m.border} overflow-hidden`}>
            <div className={`px-3 py-2 border-b ${m.border} shrink-0`}><p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Library · Drag to add</p></div>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
              {library.length === 0 && <p className={`text-xs ${m.textMuted} p-2`}>No saved prompts yet.</p>}
              {library.map(entry => (
                <div key={entry.id} draggable
                  onDragStart={e => { e.dataTransfer.setData('entryId', entry.id); setDraggingLibId(entry.id); }}
                  onDragEnd={() => setDraggingLibId(null)}
                  className={`border rounded-lg p-2.5 cursor-grab active:cursor-grabbing transition-colors ${m.draggable} ${draggingLibId === entry.id ? 'opacity-40' : ''}`}>
                  <div className="flex items-center gap-2">
                    <Ic n="GripVertical" size={11} className={m.textMuted} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${m.text} truncate`}>{entry.title}</p>
                      <p className={`text-xs ${m.textAlt} line-clamp-1 mt-0.5`}>{entry.enhanced}</p>
                    </div>
                    <button onClick={() => addToComposer(entry)} className="text-violet-400 hover:text-violet-300 shrink-0 transition-colors"><Ic n="Plus" size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className={`px-4 py-2 border-b ${m.border} flex items-center justify-between shrink-0`}>
              <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Canvas ({composerBlocks.length} blocks)</p>
              <div className="flex gap-2">
                {composerBlocks.length > 0 && <>
                  <button onClick={() => copy(composedPrompt, 'Composed prompt copied!')} className={`flex items-center gap-1 text-xs ${m.btn} ${m.textAlt} px-2 py-1 rounded-lg transition-colors`}><Ic n="Copy" size={11} />Copy All</button>
                  <button onClick={() => { setRaw(composedPrompt); setTab('editor'); notify('Loaded into editor!'); }} className="flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white px-2 py-1 rounded-lg transition-colors"><Ic n="ArrowRight" size={11} />Send to Editor</button>
                  <button onClick={() => setComposerBlocks([])} className={`flex items-center gap-1 text-xs ${m.dangerBtn} px-2 py-1 rounded-lg transition-colors`}><Ic n="Trash2" size={11} />Clear</button>
                </>}
              </div>
            </div>
            <div className="flex flex-1 overflow-hidden gap-3 p-3">
              <div
                onDragOver={e => { e.preventDefault(); setDragOverComposer(true); }}
                onDragLeave={() => setDragOverComposer(false)}
                onDrop={e => { e.preventDefault(); setDragOverComposer(false); const id = e.dataTransfer.getData('entryId'); const entry = library.find(x => x.id === id); if (entry) addToComposer(entry); }}
                className={`flex-1 rounded-xl border-2 transition-colors overflow-y-auto flex flex-col gap-2 p-3 ${dragOverComposer ? m.dropOver : m.dropZone}`}>
                {composerBlocks.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-2 pointer-events-none">
                    <Ic n="Layers" size={28} className={m.textMuted} />
                    <p className={`text-sm ${m.textSub}`}>Drop prompts here</p>
                  </div>
                )}
                {composerBlocks.map((block, idx) => (
                  <div key={block.id} draggable
                    onDragStart={e => e.dataTransfer.setData('blockIdx', String(idx))}
                    onDragOver={e => { e.preventDefault(); setDragOverBlockIdx(idx); }}
                    onDragLeave={() => setDragOverBlockIdx(null)}
                    onDrop={e => { e.stopPropagation(); const from = parseInt(e.dataTransfer.getData('blockIdx')); if (!isNaN(from) && from !== idx) { setComposerBlocks(prev => { const a = [...prev]; const [mv] = a.splice(from, 1); a.splice(idx, 0, mv); return a; }); } setDragOverBlockIdx(null); }}
                    className={`border rounded-lg p-3 cursor-grab active:cursor-grabbing transition-colors ${m.composedBlock} ${m.border} ${dragOverBlockIdx === idx ? 'border-violet-500' : ''}`}>
                    <div className="flex items-start gap-2">
                      <Ic n="GripVertical" size={11} className={`${m.textMuted} mt-0.5 shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-violet-400">{block.label}</span>
                          <button onClick={() => setComposerBlocks(prev => prev.filter((_, i) => i !== idx))} className={`${m.textMuted} hover:text-red-400 transition-colors`}><Ic n="X" size={11} /></button>
                        </div>
                        <p className={`text-xs ${m.textBody} leading-relaxed line-clamp-3`}>{block.content}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {composerBlocks.length > 0 && (
                <div className="w-2/5 flex flex-col">
                  <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Preview</p>
                  <div className={`flex-1 ${m.codeBlock} border ${m.border} rounded-xl p-3 overflow-y-auto`}>
                    <pre className={`text-xs ${m.textBody} whitespace-pre-wrap leading-relaxed font-mono`}>{composedPrompt}</pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ A/B TEST TAB ══ */}
      {tab === 'abtest' && (
        <div className="flex flex-1 flex-col overflow-hidden" style={{ height: 'calc(100vh - 44px)' }}>
          <div className={`px-4 py-2 border-b ${m.border} flex items-center justify-between shrink-0`}>
            <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>A/B Prompt Testing</p>
            <div className="flex items-center gap-3">
              {abWinner && <span className="text-xs font-bold text-green-400 flex items-center gap-1"><Ic n="Check" size={11} />Winner: {abWinner}</span>}
              <button onClick={() => { runAB('a'); runAB('b'); }} disabled={abA.loading || abB.loading}
                className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">
                <Ic n="FlaskConical" size={12} />Run Both
              </button>
              <button onClick={() => {
                abReqRef.current = { a: abReqRef.current.a + 1, b: abReqRef.current.b + 1 };
                setAbA({ prompt: '', response: '', loading: false });
                setAbB({ prompt: '', response: '', loading: false });
                setAbWinner(null);
                setAbPendingWinner(null);
                setShowWinnerNoteModal(false);
              }}
                className={`px-2 py-1.5 ${m.btn} rounded-lg text-xs ${m.textAlt} transition-colors`}>Reset</button>
            </div>
          </div>
          <div className={`px-4 py-2 border-b ${m.border}`}>
            <p className={`text-xs ${m.textAlt}`}>
              Each side is sent exactly as one isolated user message with no extra context.
            </p>
            <p className={`text-xs ${m.textMuted} mt-1 font-mono`}>
              Payload: <code>{`messages: [{ role: 'user', content: promptVariant }]`}</code>
            </p>
          </div>
          {errorState && (
            <div className={`px-4 py-2 border-b ${m.border}`}>
              <ErrorPanel
                errorState={errorState}
                showErrorDetails={showErrorDetails}
                setShowErrorDetails={setShowErrorDetails}
                onDismiss={() => setErrorState(null)}
                onAction={runErrorAction}
              />
            </div>
          )}
          <div className="flex flex-1 overflow-hidden">
            {([['A', abA, setAbA], ['B', abB, setAbB]]).map(([side, state, setter]) => (
              <div key={side} className={`flex-1 flex flex-col border-r last:border-r-0 ${m.border} overflow-hidden`}>
                <div className={`px-3 py-2 border-b ${m.border} flex items-center justify-between shrink-0`}>
                  <span className="text-xs font-bold text-violet-400 uppercase">Variant {side}</span>
                  <div className="flex gap-2">
                    <button onClick={() => runAB(side.toLowerCase())} disabled={state.loading || !state.prompt.trim()}
                      className="flex items-center gap-1 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-2 py-1 rounded-lg transition-colors">
                      {state.loading ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Ic n="Wand2" size={10} />}Run {side}
                    </button>
                    {state.response && !abWinner && (
                      <button onClick={() => pickWinner(side)} className="flex items-center gap-1 text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded-lg transition-colors"><Ic n="Check" size={10} />Pick {side}</button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-3 p-3 flex-1 overflow-y-auto">
                  <div>
                    <span className={`text-xs ${m.textSub} font-semibold uppercase tracking-wider block mb-1.5`}>Prompt</span>
                    <textarea rows={5} className={inp} placeholder={`Prompt variant ${side}…`} value={state.prompt} onChange={e => setter(p => ({ ...p, prompt: e.target.value }))} />
                  </div>
                  {(state.response || state.loading) && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-violet-400 font-semibold uppercase tracking-wider">Response</span>
                        {state.response && <span className={`text-xs ${m.textMuted}`}>~{Math.round(state.response.length / 4)} tokens</span>}
                      </div>
                      {state.loading
                        ? <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 flex items-center gap-2`}><span className="w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin shrink-0" /><span className={`text-xs ${m.textSub}`}>Generating…</span></div>
                        : <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-xs ${m.textBody} leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto`}>{state.response}</div>
                      }
                      {state.response && <button onClick={() => copy(state.response)} className={`flex items-center gap-1 text-xs ${m.textSub} hover:text-white transition-colors mt-1`}><Ic n="Copy" size={10} />Copy response</button>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ HISTORY TAB ══ */}
      {tab === 'history' && (
        <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 44px)' }}>
          <div className={`w-1/2 border-r ${m.border} flex flex-col overflow-hidden`}>
            <div className={`p-3 border-b ${m.border} flex flex-col gap-2`}>
              <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Experiment Timeline</p>
              <input
                className={`${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.text} focus:outline-none`}
                placeholder="Search label, notes, variant hash…"
                value={historyQuery}
                onChange={e => setHistoryQuery(e.target.value)}
              />
              <div className="flex gap-2">
                <input type="date" className={`${m.input} border rounded-lg px-2 py-1 text-xs ${m.text} focus:outline-none`} value={historyFrom} onChange={e => setHistoryFrom(e.target.value)} />
                <input type="date" className={`${m.input} border rounded-lg px-2 py-1 text-xs ${m.text} focus:outline-none`} value={historyTo} onChange={e => setHistoryTo(e.target.value)} />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {filteredHistory.length === 0 && <p className={`text-sm ${m.textSub}`}>No experiments yet.</p>}
              {filteredHistory.map(record => (
                <button
                  key={record.id}
                  onClick={() => setSelectedHistoryId(record.id)}
                  className={`text-left rounded-lg border p-3 transition-colors ${selectedHistoryId === record.id ? 'border-violet-500 bg-violet-500/10' : `${m.border} ${m.surface}`}`}
                >
                  <p className={`text-sm font-semibold ${m.text}`}>{record.label}</p>
                  <p className={`text-xs ${m.textMuted}`}>{new Date(record.createdAt).toLocaleString()}</p>
                  <p className={`text-xs ${m.textAlt} mt-1`}>Winner: {record.outcome || 'n/a'}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="w-1/2 flex flex-col overflow-hidden p-3">
            {!selectedHistory && <p className={`text-sm ${m.textSub}`}>Select an experiment to view details.</p>}
            {selectedHistory && (
              <div className={`flex-1 border ${m.border} rounded-xl p-4 overflow-y-auto ${m.surface} flex flex-col gap-3`}>
                <div>
                  <p className={`text-sm font-bold ${m.text}`}>{selectedHistory.label}</p>
                  <p className={`text-xs ${m.textMuted}`}>{new Date(selectedHistory.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <p className={`text-xs ${m.textSub} uppercase tracking-wider font-semibold mb-1`}>Outcome</p>
                  <p className={`text-xs ${m.textBody}`}>Winner variant id: {selectedHistory.outcome || 'n/a'}</p>
                </div>
                <div>
                  <p className={`text-xs ${m.textSub} uppercase tracking-wider font-semibold mb-1`}>Variants</p>
                  <div className="flex flex-col gap-2">
                    {(selectedHistory.variantMetadata || []).map(v => (
                      <div key={v.id} className={`border ${m.border} rounded-lg p-2`}>
                        <p className={`text-xs font-semibold ${m.text}`}>{v.name} ({v.id})</p>
                        <p className={`text-xs ${m.textMuted}`}>{v.provider} · {v.model} · {v.promptHash}</p>
                        <pre className={`text-xs ${m.textBody} whitespace-pre-wrap mt-1 max-h-28 overflow-y-auto`}>{v.promptText}</pre>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className={`text-xs ${m.textSub} uppercase tracking-wider font-semibold mb-1`}>Input Snapshot</p>
                  <pre className={`text-xs ${m.textBody} whitespace-pre-wrap ${m.codeBlock} border ${m.border} rounded-lg p-2`}>{selectedHistory.keyInputSnapshot}</pre>
                </div>
                {selectedHistory.notes && (
                  <div>
                    <p className={`text-xs ${m.textSub} uppercase tracking-wider font-semibold mb-1`}>Notes</p>
                    <p className={`text-xs ${m.textBody}`}>{selectedHistory.notes}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => loadHistoryWinner(selectedHistory)} className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors">
                    Load winning variant
                  </button>
                  <button onClick={() => { loadHistoryWinner(selectedHistory); setTab('editor'); }} className={`px-3 py-1.5 text-xs ${m.btn} ${m.textAlt} rounded-lg transition-colors`}>
                    Replay in editor
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ PAD TAB ══ */}
      {tab === 'pad' && <PadTab m={m} notify={notify} />}

      {/* ══ MODALS ══ */}
      {showVarForm && pendingTemplate && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-40 p-4`}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-md flex flex-col gap-4`}>
            <div className="flex justify-between items-center">
              <h2 className={`font-bold text-sm ${m.text}`}>Fill Template Variables</h2>
              <button onClick={() => setShowVarForm(false)} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
            </div>
            <p className={`text-xs ${m.textAlt}`}>"{pendingTemplate.title}" contains template variables:</p>
            <div className="flex flex-col gap-2">
              {Object.keys(varVals).map(k => (
                <div key={k}>
                  <label className="text-xs font-mono font-semibold text-violet-400 block mb-1">{`{{${k}}}`}</label>
                  <input className={`w-full ${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 ${m.text}`}
                    placeholder={`Value for ${k}…`} value={varVals[k]} onChange={e => setVarVals(p => ({ ...p, [k]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={applyTemplate} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg py-2 text-sm font-semibold transition-colors">Apply Template</button>
              <button onClick={() => { applyEntry(pendingTemplate); setShowVarForm(false); setPendingTemplate(null); }} className={`px-4 ${m.btn} rounded-lg text-sm ${m.textBody} transition-colors`}>Skip</button>
            </div>
          </div>
        </div>
      )}

      {redactionModal && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-50 p-4`}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-xl flex flex-col gap-3`}>
            <div className="flex items-center justify-between">
              <h2 className={`font-bold text-sm ${m.text}`}>Sensitive data detected</h2>
              <button onClick={() => closeRedactionModal('edit')} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
            </div>
            <p className={`text-xs ${m.textAlt}`}>Review matches before sending to provider.</p>
            <div className={`max-h-56 overflow-y-auto border ${m.border} rounded-lg p-2 flex flex-col gap-2`}>
              {redactionModal.matches.map(match => (
                <div key={match.id} className={`border ${m.border} rounded p-2`}>
                  <p className={`text-xs font-semibold ${m.text}`}>{match.label}</p>
                  <p className={`text-xs ${m.textMuted}`}>{match.description}</p>
                  <p className={`text-xs ${m.textBody} font-mono mt-1 break-all`}>{match.snippet}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => closeRedactionModal('redact')} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg py-2 text-sm font-semibold transition-colors">Redact and send</button>
              <button onClick={() => closeRedactionModal('send')} className={`px-3 py-2 rounded-lg text-sm ${m.btn} ${m.textBody} transition-colors`}>Send as is</button>
              <button onClick={() => closeRedactionModal('edit')} className={`px-3 py-2 rounded-lg text-sm ${m.btn} ${m.textBody} transition-colors`}>Edit prompt</button>
            </div>
          </div>
        </div>
      )}

      {showWinnerNoteModal && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-50 p-4`}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-md flex flex-col gap-3`}>
            <div className="flex items-center justify-between">
              <h2 className={`font-bold text-sm ${m.text}`}>Save experiment result</h2>
              <button onClick={() => { setShowWinnerNoteModal(false); setAbPendingWinner(null); }} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
            </div>
            <p className={`text-xs ${m.textAlt}`}>Winner: Variant {abPendingWinner}</p>
            <textarea
              rows={4}
              value={abNoteDraft}
              onChange={e => setAbNoteDraft(e.target.value)}
              placeholder="Optional rationale / note"
              className={`${m.input} border rounded-lg px-3 py-2 text-sm ${m.text} focus:outline-none focus:border-violet-500`}
            />
            <div className="flex gap-2">
              <button onClick={() => finalizeWinner()} className="flex-1 bg-green-600 hover:bg-green-500 text-white rounded-lg py-2 text-sm font-semibold transition-colors">Save winner</button>
              <button onClick={() => finalizeWinner('')} className={`px-3 py-2 rounded-lg text-sm ${m.btn} ${m.textBody} transition-colors`}>Skip note</button>
            </div>
          </div>
        </div>
      )}

      {showWizard && (
        <div className={`fixed inset-0 ${m.modalBg} z-50 p-4 overflow-y-auto`}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-2xl mx-auto flex flex-col gap-4`}>
            <div className="flex items-center justify-between">
              <h2 className={`font-bold text-base ${m.text}`}>Getting Started ({wizardStep + 1}/4)</h2>
              <button onClick={() => setShowWizard(false)} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
            </div>

            {wizardStep === 0 && (
              <div className="flex flex-col gap-3">
                <p className={`text-sm ${m.textBody}`}>Set your provider and verify connectivity.</p>
                <div className="grid grid-cols-2 gap-2">
                  <select value={wizardProvider} onChange={e => { const p = e.target.value; setWizardProvider(p); setWizardModel(PROVIDER_DEFAULTS[p]?.model || 'claude-sonnet-4-20250514'); }} className={`${m.input} border rounded-lg px-2 py-2 text-sm ${m.text} focus:outline-none`}>
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Gemini</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="ollama">Ollama (local)</option>
                  </select>
                  <input value={wizardModel} onChange={e => setWizardModel(e.target.value)} placeholder={PROVIDER_DEFAULTS[wizardProvider]?.model || ''} className={`${m.input} border rounded-lg px-2 py-2 text-sm ${m.text} focus:outline-none`} />
                </div>
                <p className={`text-xs ${m.textMuted}`}>Configure API keys in extension Options. The model can be overridden here.</p>
                <button onClick={runWizardConnectivityCheck} className={`w-fit px-3 py-2 rounded-lg text-sm ${m.btn} ${m.textBody} transition-colors`}>Validate connectivity</button>
                {wizardConnectivity.status !== 'idle' && <p className={`text-xs ${wizardConnectivity.status === 'ok' ? 'text-green-400' : wizardConnectivity.status === 'error' ? 'text-red-400' : m.textSub}`}>{wizardConnectivity.message}</p>}
              </div>
            )}

            {wizardStep === 1 && (
              <div className="flex flex-col gap-3">
                <p className={`text-sm ${m.textBody}`}>Choose a starter prompt template.</p>
                <div className="grid grid-cols-2 gap-2">
                  {STARTER_TEMPLATES.map(template => (
                    <button
                      key={template.id}
                      onClick={() => setWizardTemplateId(template.id)}
                      className={`border rounded-lg p-3 text-left transition-colors ${wizardTemplateId === template.id ? 'border-violet-500 bg-violet-500/10' : `${m.border} ${m.surface}`}`}
                    >
                      <p className={`text-sm font-semibold ${m.text}`}>{template.label}</p>
                      <p className={`text-xs ${m.textAlt} mt-1 line-clamp-3`}>{template.prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {wizardStep === 2 && (
              <div className="flex flex-col gap-3">
                <p className={`text-sm ${m.textBody}`}>First run preview.</p>
                <textarea
                  rows={8}
                  value={(STARTER_TEMPLATES.find(t => t.id === wizardTemplateId) || STARTER_TEMPLATES[0]).prompt}
                  readOnly
                  className={`${m.input} border rounded-lg px-3 py-2 text-xs ${m.text}`}
                />
                <button
                  onClick={() => {
                    const selected = STARTER_TEMPLATES.find(t => t.id === wizardTemplateId) || STARTER_TEMPLATES[0];
                    setRaw(selected.prompt);
                    setTab('editor');
                    notify('Starter template loaded.');
                  }}
                  className="w-fit px-3 py-2 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors"
                >
                  Run in editor
                </button>
              </div>
            )}

            {wizardStep === 3 && (
              <div className="flex flex-col gap-3">
                <p className={`text-sm ${m.textBody}`}>Optional A/B demo.</p>
                <button
                  onClick={() => {
                    const selected = STARTER_TEMPLATES.find(t => t.id === wizardTemplateId) || STARTER_TEMPLATES[0];
                    setAbA({ prompt: selected.prompt, response: '', loading: false });
                    setAbB({ prompt: `${selected.prompt}\n\nOutput format: bullet list with 5 bullets.`, response: '', loading: false });
                    setAbWinner(null);
                    setTab('abtest');
                    notify('A/B demo variants loaded.');
                  }}
                  className="w-fit px-3 py-2 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors"
                >
                  Load A/B demo
                </button>
                <label className={`text-sm ${m.textBody} flex items-center gap-2`}>
                  <input type="checkbox" checked={wizardDontShowAgain} onChange={e => setWizardDontShowAgain(e.target.checked)} className="accent-violet-500" />
                  Don’t show again
                </label>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
              <button onClick={() => {
                if (wizardDontShowAgain) {
                  try { localStorage.setItem(ONBOARDING_DONE_KEY, '1'); } catch {}
                }
                setShowWizard(false);
              }} className={`px-3 py-1.5 rounded-lg text-sm ${m.btn} ${m.textBody} transition-colors`}>Skip for now</button>
              <div className="flex gap-2">
                {wizardStep > 0 && <button onClick={() => setWizardStep(s => s - 1)} className={`px-3 py-1.5 rounded-lg text-sm ${m.btn} ${m.textBody} transition-colors`}>Back</button>}
                {wizardStep < 3 && <button onClick={() => setWizardStep(s => s + 1)} className="px-3 py-1.5 rounded-lg text-sm bg-violet-600 hover:bg-violet-500 text-white transition-colors">Next</button>}
                {wizardStep === 3 && <button onClick={completeWizard} className="px-3 py-1.5 rounded-lg text-sm bg-green-600 hover:bg-green-500 text-white transition-colors">Finish</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-40 p-4`}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-md flex flex-col gap-4`}>
            <div className="flex justify-between items-center">
              <h2 className={`font-bold text-base ${m.text}`}>Settings</h2>
              <button onClick={() => setShowSettings(false)} className={`${m.textSub} hover:text-white`}><Ic n="X" size={15} /></button>
            </div>
            <label className={`flex items-center justify-between text-sm ${m.textBody} cursor-pointer`}>
              <span>Show enhancement notes</span>
              <input type="checkbox" checked={showNotes} onChange={e => setShowNotes(e.target.checked)} className="accent-violet-500" />
            </label>
            <div className={`border ${m.border} rounded-lg p-3 flex flex-col gap-2`}>
              <label className={`flex items-center justify-between text-sm ${m.textBody} cursor-pointer`}>
                <span>Sensitive data redaction gate</span>
                <input
                  type="checkbox"
                  checked={redactionSettings.enabled}
                  onChange={e => setRedactionSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="accent-violet-500"
                />
              </label>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(redactionSettings.patterns || {}).map(([key, enabled]) => (
                  <label key={key} className={`text-xs ${m.textAlt} flex items-center gap-1 cursor-pointer`}>
                    <input
                      type="checkbox"
                      checked={Boolean(enabled)}
                      onChange={e => setRedactionSettings(prev => ({
                        ...prev,
                        patterns: { ...(prev.patterns || {}), [key]: e.target.checked },
                      }))}
                      className="accent-violet-500"
                    />
                    {key}
                  </label>
                ))}
              </div>
              <textarea
                rows={3}
                value={(redactionSettings.customPatterns || []).join('\n')}
                onChange={e => setRedactionSettings(prev => ({
                  ...prev,
                  customPatterns: e.target.value.split('\n').map(v => v.trim()).filter(Boolean),
                }))}
                placeholder="Custom regex patterns (one per line)"
                className={`${m.input} border rounded-lg px-2 py-1 text-xs ${m.text} focus:outline-none`}
              />
            </div>
            {collections.length > 0 && (
              <div>
                <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Collections</p>
                <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                  {collections.map(c => (
                    <div key={c} className="flex items-center justify-between">
                      <span className={`text-xs ${m.textAlt} flex items-center gap-1`}><Ic n="FolderOpen" size={9} />{c}</span>
                      <button onClick={() => setCollections(p => p.filter(x => x !== c))} className={`text-xs ${m.textMuted} hover:text-red-400 transition-colors`}><Ic n="Trash2" size={11} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={openOptions} className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 text-violet-400 font-semibold transition-colors`}>
              🔑 Manage Provider Keys (Options)
            </button>
            <button onClick={relaunchWizard} className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 ${m.textBody} transition-colors`}>
              🚀 Getting started
            </button>
            <div className={`border-t ${m.border} pt-3 flex flex-col gap-2`}>
              <button onClick={exportLib} className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 ${m.textBody} transition-colors`}><Ic n="Download" size={12} />Export Library</button>
              <label className={`flex items-center gap-2 text-sm ${m.btn} rounded-lg px-3 py-2 ${m.textBody} cursor-pointer transition-colors`}><Ic n="Upload" size={12} />Import Library<input type="file" accept=".json" onChange={importLib} className="hidden" /></label>
              <button onClick={() => { if (window.confirm('Clear all prompts from the library?')) { setLibrary([]); notify('Library cleared.'); } }} className="flex items-center gap-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg px-3 py-2 transition-colors"><Ic n="Trash2" size={12} />Clear All Prompts</button>
            </div>
          </div>
        </div>
      )}

      {showCmdPalette && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-start justify-center z-50 pt-20 p-4`} onClick={() => setShowCmdPalette(false)}>
          <div className={`${m.modal} border rounded-xl w-full max-w-md overflow-hidden shadow-2xl`} onClick={e => e.stopPropagation()}>
            <div className={`flex items-center gap-2 px-4 py-3 border-b ${m.border}`}>
              <Ic n="Search" size={13} className={m.textSub} />
              <input autoFocus className={`flex-1 bg-transparent text-sm ${m.text} focus:outline-none placeholder-gray-500`}
                placeholder="Search commands…" value={cmdQuery} onChange={e => setCmdQuery(e.target.value)} />
              <span className={`text-xs ${m.textMuted} font-mono`}>ESC</span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {filteredCmds.map((a, i) => (
                <button key={i} onClick={a.action}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm ${m.textBody} hover:bg-violet-600 hover:text-white transition-colors text-left`}>
                  <span>{a.label}</span>
                  {a.hint && <kbd className={`text-xs font-mono px-1.5 py-0.5 ${m.pill} rounded`}>{a.hint}</kbd>}
                </button>
              ))}
              {filteredCmds.length === 0 && <p className={`text-xs ${m.textMuted} p-4 text-center`}>No commands found</p>}
            </div>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-50 p-4`} onClick={() => setShowShortcuts(false)}>
          <div className={`${m.modal} border rounded-xl p-5 w-full max-w-xs`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className={`font-bold text-sm ${m.text}`}>Keyboard Shortcuts</h2>
              <button onClick={() => setShowShortcuts(false)} className={m.textSub}><Ic n="X" size={14} /></button>
            </div>
            <div className="flex flex-col gap-2.5">
              {[['⌘ ↵', 'Enhance prompt'], ['⌘ S', 'Save prompt'], ['⌘ K', 'Command palette'], ['?', 'Show shortcuts'], ['Esc', 'Close modals']].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className={`text-sm ${m.textBody}`}>{label}</span>
                  <kbd className={`text-xs font-mono px-2 py-1 ${m.pill} rounded-md`}>{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
