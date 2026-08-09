#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const REQUIRED_NODE_MAJOR = 22;

export function parseNodeMajor(version) {
  const match = /^v?(\d+)(?:\.|$)/.exec(String(version || '').trim());
  if (!match) {
    throw new TypeError(`[prompt-lab] Could not parse Node version: ${version || '<empty>'}.`);
  }
  return Number.parseInt(match[1], 10);
}

export function assertSupportedNode(version = process.versions.node) {
  const major = parseNodeMajor(version);
  if (major !== REQUIRED_NODE_MAJOR) {
    throw new Error(
      `[prompt-lab] Node ${REQUIRED_NODE_MAJOR}.x is required. Current runtime: ${version}. `
      + 'Switch to the version in prompt-lab-source/.nvmrc before running install, test, build, or deploy commands.'
    );
  }
  return { major, version };
}

function main() {
  try {
    assertSupportedNode();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
