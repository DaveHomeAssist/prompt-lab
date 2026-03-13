import { useState, useEffect } from 'react';
import { saveTestCase, listTestCases, deleteTestCase } from '../experimentStore';
import { logWarn } from '../lib/logger.js';

export default function useTestCases({ notify }) {
  const [testCasesByPrompt, setTestCasesByPrompt] = useState({});
  const [caseFormPromptId, setCaseFormPromptId] = useState(null);
  const [editingCaseId, setEditingCaseId] = useState(null);
  const [caseTitle, setCaseTitle] = useState('');
  const [caseInput, setCaseInput] = useState('');
  const [caseTraits, setCaseTraits] = useState('');
  const [caseExclusions, setCaseExclusions] = useState('');
  const [caseNotes, setCaseNotes] = useState('');
  const [runningCases, setRunningCases] = useState(false);

  const refreshTestCases = async () => {
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
  };

  useEffect(() => {
    refreshTestCases();
  }, []);

  const resetCaseForm = () => {
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
        promptId,
        title: caseTitle,
        input: caseInput,
        expectedTraits: parseCaseList(caseTraits),
        expectedExclusions: parseCaseList(caseExclusions),
        notes: caseNotes,
      };
      if (editingCaseId) {
        payload.id = editingCaseId;
        payload.updatedAt = new Date().toISOString();
      }
      const record = await saveTestCase(payload);
      await refreshTestCases();
      resetCaseForm();
      notify(editingCaseId ? `Updated test case: ${record.title}` : `Saved test case: ${record.title}`);
    } catch (e) {
      notify(e?.message || 'Unable to save test case');
    }
  };

  const removeCase = async (testCase) => {
    if (!window.confirm(`Delete test case "${testCase.title}"?`)) return;
    try {
      await deleteTestCase(testCase.id);
      await refreshTestCases();
      notify('Test case deleted');
    } catch {
      notify('Unable to delete test case');
    }
  };

  return {
    testCasesByPrompt,
    caseFormPromptId,
    editingCaseId,
    caseTitle, setCaseTitle,
    caseInput, setCaseInput,
    caseTraits, setCaseTraits,
    caseExclusions, setCaseExclusions,
    caseNotes, setCaseNotes,
    runningCases, setRunningCases,
    openCaseForm,
    resetCaseForm,
    saveCaseForPrompt,
    removeCase,
    refreshTestCases,
  };
}
