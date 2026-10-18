import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function buildIdentity() {
  let revision = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '';
  if (!revision) {
    try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Exported source has no Git metadata. */ }
  }
  revision = /^[a-f0-9]{7,40}$/i.test(revision) ? revision.slice(0, 7) : 'unknown';
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const release = process.env.PROMPTLAB_RELEASE_TAG === `v${version}` || process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME === `v${version}`;
  return { __PL_BUILD_REVISION__: JSON.stringify(revision), __PL_RELEASE_BUILD__: JSON.stringify(release) };
}
