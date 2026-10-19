import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkVersions, sourceRoot, versionFiles } from './check-version-consistency.mjs';

export function planVersionBump(version, root = sourceRoot) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '')) throw new Error('Use a stable major.minor.patch version.');
  const { canonical, errors } = checkVersions(root);
  if (errors.length) throw new Error(`Repair inconsistent versions first:\n${errors.join('\n')}`);
  const nextParts = version.split('.').map(BigInt); const currentParts = canonical.split('.').map(BigInt);
  const difference = nextParts.findIndex((part, index) => part !== currentParts[index]);
  if (difference < 0 || nextParts[difference] < currentParts[difference]) throw new Error('Version must increase.');
  const before = new Map(versionFiles.map(file => [file, readFileSync(join(root, file), 'utf8')]));
  const after = new Map();
  for (const [file, source] of before) {
    let text;
    if (file.endsWith('.json')) {
      const data = JSON.parse(source); data.version = version;
      if (file.endsWith('package-lock.json')) data.packages[''].version = version;
      text = JSON.stringify(data, null, 2) + '\n';
    } else if (file.endsWith('constants.js')) text = source.replace(/(export const APP_VERSION\s*=\s*['"])[^'"]+/, `$1${version}`);
    else if (file.endsWith('Cargo.toml')) text = source.replace(/(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+/, `$1${version}`);
    else text = source.replace(/(\[\[package\]\]\r?\nname = "prompt-lab-desktop"\r?\nversion = ")[^"]+/, `$1${version}`);
    after.set(file, text);
  }
  const checked = checkVersions(root, file => after.get(file));
  if (checked.errors.length) throw new Error(checked.errors.join('\n'));
  return { canonical, version, before, after };
}

export function bumpVersion(version, root = sourceRoot) {
  const plan = planVersionBump(version, root);
  try {
    for (const [file, content] of plan.after) {
      const target = join(root, file); const temporary = `${target}.version-${process.pid}`;
      writeFileSync(temporary, content); renameSync(temporary, target);
    }
    const { errors } = checkVersions(root);
    if (errors.length) throw new Error(errors.join('\n'));
  } catch (error) {
    for (const [file, content] of plan.before) writeFileSync(join(root, file), content);
    throw error;
  }
  return plan;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: npm run version:bump -- major.minor.patch');
    const plan = bumpVersion(process.argv[2]);
    console.log(`${plan.canonical} → ${plan.version}\n${[...plan.after.keys()].join('\n')}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
