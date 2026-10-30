import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppRecords } from '../lib/AppLibraryContext.jsx';
import { logWarn } from '../lib/logger.js';
import { RECORDS_CHANGED_EVENT } from '../lib/writeRecovery.js';

export default function useTestCases({ notify }) {
  const { saveTestCase, listTestCases, deleteTestCase } = useAppRecords();
  const [testCasesByPrompt, setTestCasesByPrompt] = useState({});
  const [caseFormPromptId, setCaseFormPromptId] = useState(null);
  const [editingCaseId, setEditingCaseId] = useState(null);
  const [caseTitle, setCaseTitle] = useState('');
  const [caseInput, setCaseInput] = useState('');
  const [caseTraits, setCaseTraits] = useState('');
  const [caseExclusions, setCaseExclusions] = useState('');
  const [caseNotes, setCaseNotes] = useState('');
  const [runningCases, setRunningCases] = useState(false);
  const draftIdRef = useRef(null);
  const observedCaseRef = useRef(null);
  const caseAttemptRef = useRef(null);

  const refreshTestCases = useCallback(async () => {
    try {
      const rows = await listTestCases();
      const next = rows.reduce((acc, row) => {
        const key = row.promptId || '__orphan__';
        if (!acc[key]) acc[key] = [];
        acc[key].push(row);
        return acc;
      }, {});
      setTestCasesByPrompt(next);
    } catch (e) {
      logWarn('refresh test cases', e);
      setTestCasesByPrompt({});
    }
  }, [listTestCases]);

  useEffect(() => {
    refreshTestCases();
    window.addEventListener(RECORDS_CHANGED_EVENT, refreshTestCases);
    return () => window.removeEventListener(RECORDS_CHANGED_EVENT, refreshTestCases);
  }, [refreshTestCases]);

  const resetCaseForm = () => {
    draftIdRef.current = null;
    observedCaseRef.current = null;
    caseAttemptRef.current = null;
    setCaseFormPromptId(null);
    setEditingCaseId(null);
    setCaseTitle('');
    setCaseInput('');
    setCaseTraits('');
    setCaseExclusions('');
    setCaseNotes('');
  };

  const parseCaseList = (value) => String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const openCaseForm = (promptId, existingCase = null) => {
    observedCaseRef.current = existingCase;
    caseAttemptRef.current = null;
    draftIdRef.current = existingCase?.id || crypto.randomUUID();
    setCaseFormPromptId(promptId);
    if (existingCase) {
      setEditingCaseId(existingCase.id);
      setCaseTitle(existingCase.title || '');
      setCaseInput(existingCase.input || '');
      setCaseTraits((existingCase.expectedTraits || []).join(', '));
      setCaseExclusions((existingCase.expectedExclusions || []).join(', '));
      setCaseNotes(existingCase.notes || '');
    } else {
      setEditingCaseId(null);
      setCaseTitle('');
      setCaseInput('');
      setCaseTraits('');
      setCaseExclusions('');
      setCaseNotes('');
    }
  };

  const saveCaseForPrompt = async (promptId) => {
    try {
      const payload = {
        ...observedCaseRef.current,
        id: editingCaseId || (draftIdRef.current ??= crypto.randomUUID()),
        promptId,
        title: caseTitle,
        input: caseInput,
        expectedTraits: parseCaseList(caseTraits),
        expectedExclusions: parseCaseList(caseExclusions),
        notes: caseNotes,
      };
      const signature = JSON.stringify(payload);
      if (caseAttemptRef.current?.signature !== signature) {
        const now = new Date().toISOString();
        caseAttemptRef.current = { signature, payload: { ...payload, createdAt: payload.createdAt || now, updatedAt: now } };
      }
      const attempt = caseAttemptRef.current;
      const record = await saveTestCase(attempt.payload);
      await refreshTestCases();
      if (caseAttemptRef.current === attempt) resetCaseForm();
      else if (draftIdRef.current === attempt.payload.id) {
        // Keep newer text, but base its next save on this acknowledged version.
        observedCaseRef.current = record;
        setEditingCaseId(record.id);
      }
      notify(editingCaseId ? `Updated test case: ${record.title}` : `Saved test case: ${record.title}`);
    } catch (e) {
      notify(e?.message || 'Unable to save test case');
    }
  };

  const removeCase = async (testCase) => {
    if (!window.confirm(`Delete test case "${testCase.title}"?`)) return;
    try {
      await deleteTestCase(testCase.id, testCase);
      await refreshTestCases();
      notify('Test case deleted');
    } catch (error) {
      notify(error?.message || 'Unable to delete test case');
    }
  };

  const edit = setter => value => {
    caseAttemptRef.current = null;
    setter(value);
  };

  return {
    testCasesByPrompt,
    caseFormPromptId,
    editingCaseId,
    caseTitle, setCaseTitle: edit(setCaseTitle),
    caseInput, setCaseInput: edit(setCaseInput),
    caseTraits, setCaseTraits: edit(setCaseTraits),
    caseExclusions, setCaseExclusions: edit(setCaseExclusions),
    caseNotes, setCaseNotes: edit(setCaseNotes),
    runningCases, setRunningCases,
    openCaseForm,
    resetCaseForm,
    saveCaseForPrompt,
    removeCase,
    refreshTestCases,
  };
}
