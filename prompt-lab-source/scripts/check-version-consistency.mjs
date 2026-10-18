import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const packages = ['', 'prompt-lab-extension/', 'prompt-lab-web/', 'prompt-lab-desktop/'];
export const specialFiles = ['prompt-lab-extension/extension/manifest.json', 'prompt-lab-extension/public/manifest.json', 'prompt-lab-desktop/src-tauri/tauri.conf.json', 'prompt-lab-desktop/src-tauri/Cargo.toml', 'prompt-lab-desktop/src-tauri/Cargo.lock', 'prompt-lab-extension/src/constants.js'];
export const versionFiles = [...packages.flatMap(prefix => [`${prefix}package.json`, `${prefix}package-lock.json`]), ...specialFiles];
export function checkVersions(root = sourceRoot, read = file => readFileSync(resolve(root, file), 'utf8')) {
  const canonical = JSON.parse(read('package.json')).version;
  const errors = [];
  for (const file of versionFiles) {
    const text = read(file);
    let versions;
    if (file.endsWith('.json')) {
      const data = JSON.parse(text);
      versions = file.endsWith('package-lock.json') ? [data.version, data.packages?.['']?.version] : [data.version];
    } else if (file.endsWith('constants.js')) versions = [text.match(/export const APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1]];
    else if (file.endsWith('Cargo.toml')) versions = [text.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1]];
    else versions = [text.match(/\[\[package\]\]\nname = "prompt-lab-desktop"\nversion = "([^"]+)"/)?.[1]];
    for (const version of versions) if (version !== canonical) errors.push(`${file}: ${version ?? 'missing'} != ${canonical}`);
  }
  return { canonical, errors };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { canonical, errors } = checkVersions();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`All distributed versions match ${canonical}`);
}
