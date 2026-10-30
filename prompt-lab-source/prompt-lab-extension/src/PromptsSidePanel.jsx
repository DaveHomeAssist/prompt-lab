import { useMemo, useRef, useState } from 'react';
import Ic from './icons';
import { Artwork } from './ArtworkPicker.jsx';
import { matchesLibrarySearch } from './lib/libraryMatching.js';
import { formatRelativeTime } from './ScratchNoteRow.jsx';
import { smartViewEntries } from './lib/librarySmartViews.js';
import { WRITE_PROMPT_VIEWS } from './lib/sidePane.js';

const EMPTY_MESSAGES = {
  all: 'No saved prompts yet. Save a prompt from Write to see it here.',
  recent: 'No saved prompts yet. Prompts you open appear here, most recent first.',
  favorites: 'No favorites yet. Star a prompt here or in the Library.',
};

function entryText(entry) {
  return entry?.enhanced || entry?.original || '';
}

function entryMeta(entry, view) {
  if (view === 'recent' && entry.lastAccessedAt) return `Opened ${formatRelativeTime(entry.lastAccessedAt)}`;
  const parts = [];
  if (entry.collection) parts.push(entry.collection);
  const updated = entry.updatedAt || entry.createdAt;
  if (updated) parts.push(formatRelativeTime(updated));
  return parts.join(' · ');
}

// Saved prompts beside the Write editor: All, Recent and Favorites, listed
// with the same rules and order as the Library's smart views.
export default function PromptsSidePanel({
  m = {},
  library = [],
  sortBy = 'newest',
  view = 'all',
  onViewChange,
  query: controlledQuery,
  onQueryChange,
  onOpen,
  onInsert,
  onToggleFavorite,
}) {
  const [localQuery, setLocalQuery] = useState('');
  const searchRef = useRef(null);
  const query = controlledQuery ?? localQuery;
  const setQuery = onQueryChange ?? setLocalQuery;
  const clearSearch = () => { setQuery(''); searchRef.current?.focus(); };
  const allEntries = useMemo(() => smartViewEntries(library, view, sortBy), [library, view, sortBy]);
  const entries = useMemo(() => allEntries.filter(entry => matchesLibrarySearch(entry, query)), [allEntries, query]);
  const label = WRITE_PROMPT_VIEWS.find((item) => item.id === view)?.label || 'All';

  return (
    <div className="pl-write-prompts">
      <div className="pl-write-side-subheader">
        <div className="pl-segmented flex-1" role="group" aria-label="Prompt list">
          {WRITE_PROMPT_VIEWS.map((item) => (
            <button key={item.id} type="button" aria-pressed={view === item.id} data-side-autofocus={view === item.id ? '' : undefined} onClick={() => onViewChange?.(item.id)}>{item.label}</button>
          ))}
        </div>
        <p className={`shrink-0 text-[10px] ${m.textMuted || ''}`}>{query.trim() ? `${entries.length} of ${allEntries.length}` : entries.length} prompt{allEntries.length === 1 ? '' : 's'}</p>
      </div>
      <div className="pl-write-prompt-search">
        <label className="sr-only" htmlFor="write-prompt-search">Search prompts beside Write</label>
        <input ref={searchRef} id="write-prompt-search" type="search" value={query} placeholder="Search prompts…" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }} />
        {query && (entries.length > 0 || !query.trim()) && <button type="button" className={`ui-control ${m.btn || ''}`} onClick={clearSearch}>Clear search</button>}
      </div>
      {entries.length === 0
        ? <div className={`pl-write-prompts-empty text-xs ${m.textMuted || ''}`}>
          <p role="status">{query.trim() ? 'No prompts match this search in the selected view.' : EMPTY_MESSAGES[view] || EMPTY_MESSAGES.all}</p>
          {query.trim() && <div className="pl-write-search-recovery">
            <button type="button" className={`ui-control ${m.btn || ''}`} onClick={clearSearch}>Clear search</button>
            {view !== 'all' && onViewChange && <button type="button" className={`ui-control ${m.btn || ''}`} onClick={() => { onViewChange('all'); searchRef.current?.focus(); }}>Search All prompts</button>}
          </div>}
        </div>
        : (
          <ul className="pl-write-prompts-list" aria-label={`${label} prompts`}>
            {entries.map((entry) => {
              const title = entry.title || 'Untitled prompt';
              const meta = entryMeta(entry, view);
              return (
                <li key={entry.id} className="pl-write-prompt-row">
                  <button type="button" className={`pl-write-prompt-open ui-control ${m.btn || ''}`} onClick={() => onOpen?.(entry)} aria-label={`Open ${title} in Write`} title={title}>
                    <Artwork value={entry.metadata?.artwork} />
                    <span className="pl-write-prompt-copy">
                      <span className={`block truncate text-xs font-semibold ${m.text || ''}`}>{title}</span>
                      {meta && <span className={`block truncate text-[10px] ${m.textMuted || ''}`}>{meta}</span>}
                    </span>
                  </button>
                  <button type="button" className="pl-write-prompt-action ui-control" onClick={() => onInsert?.(entryText(entry), entry)} disabled={!entryText(entry).trim()} aria-label={`Insert ${title} into prompt`} title="Insert into prompt at the cursor">
                    <Ic n="CopyPlus" size={12} />
                  </button>
                  <button type="button" className={`pl-write-prompt-action ui-control ${entry.favorite ? 'is-favorite' : ''}`} onClick={() => onToggleFavorite?.(entry)} aria-pressed={Boolean(entry.favorite)} aria-label={`${entry.favorite ? 'Unfavorite' : 'Favorite'} ${title}`} title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}>
                    <Ic n="Star" size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
