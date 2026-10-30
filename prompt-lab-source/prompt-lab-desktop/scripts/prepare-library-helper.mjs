import { build } from 'vite';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyUniversalRuntime } from './verify-universal-runtime.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const triples = {
  'linux:x64': 'x86_64-unknown-linux-gnu', 'linux:arm64': 'aarch64-unknown-linux-gnu',
  'win32:x64': 'x86_64-pc-windows-msvc', 'win32:arm64': 'aarch64-pc-windows-msvc',
  'darwin:x64': 'x86_64-apple-darwin', 'darwin:arm64': 'aarch64-apple-darwin',
};

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Required runtime download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function prepareLibraryHelper() {
  if (!/^v22\./.test(process.version)) throw new Error('Library helper packaging requires Node 22.');
  const triple = triples[`${process.platform}:${process.arch}`];
  if (!triple) throw new Error('This native helper target is not qualified.');
  const output = join(desktop, 'src-tauri', 'library-helper');
  const binaries = join(desktop, 'src-tauri', 'binaries');
  await build({ configFile: false, root: desktop, logLevel: 'warn', build: {
    ssr: resolve(desktop, '../library-storage/service-worker.mjs'), target: 'node22',
    outDir: output, emptyOutDir: true, minify: false,
    rollupOptions: { output: { entryFileNames: 'worker.mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' } },
  } });
  await mkdir(binaries, { recursive: true });
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const nativeBinary = join(binaries, `promptlab-node-${triple}${suffix}`);
  await copyFile(process.execPath, nativeBinary); await chmod(nativeBinary, 0o755);
  const runtimeFiles = [nativeBinary];
  if (process.platform === 'darwin') {
    // A universal app must not depend on Rosetta or the build machine's CPU.
    const otherArch = process.arch === 'arm64' ? 'x64' : 'arm64';
    const name = `node-${process.version}-darwin-${otherArch}.tar.gz`;
    const base = `https://nodejs.org/dist/${process.version}/`;
    const sums = (await download(base + 'SHASUMS256.txt')).toString('utf8');
    const expected = sums.split('\n').map(line => line.trim().split(/\s+/)).find(parts => parts[1] === name)?.[0];
    if (!/^[a-f0-9]{64}$/.test(expected ?? '')) throw new Error('Official Node archive checksum is missing.');
    const archive = await download(base + name);
    if (sha256(archive) !== expected) throw new Error('Official Node archive checksum does not match.');
    const cache = join(tmpdir(), `promptlab-node-${process.version}-${otherArch}-${expected}`);
    await mkdir(cache, { recursive: true });
    const archivePath = join(cache, name); await writeFile(archivePath, archive);
    execFileSync('tar', ['-xzf', archivePath, '-C', cache, '--strip-components=1', `node-${process.version}-darwin-${otherArch}/bin/node`]);
    const otherBinary = join(binaries, `promptlab-node-${triples[`darwin:${otherArch}`]}`);
    await copyFile(join(cache, 'bin', 'node'), otherBinary); await chmod(otherBinary, 0o755);
    const universal = join(binaries, 'promptlab-node-universal-apple-darwin');
    execFileSync('lipo', ['-create', nativeBinary, otherBinary, '-output', universal]);
    verifyUniversalRuntime(universal);
    runtimeFiles.push(otherBinary, universal);
  }
  const license = await download(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!license.toString('utf8').includes('Node.js')) throw new Error('Node runtime license is invalid.');
  await writeFile(join(output, 'NODE-LICENSE'), license);
  const files = {};
  async function collect(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, item.name);
      if (item.isDirectory()) await collect(file);
      else files[file.slice(output.length + 1).replaceAll('\\', '/')] = sha256(await readFile(file));
    }
  }
  await collect(output);
  const manifest = { version: 1, node: process.version, hostTarget: triple, files,
    runtimes: Object.fromEntries(await Promise.all(runtimeFiles.map(async file => [basename(file), sha256(await readFile(file))]))) };
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = await prepareLibraryHelper();
  console.log(`Prepared library helper: ${manifest.node}, ${Object.keys(manifest.files).length} resource files, ${Object.keys(manifest.runtimes).length} runtime binaries.`);
}
