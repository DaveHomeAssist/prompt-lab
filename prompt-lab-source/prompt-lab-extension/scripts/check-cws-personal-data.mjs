// Fails when the Chrome Web Store build still contains personal-data strings
// that used to ship in the extension bundle.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CWS_FORBIDDEN_PERSONAL_DATA = [
  'dave@promptlab.tools',
  'Notion Workspace — Dave Robertson',
];

export function findForbiddenPersonalData(directory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`CWS build output is missing: ${directory}`);
  }
  const hits = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const text = readFileSync(fullPath).toString('utf8');
      for (const needle of CWS_FORBIDDEN_PERSONAL_DATA) {
        if (text.includes(needle)) hits.push({ file: fullPath, needle });
      }
    }
  }
  visit(directory);
  return hits;
}

function main() {
  const directories = process.argv.slice(2);
  if (!directories.length) {
    console.error('usage: node scripts/check-cws-personal-data.mjs <dist-cws> [more]');
    process.exit(2);
  }
  let failed = false;
  for (const directory of directories) {
    const hits = findForbiddenPersonalData(path.resolve(directory));
    if (!hits.length) continue;
    failed = true;
    for (const hit of hits) {
      console.error(`${hit.file}: contains ${JSON.stringify(hit.needle)}`);
    }
  }
  if (failed) process.exit(1);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main();
