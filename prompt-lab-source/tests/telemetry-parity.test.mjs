// AN-03: every literal telemetry call site must only send fields (and literal
// enum values) that its schema accepts. sanitizeTelemetryEventContext drops
// anything else silently, which is how tabBlocked and a `via` value were lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TELEMETRY_EVENT_SCHEMAS } from '../shared/telemetrySchema.js';

const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompt-lab-extension', 'src');
const CALL = /\b(?:trackTelemetry|track)\??\.?\(\s*'([a-z_]+\.[a-z_]+)'\s*(?:,\s*\{)?/g;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return ['tests', '__tests__', 'node_modules'].includes(name) ? [] : sourceFiles(full);
    }
    return /\.(jsx?|mjs)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

function objectBody(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, index);
    }
  }
  return '';
}

function topLevelEntries(body) {
  const entries = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if ('{[('.includes(char)) depth += 1;
    if ('}])'.includes(char)) depth -= 1;
    if (char === ',' && depth === 0) {
      entries.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  entries.push(current);
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

function collectCallSites() {
  const sites = [];
  for (const file of sourceFiles(sourceDir)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(CALL)) {
      const [whole, event] = match;
      const fields = [];
      if (whole.trimEnd().endsWith('{')) {
        const body = objectBody(text, match.index + whole.lastIndexOf('{'));
        for (const entry of topLevelEntries(body)) {
          const keyMatch = /^([A-Za-z_$][\w$]*)\s*(?::\s*([\s\S]*))?$/.exec(entry);
          if (!keyMatch) continue;
          const literal = /^'([^']*)'$/.exec(String(keyMatch[2] || '').trim());
          fields.push({ name: keyMatch[1], literal: literal ? literal[1] : null });
        }
      }
      sites.push({ file: path.relative(sourceDir, file), event, fields });
    }
  }
  return sites;
}

test('telemetry call sites were found', () => {
  const sites = collectCallSites();
  assert.ok(sites.length >= 20, `expected the app's call sites, found ${sites.length}`);
  assert.ok(sites.some((site) => site.event === 'billing.checkout_returned'));
});

test('every telemetry call site uses a defined event and schema fields', () => {
  const problems = [];
  for (const site of collectCallSites()) {
    const schema = TELEMETRY_EVENT_SCHEMAS[site.event];
    if (!schema) {
      problems.push(`${site.file}: ${site.event} has no schema`);
      continue;
    }
    for (const field of site.fields) {
      const descriptor = schema.fields[field.name];
      if (!descriptor) {
        problems.push(`${site.file}: ${site.event}.${field.name} is not in the schema`);
      } else if (field.literal !== null && descriptor.type === 'enum' && !descriptor.values.has(field.literal)) {
        problems.push(`${site.file}: ${site.event}.${field.name}='${field.literal}' is not an allowed value`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
