#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const shells = [
  'prompt-lab-extension',
  'prompt-lab-web',
  'prompt-lab-desktop',
];

const sharedVersions = {
  dependencies: {
    'diff-match-patch': '1.0.5',
    react: '18.3.1',
    'react-dom': '18.3.1',
    'react-router-dom': '7.18.0',
  },
  devDependencies: {
    autoprefixer: '10.4.20',
    postcss: '8.5.15',
    tailwindcss: '3.4.17',
    vite: '7.3.6',
  },
};

const forbiddenDeps = [
  '@vitejs/plugin-react',
];

const errors = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function checkPackage(shell, pkg, lock) {
  for (const [section, deps] of Object.entries(sharedVersions)) {
    for (const [name, expected] of Object.entries(deps)) {
      const actual = pkg[section]?.[name];
      if (actual !== expected) {
        errors.push(`${shell} package.json ${section}.${name}: expected ${expected}, got ${actual ?? 'missing'}`);
      }

      const locked = lock.packages?.[`node_modules/${name}`]?.version;
      if (locked !== expected) {
        errors.push(`${shell} package-lock.json ${name}: expected ${expected}, got ${locked ?? 'missing'}`);
      }
    }
  }

  for (const name of forbiddenDeps) {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (pkg[section]?.[name] != null) {
        errors.push(`${shell} package.json ${section}.${name}: expected absent, got ${pkg[section][name]}`);
      }
    }

    const locked = lock.packages?.[`node_modules/${name}`]?.version;
    if (locked != null) {
      errors.push(`${shell} package-lock.json ${name}: expected absent, got ${locked}`);
    }
  }
}

function checkInstalled(shell) {
  const modulesDir = join(root, shell, 'node_modules');
  if (!existsSync(modulesDir)) return;

  for (const deps of Object.values(sharedVersions)) {
    for (const [name, expected] of Object.entries(deps)) {
      const packageJsonPath = join(modulesDir, name, 'package.json');
      if (!existsSync(packageJsonPath)) {
        errors.push(`${shell} node_modules ${name}: missing`);
        continue;
      }

      const actual = readJson(packageJsonPath).version;
      if (actual !== expected) {
        errors.push(`${shell} node_modules ${name}: expected ${expected}, got ${actual}`);
      }
    }
  }

  for (const name of forbiddenDeps) {
    const packageJsonPath = join(modulesDir, name, 'package.json');
    if (existsSync(packageJsonPath)) {
      errors.push(`${shell} node_modules ${name}: expected absent`);
    }
  }
}

function checkIcloudDuplicates(shell) {
  const modulesDir = join(root, shell, 'node_modules');
  if (!existsSync(modulesDir)) return;

  const found = [];
  const stack = [modulesDir];
  while (stack.length > 0 && found.length < 20) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (/(^| )2(\.|$)/.test(entry.name)) {
        found.push(relative(root, fullPath));
        continue;
      }

      if (entry.isDirectory()) {
        const stats = statSync(fullPath);
        if (stats.isDirectory()) stack.push(fullPath);
      }
    }
  }

  if (found.length > 0) {
    const suffix = found.length === 20 ? ', ...' : '';
    errors.push(`${shell} node_modules has iCloud duplicate paths: ${found.join(', ')}${suffix}`);
  }
}

for (const shell of shells) {
  const pkg = readJson(join(root, shell, 'package.json'));
  const lock = readJson(join(root, shell, 'package-lock.json'));
  checkPackage(shell, pkg, lock);
  checkInstalled(shell);
  checkIcloudDuplicates(shell);
}

if (errors.length > 0) {
  console.error('[toolchain] Shared build toolchain check failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('[toolchain] Shared build toolchain is aligned');
