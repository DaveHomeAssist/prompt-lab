// embedded-postgres ships its binaries with a postinstall step that npm may
// skip (install scripts not approved). Run it once so the concurrency test can
// start a real local Postgres. Local only; nothing here touches the network.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
let dir;
try { dir = dirname(require.resolve(`@embedded-postgres/${process.platform}-${process.arch}/package.json`)); } catch { process.exit(0); }
const script = join(dir, 'scripts', 'hydrate-symlinks.js');
if (existsSync(script)) execFileSync(process.execPath, [script], { cwd: dir, stdio: 'ignore' });
