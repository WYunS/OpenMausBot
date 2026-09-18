import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareRuijieHarness, verifyRuijieHarnessBundle } from './prepare-ruijie-harness.mjs';

const fixtures = [];
afterEach(async () => Promise.all(fixtures.splice(0).map((item) => rm(item, { recursive: true, force: true }))));

it('stages and verifies a pinned Windows Harness runtime without touching user data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'omb-harness-stage-')); fixtures.push(root);
  const source = path.join(root, 'input'); await mkdir(source);
  await writeFile(path.join(source, 'Ruijie-Harness.exe'), Buffer.from('fixture executable'));
  await writeFile(path.join(source, 'resources.pak'), Buffer.from('fixture resource'));
  const { output, manifest } = await prepareRuijieHarness({ target: 'win32-x64', source, directory: root, buildCommit: 'abc123' });
  expect(manifest).toMatchObject({ version: '2.1.10', target: 'win32-x64', buildCommit: 'abc123' });
  await expect(verifyRuijieHarnessBundle(output, 'win32-x64')).resolves.toEqual(manifest);
});

it('rejects a modified staged executable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'omb-harness-stage-')); fixtures.push(root);
  const source = path.join(root, 'input'); await mkdir(source);
  await writeFile(path.join(source, 'Ruijie-Harness.exe'), Buffer.from('fixture executable'));
  const { output } = await prepareRuijieHarness({ target: 'win32-x64', source, directory: root });
  await writeFile(path.join(output, 'runtime', 'Ruijie-Harness.exe'), Buffer.from('changed'));
  await expect(verifyRuijieHarnessBundle(output, 'win32-x64')).rejects.toThrow('digest mismatch');
});
