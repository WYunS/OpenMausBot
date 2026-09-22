// Exercise production Harness discovery in a real Electron utility process.
// No Harness launch, login, model request, or access to the user's workspace.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const script = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));

if (process.type === 'utility') {
  const [bundle, fixture] = process.argv.slice(2);
  const { createRuijieHarnessLocator, RuijieHarnessDormantError } = await import(pathToFileURL(path.join(fixture, 'locator.mjs')));
  const locator = createRuijieHarnessLocator();
  try {
    try {
      await locator.ensureEndpoint({ bundledRoot: bundle, bridgePath: path.join(fixture, 'unused-bridge.json'), autoLaunch: false });
    } catch (error) {
      if (!(error instanceof RuijieHarnessDormantError)) throw error;
    }
    console.log('Electron utility process detects the verified Harness bundle without launching it');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally { await locator.dispose(); }
  process.exit(process.exitCode ?? 0);
} else if (process.versions.electron) {
  const { app, utilityProcess } = require('electron');
  const [bundle, fixture] = process.argv.slice(2);
  app.setPath('userData', path.join(fixture, 'electron'));
  void app.whenReady().then(() => {
    const child = utilityProcess.fork(script, [bundle, fixture], { stdio: 'pipe' });
    child.stdout.on('data', chunk => process.stdout.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    const timeout = setTimeout(() => { child.kill(); app.exit(1); }, 30_000);
    child.on('exit', code => { clearTimeout(timeout); app.exit(code ?? 1); });
  }).catch(error => { console.error(error.message); app.exit(1); });
} else {
  const bundle = path.resolve(process.argv[2] ?? path.join(root, 'dist-native/ruijie-harness', `${process.platform}-${process.arch}`));
  const fixture = await mkdtemp(path.join(tmpdir(), 'harness-electron-discovery-'));
  try {
    await mkdir(path.join(fixture, 'electron'));
    const { build } = await import('esbuild');
    await build({ entryPoints: [path.join(root, 'server/drivers/ruijie-harness-local.ts')],
      outfile: path.join(fixture, 'locator.mjs'), bundle: true, platform: 'node', format: 'esm' });
    const env = {};
    for (const key of ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH', 'TEMP', 'TMP']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    Object.assign(env, { HOME: fixture, USERPROFILE: fixture, APPDATA: fixture, LOCALAPPDATA: fixture, XDG_CONFIG_HOME: fixture });
    const child = spawn(require('electron'), [script, bundle, fixture], { cwd: fixture, env, stdio: 'inherit', windowsHide: true });
    const deadline = setTimeout(() => child.kill(), 45_000);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); })
      .finally(() => clearTimeout(deadline));
    assert.equal(code, 0, 'Harness must be discoverable in the same Electron process type as the desktop server');
  } finally { await rm(fixture, { recursive: true, force: true }); }
}
