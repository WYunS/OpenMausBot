import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { HARNESS_RELEASE } from '../shared/ruijie-harness-release.ts';
import { assertHarnessRegistryPins, electronInstallArguments, ensureRuijieHarness, harnessBuildArguments, harnessTargets, macHarnessConfig, unexpectedHarnessChanges, withStableHarnessLockfile } from './build-ruijie-harness.mjs';

it.each(['win32', 'darwin'])('builds a source-stamped directory, never an installer: %s', platform => {
  const args = harnessBuildArguments(platform, 'C:/fixture with spaces/electron/dist', 'arm64');
  expect(args).toContain('--dir');
  expect(args).toContain(`--config.extraMetadata.ruijieHarnessBuildCommit=${HARNESS_RELEASE.commit}`);
  expect(args).not.toContain('dmg');
  if (platform === 'win32') {
    expect(args).toContain('--config.npmRebuild=false');
    expect(args).toContain('--config.win.signExecutable=false');
    expect(args).toContain('--config.electronDist=C:/fixture with spaces/electron/dist');
  }
  if (platform === 'darwin') {
    expect(args).toContain('--arm64');
    expect(args).not.toContain('--universal');
    expect(args).toContain('--config.afterPack=./scripts/verify-packaged-runtime.ts');
  }
});
it('all release entrypoints checkout the same reviewed source', async () => {
  for (const file of ['package-release.yml', 'release.yml', 'package-win.yml']) {
    const workflow = parse(await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'));
    const checkouts = Object.values(workflow.jobs).flatMap(job => job.steps ?? [])
      .filter(step => step.with?.path === 'ruijie-harness');
    expect(checkouts.length).toBeGreaterThan(0);
    for (const checkout of checkouts) {
      expect(checkout.with.ref).toBe(HARNESS_RELEASE.commit);
      expect(checkout.with.token).toContain('secrets.RUIJIE_HARNESS_READ_TOKEN');
      expect(checkout.with['persist-credentials']).toBe(false);
    }
  }
  const adapter = await readFile(new URL('../.release/adapter.mjs', import.meta.url), 'utf8');
  expect(adapter).toContain("scripts/build-ruijie-harness.mjs");
  expect(adapter.indexOf("scripts/build-ruijie-harness.mjs")).toBeLessThan(adapter.indexOf("'exec','electron-builder'"));
  const builder = await readFile(new URL('./build-ruijie-harness.mjs', import.meta.url), 'utf8');
  expect(builder).not.toContain("'build:vendor-sidebar'");

  const packageWorkflow = parse(await readFile(new URL('../.github/workflows/package-release.yml', import.meta.url), 'utf8'));
  const buildSteps = packageWorkflow.jobs.build.steps;
  const restore = buildSteps.find(step => String(step.uses).startsWith('actions/cache/restore@'));
  const save = buildSteps.find(step => String(step.uses).startsWith('actions/cache/save@'));
  expect(restore.with.path).toBe('dist-native/ruijie-harness');
  expect(restore.with.key).toContain(HARNESS_RELEASE.commit);
  expect(save.with.path).toBe('dist-native/ruijie-harness');
  expect(save.with.key).toBe('${{ steps.harness-cache.outputs.cache-primary-key }}');
  const macBuild = buildSteps.find(step => step.name === 'Build and verify macOS candidate structure');
  expect(macBuild.if).toBe("runner.os == 'macOS'");
  expect(macBuild.run).toContain('ulimit -n 10240');
});

it('maps each native packaging host to the exact Harness sidecar slices', () => {
  expect(harnessTargets('win32')).toEqual(['win32-x64']);
  expect(harnessTargets('darwin')).toEqual(['darwin-arm64', 'darwin-x64']);
  expect(harnessTargets('darwin','arm64')).toEqual(['darwin-arm64']);
  expect(harnessTargets('darwin','x64')).toEqual(['darwin-x64']);
  expect(()=>harnessTargets('win32','arm64')).toThrow();
  expect(()=>harnessTargets('darwin','universal')).toThrow();
});

it.each(['arm64','x64'])('thin %s overrides retain closure checks and do not mutate public Harness configuration', arch => {
  const base={files:['lib/**','package.json'],mac:{target:['dir'],notarize:true},afterPack:'./scripts/verify-packaged-runtime.ts'};
  const before=JSON.stringify(base);
  const config=macHarnessConfig(base,arch);
  expect(JSON.stringify(base)).toBe(before);
  expect(config.extraMetadata.ruijieHarnessBuildCommit).toBe(HARNESS_RELEASE.commit);
  expect(config.afterPack).toBe('./scripts/verify-packaged-runtime.ts');
  expect(config.mac.identity).toBeNull();
  expect(config.mac.notarize).toBe(false);
  expect(config.files).toContain(`!**/node_modules/node-pty/prebuilds/darwin-${arch==='arm64'?'x64':'arm64'}/**`);
  const args=harnessBuildArguments('darwin',undefined,arch);
  expect(args).toContain(`--${arch}`);
  expect(args).not.toContain('--universal');
});

it('reuses a fully verified Harness stage and rebuilds a missing one', async () => {
  const calls = [];
  const options = { sourceRoot: 'source', directory: 'output', platform: 'darwin' };
  const reused = await ensureRuijieHarness(options, {
    verifySource: async () => calls.push('source'),
    verifyBundle: async (_path, target) => calls.push(target),
    build: async () => calls.push('build'),
  });
  expect(reused).toEqual({ reused: true });
  expect(calls).toEqual(['source', 'darwin-arm64', 'darwin-x64']);

  calls.length = 0;
  const rebuilt = await ensureRuijieHarness(options, {
    verifySource: async () => calls.push('source'),
    verifyBundle: async (_path, target) => {
      calls.push(target);
      if (target === 'darwin-x64') throw new Error('cache miss');
    },
    build: async () => calls.push('build'),
  });
  expect(rebuilt).toEqual({ reused: false });
  expect(calls).toEqual(['source', 'darwin-arm64', 'darwin-x64', 'build']);
});

it('can prepare then reuse the same source checkout after its generated icons change', async () => {
  let generated = false;
  let staged = false;
  let builds = 0;
  const dependencies = {
    verifySource: async (_source, options = {}) => {
      if (generated && !options.allowGeneratedAssets) throw new Error('Harness source has unexpected uncommitted changes');
    },
    verifyBundle: async () => { if (!staged) throw new Error('missing stage'); },
    build: async () => { builds++; generated = true; staged = true; },
  };
  const options = { sourceRoot: 'source', directory: 'output', platform: 'darwin' };
  expect(await ensureRuijieHarness(options, dependencies)).toEqual({ reused: false });
  expect(await ensureRuijieHarness(options, dependencies)).toEqual({ reused: true });
  expect(builds).toBe(1);
});

it('installs the pinned Electron distribution only when Windows packaging needs it', () => {
  expect(electronInstallArguments('win32', 'C:/repo/electron/install.js')).toEqual(['C:/repo/electron/install.js']);
  expect(electronInstallArguments('darwin', '/repo/electron/install.js')).toBeNull();
});

it('refreshes platform file dependency hashes before immutable install and restores the reviewed lockfile', async () => {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), 'omb-harness-lock-'));
  const lockfile = path.join(sourceRoot, 'yarn.lock');
  await writeFile(lockfile, 'local: reviewed\n');
  const calls = [];
  const run = (_command, args) => {
    calls.push(args);
    if (calls.length === 1) return writeFile(lockfile, 'local: platform\n');
  };
  try {
    await withStableHarnessLockfile(sourceRoot, async (...args) => await run(...args), async () => {
      expect(await readFile(lockfile, 'utf8')).toBe('local: platform\n');
    });
    expect(calls).toEqual([
      ['yarn', 'install', '--mode=update-lockfile'],
      ['yarn', 'install', '--mode=update-lockfile'],
      ['yarn', 'install', '--immutable'],
    ]);
    expect(await readFile(lockfile, 'utf8')).toBe('local: reviewed\n');
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

it('allows only deterministic icon outputs after the Harness build', () => {
  const generated = [
    'M dsh-plugin-desktop/build/app-icon-mac.png',
    ' M dsh-plugin-desktop/build/tray-icon-blue@2x.png',
  ].join('\n');
  expect(unexpectedHarnessChanges(generated)).toBe('');
  expect(unexpectedHarnessChanges(`${generated}\n M dsh-plugin-desktop/package.json`))
    .toBe(' M dsh-plugin-desktop/package.json');
});

it('always restores the source lockfile after install failure or unstable refresh', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'harness-lock-failure-'));
  const lock=path.join(root,'yarn.lock');
  try {
    await writeFile(lock,'local: reviewed');
    await expect(withStableHarnessLockfile(root,async()=>{await writeFile(lock,'changed');throw Error('install failed');},()=>{})).rejects.toThrow('install failed');
    expect(await readFile(lock,'utf8')).toBe('local: reviewed');
    let step=0;
    await expect(withStableHarnessLockfile(root,()=>writeFile(lock,`local: ${++step}`),()=>{})).rejects.toThrow('not stable');
    expect(await readFile(lock,'utf8')).toBe('local: reviewed');
  } finally {await rm(root,{recursive:true,force:true});}
});

it('runner-local file refresh cannot silently change registry package versions',()=>{
  const before=JSON.stringify({dep:{resolution:'dep@npm:1.0.0',version:'1.0.0'},vendor:{resolution:'vendor@file:../vendor::hash=aaa'}});
  expect(()=>assertHarnessRegistryPins(before,before.replace('hash=aaa','hash=bbb'))).not.toThrow();
  expect(()=>assertHarnessRegistryPins(before,before.replaceAll('1.0.0','2.0.0'))).toThrow('must not upgrade');
});
