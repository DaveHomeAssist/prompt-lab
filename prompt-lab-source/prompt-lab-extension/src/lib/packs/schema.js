// Prompt Packs v1 — schema constants and primitive type guards.
//
// The wire format is documented in
// `prompt-lab-source/Prompt Packs Implementation Pack.md` (or its archived
// copy under `docs/`). This file is the authoritative client-side reflection.
//
// Runtime gate: schema/validator are pure functions and safe to import
// regardless of the flag. The importer that wires them into the UI must
// check `PROMPT_PACKS_V1_ENABLED` before exposing the import surface.

export const PACK_KIND = 'prompt-pack';

// Bumped only when the wire format changes shape. See spec §4.2.
export const CLIENT_MAX_SCHEMA = 1;

// Hard compatibility number. Bumped only for additions the client cannot
// silently ignore (e.g. a new `image` variable type whose absence in older
// clients would corrupt input). See spec §4.3.
export const CLIENT_MAX_COMPAT = 1;

// Calver `YYYY.MM` of the current PromptLab build. Used to evaluate
// `manifest.minAppVersion`. Sourced from APP_VERSION when wiring; this
// constant is the validator's reference for tests.
export const CLIENT_APP_VERSION = '2026.04';

// Default category palette colors, mapped to library accent tokens.
// Unknown values fall back to `mono`. See spec §2.5.
export const PACK_CATEGORY_COLORS = Object.freeze(['violet', 'teal', 'amber', 'mono']);

// Variable types accepted by v1.
export const PACK_VARIABLE_TYPES = Object.freeze(['text', 'number', 'select', 'boolean']);

// Pack-id and prompt-id regexes. Reverse-DNS lowercase + dashes/dots/digits
// for pack ids; same plus underscores for prompt ids. See spec §2.2 / §2.3.
export const PACK_ID_REGEX = /^[a-z0-9][a-z0-9.\-]*$/;
export const PROMPT_ID_REGEX = /^[a-z0-9][a-z0-9.\-_]*$/;

// SemVer (MAJOR.MINOR.PATCH). Pre-release / build metadata not allowed in v1.
export const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Calver YYYY.MM (years 2000-2099, months 01-12).
export const CALVER_REGEX = /^(20\d{2})\.(0[1-9]|1[0-2])$/;

// Variable token in body text: `{{name}}` with optional surrounding spaces.
export const VAR_TOKEN_REGEX = /\{\{\s*([\w-]+)\s*\}\}/g;

// Maximum string lengths from spec §2.2.
export const MAX_NAME_LEN = 80;
export const MAX_DESCRIPTION_LEN = 500;
export const MAX_PROMPT_NAME_LEN = 120;
export const MAX_CATEGORY_NAME_LEN = 40;
export const MAX_CATEGORY_DESCRIPTION_LEN = 200;

// Error codes from spec §6. `E_*` blocks import; `W_*` warns only.
export const PACK_ERROR_CODES = Object.freeze({
  E_PACK_NOT_JSON: 'E_PACK_NOT_JSON',
  E_PACK_KIND: 'E_PACK_KIND',
  E_PACK_SCHEMA_TOO_NEW: 'E_PACK_SCHEMA_TOO_NEW',
  E_PACK_COMPAT_TOO_NEW: 'E_PACK_COMPAT_TOO_NEW',
  E_PACK_MIN_APP_VERSION: 'E_PACK_MIN_APP_VERSION',
  E_PACK_MISSING_FIELD: 'E_PACK_MISSING_FIELD',
  E_PACK_BAD_ID: 'E_PACK_BAD_ID',
  E_PACK_BAD_VERSION: 'E_PACK_BAD_VERSION',
  E_PACK_NO_CATEGORIES: 'E_PACK_NO_CATEGORIES',
  E_PACK_NO_PROMPTS: 'E_PACK_NO_PROMPTS',
  E_PACK_BAD_CATEGORY_REF: 'E_PACK_BAD_CATEGORY_REF',
  E_PACK_BAD_VARIABLE: 'E_PACK_BAD_VARIABLE',
});

export const PACK_WARNING_CODES = Object.freeze({
  W_PACK_CHECKSUM: 'W_PACK_CHECKSUM',
  W_PACK_UNUSED_VARIABLE: 'W_PACK_UNUSED_VARIABLE',
  W_PACK_UNDECLARED_VARIABLE: 'W_PACK_UNDECLARED_VARIABLE',
});

// Runtime feature flag. Default OFF in production. Toggle to true to expose
// the importer + lifecycle UI. Currently only consumed by the importer site
// once it lands; schema/validator/checksum are flag-agnostic.
export const PROMPT_PACKS_V1_ENABLED = false;

// Fast calver compare: returns -1/0/1 for a vs b. Both must match CALVER_REGEX.
export function compareCalver(a, b) {
  const [ay, am] = a.split('.').map(Number);
  const [by, bm] = b.split('.').map(Number);
  if (ay !== by) return ay < by ? -1 : 1;
  if (am !== bm) return am < bm ? -1 : 1;
  return 0;
}

// Fast semver compare: returns -1/0/1 for a vs b. Both must match SEMVER_REGEX.
export function compareSemver(a, b) {
  const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
  const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

// Categorize a semver delta as PATCH / MINOR / MAJOR. Used by the update
// flow to decide between normal and destructive styling. See spec §4.1.
export function classifySemverDelta(from, to) {
  const [fMaj, fMin] = from.split('.').map(Number);
  const [tMaj, tMin] = to.split('.').map(Number);
  if (tMaj > fMaj) return 'MAJOR';
  if (tMin > fMin) return 'MINOR';
  return 'PATCH';
}
