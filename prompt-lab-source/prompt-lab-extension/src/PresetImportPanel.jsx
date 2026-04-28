import { useMemo, useRef, useState } from 'react';
import Ic from './icons';
import DraftBadge from './DraftBadge.jsx';
import {
  detectDuplicates,
  detectEmptyPrompts,
  importPresetPack,
  validatePresetPack,
} from './lib/presetImport.js';
import { ensureString } from './lib/utils.js';

function summarizeImport(result) {
  if (!result) return '';
  const importedCount = result.imported.length;
  const skippedCount = result.skipped.length;
  if (!importedCount && !skippedCount) return 'No changes applied.';
  return `${importedCount} imported${skippedCount ? `, ${skippedCount} skipped` : ''}`;
}

function uniqueCollections(entries) {
  return [...new Set(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => ensureString(entry?.collection).trim())
      .filter(Boolean)
  )];
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(ensureString(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

export default function PresetImportPanel({ m, lib, compact = false, onClose }) {
  const fileInputRef = useRef(null);
  const [sourceText, setSourceText] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const preview = useMemo(() => {
    const text = sourceText.trim();
    if (!text) {
      return {
        pack: null,
        parseError: '',
        validation: null,
        duplicates: [],
        emptyPrompts: [],
      };
    }

    try {
      const parsed = JSON.parse(text);
      const validation = validatePresetPack(parsed);
      return {
        pack: parsed,
        parseError: '',
        validation,
        duplicates: validation.valid ? detectDuplicates(parsed.presets, lib.library) : [],
        emptyPrompts: validation.valid ? detectEmptyPrompts(parsed.presets) : [],
      };
    } catch (error) {
      return {
        pack: null,
        parseError: error instanceof Error ? error.message : 'Invalid JSON.',
        validation: null,
        duplicates: [],
        emptyPrompts: [],
      };
    }
  }, [lib.library, sourceText]);

  const presetCount = Array.isArray(preview.pack?.presets) ? preview.pack.presets.length : 0;
  const readyToImport = Boolean(preview.pack && preview.validation?.valid);
  const hasDraft = Boolean(sourceText.trim());
  const importTitle = importing
    ? 'Import in progress'
    : !readyToImport && preview.parseError
      ? 'Fix the JSON error to enable'
      : !readyToImport && preview.validation && !preview.validation.valid
        ? 'Resolve validation issues to enable'
        : !readyToImport
          ? 'Paste or drop a preset pack to enable'
          : undefined;

  const handleSourceText = (value, label = '') => {
    setSourceText(value);
    setSourceLabel(label);
    setImportResult(null);
  };

  const handleFile = async (file) => {
    if (!file) return;
    const text = await readFileAsText(file);
    handleSourceText(text, file.name);
  };

  const handleImport = async () => {
    if (!readyToImport || importing) return;

    const adapter = {
      load: async () => lib.library,
      save: async (mergedLibrary) => {
        lib.setLibrary(mergedLibrary);
        if (typeof lib.setCollections === 'function') {
          const nextCollections = uniqueCollections(mergedLibrary);
          lib.setCollections((prev) => [...new Set([...(Array.isArray(prev) ? prev : []), ...nextCollections])]);
        }
        return true;
      },
    };

    setImporting(true);
    try {
      const result = await importPresetPack(preview.pack, adapter);
      setImportResult(result);
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className={`${m.surface} border ${m.border} rounded-xl p-3 flex flex-col gap-3`}>
      <div className={`flex items-start justify-between gap-3 ${compact ? 'flex-col' : ''}`}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <p className={`text-sm font-semibold ${m.text}`}>Import Preset Pack</p>
            {hasDraft && <DraftBadge>{sourceLabel ? `Draft · ${sourceLabel}` : 'Draft JSON'}</DraftBadge>}
            {readyToImport && <DraftBadge tone="success">{presetCount} preset{presetCount === 1 ? '' : 's'}</DraftBadge>}
          </div>
          <p className={`text-xs ${m.textMuted}`}>
            Drop a `.json` pack or paste pack JSON to preview warnings, duplicates, and skipped prompts before merge.
          </p>
        </div>
        <div className={`flex gap-2 ${compact ? 'w-full' : ''}`}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`ui-control inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt} ${compact ? 'flex-1' : ''}`}
          >
            <Ic n="Upload" size={12} />
            Choose File
          </button>
          <button
            type="button"
            onClick={() => {
              handleSourceText('');
              if (typeof onClose === 'function') onClose();
            }}
            className={`ui-control rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt} ${compact ? 'flex-1' : ''}`}
          >
            Close
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={async (event) => {
            try {
              await handleFile(event.target.files?.[0]);
            } finally {
              event.target.value = '';
            }
          }}
        />
      </div>

      <div
        className={`rounded-xl border border-dashed px-3 py-4 text-center transition-colors ${dragActive ? 'border-violet-400 bg-violet-500/10' : `${m.border} ${m.codeBlock}`}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={async (event) => {
          event.preventDefault();
          setDragActive(false);
          await handleFile(event.dataTransfer.files?.[0]);
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <Ic n="Upload" size={18} className={m.textSub} />
          <p className={`text-sm font-medium ${m.text}`}>Drop preset pack JSON here</p>
          <p className={`text-xs ${m.textMuted}`}>File import and pasted JSON use the same preview path.</p>
        </div>
      </div>

      <textarea
        value={sourceText}
        onChange={(event) => handleSourceText(event.target.value, sourceLabel)}
        placeholder='Paste preset pack JSON…'
        className={`min-h-[9rem] w-full ${m.input} border rounded-xl px-3 py-2 text-xs leading-relaxed focus:outline-none focus:border-violet-500 ${m.text}`}
      />

      {preview.parseError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <DraftBadge tone="danger">Invalid JSON</DraftBadge>
            <p className="text-xs text-rose-200">{preview.parseError}</p>
          </div>
        </div>
      )}

      {preview.validation && (
        <div className="grid gap-2 md:grid-cols-3">
          <div className={`${m.codeBlock} border ${m.border} rounded-lg px-3 py-2`}>
            <p className={`text-[10px] uppercase tracking-wide ${m.textSub}`}>Validation</p>
            <p className={`mt-1 text-sm font-semibold ${preview.validation.valid ? 'text-emerald-300' : 'text-rose-300'}`}>
              {preview.validation.valid ? 'Ready to import' : `${preview.validation.errors.length} blocking issue${preview.validation.errors.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className={`${m.codeBlock} border ${m.border} rounded-lg px-3 py-2`}>
            <p className={`text-[10px] uppercase tracking-wide ${m.textSub}`}>Duplicates</p>
            <p className={`mt-1 text-sm font-semibold ${m.text}`}>{preview.duplicates.length}</p>
          </div>
          <div className={`${m.codeBlock} border ${m.border} rounded-lg px-3 py-2`}>
            <p className={`text-[10px] uppercase tracking-wide ${m.textSub}`}>Empty prompts</p>
            <p className={`mt-1 text-sm font-semibold ${m.text}`}>{preview.emptyPrompts.length}</p>
          </div>
        </div>
      )}

      {preview.validation?.errors?.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2">
          <div className="mb-2 flex items-center gap-2">
            <DraftBadge tone="danger">Fix before import</DraftBadge>
          </div>
          <ul className="flex flex-col gap-1 text-xs text-rose-100">
            {preview.validation.errors.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </div>
      )}

      {preview.validation?.warnings?.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <div className="mb-2 flex items-center gap-2">
            <DraftBadge tone="warning">Warnings</DraftBadge>
          </div>
          <ul className="flex flex-col gap-1 text-xs text-amber-100">
            {preview.validation.warnings.slice(0, 5).map((message) => <li key={message}>{message}</li>)}
          </ul>
        </div>
      )}

      {preview.pack && (
        <div className="grid gap-3 lg:grid-cols-[1.4fr,1fr]">
          <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-sm font-semibold ${m.text}`}>{ensureString(preview.pack.title) || 'Untitled Pack'}</p>
                <p className={`mt-1 text-xs ${m.textMuted}`}>{ensureString(preview.pack.description) || 'No description provided.'}</p>
              </div>
              <DraftBadge tone={readyToImport ? 'success' : 'default'}>
                {presetCount} preset{presetCount === 1 ? '' : 's'}
              </DraftBadge>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {preview.pack.presets?.slice(0, 4).map((preset) => {
                const presetId = ensureString(preset.id);
                const emptyPrompt = preview.emptyPrompts.some((item) => ensureString(item.id) === presetId);
                const duplicate = preview.duplicates.find((item) => ensureString(item.a.id) === presetId);
                return (
                  <div key={presetId || preset.title} className={`rounded-lg border ${m.border} px-3 py-2`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className={`text-xs font-semibold ${m.text}`}>{ensureString(preset.title) || 'Untitled preset'}</p>
                        <p className={`mt-0.5 text-[11px] ${m.textMuted}`}>{ensureString(preset.summary) || ensureString(preset.category) || 'No summary provided.'}</p>
                      </div>
                      {emptyPrompt && <DraftBadge tone="danger">Empty</DraftBadge>}
                      {!emptyPrompt && duplicate && (
                        <DraftBadge tone="warning">
                          {duplicate.reason === 'prompt-exact-match' ? 'Exact match' : 'Similar'}
                        </DraftBadge>
                      )}
                    </div>
                  </div>
                );
              })}
              {presetCount > 4 && (
                <p className={`text-[11px] ${m.textMuted}`}>+{presetCount - 4} more preset{presetCount - 4 === 1 ? '' : 's'} in preview</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {preview.duplicates.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200">Possible duplicates</p>
                <div className="mt-2 flex flex-col gap-1">
                  {preview.duplicates.slice(0, 4).map((item) => (
                    <p key={`${item.a.id}-${item.b.id}-${item.reason}`} className="text-xs text-amber-100">
                      {item.a.title} ↔ {item.b.title} ({item.reason})
                    </p>
                  ))}
                </div>
              </div>
            )}

            {importResult && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                <div className="flex items-center gap-2">
                  <DraftBadge tone="success">Imported</DraftBadge>
                  <p className="text-xs text-emerald-100">{summarizeImport(importResult)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={`flex ${compact ? 'flex-col' : 'items-center justify-between'} gap-2`}>
        <p className={`text-xs ${m.textMuted}`}>
          Exact prompt matches are skipped automatically. ID collisions are imported with a safe suffix.
        </p>
        <button
          type="button"
          onClick={handleImport}
          disabled={!readyToImport || importing}
          title={importTitle}
          className="ui-control inline-flex items-center justify-center gap-1 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Ic n="Download" size={12} />
          {importing ? 'Importing…' : 'Import Presets'}
        </button>
      </div>
    </section>
  );
}
