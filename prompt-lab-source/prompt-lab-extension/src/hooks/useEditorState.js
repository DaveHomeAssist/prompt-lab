import { useEffect, useRef, useState } from 'react';
import { lintPrompt, applyLintQuickFixAtSelection } from '../promptLint';
import { normalizeError } from '../lib/errorTaxonomy.js';

/**
 * Editor-local state only: text buffers, cursor, layout, and lint.
 */
export default function useEditorState() {
  const [raw, setRaw] = useState('');
  const [enhanced, setEnhanced] = useState('');
  const [variants, setVariants] = useState([]);
  const [notes, setNotes] = useState('');
  const [resultMeta, setResultMeta] = useState(null);
  const [enhMode, setEnhMode] = useState('balanced');
  const [showNotes, setShowNotes] = useState(true);
  const [editorLayout, setEditorLayout] = useState('editor');
  const [composerBlocks, setComposerBlocks] = useState([]);
  const [cursor, setCursor] = useState({ start: 0, end: 0 });

  const [lintIssues, setLintIssues] = useState([]);
  const [lintOpen, setLintOpen] = useState(false);
  const [lintError, setLintError] = useState(null);
  const lintTimerRef = useRef(null);

  useEffect(() => {
    if (lintTimerRef.current) clearTimeout(lintTimerRef.current);
    if (!raw.trim()) {
      setLintIssues([]);
      return undefined;
    }
    lintTimerRef.current = setTimeout(() => {
      try {
        setLintIssues(lintPrompt(raw));
        setLintError(null);
      } catch (caught) {
        setLintIssues([]);
        setLintError(normalizeError(caught, 'lint'));
      }
    }, 300);
    return () => clearTimeout(lintTimerRef.current);
  }, [raw]);

  const handleLintFix = (ruleId) => {
    try {
      const result = applyLintQuickFixAtSelection(raw, ruleId, cursor);
      setRaw(result.text);
      setCursor({ start: result.selectionStart, end: result.selectionEnd });
      setLintError(null);
      return result;
    } catch (caught) {
      setLintError(normalizeError(caught, 'lint'));
      return null;
    }
  };

  const updateCursor = (start, end = start) => {
    const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;
    const safeEnd = Number.isFinite(end) ? Math.max(safeStart, end) : safeStart;
    setCursor({ start: safeStart, end: safeEnd });
  };

  const clearEditorState = () => {
    setRaw('');
    setEnhanced('');
    setVariants([]);
    setNotes('');
    setResultMeta(null);
    setCursor({ start: 0, end: 0 });
  };

  return {
    raw, setRaw,
    enhanced, setEnhanced,
    variants, setVariants,
    notes, setNotes,
    resultMeta, setResultMeta,
    enhMode, setEnhMode,
    showNotes, setShowNotes,
    editorLayout, setEditorLayout,
    composerBlocks, setComposerBlocks,
    cursor, setCursor, updateCursor,
    lintIssues, lintOpen, setLintOpen, lintError, handleLintFix,
    hasSavablePrompt: raw.trim() || enhanced.trim(),
    clearEditorState,
  };
}
