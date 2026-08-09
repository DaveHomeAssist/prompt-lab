import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertSupportedNode,
  parseNodeMajor,
  REQUIRED_NODE_MAJOR,
} from '../scripts/require-node.mjs';

const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(sourceDir, '..');
const packagePaths = [
  'package.json',
  'prompt-lab-extension/package.json',
  'prompt-lab-web/package.json',
  'prompt-lab-desktop/package.json',
];

test('Node guard accepts Node 22 and rejects unsupported majors', () => {
  assert.equal(REQUIRED_NODE_MAJOR, 22);
  assert.equal(parseNodeMajor('v22.22.1'), 22);
  assert.deepEqual(assertSupportedNode('22.22.1'), { major: 22, version: '22.22.1' });
  assert.throws(() => assertSupportedNode('20.19.5'), /Node 22\.x is required.*20\.19\.5/);
  assert.throws(() => assertSupportedNode('25.8.1'), /Node 22\.x is required.*25\.8\.1/);
  assert.throws(() => parseNodeMajor('not-a-version'), /Could not parse Node version/);
});

test('the active test runtime satisfies the repository contract', () => {
  assert.doesNotThrow(() => assertSupportedNode(process.versions.node));
});

test('all package manifests and .nvmrc declare the Node 22 contract', async () => {
  const nvmrcPaths = [
    join(repoDir, '.nvmrc'),
    join(sourceDir, '.nvmrc'),
    join(sourceDir, 'prompt-lab-extension', '.nvmrc'),
  ];
  for (const nvmrcPath of nvmrcPaths) {
    assert.equal((await readFile(nvmrcPath, 'utf8')).trim(), '22', `${nvmrcPath} must select Node 22`);
  }

  for (const packagePath of packagePaths) {
    const manifest = JSON.parse(await readFile(join(sourceDir, packagePath), 'utf8'));
    assert.equal(manifest.engines?.node, '22.x', `${packagePath} must require Node 22.x`);
    assert.match(manifest.scripts?.['check:node'] || '', /require-node\.mjs/);
    assert.doesNotMatch(manifest.scripts?.['check:node'] || '', /require-node-20/);
  }

  await assert.rejects(access(join(sourceDir, 'scripts', 'require-node-20.mjs')), { code: 'ENOENT' });
});

test('every GitHub Actions Node setup uses .nvmrc', async () => {
  const workflowDir = join(repoDir, '.github', 'workflows');
  const workflowNames = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/.test(name));
  let setupCount = 0;

  for (const workflowName of workflowNames) {
    const workflow = await readFile(join(workflowDir, workflowName), 'utf8');
    const setupMatches = workflow.match(/uses: actions\/setup-node@v4/g) || [];
    if (setupMatches.length === 0) continue;
    setupCount += setupMatches.length;
    assert.equal(
      (workflow.match(/node-version-file: prompt-lab-source\/\.nvmrc/g) || []).length,
      setupMatches.length,
      `${workflowName} must source every Node setup from prompt-lab-source/.nvmrc`
    );
    assert.doesNotMatch(workflow, /node-version\s*:\s*['"]?(?:20|22)(?:['"]|\s|$)/);
  }

  assert.ok(setupCount > 0, 'expected at least one actions/setup-node step');
});
