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
  assert.match(privacy, /Google Analytics 4/);
  assert.match(privacy, /Google Analytics may set its own cookies after you allow analytics/);
  assert.match(privacy, /same-origin session storage/);
  assert.match(privacy, /Prompt text, model responses, documentation search terms, arbitrary URLs, email addresses, and provider API keys are never included/);
});

// M-4: the Data Export section promised "library, experiments, and settings"
// while the shipped export omitted saved experiment test cases and never
// included settings at all. The page must describe exactly what exportLib
// writes, and the payload must carry the experiment surfaces it names.
const libraryHook = await readFile(
  new URL('../prompt-lab-extension/src/hooks/usePromptLibrary.js', import.meta.url),
  'utf8',
);

test('privacy export claim matches the shipped workspace export', () => {
  // The shipped payload carries both experiment surfaces...
  const payloadBlock = libraryHook.match(/const exportPayload = \{[\s\S]*?\n {4}\};/)?.[0] || '';
  assert.match(payloadBlock, /\bruns\b/, 'export payload must include evaluation runs');
  assert.match(payloadBlock, /\btestCases\b/, 'export payload must include experiment test cases');

  // ...and the privacy page describes that payload instead of a broader one.
  assert.match(privacy, /evaluation history/i);
  assert.match(privacy, /test cases/i);
  assert.doesNotMatch(
    privacy,
    /export your library, experiments, and settings/i,
    'privacy must not promise a settings export the product does not expose',
  );
  // Settings (provider API keys included) never leave the browser, and the
  // page must say so instead of promising to export them.
  assert.match(privacy, /API keys[^.]*are (never|not) (part of|included in)[^.]*export/i);
});
