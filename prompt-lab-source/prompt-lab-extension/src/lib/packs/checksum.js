// Prompt Packs v1 — checksum verification.
//
// Spec §2.2: `checksum` is `sha256-<base64>` of the document with the
// `checksum` field itself omitted. Verification is **warn-only** — a
// mismatch surfaces a W_PACK_CHECKSUM warning in the install dialog but
// does not block import. Authors who don't ship a checksum are uncovered;
// the warning fires only when the field is present and disagrees.

import { PACK_WARNING_CODES } from './schema.js';

const CHECKSUM_PREFIX = 'sha256-';

// Compute the base64-encoded SHA-256 of the canonical-JSON form of the
// manifest (with `checksum` omitted). Returns the prefixed string ready to
// compare to `manifest.checksum`.
//
// Uses Web Crypto's `subtle.digest`, available in:
//   - Web shell (browser)
//   - Desktop shell (Electron renderer)
//   - Extension shell (MV3 service worker + content scripts)
//   - Node ≥ 16 test runner (via globalThis.crypto)
//
// Throws if `crypto.subtle` is unavailable. Callers should catch and treat
// as "no checksum verification possible" (skip silently).
export async function computePackChecksum(manifest) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('crypto.subtle unavailable — cannot compute pack checksum.');
  }
  const { checksum: _omit, ...rest } = manifest || {};
  const canonical = canonicalStringify(rest);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await subtle.digest('SHA-256', bytes);
  return CHECKSUM_PREFIX + base64FromBuffer(digest);
}

// Verify a manifest's `checksum` field against a freshly computed digest.
// Returns:
//   { verified: true,  warning: null }              — match
//   { verified: false, warning: { code, ... } }     — mismatch (warn-only)
//   { verified: null,  warning: null }              — no checksum field, skip
export async function verifyPackChecksum(manifest) {
  const claimed = manifest?.checksum;
  if (typeof claimed !== 'string' || !claimed.trim()) {
    return { verified: null, warning: null };
  }
  if (!claimed.startsWith(CHECKSUM_PREFIX)) {
    return {
      verified: false,
      warning: {
        code: PACK_WARNING_CODES.W_PACK_CHECKSUM,
        path: '$.checksum',
        message: `Checksum must be prefixed with "${CHECKSUM_PREFIX}". Treating as mismatch.`,
      },
    };
  }
  let computed;
  try {
    computed = await computePackChecksum(manifest);
  } catch (err) {
    return {
      verified: null,
      warning: null,
      // No warning emitted; absence of crypto.subtle is environmental and
      // not the author's fault. Importer can decide whether to surface this.
      _internalError: err.message,
    };
  }
  if (computed === claimed) {
    return { verified: true, warning: null };
  }
  return {
    verified: false,
    warning: {
      code: PACK_WARNING_CODES.W_PACK_CHECKSUM,
      path: '$.checksum',
      message: 'Checksum mismatch. Pack contents may have been altered after signing.',
    },
  };
}

// ── Internal helpers ────────────────────────────────────────────────────

// Stable, recursive JSON.stringify with sorted object keys. Required so
// the digest is deterministic regardless of key order in the source file.
// Arrays preserve order (semantically meaningful).
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k]));
  return '{' + parts.join(',') + '}';
}

function base64FromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa is available in browsers and Node ≥ 16.
  return globalThis.btoa(binary);
}
