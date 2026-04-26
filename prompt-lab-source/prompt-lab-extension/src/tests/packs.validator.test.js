import { describe, expect, it } from 'vitest';
import {
  parseAndValidatePack,
  validatePack,
  resolveCategoryColor,
} from '../lib/packs/validator.js';
import {
  computePackChecksum,
  verifyPackChecksum,
} from '../lib/packs/checksum.js';
import {
  PACK_ERROR_CODES as E,
  PACK_WARNING_CODES as W,
  classifySemverDelta,
  compareCalver,
  compareSemver,
} from '../lib/packs/schema.js';

// ── Fixtures ────────────────────────────────────────────────────────────

function minimalValidPack(overrides = {}) {
  return {
    kind: 'prompt-pack',
    schema: 1,
    compat: 1,
    id: 'acme.code-review',
    version: '1.0.0',
    name: 'Code Review Pack',
    description: 'Senior-engineer review prompts.',
    author: { name: 'Acme Co' },
    categories: [{ id: 'review', name: 'Review' }],
    prompts: [
      {
        id: 'review.python.senior',
        name: 'Senior Python review',
        category: 'review',
        body: 'Review this {{code}}.',
        variables: [{ name: 'code', type: 'text', required: true }],
      },
    ],
    ...overrides,
  };
}

function richValidPack() {
  return {
    kind: 'prompt-pack',
    schema: 1,
    compat: 1,
    id: 'acme.full',
    version: '2.4.1',
    name: 'Full Coverage Pack',
    description: 'Exercises every optional field.',
    author: { name: 'Acme Co', url: 'https://acme.example', email: 'team@acme.example' },
    license: 'MIT',
    homepage: 'https://acme.example/',
    updateUrl: 'https://acme.example/latest.json',
    minAppVersion: '2026.04',
    categories: [
      { id: 'review', name: 'Review', color: 'violet', description: 'Code review prompts.' },
      { id: 'refactor', name: 'Refactor', color: 'teal' },
      { id: 'unknown-color', name: 'Unknown', color: 'fuchsia' }, // unknown color allowed (silent fallback at render time)
    ],
    prompts: [
      {
        id: 'review.go.senior',
        name: 'Senior Go review',
        category: 'review',
        tags: ['go', 'review'],
        body: 'Act as a senior Go engineer. Review {{code}} considering {{focus}}.',
        variables: [
          { name: 'code', type: 'text', required: true },
          { name: 'focus', type: 'select', required: false, options: ['perf', 'safety', 'idiom'] },
          { name: 'verbose', type: 'boolean', default: false },
          { name: 'depth', type: 'number', default: 2 },
        ],
        providers: { preferred: 'claude-sonnet-4', fallback: ['gpt-4-turbo'] },
        params: { temperature: 0.2, maxTokens: 2000 },
      },
      {
        id: 'refactor.rename',
        name: 'Rename suggestion',
        category: 'refactor',
        body: 'Suggest names for {{symbol}}.',
      },
    ],
  };
}

// ── Happy path ──────────────────────────────────────────────────────────

describe('validatePack — valid packs', () => {
  it('accepts a minimal valid pack with no warnings', () => {
    const result = validatePack(minimalValidPack());
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.manifest.id).toBe('acme.code-review');
  });

  it('accepts a rich valid pack covering every optional field', () => {
    const result = validatePack(richValidPack());
    expect(result.ok).toBe(true);
    // refactor.rename has no declared variables, body uses {{symbol}} → undeclared variable warning
    expect(result.warnings.some((w) => w.code === W.W_PACK_UNDECLARED_VARIABLE)).toBe(true);
  });
});

// ── Error codes — one test per labeled code ─────────────────────────────

describe('validatePack — error codes', () => {
  it('E_PACK_NOT_JSON: parseAndValidatePack rejects non-JSON', () => {
    const result = parseAndValidatePack('not { json');
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe(E.E_PACK_NOT_JSON);
  });

  it('E_PACK_KIND: rejects when top-level kind is wrong', () => {
    const result = validatePack({ ...minimalValidPack(), kind: 'something-else' });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe(E.E_PACK_KIND);
  });

  it('E_PACK_KIND: rejects non-object top level', () => {
    const result = validatePack(['array', 'not', 'object']);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe(E.E_PACK_KIND);
  });

  it('E_PACK_SCHEMA_TOO_NEW: rejects schema > clientMaxSchema', () => {
    const result = validatePack({ ...minimalValidPack(), schema: 99 });
    expect(result.errors.some((e) => e.code === E.E_PACK_SCHEMA_TOO_NEW)).toBe(true);
  });

  it('E_PACK_COMPAT_TOO_NEW: rejects compat > clientMaxCompat', () => {
    const result = validatePack({ ...minimalValidPack(), compat: 99 });
    expect(result.errors.some((e) => e.code === E.E_PACK_COMPAT_TOO_NEW)).toBe(true);
  });

  it('E_PACK_MIN_APP_VERSION: rejects when minAppVersion > clientAppVersion', () => {
    const result = validatePack({ ...minimalValidPack(), minAppVersion: '2099.12' });
    expect(result.errors.some((e) => e.code === E.E_PACK_MIN_APP_VERSION)).toBe(true);
  });

  it('E_PACK_MIN_APP_VERSION: rejects malformed calver', () => {
    const result = validatePack({ ...minimalValidPack(), minAppVersion: 'not-calver' });
    expect(result.errors.some((e) => e.code === E.E_PACK_MIN_APP_VERSION)).toBe(true);
  });

  it('E_PACK_MISSING_FIELD: rejects when required string is missing', () => {
    const pack = minimalValidPack();
    delete pack.name;
    const result = validatePack(pack);
    expect(result.errors.some((e) => e.code === E.E_PACK_MISSING_FIELD && e.path === '$.name')).toBe(true);
  });

  it('E_PACK_BAD_ID: rejects pack id with uppercase / disallowed chars', () => {
    const result = validatePack({ ...minimalValidPack(), id: 'Acme.Bad ID' });
    expect(result.errors.some((e) => e.code === E.E_PACK_BAD_ID)).toBe(true);
  });

  it('E_PACK_BAD_VERSION: rejects non-semver version', () => {
    const result = validatePack({ ...minimalValidPack(), version: '1.0' });
    expect(result.errors.some((e) => e.code === E.E_PACK_BAD_VERSION)).toBe(true);
  });

  it('E_PACK_NO_CATEGORIES: rejects empty categories array', () => {
    const result = validatePack({ ...minimalValidPack(), categories: [] });
    expect(result.errors.some((e) => e.code === E.E_PACK_NO_CATEGORIES)).toBe(true);
  });

  it('E_PACK_NO_PROMPTS: rejects empty prompts array', () => {
    const result = validatePack({ ...minimalValidPack(), prompts: [] });
    expect(result.errors.some((e) => e.code === E.E_PACK_NO_PROMPTS)).toBe(true);
  });

  it('E_PACK_BAD_CATEGORY_REF: rejects prompt referencing an undeclared category', () => {
    const pack = minimalValidPack();
    pack.prompts[0].category = 'no-such-category';
    const result = validatePack(pack);
    expect(result.errors.some((e) => e.code === E.E_PACK_BAD_CATEGORY_REF)).toBe(true);
  });

  it('E_PACK_BAD_VARIABLE: rejects variable with unknown type', () => {
    const pack = minimalValidPack();
    pack.prompts[0].variables = [{ name: 'x', type: 'image' }];
    const result = validatePack(pack);
    expect(result.errors.some((e) => e.code === E.E_PACK_BAD_VARIABLE)).toBe(true);
  });

  it('E_PACK_BAD_VARIABLE: rejects select variable without options', () => {
    const pack = minimalValidPack();
    pack.prompts[0].variables = [{ name: 'pick', type: 'select' }];
    const result = validatePack(pack);
    expect(result.errors.some((e) => e.code === E.E_PACK_BAD_VARIABLE && e.path.endsWith('.options'))).toBe(true);
  });

  it('collects multiple top-level errors before bailing', () => {
    const result = validatePack({
      kind: 'prompt-pack', schema: 1, compat: 1,
      // missing id, version, name, description, author, categories, prompts
    });
    expect(result.ok).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain(E.E_PACK_MISSING_FIELD); // id / version / name / description / author
    expect(codes).toContain(E.E_PACK_NO_CATEGORIES);
    expect(codes).toContain(E.E_PACK_NO_PROMPTS);
  });
});

// ── Warning codes ───────────────────────────────────────────────────────

describe('validatePack — warnings', () => {
  it('W_PACK_UNUSED_VARIABLE: declared variable not referenced in body', () => {
    const pack = minimalValidPack();
    pack.prompts[0].body = 'No vars at all.';
    pack.prompts[0].variables = [{ name: 'unused', type: 'text' }];
    const result = validatePack(pack);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === W.W_PACK_UNUSED_VARIABLE)).toBe(true);
  });

  it('W_PACK_UNDECLARED_VARIABLE: body references a token with no declaration', () => {
    const pack = minimalValidPack();
    pack.prompts[0].body = 'Use {{undeclared_var}} here.';
    pack.prompts[0].variables = [{ name: 'code', type: 'text' }];
    const result = validatePack(pack);
    expect(result.ok).toBe(true);
    expect(result.warnings.some(
      (w) => w.code === W.W_PACK_UNDECLARED_VARIABLE && w.message.includes('undeclared_var'),
    )).toBe(true);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

describe('schema helpers', () => {
  it('compareSemver orders correctly', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1);
    expect(compareSemver('2.0.0', '1.99.99')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('classifySemverDelta tags PATCH/MINOR/MAJOR', () => {
    expect(classifySemverDelta('1.2.3', '1.2.4')).toBe('PATCH');
    expect(classifySemverDelta('1.2.3', '1.3.0')).toBe('MINOR');
    expect(classifySemverDelta('1.2.3', '2.0.0')).toBe('MAJOR');
  });

  it('compareCalver orders YYYY.MM correctly', () => {
    expect(compareCalver('2026.04', '2026.05')).toBe(-1);
    expect(compareCalver('2025.12', '2026.01')).toBe(-1);
    expect(compareCalver('2026.04', '2026.04')).toBe(0);
  });

  it('resolveCategoryColor falls back to mono on unknown color', () => {
    expect(resolveCategoryColor('violet')).toBe('violet');
    expect(resolveCategoryColor('unknown')).toBe('mono');
    expect(resolveCategoryColor(undefined)).toBe('mono');
  });
});

// ── Checksum ────────────────────────────────────────────────────────────

describe('computePackChecksum / verifyPackChecksum', () => {
  it('produces a sha256-prefixed base64 string with stable key order', async () => {
    const a = { foo: 1, bar: 2 };
    const b = { bar: 2, foo: 1 };
    const checksumA = await computePackChecksum(a);
    const checksumB = await computePackChecksum(b);
    expect(checksumA).toBe(checksumB);
    expect(checksumA.startsWith('sha256-')).toBe(true);
  });

  it('omits the existing checksum field from the digest', async () => {
    const without = { ...minimalValidPack() };
    const withClaimed = { ...without, checksum: 'sha256-bogus' };
    const a = await computePackChecksum(without);
    const b = await computePackChecksum(withClaimed);
    expect(a).toBe(b);
  });

  it('verifyPackChecksum returns null verified when no checksum present', async () => {
    const result = await verifyPackChecksum(minimalValidPack());
    expect(result.verified).toBe(null);
    expect(result.warning).toBe(null);
  });

  it('verifyPackChecksum returns true on a self-computed checksum', async () => {
    const pack = minimalValidPack();
    const checksum = await computePackChecksum(pack);
    const result = await verifyPackChecksum({ ...pack, checksum });
    expect(result.verified).toBe(true);
    expect(result.warning).toBe(null);
  });

  it('verifyPackChecksum returns a W_PACK_CHECKSUM warning on mismatch', async () => {
    const result = await verifyPackChecksum({
      ...minimalValidPack(),
      checksum: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    expect(result.verified).toBe(false);
    expect(result.warning?.code).toBe(W.W_PACK_CHECKSUM);
  });

  it('verifyPackChecksum warns on a malformed prefix', async () => {
    const result = await verifyPackChecksum({ ...minimalValidPack(), checksum: 'md5-xxx' });
    expect(result.verified).toBe(false);
    expect(result.warning?.code).toBe(W.W_PACK_CHECKSUM);
  });
});
