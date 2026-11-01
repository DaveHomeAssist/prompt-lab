import { safeArtwork } from './libraryPresentation.js';

// Local, deterministic artwork ideas from a prompt's own words. No network,
// no model calls and nothing is applied until the person picks a suggestion.
// Each theme pairs a bundled icon with one emoji so either style is offered.
const THEMES = [
  { id: 'code', icon: 'Braces', emoji: '💻', words: /\b(?:code|coding|coder|refactor|debug|bug|function|api|repo|script|typescript|javascript|python|sql|regex|css|html)\b/g },
  { id: 'test', icon: 'FlaskConical', emoji: '🧪', words: /\b(?:test|tests|testing|eval|evals|evaluate|experiment|verify|verification|qa|audit|benchmark)\b/g },
  { id: 'writing', icon: 'FileText', emoji: '✍️', words: /\b(?:write|writing|rewrite|blog|essay|copy|copywriting|draft|email|story|article|newsletter|edit|proofread)\b/g },
  { id: 'research', icon: 'Eye', emoji: '🔍', words: /\b(?:research|analy[sz]e|analysis|summari[sz]e|summary|investigate|review|compare|findings)\b/g },
  { id: 'voice', icon: 'Quote', emoji: '💬', words: /\b(?:quote|tone|voice|reply|respond|conversation|chat|dialogue|interview)\b/g },
  { id: 'creative', icon: 'Wand2', emoji: '🎨', words: /\b(?:image|art|artwork|design|creative|illustration|banner|logo|poster|brand|style)\b/g },
  { id: 'data', icon: 'LayoutGrid', emoji: '📊', words: /\b(?:table|tables|data|csv|json|schema|database|spreadsheet|chart|metrics)\b/g },
  { id: 'ship', icon: 'GitBranch', emoji: '🚀', words: /\b(?:git|branch|merge|release|deploy|launch|ship|version|changelog)\b/g },
  { id: 'automation', icon: 'Zap', emoji: '⚡', words: /\b(?:workflow|automate|automation|chain|pipeline|agent|agents|trigger|routine)\b/g },
  { id: 'time', icon: 'Clock', emoji: '⏰', words: /\b(?:schedule|daily|weekly|reminder|deadline|calendar|timeline|agenda)\b/g },
  { id: 'keys', icon: 'Keyboard', emoji: '⌨️', words: /\b(?:shortcut|shortcuts|keyboard|hotkey|stream deck|macro)\b/g },
  { id: 'share', icon: 'Share2', emoji: '📣', words: /\b(?:share|social|post|tweet|publish|announce|marketing)\b/g },
  { id: 'system', icon: 'Layers', emoji: '🧩', words: /\b(?:system|role|persona|instructions|framework|template)\b/g },
];

const sameArtwork = (left, right) => {
  const a = safeArtwork(left); const b = safeArtwork(right);
  return a.image === b.image && (a.emoji || '') === (b.emoji || '') && (a.emoji ? true : a.icon === b.icon);
};

function countMatches(text, pattern) {
  pattern.lastIndex = 0;
  return text ? (text.match(pattern) || []).length : 0;
}

/**
 * Suggest up to `limit` artwork choices for a prompt.
 * Title, tags and collection weigh three times more than the prompt body.
 * Returns [] when nothing in the prompt points to a theme.
 */
export function suggestArtwork({ title = '', text = '', tags = [], collection = '' } = {}, { limit = 4, current = null } = {}) {
  const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : '');
  const strong = [lower(title), ...(Array.isArray(tags) ? tags.map(lower) : []), lower(collection)].join(' \n ');
  const body = lower(text).slice(0, 4000);
  const ranked = THEMES
    .map((theme, order) => ({ theme, order, score: countMatches(strong, theme.words) * 3 + countMatches(body, theme.words) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  const choices = [];
  for (const { theme } of ranked) {
    choices.push({ icon: '', image: '', emoji: theme.emoji }, { icon: theme.icon, image: '' });
  }
  return choices.filter((choice) => !current || !sameArtwork(choice, current)).slice(0, Math.max(0, limit));
}

export const suggestionLabel = (choice) => choice.emoji || choice.icon;
