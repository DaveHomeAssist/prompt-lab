import Ic from './icons';
import { useThemeTokens } from './theme/ThemeProvider.jsx';

export default function TagChip({ tag, onRemove, onClick, selected }) {
  const { getTagChipClass } = useThemeTokens();
  const className = getTagChipClass({ tag, selected: Boolean(selected), clickable: Boolean(onClick) });
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={Boolean(selected)} className={className}>
        {tag}
      </button>
    );
  }
  return (
    <span className={className}>
      {tag}
      {onRemove && (
        <button type="button" className="pl-tag-remove" aria-label={`Remove ${tag}`} onClick={() => onRemove(tag)}>
          <Ic n="X" size={10} />
        </button>
      )}
    </span>
  );
}
