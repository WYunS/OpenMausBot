import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HARNESS_RELEASE } from '../shared/ruijie-harness-release.ts';
import { prepareRuijieHarness, verifyRuijieHarnessBundle } from './prepare-ruijie-harness.mjs';

const fixtures = [];
afterEach(async () => Promise.all(fixtures.splice(0).map(item => rm(item, { recursive: true, force: true }))));
async function fixture(overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'omb-harness-stage-')); fixtures.push(directory);
  const source = path.join(directory, 'input');
  const unpacked = path.join(source, 'resources/app.asar.unpacked');
  await mkdir(path.join(unpacked, 'lib'), { recursive: true });
  await writeFile(path.join(source, 'Ruijie-Harness.exe'), 'fixture executable');
  await writeFile(path.join(source, 'resources/app.asar'), 'fixture archive');
  await writeFile(path.join(unpacked, 'lib/main.js'), 'export const fixture = true;');
  await writeFile(path.join(unpacked, 'package.json'), JSON.stringify({
    name: 'dsh-plugin-desktop', version: HARNESS_RELEASE.version,
    main: 'lib/main.js', ruijieHarnessBuildCommit: HARNESS_RELEASE.commit, ...overrides,
  }));
  return { target: 'win32-x64', source, directory };
}
it('stages actual reviewed runtime metadata and code without touching user data', async () => {
  const { output, manifest } = await prepareRuijieHarness(await fixture());
  expect(manifest).toMatchObject({ schemaVersion: 2, version: HARNESS_RELEASE.version, buildCommit: HARNESS_RELEASE.commit });
  await expect(verifyRuijieHarnessBundle(output, 'win32-x64')).resolves.toEqual(manifest);
});
it.each(['Ruijie-Harness.exe', 'resources/app.asar', 'resources/app.asar.unpacked/lib/main.js'])(
  'rejects changed executable or application code: %s', async file => {
    const { output } = await prepareRuijieHarness(await fixture());
    await writeFile(path.join(output, 'runtime', file), 'changed');
    await expect(verifyRuijieHarnessBundle(output, 'win32-x64')).rejects.toThrow(/digest mismatch/);
  });
it('cannot relabel 2.1.9 as 2.1.10', async () => {
  await expect(prepareRuijieHarness(await fixture({ version: '2.1.9' }))).rejects.toThrow('actual Harness runtime version');
});
it('rejects an unproven or stale source commit', async () => {
  await expect(prepareRuijieHarness(await fixture({ ruijieHarnessBuildCommit: 'abc123' }))).rejects.toThrow('actual Harness source commit');
});
it('rejects added dependency files after staging', async () => {
  const { output } = await prepareRuijieHarness(await fixture());
  await writeFile(path.join(output, 'runtime/resources/app.asar.unpacked/lib/unreviewed.js'), 'changed');
  await expect(verifyRuijieHarnessBundle(output, 'win32-x64')).rejects.toThrow('runtime digest mismatch');
});
