import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export function verifyUniversalRuntime(file) {
  const architectures = execFileSync('lipo', ['-archs', file], {
    encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim().split(/\s+/).sort();
  assert.deepEqual(architectures, ['arm64', 'x86_64'],
    'The macOS runtime must contain both Apple Silicon and Intel architectures.');
}
