// Prompt Packs v1 — strict validator with labeled error codes.
//
// Returns:
//   { ok: true,  manifest, warnings: Warning[] }   on success (warnings allowed)
//   { ok: false, errors: ValidationError[],
//                warnings: Warning[] }              on failure
//
// One error stops the validator from continuing into deeper checks for that
// node, so callers don't have to chase a cascade — but the validator
// collects all top-level structural errors before bailing so a malformed
// pack surfaces multiple labeled issues at once.

import {
  CLIENT_APP_VERSION,
  CLIENT_MAX_COMPAT,
  CLIENT_MAX_SCHEMA,
  CALVER_REGEX,
  MAX_CATEGORY_DESCRIPTION_LEN,
  MAX_CATEGORY_NAME_LEN,
  MAX_DESCRIPTION_LEN,
  MAX_NAME_LEN,
  MAX_PROMPT_NAME_LEN,
  PACK_CATEGORY_COLORS,
  PACK_ERROR_CODES,
  PACK_ID_REGEX,
  PACK_KIND,
  PACK_VARIABLE_TYPES,
  PACK_WARNING_CODES,
  PROMPT_ID_REGEX,
  SEMVER_REGEX,
  VAR_TOKEN_REGEX,
  compareCalver,
} from './schema.js';

const E = PACK_ERROR_CODES;
const W = PACK_WARNING_CODES;

// ── Public API ──────────────────────────────────────────────────────────

// Parse + validate a JSON string. Convenience wrapper for the file-import path.
export function parseAndValidatePack(jsonText, options) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      errors: [{ code: E.E_PACK_NOT_JSON, path: '$', message: err.message }],
      warnings: [],
    };
  }
  return validatePack(parsed, options);
}

// Validate an already-parsed object.
//
// Options:
//   clientAppVersion:  override CLIENT_APP_VERSION for tests (default OK)
//   clientMaxSchema:   override CLIENT_MAX_SCHEMA for tests
//   clientMaxCompat:   override CLIENT_MAX_COMPAT for tests
export function validatePack(manifest, options = {}) {
  const errors = [];
  const warnings = [];
  const opts = {
    clientAppVersion: options.clientAppVersion || CLIENT_APP_VERSION,
    clientMaxSchema: options.clientMaxSchema ?? CLIENT_MAX_SCHEMA,
    clientMaxCompat: options.clientMaxCompat ?? CLIENT_MAX_COMPAT,
  };

  if (!isPlainObject(manifest)) {
    errors.push({ code: E.E_PACK_KIND, path: '$', message: 'Top level must be a JSON object.' });
    return { ok: false, errors, warnings };
  }

  // ── Discriminator ──
  if (manifest.kind !== PACK_KIND) {
    errors.push({
      code: E.E_PACK_KIND,
      path: '$.kind',
      message: `Expected kind "${PACK_KIND}", got ${JSON.stringify(manifest.kind)}.`,
    });
    return { ok: false, errors, warnings };
  }

  // ── Schema gate ──
  if (typeof manifest.schema !== 'number' || !Number.isInteger(manifest.schema) || manifest.schema < 1) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path: '$.schema', message: 'schema must be a positive integer.' });
  } else if (manifest.schema > opts.clientMaxSchema) {
    errors.push({
      code: E.E_PACK_SCHEMA_TOO_NEW,
      path: '$.schema',
      message: `schema=${manifest.schema} > client max ${opts.clientMaxSchema}. Update PromptLab to import this pack.`,
    });
  }

  // ── Compat gate ──
  if (typeof manifest.compat !== 'number' || !Number.isInteger(manifest.compat) || manifest.compat < 1) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path: '$.compat', message: 'compat must be a positive integer.' });
  } else if (manifest.compat > opts.clientMaxCompat) {
    errors.push({
      code: E.E_PACK_COMPAT_TOO_NEW,
      path: '$.compat',
      message: `compat=${manifest.compat} > client max ${opts.clientMaxCompat}. Update PromptLab to import this pack.`,
    });
  }

  // ── Required string fields ──
  requireNonEmptyString(manifest, 'id', errors);
  requireNonEmptyString(manifest, 'version', errors);
  requireNonEmptyString(manifest, 'name', errors, MAX_NAME_LEN);
  requireNonEmptyString(manifest, 'description', errors, MAX_DESCRIPTION_LEN);

  // ── id regex ──
  if (typeof manifest.id === 'string' && !PACK_ID_REGEX.test(manifest.id)) {
    errors.push({
      code: E.E_PACK_BAD_ID,
      path: '$.id',
      message: 'id must be lowercase reverse-DNS: [a-z0-9][a-z0-9.-]*',
    });
  }

  // ── version semver ──
  if (typeof manifest.version === 'string' && !SEMVER_REGEX.test(manifest.version)) {
    errors.push({
      code: E.E_PACK_BAD_VERSION,
      path: '$.version',
      message: 'version must be MAJOR.MINOR.PATCH semver (no pre-release / build).',
    });
  }

  // ── author ──
  if (!isPlainObject(manifest.author)) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path: '$.author', message: 'author must be an object with a name.' });
  } else if (typeof manifest.author.name !== 'string' || !manifest.author.name.trim()) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path: '$.author.name', message: 'author.name is required.' });
  }

  // ── minAppVersion (optional) ──
  if (manifest.minAppVersion !== undefined) {
    if (typeof manifest.minAppVersion !== 'string' || !CALVER_REGEX.test(manifest.minAppVersion)) {
      errors.push({
        code: E.E_PACK_MIN_APP_VERSION,
        path: '$.minAppVersion',
        message: 'minAppVersion must be calver YYYY.MM.',
      });
    } else if (compareCalver(manifest.minAppVersion, opts.clientAppVersion) > 0) {
      errors.push({
        code: E.E_PACK_MIN_APP_VERSION,
        path: '$.minAppVersion',
        message: `Pack requires PromptLab >= ${manifest.minAppVersion}; this client is ${opts.clientAppVersion}.`,
      });
    }
  }

  // ── categories ──
  if (!Array.isArray(manifest.categories) || manifest.categories.length === 0) {
    errors.push({
      code: E.E_PACK_NO_CATEGORIES,
      path: '$.categories',
      message: 'A pack must declare at least one category.',
    });
  } else {
    manifest.categories.forEach((cat, i) => validateCategory(cat, i, errors));
  }

  // ── prompts ──
  if (!Array.isArray(manifest.prompts) || manifest.prompts.length === 0) {
    errors.push({
      code: E.E_PACK_NO_PROMPTS,
      path: '$.prompts',
      message: 'A pack must declare at least one prompt.',
    });
  } else {
    const knownCategoryIds = new Set(
      Array.isArray(manifest.categories)
        ? manifest.categories.map((c) => c?.id).filter(Boolean)
        : [],
    );
    manifest.prompts.forEach((p, i) =>
      validatePrompt(p, i, knownCategoryIds, errors, warnings),
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, manifest, warnings };
}

// ── Internal helpers ────────────────────────────────────────────────────

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function requireNonEmptyString(obj, key, errors, maxLen) {
  const value = obj?.[key];
  if (typeof value !== 'string' || !value.trim()) {
    errors.push({
      code: E.E_PACK_MISSING_FIELD,
      path: `$.${key}`,
      message: `${key} is required and must be a non-empty string.`,
    });
    return;
  }
  if (maxLen != null && value.length > maxLen) {
    errors.push({
      code: E.E_PACK_MISSING_FIELD,
      path: `$.${key}`,
      message: `${key} exceeds max length ${maxLen} (got ${value.length}).`,
    });
  }
}

function validateCategory(cat, index, errors) {
  const path = `$.categories[${index}]`;
  if (!isPlainObject(cat)) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path, message: 'category must be an object.' });
    return;
  }
  if (typeof cat.id !== 'string' || !cat.id.trim()) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path: `${path}.id`, message: 'category.id is required.' });
  } else if (!PACK_ID_REGEX.test(cat.id)) {
    errors.push({
      code: E.E_PACK_BAD_ID,
      path: `${path}.id`,
      message: 'category.id must match [a-z0-9][a-z0-9.-]*.',
    });
  }
  if (typeof cat.name !== 'string' || !cat.name.trim()) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path: `${path}.name`, message: 'category.name is required.' });
  } else if (cat.name.length > MAX_CATEGORY_NAME_LEN) {
    errors.push({
      code: E.E_PACK_MISSING_FIELD,
      path: `${path}.name`,
      message: `category.name exceeds ${MAX_CATEGORY_NAME_LEN} chars.`,
    });
  }
  if (cat.description !== undefined) {
    if (typeof cat.description !== 'string') {
      errors.push({
        code: E.E_PACK_MISSING_FIELD,
        path: `${path}.description`,
        message: 'category.description must be a string when present.',
      });
    } else if (cat.description.length > MAX_CATEGORY_DESCRIPTION_LEN) {
      errors.push({
        code: E.E_PACK_MISSING_FIELD,
        path: `${path}.description`,
        message: `category.description exceeds ${MAX_CATEGORY_DESCRIPTION_LEN} chars.`,
      });
    }
  }
  // color is optional; unknown values are silently coerced to `mono` at
  // render time, so no validation error here.
  if (cat.color !== undefined && typeof cat.color !== 'string') {
    errors.push({
      code: E.E_PACK_MISSING_FIELD,
      path: `${path}.color`,
      message: 'category.color must be a string when present.',
    });
  }
}

function validatePrompt(prompt, index, knownCategoryIds, errors, warnings) {
  const path = `$.prompts[${index}]`;
  if (!isPlainObject(prompt)) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path, message: 'prompt must be an object.' });
    return;
  }

  // id
  if (typeof prompt.id !== 'string' || !prompt.id.trim()) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path: `${path}.id`, message: 'prompt.id is required.' });
  } else if (!PROMPT_ID_REGEX.test(prompt.id)) {
    errors.push({
      code: E.E_PACK_BAD_ID,
      path: `${path}.id`,
      message: 'prompt.id must match [a-z0-9][a-z0-9.\\-_]*.',
    });
  }

  // name
  if (typeof prompt.name !== 'string' || !prompt.name.trim()) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path: `${path}.name`, message: 'prompt.name is required.' });
  } else if (prompt.name.length > MAX_PROMPT_NAME_LEN) {
    errors.push({
      code: E.E_PACK_MISSING_FIELD,
      path: `${path}.name`,
      message: `prompt.name exceeds ${MAX_PROMPT_NAME_LEN} chars.`,
    });
  }

  // category — must resolve to a declared category id
  if (typeof prompt.category !== 'string' || !prompt.category.trim()) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path: `${path}.category`, message: 'prompt.category is required.' });
  } else if (!knownCategoryIds.has(prompt.category)) {
    errors.push({
      code: E.E_PACK_BAD_CATEGORY_REF,
      path: `${path}.category`,
      message: `prompt.category "${prompt.category}" does not match any declared category.`,
    });
  }

  // body (required, must be a string)
  if (typeof prompt.body !== 'string' || !prompt.body.trim()) {
    errors.push({ code: E.E_PACK_MISSING_FIELD, path: `${path}.body`, message: 'prompt.body is required.' });
  }

  // tags (optional)
  if (prompt.tags !== undefined) {
    if (!Array.isArray(prompt.tags) || prompt.tags.some((t) => typeof t !== 'string')) {
      errors.push({
        code: E.E_PACK_MISSING_FIELD,
        path: `${path}.tags`,
        message: 'prompt.tags must be an array of strings when present.',
      });
    }
  }

  // variables (optional)
  const declaredVars = [];
  if (prompt.variables !== undefined) {
    if (!Array.isArray(prompt.variables)) {
      errors.push({
        code: E.E_PACK_BAD_VARIABLE,
        path: `${path}.variables`,
        message: 'prompt.variables must be an array when present.',
      });
    } else {
      prompt.variables.forEach((v, vi) => {
        const vpath = `${path}.variables[${vi}]`;
        if (!isPlainObject(v)) {
          errors.push({ code: E.E_PACK_BAD_VARIABLE, path: vpath, message: 'variable must be an object.' });
          return;
        }
        if (typeof v.name !== 'string' || !v.name.trim()) {
          errors.push({ code: E.E_PACK_BAD_VARIABLE, path: `${vpath}.name`, message: 'variable.name is required.' });
        } else {
          declaredVars.push(v.name);
        }
        if (!PACK_VARIABLE_TYPES.includes(v.type)) {
          errors.push({
            code: E.E_PACK_BAD_VARIABLE,
            path: `${vpath}.type`,
            message: `variable.type must be one of ${PACK_VARIABLE_TYPES.join(' | ')}.`,
          });
        }
        if (v.type === 'select') {
          if (!Array.isArray(v.options) || v.options.length === 0
              || v.options.some((opt) => typeof opt !== 'string')) {
            errors.push({
              code: E.E_PACK_BAD_VARIABLE,
              path: `${vpath}.options`,
              message: 'variable.options is required for select type and must be a non-empty string[].',
            });
          }
        }
      });
    }
  }

  // ── Warnings: variable-token vs. declaration symmetry ──
  if (typeof prompt.body === 'string') {
    const usedVars = new Set();
    let match;
    VAR_TOKEN_REGEX.lastIndex = 0;
    while ((match = VAR_TOKEN_REGEX.exec(prompt.body)) !== null) {
      usedVars.add(match[1]);
    }
    for (const declared of declaredVars) {
      if (!usedVars.has(declared)) {
        warnings.push({
          code: W.W_PACK_UNUSED_VARIABLE,
          path: `${path}.variables`,
          message: `Variable "${declared}" is declared but no {{${declared}}} appears in body.`,
        });
      }
    }
    for (const used of usedVars) {
      if (!declaredVars.includes(used)) {
        warnings.push({
          code: W.W_PACK_UNDECLARED_VARIABLE,
          path: `${path}.body`,
          message: `Body uses {{${used}}} but no matching variable is declared.`,
        });
      }
    }
  }

  // category color enum sanity (cross-cutting, but pack-level)
  // No-op here; validateCategory handles per-category.

  // providers / params / examples are advisory in v1; no schema enforcement.
  // Future: validate provider id allowlist + param ranges.
}

// ── Color helper used at render time ────────────────────────────────────

export function resolveCategoryColor(rawColor) {
  if (typeof rawColor === 'string' && PACK_CATEGORY_COLORS.includes(rawColor)) {
    return rawColor;
  }
  return 'mono';
}
