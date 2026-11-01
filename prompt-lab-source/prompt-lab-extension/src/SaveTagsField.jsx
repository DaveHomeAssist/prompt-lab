import { useMemo, useState } from 'react';
import TagChip from './TagChip';
import { ALL_TAGS } from './constants';
import { cleanTypedTag, MAX_TAG_LENGTH, suggestTags, tagChoices } from './lib/tagSuggestions.js';

export default function SaveTagsField({ m, saveTags, setSaveTags, libraryTags = [], sourceText = '' }) {
  const [typed, setTyped] = useState('');
  const [hint, setHint] = useState('');
  const choices = useMemo(() => tagChoices({ builtIn: ALL_TAGS, libraryTags, selected: saveTags }), [libraryTags, saveTags]);
  const ideas = useMemo(() => suggestTags(sourceText, { libraryTags, selected: saveTags }), [sourceText, libraryTags, saveTags]);
  const has = (tag) => saveTags.some((item) => item.toLowerCase() === tag.toLowerCase());
  const toggle = (tag) => setSaveTags((prev) => (prev.some((item) => item.toLowerCase() === tag.toLowerCase())
    ? prev.filter((item) => item.toLowerCase() !== tag.toLowerCase())
    : [...prev, tag]));
  const add = (tag) => setSaveTags((prev) => (prev.some((item) => item.toLowerCase() === tag.toLowerCase()) ? prev : [...prev, tag]));
  const commitTyped = () => {
    const tag = cleanTypedTag(typed);
    if (!tag) { setHint(typed.trim() ? `Tags can be up to ${MAX_TAG_LENGTH} characters.` : ''); return; }
    add(tag); setTyped(''); setHint('');
  };
  return (
    <div>
      <p id="save-prompt-tags-label" className={`mb-2 text-xs font-semibold uppercase tracking-wider ${m.textSub}`}>Tags</p>
      {ideas.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Suggested tags">
          <span className={`text-[11px] ${m.textMuted}`}>Suggested</span>
          {ideas.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => add(tag)}
              aria-label={`Add suggested tag ${tag}`}
              className={`ui-control rounded-full border border-dashed px-2.5 py-1 text-[11px] transition-colors ${m.border} ${m.textAlt} hover:text-orange-400`}
            >
              + {tag}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="save-prompt-tags-label">
        {choices.map((tag) => <TagChip key={tag} tag={tag} selected={has(tag)} onClick={() => toggle(tag)} />)}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          aria-label="Add a tag"
          className={`${m.input} min-w-0 flex-1 border rounded-lg px-3 py-1.5 text-xs ${m.text} focus:outline-none focus:border-orange-500`}
          placeholder="Add a tag…"
          value={typed}
          maxLength={MAX_TAG_LENGTH + 8}
          onChange={(event) => { setTyped(event.target.value); setHint(''); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); commitTyped(); }
          }}
        />
        <button type="button" onClick={commitTyped} disabled={!typed.trim()} className={`ui-control rounded-lg px-3 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt}`}>
          Add
        </button>
      </div>
      {hint && <p role="status" className={`mt-1 text-[11px] ${m.textMuted}`}>{hint}</p>}
    </div>
  );
}
