import Ic from './icons';

const VERDICT_COLORS = {
  pass: 'text-green-400',
  fail: 'text-red-400',
  mixed: 'text-yellow-400',
};

function VerdictBadge({ evalRuns, testCaseId }) {
  if (!evalRuns || !testCaseId) return null;
  const last = evalRuns.find((r) => r.testCaseId === testCaseId);
  if (!last) return null;
  if (last.status === 'error') {
    return <span className="text-[10px] font-semibold text-red-400 uppercase">error</span>;
  }
  if (last.verdict) {
    return <span className={`text-[10px] font-semibold uppercase ${VERDICT_COLORS[last.verdict] || ''}`}>{last.verdict}</span>;
  }
  return <span className="text-[10px] font-semibold text-blue-400 uppercase">ran</span>;
}

export default function TestCasesPanel({
  m, entry, cases, evalRuns,
  caseFormPromptId, editingCaseId,
  caseTitle, setCaseTitle, caseInput, setCaseInput,
  caseTraits, setCaseTraits, caseExclusions, setCaseExclusions,
  caseNotes, setCaseNotes,
  openCaseForm, resetCaseForm, saveCaseForPrompt,
  loadCaseIntoEditor, runSingleCase, removeCase,
}) {
  const isFormOpen = caseFormPromptId === entry.id;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className={`text-xs ${m.textSub} font-semibold uppercase tracking-wider flex items-center gap-1`}>
          <Ic n="FlaskConical" size={11} />Test Cases ({cases.length})
        </p>
        {isFormOpen ? (
          <button onClick={resetCaseForm} className={`text-xs ${m.textSub} hover:text-white transition-colors`}>Cancel</button>
        ) : (
          <button onClick={() => openCaseForm(entry.id)} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">Add Case</button>
        )}
      </div>
      {isFormOpen && (
        <div className={`${m.codeBlock} border ${m.border} rounded-lg p-2.5 flex flex-col gap-2 mb-2`}>
          <input
            className={`${m.input} border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-violet-500 ${m.text}`}
            placeholder="Case title"
            value={caseTitle}
            onChange={(e) => setCaseTitle(e.target.value)}
          />
          <textarea
            rows={4}
            className={`${m.input} border rounded-lg px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:border-violet-500 ${m.text}`}
            placeholder="Representative prompt input..."
            value={caseInput}
            onChange={(e) => setCaseInput(e.target.value)}
          />
          <input
            className={`${m.input} border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-violet-500 ${m.text}`}
            placeholder="Expected traits (comma separated)"
            value={caseTraits}
            onChange={(e) => setCaseTraits(e.target.value)}
          />
          <input
            className={`${m.input} border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-violet-500 ${m.text}`}
            placeholder="Expected exclusions (comma separated)"
            value={caseExclusions}
            onChange={(e) => setCaseExclusions(e.target.value)}
          />
          <textarea
            rows={2}
            className={`${m.input} border rounded-lg px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:border-violet-500 ${m.text}`}
            placeholder="Notes"
            value={caseNotes}
            onChange={(e) => setCaseNotes(e.target.value)}
          />
          <button
            onClick={() => saveCaseForPrompt(entry.id)}
            disabled={!caseInput.trim()}
            className="self-start px-2.5 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            {editingCaseId ? 'Update Case' : 'Save Case'}
          </button>
        </div>
      )}
      {cases.length > 0 ? (
        <div className="flex flex-col gap-2">
          {cases.map((testCase) => (
            <div key={testCase.id} className={`${m.codeBlock} border ${m.border} rounded-lg p-2.5`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-semibold text-violet-400 truncate">{testCase.title}</span>
                  <VerdictBadge evalRuns={evalRuns} testCaseId={testCase.id} />
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openCaseForm(entry.id, testCase)} className={`text-xs ${m.textSub} hover:text-violet-400 transition-colors`}>Edit</button>
                  <button onClick={() => loadCaseIntoEditor(testCase)} className={`text-xs ${m.textSub} hover:text-white transition-colors`}>Use</button>
                  <button onClick={() => runSingleCase(testCase, entry.title)} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Run</button>
                  <button onClick={() => removeCase(testCase)} className="text-xs text-red-400 hover:text-red-300 transition-colors">Delete</button>
                </div>
              </div>
              <p className={`text-xs ${m.textBody} leading-relaxed whitespace-pre-wrap`}>{testCase.input}</p>
              {(testCase.expectedTraits.length > 0 || testCase.expectedExclusions.length > 0) && (
                <div className={`mt-1 flex flex-wrap gap-2 ${m.textMuted}`}>
                  {testCase.expectedTraits.length > 0 && <span>Expect: {testCase.expectedTraits.join(', ')}</span>}
                  {testCase.expectedExclusions.length > 0 && <span>Avoid: {testCase.expectedExclusions.join(', ')}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className={`text-xs ${m.textMuted}`}>No saved test cases yet.</p>
      )}
    </div>
  );
}
