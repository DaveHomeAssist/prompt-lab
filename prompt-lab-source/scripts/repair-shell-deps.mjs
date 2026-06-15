#!/usr/bin/env node

import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shells = [
  'prompt-lab-extension',
  'prompt-lab-web',
  'prompt-lab-desktop',
];

function runNpmCi(shell) {
  return new Promise((resolve, reject) => {
    console.log(`[deps:repair] installing ${shell}`);
    const child = spawn('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], {
      cwd: join(root, shell),
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${shell} npm ci failed with code ${code ?? 'none'} signal ${signal ?? 'none'}`));
    });
  });
}

for (const shell of shells) {
  await rm(join(root, shell, 'node_modules'), { recursive: true, force: true });
  await runNpmCi(shell);
}

console.log('[deps:repair] shell dependencies reinstalled');
