import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const privacy = await readFile(new URL('../prompt-lab-web/public/privacy.html', import.meta.url), 'utf8');
const webEntry = await readFile(new URL('../prompt-lab-web/app/main-web.jsx', import.meta.url), 'utf8');

test('privacy account claim matches the Clerk-gated hosted web app', () => {
  assert.match(webEntry, /<SignedOut>[\s\S]*<SignIn/);
  assert.match(
    privacy,
    /local extension or desktop shells; the hosted web app requires a Clerk account and sign-in/,
  );
  assert.doesNotMatch(privacy, /No mandatory user account, login, or registration flow/);
});

test('privacy discloses consent-gated, content-free landing attribution', () => {
  assert.match(privacy, /only after you allow analytics/);
  assert.match(privacy, /same-origin session storage/);
  assert.match(privacy, /Prompt text, model responses, documentation search terms, arbitrary URLs, email addresses, and provider API keys are never included/);
});
