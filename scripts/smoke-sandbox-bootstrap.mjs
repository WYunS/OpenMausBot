// Real OS encryption + real packaged utility server in a disposable profile.
// Never connects to the live sandbox and never imports the private build input.
import assert from 'node:assert/strict';
import { app, safeStorage, utilityProcess } from 'electron';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopSandboxPresetPath, installSandboxPreset, writePrivateJson } from '../electron/ruijie-sandbox-bootstrap.mjs';
import { readSecureCredentials } from '../electron/secure-credentials.mjs';
import { workspaceCredentialEnv, workspaceCredentialSyncMessage } from '../electron/workspace-credentials.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), 'ruijie-sandbox-native-smoke-'));
app.setPath('userData', path.join(temporary, 'electron'));
const watchdog = setTimeout(() => { console.error('Sandbox fixture timed out'); app.exit(1); }, 50_000);
void (async () => {
  let child, failure;
  const manager = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/task/fixture-desktop') { res.writeHead(404).end(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ task_id: 'fixture-desktop', status: 'finished', vnc_proxy: 'http://127.0.0.1/fixture-vnc' }));
  });
  try {
    await app.whenReady();
    assert(await safeStorage.isAsyncEncryptionAvailable(), 'Native secure storage unavailable; this is not a pass');
    manager.listen(0, '127.0.0.1'); await once(manager, 'listening');
    const preview = process.argv.includes('--preview');
    const presetPath = desktopSandboxPresetPath({ packaged: !preview, built: true, ownsLocalServer: true,
      resourcesPath: path.join(temporary, 'resources'), appRoot: temporary });
    const configPath = path.join(temporary, 'data', 'config.json');
    const credentialFile = path.join(temporary, 'credentials.bin');
    const template = JSON.stringify({ client_id: 'fixture-desktop', vnc_key: 'synthetic-cua-secret', minio_url: 'http://fixture.invalid', attach_only: true });
    writePrivateJson(presetPath, { schemaVersion: 1, managerUrl: `http://127.0.0.1:${manager.address().port}`, requestJson: template });
    writePrivateJson(configPath, { ...(preview ? { ruijieSandbox: { managerUrl: `http://127.0.0.1:${manager.address().port}` } } : {}),
      instances: { verification: { driver: 'claudeAgent', enabled: true,
      config: { cli: path.join(root, 'server', 'testing', 'fake-claude-cli.ts') } } } });
    let writes = 0;
    const saveCredentials = async (value) => {
      writeFileSync(credentialFile, await safeStorage.encryptStringAsync(JSON.stringify(value)), { mode: 0o600 }); writes++;
    };
    const first = await installSandboxPreset({ presetPath, configPath,
      credentials: { fixtureUnrelatedAccount: 'keep-me' }, saveCredentials });
    assert.equal(first.status, 'installed');
    assert(!readFileSync(credentialFile).includes(Buffer.from('synthetic-cua-secret')));
    assert(!readFileSync(configPath, 'utf8').includes('synthetic-cua-secret'));
    const loaded = await readSecureCredentials({ exists: () => true, isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      readFile: () => readFileSync(credentialFile), decrypt: (bytes) => safeStorage.decryptStringAsync(bytes), sleep: async () => {} });
    assert.equal(loaded.status, 'ok');
    assert.equal(loaded.credentials.fixtureUnrelatedAccount, 'keep-me');
    const count = writes;
    assert.equal((await installSandboxPreset({ presetPath, configPath, credentials: loaded.credentials, saveCredentials })).status, 'handled');
    assert.equal(writes, count);
    const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
    const staged = path.join(temporary, 'server');
    cpSync(path.join(root, 'dist-server'), staged, { recursive: true });
    child = utilityProcess.fork(path.join(staged, 'index.js'), [], {
      cwd: temporary, stdio: 'pipe', env: {
        SystemRoot: process.env.SystemRoot, PATH: process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin',
        HOME: temporary, USERPROFILE: temporary, APPDATA: path.join(temporary, 'roaming'), LOCALAPPDATA: path.join(temporary, 'local'),
        XDG_CONFIG_HOME: path.join(temporary, '.config'), OMB_DATA_DIR: path.dirname(configPath),
        OMB_PORT: String(port), OMB_WEBHOOK_PORT: '0',
        RUIJIE_HARNESS_EXECUTABLE: path.join(temporary, 'missing-harness'), ...workspaceCredentialEnv(loaded.credentials),
      },
    });
    let logs = '';
    child.stdout?.on('data', (data) => { logs += data; });
    child.stderr?.on('data', (data) => { logs += data; });
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline) {
      try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* starting */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, `Isolated packaged server failed to start: ${logs.slice(-2000)}`);
    child.postMessage(workspaceCredentialSyncMessage(loaded.credentials));
    for (const name of ['Bootstrap fixture A', 'Bootstrap fixture B']) {
      const response = await fetch(`${base}/api/bots`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }), signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 201);
      const { bot } = await response.json();
      assert.equal(bot.computer, 'cloud'); assert.equal(bot.cloudBackend, 'ruijie-sandbox');
      const status = await (await fetch(`${base}/api/bots/${bot.id}/computer`, { signal: AbortSignal.timeout(5000) })).json();
      assert.equal(status.configured, true); assert.equal(status.ready, true); assert.equal(status.taskId, 'fixture-desktop');
    }
    const cleared = { ...loaded.credentials }; delete cleared.ruijieSandboxRequestJson;
    assert.equal((await installSandboxPreset({ presetPath, configPath, credentials: cleared, saveCredentials })).credentials.ruijieSandboxRequestJson, undefined);
    console.log(JSON.stringify({ ok: true, platform: process.platform, mode: preview ? 'preview-incomplete-config' : 'packaged-first-install', checks: [
      'real OS encryption and reload', 'no plaintext credential in profile config', 'unrelated accounts preserved',
      'second launch idempotent', 'real utility process with copied dist-server', 'two new bots default to shared sandbox',
      'synthetic sandbox status ready without manual setup', 'explicit clear stays cleared',
    ] }));
  } catch (error) { failure = error; console.error(error); }
  finally {
    if (child) { const exited = once(child, 'exit'); child.kill(); await exited; }
    manager.closeAllConnections(); await new Promise((resolve) => manager.close(resolve));
    clearTimeout(watchdog);
    try { rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch { console.error('Fixture profile still held by Electron; temporary path:', temporary); }
    app.exit(failure ? 1 : 0);
  }
})();
