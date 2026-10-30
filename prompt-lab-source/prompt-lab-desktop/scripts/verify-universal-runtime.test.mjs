import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyUniversalRuntime } from './verify-universal-runtime.mjs';

test('universal runtime check rejects missing slices and invalid inputs', {
  skip: process.platform !== 'darwin' && 'Requires the real macOS architecture tools',
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab universal runtime '));
  try {
    const source = join(directory, 'probe.c');
    await writeFile(source, 'int promptlab_architecture_probe(void) { return 0; }\n');
    const slices = ['arm64', 'x86_64'].map(architecture => join(directory, `${architecture}.o`));
    for (const [index, architecture] of ['arm64', 'x86_64'].entries()) {
      execFileSync('xcrun', ['clang', '-arch', architecture, '-c', source, '-o', slices[index]], { timeout: 15_000 });
    }
    const universal = join(directory, 'universal.o');
    execFileSync('lipo', ['-create', ...slices, '-output', universal], { timeout: 10_000 });
    verifyUniversalRuntime(universal);
    for (const slice of slices) {
      assert.throws(() => verifyUniversalRuntime(slice), /must contain both/);
    }
    assert.throws(() => verifyUniversalRuntime(source));
    assert.throws(() => verifyUniversalRuntime(join(directory, 'missing')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
