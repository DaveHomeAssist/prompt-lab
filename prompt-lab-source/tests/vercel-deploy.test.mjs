import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_VERCEL_PROJECT_ID,
  CANONICAL_VERCEL_PROJECT_NAME,
  assertCanonicalVercelProject,
} from '../scripts/vercel-deploy.mjs';

test('Vercel deploy guard accepts only the canonical Prompt Lab project', () => {
  const project = assertCanonicalVercelProject(JSON.stringify({
    orgId: 'team_example',
    projectId: CANONICAL_VERCEL_PROJECT_ID,
    projectName: CANONICAL_VERCEL_PROJECT_NAME,
  }));
  assert.equal(project.projectId, CANONICAL_VERCEL_PROJECT_ID);
  assert.equal(project.projectName, CANONICAL_VERCEL_PROJECT_NAME);
});

test('Vercel deploy guard rejects a valid but wrong project link', () => {
  assert.throws(
    () => assertCanonicalVercelProject(JSON.stringify({
      orgId: 'team_example',
      projectId: 'prj_wrong',
      projectName: 'prompt-lab-source',
    })),
    /Refusing Vercel deployment.*prompt-lab-source.*is not canonical "prompt-lab"/,
  );
});

test('Vercel deploy guard rejects malformed project metadata before any deploy', () => {
  assert.throws(
    () => assertCanonicalVercelProject('{not-json'),
    /Invalid prompt-lab-source\/\.vercel\/project\.json/,
  );
});
