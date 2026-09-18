// The only build entry for the pinned, Bot-owned sidecar. No installer or GUI.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HARNESS_RELEASE } from '../shared/ruijie-harness-release.ts';
import { prepareRuijieHarness } from './prepare-ruijie-harness.mjs';

export function harnessBuildArguments(platform) {
  assert(['win32', 'darwin'].includes(platform), 'Bundled Harness supports Windows and macOS');
  return ['yarn', 'exec', 'electron-builder', '--dir',
    ...(platform === 'win32' ? ['--win', '--x64'] : ['--mac', '--universal',
      '--config.mac.notarize=false', '--config.npmRebuild=false',
      '--config.afterPack=./scripts/sign-mac-internal.ts']),
    '--publish', 'never', `--config.extraMetadata.ruijieHarnessBuildCommit=${HARNESS_RELEASE.commit}`];
}

export async function verifyHarnessSource(sourceRoot) {
  const git = args => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(git(['rev-parse', 'HEAD']), HARNESS_RELEASE.commit, 'Harness checkout is not the reviewed commit');
  assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'Harness source has uncommitted changes');
  assert(!git(['submodule', 'status', '--recursive']).split('\n').some(line => /^[-+U]/.test(line)), 'Harness submodules are not pinned/initialized');
  const pkg = JSON.parse(await readFile(path.join(sourceRoot, 'dsh-plugin-desktop/package.json'), 'utf8'));
  assert.equal(pkg.version, HARNESS_RELEASE.version, 'Wrong Harness source version');
}

export async function buildRuijieHarness({ sourceRoot, directory = fileURLToPath(new URL('../', import.meta.url)), platform = process.platform } = {}) {
  assert(sourceRoot, 'Use --source PATH to the pinned Harness checkout');
  sourceRoot = path.resolve(sourceRoot);
  const args = harnessBuildArguments(platform);
  assert.equal(platform, process.platform, 'Build the sidecar on its native platform');
  await verifyHarnessSource(sourceRoot);
  const desktop = path.join(sourceRoot, 'dsh-plugin-desktop');
  function run(command, commandArgs, cwd) {
    const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', windowsHide: true,
      shell: platform === 'win32' && command === 'corepack',
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', DSH_TELEMETRY_DISABLED: '1' } });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Harness build failed: ${commandArgs.join(' ')}`);
  }
  run('corepack', ['yarn', 'install', '--immutable'], sourceRoot);
  run('corepack', ['yarn', 'workspace', 'dsh-community-market', 'build'], sourceRoot);
  run('corepack', ['yarn', 'workspace', 'dsh-plugin-desktop', 'build:vendor-sidebar'], sourceRoot);
  run('corepack', ['yarn', 'workspace', 'dsh-plugin-desktop', 'build'], sourceRoot);
  if (platform === 'darwin') {
    const { prepareInstalledMacUniversalRuntime } = await import(pathToFileURL(path.join(desktop, 'scripts/mac-universal.ts')).href);
    prepareInstalledMacUniversalRuntime(desktop);
    run(process.execPath, ['scripts/generate-mac-app-icns.mjs'], desktop);
  }
  run('corepack', args, desktop);
  for (const target of platform === 'darwin' ? ['darwin-arm64', 'darwin-x64'] : ['win32-x64']) {
    const source = path.join(desktop, 'dist', platform === 'darwin' ? 'mac-universal/锐捷 Harness.app' : 'win-unpacked');
    const { output } = await prepareRuijieHarness({ target, source, directory });
    console.log(`Verified Harness ${HARNESS_RELEASE.version} ${target}: ${output}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv[2], '--source', 'Use --source PATH');
  await buildRuijieHarness({ sourceRoot: process.argv[3] });
}
