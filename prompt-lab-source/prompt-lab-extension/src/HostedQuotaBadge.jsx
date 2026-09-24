import Ic from './icons';
import useHostedQuota from './hooks/useHostedQuota.js';

function formatResetTime(resetAt) {
  const parsed = Date.parse(resetAt || '');
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Describe the hosted quota in one line. Exported for tests.
 * tone: 'danger' when a window is used up, 'warn' on the last request,
 * 'info' otherwise.
 */
export function describeHostedQuota(quota) {
  if (!quota) return null;
  const { access, demo, global } = quota;

  if (demo?.remaining === 0) {
    const reset = formatResetTime(demo.resetAt);
    return {
      tone: 'danger',
      text: `Hosted demo used up for today${reset ? ` · resets ${reset}` : ''}`,
      offerKey: true,
    };
  }
  if (global?.remaining === 0) {
    const reset = formatResetTime(global.resetAt);
    return {
      tone: 'danger',
      text: `Shared hosted budget used up${reset ? ` · resets ${reset}` : ''}`,
      offerKey: true,
    };
  }
  if (demo) {
    const reset = formatResetTime(demo.resetAt);
    const count = demo.limit ? `${demo.remaining} of ${demo.limit}` : `${demo.remaining}`;
    return {
      tone: demo.remaining === 1 ? 'warn' : 'info',
      text: `Hosted demo: ${count} left today${reset ? ` · resets ${reset}` : ''}`,
      offerKey: demo.remaining === 1,
    };
  }
  if (access === 'owner') {
    return { tone: 'info', text: 'Owner access · no daily demo cap', offerKey: false };
  }
  return null;
}

const TONE_CLASSES = {
  dark: {
    danger: 'border-red-500/35 bg-red-950/30 text-red-200',
    warn: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
  },
  light: {
    danger: 'border-red-300 bg-red-50 text-red-800',
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
  },
};

/**
 * Hosted web only: the caller's remaining daily hosted requests, from the
 * proxy's quota headers. Renders nothing until a hosted request has been made
 * or when a personal key is in use.
 */
export default function HostedQuotaBadge({ m, colorMode = 'dark', onOpenSettings, className = '' }) {
  const summary = describeHostedQuota(useHostedQuota());
  if (!summary) return null;

  const toneClass = TONE_CLASSES[colorMode === 'light' ? 'light' : 'dark'][summary.tone]
    || `${m.border} ${m.btn} ${m.textMuted}`;

  return (
    <div
      role="status"
      data-testid="hosted-quota"
      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-[11px] ${toneClass} ${className}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Ic n="Clock" size={11} className="shrink-0" />
        <span>{summary.text}</span>
      </span>
      {summary.offerKey && onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="shrink-0 text-[11px] font-semibold underline underline-offset-2"
        >
          Use your own key
        </button>
      )}
    </div>
  );
}
