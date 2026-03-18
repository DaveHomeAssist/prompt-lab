export default function DraftBadge({ tone = 'default', children }) {
  const tones = {
    default: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    danger: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tones[tone] || tones.default}`}>
      {children}
    </span>
  );
}
