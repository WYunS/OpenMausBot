// The only build entry for the pinned, Bot-owned sidecar. No installer or GUI.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { HARNESS_RELEASE } from '../shared/ruijie-harness-release.ts';
import { prepareRuijieHarness, verifyRuijieHarnessBundle } from './prepare-ruijie-harness.mjs';

const GENERATED_HARNESS_ASSETS = new Set([
  'dsh-plugin-desktop/build/app-icon-mac.png',
  'dsh-plugin-desktop/build/app-icon.ico',
  'dsh-plugin-desktop/build/app-icon.png',
  'dsh-plugin-desktop/build/tray-icon-blue.png',
  'dsh-plugin-desktop/build/tray-icon-blue@1.25x.png',
  'dsh-plugin-desktop/build/tray-icon-blue@1.5x.png',
  'dsh-plugin-desktop/build/tray-icon-blue@2x.png',
  'dsh-plugin-desktop/build/tray-iconTemplate.png',
  'dsh-plugin-desktop/build/tray-iconTemplate@2x.png',
]);

export function harnessBuildArguments(platform, electronDist, arch = process.arch) {
  assert(['win32', 'darwin'].includes(platform), 'Bundled Harness supports Windows and macOS');
  if (platform === 'win32') assert(electronDist, 'Use the source-installed Electron distribution');
  return ['yarn', 'exec', 'electron-builder', '--dir',
    // Match Harness's native Windows package entry: node-pty ships verified
    // prebuilds, and the installed Electron distribution needs no download.
    ...(platform === 'win32' ? ['--win', '--x64', '--config.npmRebuild=false',
      '--config.win.signExecutable=false', `--config.electronDist=${electronDist}`] : ['--mac', `--${checkedMacArch(arch)}`,
      '--config.mac.notarize=false', '--config.npmRebuild=false',
      '--config.afterPack=./scripts/verify-packaged-runtime.ts']),
    '--publish', 'never', `--config.extraMetadata.ruijieHarnessBuildCommit=${HARNESS_RELEASE.commit}`];
}

export function electronInstallArguments(platform, installer) {
  return platform === 'win32' ? [installer] : null;
}

export function checkedMacArch(arch) {
  assert(['arm64', 'x64'].includes(arch), `Unsupported Mac architecture: ${arch}`);
  return arch;
}

export function harnessTargets(platform, arch) {
  assert(['win32', 'darwin'].includes(platform), 'Bundled Harness supports Windows and macOS');
  if (arch !== undefined) {
    if (platform === 'win32') assert.equal(arch, 'x64', 'Windows Harness is x64');
    else checkedMacArch(arch);
    return [`${platform}-${arch}`];
  }
  return platform === 'darwin' ? ['darwin-arm64', 'darwin-x64'] : ['win32-x64'];
}

export function unexpectedHarnessChanges(status) {
  return status.split('\n').filter(Boolean).filter(line => {
    const match = /^ ?M (.+)$/.exec(line);
    return !match || !GENERATED_HARNESS_ASSETS.has(match[1].replaceAll('\\', '/'));
  }).join('\n');
}

export async function verifyHarnessSource(sourceRoot, { allowGeneratedAssets = false } = {}) {
  const git = args => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(git(['rev-parse', 'HEAD']), HARNESS_RELEASE.commit, 'Harness checkout is not the reviewed commit');
  const status = git(['status', '--porcelain', '--untracked-files=no']);
  assert.equal(allowGeneratedAssets ? unexpectedHarnessChanges(status) : status, '', 'Harness source has unexpected uncommitted changes');
  assert(!git(['submodule', 'status', '--recursive']).split('\n').some(line => /^[-+U]/.test(line)), 'Harness submodules are not pinned/initialized');
  const pkg = JSON.parse(await readFile(path.join(sourceRoot, 'dsh-plugin-desktop/package.json'), 'utf8'));
  assert.equal(pkg.version, HARNESS_RELEASE.version, 'Wrong Harness source version');
}

export async function withStableHarnessLockfile(sourceRoot, run, task) {
  const lockfile = path.join(sourceRoot, 'yarn.lock');
  const original = await readFile(lockfile);
  try {
    // Yarn file: dependency hashes include platform checkout metadata. Refresh
    // only the lock graph for this runner, prove that refresh is stable, then
    // perform the real immutable install against that graph.
    await run('corepack', ['yarn', 'install', '--mode=update-lockfile'], sourceRoot);
    const refreshed = await readFile(lockfile);
    assertHarnessRegistryPins(original, refreshed);
    await run('corepack', ['yarn', 'install', '--mode=update-lockfile'], sourceRoot);
    assert((await readFile(lockfile)).equals(refreshed), 'Harness platform lockfile refresh is not stable');
    await run('corepack', ['yarn', 'install', '--immutable'], sourceRoot);
    return await task();
  } finally {
    await writeFile(lockfile, original);
  }
}

export function assertHarnessRegistryPins(original, refreshed) {
  const pins = bytes => {
    const lock = parse(String(bytes));
    assert(lock && typeof lock === 'object' && !Array.isArray(lock), 'Invalid Harness lockfile');
    return Object.entries(lock).filter(([,entry]) => typeof entry?.resolution === 'string' && entry.resolution.includes('@npm:'))
      .map(([descriptor,entry]) => [descriptor,entry.resolution,entry.version,entry.dependencies??{},entry.peerDependencies??{}])
      .sort(([a],[b])=>a.localeCompare(b));
  };
  assert.deepEqual(pins(refreshed),pins(original),'Runner refresh must not upgrade registry dependencies');
}

export async function buildRuijieHarness({ sourceRoot, directory = fileURLToPath(new URL('../', import.meta.url)), platform = process.platform, arch } = {}) {
  assert(sourceRoot, 'Use --source PATH to the pinned Harness checkout');
  sourceRoot = path.resolve(sourceRoot);
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
  await withStableHarnessLockfile(sourceRoot, run, async () => {
    run('corepack', ['yarn', 'workspace', 'dsh-community-market', 'build'], sourceRoot);
    run('corepack', ['yarn', 'workspace', 'dsh-plugin-desktop', 'verify:vendor-sidebar'], sourceRoot);
    run('corepack', ['yarn', 'workspace', 'dsh-plugin-desktop', 'build'], sourceRoot);
  });
  await verifyHarnessSource(sourceRoot, { allowGeneratedAssets: true });
  const sourceRequire = createRequire(path.join(desktop, 'package.json'));
  const electronRoot = path.dirname(sourceRequire.resolve('electron/package.json'));
  const electronInstaller = electronInstallArguments(platform, path.join(electronRoot, 'install.js'));
  if (electronInstaller) run(process.execPath, electronInstaller, desktop);
  for (const target of harnessTargets(platform, arch)) {
    const targetArch = target.split('-')[1];
    const args = harnessBuildArguments(platform, path.join(electronRoot, 'dist'), targetArch);
    const configDir = await mkdtemp(path.join(tmpdir(), 'bot-harness-config-'));
    try {
      if (platform === 'darwin') {
        const { MACOS_UNIVERSAL_NATIVE_ENTRIES } = await import(pathToFileURL(path.join(desktop, 'scripts/mac-universal.ts')).href);
        for (const entry of MACOS_UNIVERSAL_NATIVE_ENTRIES.filter(entry => entry.arch === (targetArch === 'x64' ? 'x86_64' : 'arm64'))) {
          const file = path.join(desktop, entry.path);
          assert((await lstat(file)).isFile(), `Missing ${target} Harness native dependency: ${entry.path}`);
          if (entry.path.endsWith('/spawn-helper')) await chmod(file, 0o755);
        }
        run(process.execPath, ['scripts/generate-mac-app-icns.mjs'], desktop);
        const pkg = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
        const config = path.join(configDir, 'electron-builder.json');
        // A Bot-owned override, never an edit to Harness's public Universal config.
        await writeFile(config, JSON.stringify(macHarnessConfig(pkg.build, targetArch)));
        // Do not mix dotted --config.* options with a config pathname: CLI
        // parsers can replace that object and silently lose the overrides.
        args.splice(3, args.length - 3, '--dir', '--mac', `--${targetArch}`, '--config', config, '--publish', 'never');
      }
      run(process.execPath, [sourceRequire.resolve('electron-builder/cli.js'), ...args.slice(3)], desktop);
      const source = path.join(desktop, 'dist', platform === 'darwin'
        ? `${targetArch === 'arm64' ? 'mac-arm64' : 'mac'}/锐捷 Harness.app` : 'win-unpacked');
      if (platform === 'darwin') {
        const { MACOS_UNIVERSAL_NATIVE_ENTRIES } = await import(pathToFileURL(path.join(desktop, 'scripts/mac-universal.ts')).href);
        for (const entry of MACOS_UNIVERSAL_NATIVE_ENTRIES.filter(entry => entry.arch === (targetArch === 'x64' ? 'x86_64' : 'arm64'))) {
          const file = path.join(source,'Contents/Resources/app.asar.unpacked',entry.path);
          assert((await lstat(file)).isFile(), `Packaged ${target} Harness is missing ${entry.path}`);
        }
        const { signMacInternalApp } = await import(pathToFileURL(path.join(desktop, 'scripts/sign-mac-internal.ts')).href);
        // The public afterPack hook only seals arch=universal. Keep that flow
        // unchanged; explicitly seal this thin Bot sidecar after closure checks.
        signMacInternalApp({ appPath: source, platform, run: (command, commandArgs) => run(command, commandArgs, desktop), log: console.log });
        const actual = execFileSync('/usr/bin/lipo', ['-archs', path.join(source, 'Contents/MacOS/锐捷 Harness')], {encoding:'utf8'}).trim();
        assert.equal(actual, targetArch === 'x64' ? 'x86_64' : 'arm64', 'Harness must be a single-architecture app');
      }
      const { output } = await prepareRuijieHarness({ target, source, directory });
      console.log(`Verified Harness ${HARNESS_RELEASE.version} ${target}: ${output}`);
    } finally {
      await rm(configDir, {recursive:true,force:true});
    }
  }
}

export function macHarnessConfig(base, arch) {
  const other = checkedMacArch(arch) === 'arm64' ? 'x64' : 'arm64';
  return {...base, npmRebuild:false, afterPack:'./scripts/verify-packaged-runtime.ts',
    extraMetadata:{...base.extraMetadata,ruijieHarnessBuildCommit:HARNESS_RELEASE.commit},
    mac:{...base.mac,identity:null,notarize:false}, files:[...base.files,
    `!**/node_modules/@*/*darwin-${other}*/**`,
    `!**/node_modules/*darwin-${other}*/**`,
    `!**/node_modules/node-pty/prebuilds/darwin-${other}/**`,
  ]};
}

export async function ensureRuijieHarness(
  { sourceRoot, directory = fileURLToPath(new URL('../', import.meta.url)), platform = process.platform, arch } = {},
  { verifySource = verifyHarnessSource, verifyBundle = verifyRuijieHarnessBundle, build = buildRuijieHarness } = {},
) {
  assert(sourceRoot, 'Use --source PATH to the pinned Harness checkout');
  sourceRoot = path.resolve(sourceRoot);
  // This entry is called once to prepare the sidecar and again by the release
  // adapter. Reuse accepts only the same generated assets as the post-build
  // check; buildRuijieHarness still requires a pristine checkout before a build.
  await verifySource(sourceRoot, { allowGeneratedAssets: true });
  try {
    for (const target of harnessTargets(platform, arch)) {
      const bundle = path.join(directory, 'dist-native', 'ruijie-harness', target);
      const manifest = await verifyBundle(bundle, target);
      if (platform === 'darwin' && typeof manifest?.executable === 'string') {
        const actual = execFileSync('/usr/bin/lipo', ['-archs', path.join(bundle, manifest.executable)], {encoding:'utf8'}).trim();
        assert.equal(actual, target.endsWith('-x64') ? 'x86_64' : 'arm64', 'Cached Universal Harness must be rebuilt as a thin sidecar');
        execFileSync('/usr/bin/codesign', ['--verify','--deep','--strict',path.resolve(bundle,manifest.executable,'../../..')],{stdio:'pipe'});
      }
    }
    console.log(`Reused verified Harness ${HARNESS_RELEASE.version} stage for ${platform}`);
    return { reused: true };
  } catch (error) {
    console.log(`No reusable verified Harness stage for ${platform}: ${error.code ?? error.message}`);
  }
  await build({ sourceRoot, directory, platform, arch });
  return { reused: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { parseArgs } = await import('node:util');
  const {values} = parseArgs({options:{source:{type:'string'},arch:{type:'string'}},strict:true});
  await ensureRuijieHarness({ sourceRoot: values.source, arch: values.arch });
}
