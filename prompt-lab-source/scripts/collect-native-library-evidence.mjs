import assert from 'node:assert/strict';
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve(process.argv[2]);
const attachmentsDirectory = path.join(directory, 'attachments');
const manifest = JSON.parse(await readFile(path.join(attachmentsDirectory, 'manifest.json'), 'utf8'));
const attachments = manifest.flatMap(test => test.attachments || []);
for (const name of ['native-library-contract.json', 'native-parent-edit-contract.json', 'native-created-library.json']) {
  const matches = attachments.filter(item => item.suggestedHumanReadableName === name
    || item.suggestedHumanReadableName?.startsWith(`${name}_`));
  assert.equal(matches.length, 1, `Exactly one XCTest attachment required for ${name}`);
  const source = path.resolve(attachmentsDirectory, matches[0].exportedFileName);
  assert.ok(source.startsWith(`${attachmentsDirectory}${path.sep}`));
  JSON.parse(await readFile(source, 'utf8'));
  await copyFile(source, path.join(directory, name));
  console.log(`Collected ${name} from XCTest results`);
}
