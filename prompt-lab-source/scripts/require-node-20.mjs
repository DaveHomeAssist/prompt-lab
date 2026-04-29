#!/usr/bin/env node

const [major, minor] = process.versions.node.split('.').map(Number);

const isSupported = major === 22 && minor >= 12;

if (!isSupported) {
  console.error(
    `[prompt-lab] Supported Node runtime is 22.12+. Current runtime: ${process.versions.node}.`
  );
  console.error(
    '[prompt-lab] Use the Homebrew Node 22 binary on this machine: PATH=/opt/homebrew/opt/node@22/bin:$PATH'
  );
  process.exitCode = 1;
}
