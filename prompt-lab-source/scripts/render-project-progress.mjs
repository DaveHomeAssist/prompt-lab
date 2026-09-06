import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../../project-progress/', import.meta.url);
const data = JSON.parse(await readFile(new URL('status.json', root), 'utf8'));
assert.equal(data.schemaVersion, 1);
assert.ok(Number.isFinite(Date.parse(data.snapshotAt)), 'Snapshot timestamp is required');
assert.match(data.mainSha, /^[a-f0-9]{40}$/);
assert.equal(typeof data.source.complete, 'boolean');
const validUrl = value => {
  const url = new URL(value);
  assert.ok(!url.username && !url.password, 'Evidence URLs must not contain credentials');
  assert.ok(url.protocol === 'https:' && ['app.notion.com', 'github.com'].includes(url.hostname), `Unexpected evidence URL: ${url.hostname}`);
};
validUrl(data.source.databaseUrl);
validUrl(data.source.runUrl);
assert.ok(Array.isArray(data.issues) && data.issues.length > 0);
assert.equal(new Set(data.issues.map(row => row.id)).size, data.issues.length, 'Duplicate issue IDs');
for (const row of data.issues) {
  assert.match(row.id, /^[a-f0-9]{32}$/);
  for (const key of ['title', 'area', 'type', 'verification']) assert.ok(typeof row[key] === 'string' && row[key].trim(), `Missing ${key}`);
  assert.ok(['Done', 'In progress', 'Not started'].includes(row.status), 'Refresh status mapping from the live schema');
  assert.ok(['High', 'Medium', 'Low'].includes(row.severity));
  assert.equal(typeof row.inPlan, 'boolean');
  validUrl(row.url);
}
assert.equal(data.issues.filter(row => row.inPlan).length, 14, 'Selected implementation plan must contain exactly 14 issues');
for (const item of data.evidence) {
  assert.ok(['Verified', 'Running', 'Open', 'Unknown', 'Failed'].includes(item.state));
  assert.ok(item.label && item.detail);
  validUrl(item.url);
}
const template = await readFile(new URL('dashboard.template.html', root), 'utf8');
assert.equal(template.split('<!-- SNAPSHOT -->').length, 2, 'Template must contain one snapshot marker');
const json = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const html = template.replace('<!-- SNAPSHOT -->', `<script id="snapshot" type="application/json">${json}</script>`);
const output = new URL('index.html', root);
if (process.argv.includes('--check')) {
  assert.equal(await readFile(output, 'utf8'), html, 'Dashboard is stale: run the renderer');
  console.log(`Progress dashboard current: ${data.issues.length} issues, snapshot ${data.snapshotAt}`);
} else {
  await writeFile(output, html);
  console.log(`Rendered ${data.issues.length} issues to ${output.pathname}`);
}
