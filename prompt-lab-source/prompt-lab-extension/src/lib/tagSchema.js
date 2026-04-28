const CANONICAL_TAG_LABELS = Object.freeze([
  'Writing',
  'Code',
  'Research',
  'Analysis',
  'Creative',
  'System',
  'Role-play',
  'Other',
]);

const CANONICAL_TAG_LOOKUP = Object.freeze(
  Object.fromEntries(CANONICAL_TAG_LABELS.map((label) => [label.toLowerCase(), label])),
);

const TAG_ALIASES = Object.freeze({
  roleplay: 'Role-play',
  'role play': 'Role-play',
  'role-playing': 'Role-play',
  coder: 'Code',
  coding: 'Code',
  development: 'Code',
  dev: 'Code',
  writing: 'Writing',
  authoring: 'Writing',
  analysis: 'Analysis',
  analytical: 'Analysis',
  research: 'Research',
  researching: 'Research',
  creativity: 'Creative',
  creative: 'Creative',
  systems: 'System',
  system: 'System',
  misc: 'Other',
  miscellaneous: 'Other',
});

function normalizeTagValue(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const lowered = trimmed.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(TAG_ALIASES, lowered)) return TAG_ALIASES[lowered];
  return CANONICAL_TAG_LOOKUP[lowered] || trimmed;
}

export function normalizeTagList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map(normalizeTagValue)
    .filter((tag) => {
      if (!tag) return false;
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export { CANONICAL_TAG_LABELS };
