import { checkVersions } from './check-version-consistency.mjs';
const tag = process.argv[2];
const { canonical, errors } = checkVersions();
if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag || '') || tag !== `v${canonical}` || errors.length) {
  console.error(`Release tag must be v${canonical}.\n${errors.join('\n')}`); process.exitCode = 1;
} else console.log(`Release tag ${tag} matches every distributed version.`);
