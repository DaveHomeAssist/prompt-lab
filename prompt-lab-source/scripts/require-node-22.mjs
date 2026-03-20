#!/usr/bin/env node

const REQUIRED_MAJOR = 22;
const [major] = process.versions.node.split('.').map(Number);
const isCiRuntime = Boolean(process.env.CI || process.env.VERCEL);
const isAllowed = major === REQUIRED_MAJOR || (isCiRuntime && major >= 20);

if (!isAllowed) {
  console.error(
    `[prompt-lab] Node ${REQUIRED_MAJOR}.x is required. Current runtime: ${process.versions.node}.`
  );
  console.error('[prompt-lab] Run `nvm use` in the repo root before building or testing.');
  process.exit(1);
}

if (major !== REQUIRED_MAJOR && isCiRuntime) {
  console.warn(
    `[prompt-lab] CI/Vercel runtime ${process.versions.node} accepted for deployment; local development should still use Node ${REQUIRED_MAJOR}.x.`
  );
}
