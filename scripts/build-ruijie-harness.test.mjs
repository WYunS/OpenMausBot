import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { HARNESS_RELEASE } from '../shared/ruijie-harness-release.ts';
import { harnessBuildArguments } from './build-ruijie-harness.mjs';

it.each(['win32', 'darwin'])('builds a source-stamped directory, never an installer: %s', platform => {
  const args = harnessBuildArguments(platform);
  expect(args).toContain('--dir');
  expect(args).toContain(`--config.extraMetadata.ruijieHarnessBuildCommit=${HARNESS_RELEASE.commit}`);
  expect(args).not.toContain('dmg');
  if (platform === 'darwin') {
    expect(args).toContain('--universal');
    expect(args).toContain('--config.afterPack=./scripts/sign-mac-internal.ts');
  }
});
it('all release entrypoints checkout the same reviewed source', async () => {
  for (const file of ['package-release.yml', 'release.yml', 'package-win.yml']) {
    const workflow = parse(await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'));
    const checkouts = Object.values(workflow.jobs).flatMap(job => job.steps ?? [])
      .filter(step => step.with?.repository === HARNESS_RELEASE.repository);
    expect(checkouts.length).toBeGreaterThan(0);
    for (const checkout of checkouts) expect(checkout.with.ref).toBe(HARNESS_RELEASE.commit);
  }
  const adapter = await readFile(new URL('../.release/adapter.mjs', import.meta.url), 'utf8');
  expect(adapter).toContain("scripts/build-ruijie-harness.mjs");
  expect(adapter.indexOf("scripts/build-ruijie-harness.mjs")).toBeLessThan(adapter.indexOf("'exec','electron-builder'"));
});
