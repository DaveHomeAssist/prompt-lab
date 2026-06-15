#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const timeoutMs = Number.parseInt(process.env.PROMPTLAB_BUILD_TIMEOUT_MS || '300000', 10);

const builds = [
  { name: 'extension', cwd: 'prompt-lab-extension' },
  { name: 'web', cwd: 'prompt-lab-web' },
  { name: 'desktop', cwd: 'prompt-lab-desktop' },
];

function runBuild({ name, cwd }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    console.log(`[build:smoke] ${name} build starting`);

    const child = spawn('npm', ['run', 'build'], {
      cwd: join(root, cwd),
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    const timer = setTimeout(() => {
      console.error(`[build:smoke] ${name} build exceeded ${timeoutMs}ms`);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const elapsed = ((Date.now() - started) / 1000).toFixed(2);
      if (code === 0) {
        console.log(`[build:smoke] ${name} build passed in ${elapsed}s`);
        resolve();
        return;
      }

      reject(new Error(`${name} build failed with code ${code ?? 'none'} signal ${signal ?? 'none'} after ${elapsed}s`));
    });
  });
}

for (const build of builds) {
  await runBuild(build);
}

console.log('[build:smoke] All shell builds passed');
