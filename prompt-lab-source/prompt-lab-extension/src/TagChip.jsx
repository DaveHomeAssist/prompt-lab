import Ic from './icons';
import { TAG_COLORS } from './constants';

export default function TagChip({ tag, onRemove, onClick, selected }) {
  const color = TAG_COLORS[tag] || 'bg-gray-500';
  return (
    <span onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full text-white font-medium transition-all px-2 py-0.5 text-xs ${color} ${onClick ? 'cursor-pointer' : ''} ${selected ? 'ring-2 ring-violet-300 ring-offset-1 opacity-100' : 'opacity-70 hover:opacity-90'}`}>
      {tag}
      {onRemove && <Ic n="X" size={10} className="cursor-pointer" onClick={e => { e.stopPropagation(); onRemove(tag); }} />}
    </span>
  );
}
