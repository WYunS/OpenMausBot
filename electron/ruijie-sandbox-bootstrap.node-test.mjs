import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installSandboxPreset, readSandboxPreset, validateSandboxPreset, writePrivateJson, SANDBOX_PRESET_MARKER } from './ruijie-sandbox-bootstrap.mjs';
import { prepareSandboxBootstrap, verifySandboxBootstrap, sandboxStagedPath } from '../scripts/prepare-ruijie-sandbox-bootstrap.mjs';
import { workspaceCredentialEnv, workspaceCredentialSyncMessage, applyWorkspaceCredentialSyncMessage } from './workspace-credentials.mjs';

const preset = { schemaVersion: 1, managerUrl: 'http://127.0.0.1:12345',
  requestJson: JSON.stringify({ client_id: 'fixture-client', vnc_key: 'fixture-secret', minio_url: 'http://fixture.invalid', attach_only: true }) };
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'ruijie-preset-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const presetPath = path.join(root, 'release-inputs', 'ruijie-sandbox.json');
  const configPath = path.join(root, 'profile', 'config.json');
  writePrivateJson(presetPath, preset);
  let saved = { personalAccount: { token: 'do-not-export' } };
  let writes = 0;
  return { root, configPath, presetPath,
    read: () => structuredClone(saved), writes: () => writes,
    async boot(overrides = {}) {
      return installSandboxPreset({ presetPath, configPath, credentials: saved,
        saveCredentials: async (value) => { saved = structuredClone(value); writes++; }, ...overrides });
    } };
}

test('first boot seeds only sandbox, preserves accounts, and server receives credentials privately', async (t) => {
  const f = fixture(t);
  const result = await f.boot();
  assert.equal(result.status, 'installed');
  assert.deepEqual(f.read().personalAccount, { token: 'do-not-export' });
  assert.deepEqual(JSON.parse(readFileSync(f.configPath)), { ruijieSandbox: { managerUrl: preset.managerUrl } });
  assert(!readFileSync(f.configPath, 'utf8').includes('fixture-secret'));
  assert.deepEqual(workspaceCredentialEnv(f.read()), { OMB_RUIJIE_SANDBOX_REQUEST_JSON: preset.requestJson });
  const target = {}, environment = {};
  const message = workspaceCredentialSyncMessage(f.read(), result.managerUrl);
  assert(!JSON.stringify(message).includes('do-not-export'));
  assert(applyWorkspaceCredentialSyncMessage(message, { target, environment }));
  assert.deepEqual(target.ruijieSandbox, { managerUrl: preset.managerUrl, requestJson: preset.requestJson });
  const writes = f.writes();
  assert.equal((await f.boot()).status, 'handled');
  assert.equal(f.writes(), writes);
  // User clearing their saved credential never resurrects the bundled secret.
  const cleared = f.read(); delete cleared.ruijieSandboxRequestJson;
  assert.equal((await f.boot({ credentials: cleared })).credentials.ruijieSandboxRequestJson, undefined);
});

test('existing and deliberately cleared sandbox settings are preserved', async (t) => {
  for (const settings of [{ managerUrl: 'https://custom.example' }, { managerUrl: '', requestJson: '' }, {}]) {
    const f = fixture(t);
    writePrivateJson(f.configPath, { ruijieSandbox: settings, unrelated: 'keep' });
    assert.equal((await f.boot()).status, 'preserved');
    assert.deepEqual(JSON.parse(readFileSync(f.configPath)), { ruijieSandbox: settings, unrelated: 'keep' });
    assert.equal(f.read().ruijieSandboxRequestJson, undefined);
  }
  const f = fixture(t);
  assert.equal((await f.boot({ credentials: { ruijieSandboxRequestJson: 'custom' } })).status, 'preserved');
});

test('unavailable store and failed encryption never replace saved credentials or config', async (t) => {
  const f = fixture(t);
  assert.equal((await f.boot({ storeAvailable: false })).status, 'unavailable');
  const result = await f.boot({ saveCredentials: async () => { throw new Error('fixture-secret'); } });
  assert.equal(result.status, 'retry');
  assert(!existsSync(f.configPath));
  assert.equal(f.writes(), 0);
  assert(!JSON.stringify(result).includes('fixture-secret'));
  assert.equal((await f.boot()).status, 'installed');
});

test('partial import resumes original preset without overwriting a newer installer/user choice', async (t) => {
  const f = fixture(t);
  const failed = await f.boot({ saveConfig: () => { throw new Error('disk full'); } });
  assert.equal(failed.status, 'retry');
  assert.deepEqual(failed.credentials, f.read(), 'caller must keep last durable snapshot');
  assert.equal(f.read()[SANDBOX_PRESET_MARKER].state, 'pending');
  writePrivateJson(f.presetPath, { ...preset, managerUrl: 'https://new-preset.example' });
  assert.equal((await f.boot()).status, 'installed');
  assert.equal(JSON.parse(readFileSync(f.configPath)).ruijieSandbox.managerUrl, preset.managerUrl);
  const g = fixture(t);
  await g.boot({ saveConfig: () => { throw new Error('disk full'); } });
  writePrivateJson(g.configPath, { ruijieSandbox: { managerUrl: 'https://user-choice.example' } });
  await g.boot();
  assert.equal(JSON.parse(readFileSync(g.configPath)).ruijieSandbox.managerUrl, 'https://user-choice.example');
});

test('bad existing config is not overwritten and input validation never echoes secrets', async (t) => {
  const f = fixture(t);
  writePrivateJson(f.configPath, []);
  assert.equal((await f.boot()).status, 'retry');
  assert.equal(f.writes(), 0);
  for (const invalid of [{ ...preset, sso: 'private' }, { ...preset, managerUrl: 'http://user:fixture-secret@localhost' },
    { ...preset, managerUrl: 'https://host/path' }, { ...preset, requestJson: 'fixture-secret' },
    { ...preset, requestJson: '{}' }, { ...preset, schemaVersion: 2 }]) {
    assert.throws(() => validateSandboxPreset(invalid), (error) => !error.message.includes('fixture-secret'));
  }
  assert.throws(() => validateSandboxPreset({ ...preset, requestJson: JSON.stringify({
    ...JSON.parse(preset.requestJson), models: { api_key: 'must-not-ship' },
  }) }), /Invalid sandbox preset/);
});

test('build requires private connection input and rejects changed/stale staging', (t) => {
  const f = fixture(t);
  const digest = prepareSandboxBootstrap(f.root);
  assert.equal(verifySandboxBootstrap(f.root), digest);
  assert.deepEqual(readSandboxPreset(sandboxStagedPath(f.root)), preset);
  writePrivateJson(f.presetPath, { ...preset, managerUrl: 'https://changed.example' });
  assert.throws(() => verifySandboxBootstrap(f.root), /changed/);
  rmSync(f.presetPath);
  assert.throws(() => prepareSandboxBootstrap(f.root), /private/);
});
