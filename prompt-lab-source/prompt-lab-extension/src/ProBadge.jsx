// Product call 3: a "Pro" marker on navigation tabs and buttons that lead to a
// locked Pro feature. Callers render it only when the feature is locked for
// this user (billing.hasFeature(...) === false), so Pro accounts and builds
// without Pro gates (extension, desktop) never see it. The visible text and
// border carry the meaning (not colour alone), and screen readers hear
// "Pro feature" as part of the control's name.
export default function ProBadge({ className = '' }) {
  return (
    <span
      data-testid="pro-badge"
      title="Pro feature"
      // inline-flex (also set inline for environments without the Tailwind
      // stylesheet) makes accessible-name computation put a space between
      // the control label and "Pro feature".
      style={{ display: 'inline-flex' }}
      className={`pl-pro-badge ml-1 shrink-0 items-center rounded-full border border-current px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide ${className}`}
    >
      <span aria-hidden="true">Pro</span>
      {/* The leading space keeps the computed name "<label> Pro feature". */}
      <span className="sr-only">{' Pro feature'}</span>
    </span>
  );
}
