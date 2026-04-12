#!/usr/bin/env node

const [major, minor] = process.versions.node.split('.').map(Number);

const isSupported =
  (major === 20 && minor >= 19) ||
  major > 22 ||
  (major === 22 && minor >= 12);

if (!isSupported) {
  console.warn(
    `[prompt-lab] Supported Node runtimes are 20.19+ or 22.12+. Current runtime: ${process.versions.node}.`
  );
  console.warn(
    '[prompt-lab] Newer Vite releases require a newer Node floor than plain "20.x".'
  );
  console.warn(
    '[prompt-lab] Use Node 20.19.x LTS in this repo unless you have a specific reason to run 22.12+.'
  );
}
