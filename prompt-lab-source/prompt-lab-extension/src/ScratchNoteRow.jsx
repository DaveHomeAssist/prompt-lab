import Ic from './icons';

export const SCRATCH_COLOR_SWATCHES = {
  orange: '#c2410c',
  violet: '#8b5cf6',
  blue: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  rose: '#f43f5e',
  slate: '#64748b',
};

export const SCRATCH_LIST_DENSITIES = ['compact', 'detailed'];

export function formatRelativeTime(value) {
  if (!value) return '';
  const timestamp = typeof value === 'number' ? value : new Date(value).getTime();
  const diffMs = Date.now() - timestamp;
  if (Number.isNaN(diffMs) || diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// One note in a Scratch list. Compact rows are a single line: color dot,
// title, pin and, when there is room, a grey relative date. Detailed rows add
// the content preview and status underneath.
export default function ScratchNoteRow({ m = {}, pad, active = false, isDark = true, density = 'compact', showDate = true, onSelect }) {
  const titleClass = active ? (isDark ? 'text-orange-200' : 'text-orange-800') : m.text || '';
  const compact = density !== 'detailed';
  return (
    <button
      type="button"
      onClick={() => onSelect(pad.id)}
      aria-current={active ? 'page' : undefined}
      title={compact ? `${pad.name} · ${formatRelativeTime(pad.updatedAt)}` : undefined}
      data-density={compact ? 'compact' : 'detailed'}
      className={`ui-control w-full border-r-2 px-3 ${compact ? 'py-1.5' : 'py-2.5'} text-left transition-colors ${active ? 'border-orange-600 bg-orange-600/15' : `border-transparent ${m.btn || ''}`}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: SCRATCH_COLOR_SWATCHES[pad.color] || SCRATCH_COLOR_SWATCHES.orange }} />
        <span className={`min-w-0 truncate text-xs font-semibold ${titleClass}`}>{pad.name}</span>
        {pad.pinned && <Ic n="Pin" size={10} className={compact ? 'shrink-0' : 'ml-auto shrink-0'} />}
        {compact && showDate && <span className={`ml-auto shrink-0 whitespace-nowrap text-[10px] ${m.textMuted || ''}`}>{formatRelativeTime(pad.updatedAt)}</span>}
      </span>
      {!compact && <>
        <span className={`mt-1 block truncate text-[10px] ${m.textMuted || ''}`}>{pad.content.trim().replace(/\s+/g, ' ').slice(0, 72) || 'Empty note'}</span>
        <span className={`mt-1 block text-[10px] ${m.textMuted || ''}`}>{formatRelativeTime(pad.updatedAt)} · {pad.status}</span>
      </>}
    </button>
  );
}
