import { mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative, sep } from 'node:path';
import { buildIdentity } from './build-identity.mjs';

export function retainSourceMaps(outputDirectory, artifactDirectory) {
  const root = resolve(outputDirectory);
  let retained = 0;
  const assets = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.map')) {
        if (!resolve(path).startsWith(root + sep)) throw new Error('Source map escaped build output');
        const target = join(artifactDirectory, relative(root, path));
        mkdirSync(resolve(target, '..'), { recursive: true });
        const compiled = path.slice(0, -4);
        assets.push({ asset: relative(root, compiled).split(sep).join('/'), sha256: createHash('sha256').update(readFileSync(compiled)).digest('hex') });
        renameSync(path, target); retained++;
      }
    }
  }
  visit(root);
  if (retained) writeFileSync(join(artifactDirectory, 'manifest.json'), JSON.stringify({ assets }, null, 2));
  return retained;
}

export function diagnosticSourceMaps(surface) {
  let config;
  return {
    name: 'promptlab-diagnostic-source-maps',
    apply: 'build',
    configResolved(value) { config = value; },
    closeBundle() {
      const revision = JSON.parse(buildIdentity().__PL_BUILD_REVISION__);
      const destination = resolve(config.root, '.diagnostic-source-maps', revision, surface);
      const count = retainSourceMaps(resolve(config.root, config.build.outDir), destination);
      if (!count) throw new Error('Diagnostic source maps were not produced');
      console.log(`[PromptLab] Retained ${count} diagnostic maps outside distributable output (${revision}/${surface}).`);
    },
  };
}
