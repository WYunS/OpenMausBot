import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConnector } from './index.mjs';
import { createCli } from './cli.mjs';
import { createRecoveryContext } from './runtime.mjs';
import { TOOL_SCOPES } from './onboarding.mjs';
import { TOOL_DEFINITIONS } from './tools.mjs';

test('deleted-app recovery resumes verified browser consent after a tool startup failure without another setup prompt', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tuantuan-app-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const old = path.join(root, 'context');
  await mkdir(old);
  const originalBytes = '{"fixture":"old deleted app - retain"}';
  await writeFile(path.join(old, 'config.json'), originalBytes);
  const cliPath = path.join(root, 'lark-cli.exe');
  let disk = { configDir: old, cliPath, nodePath: process.execPath,
    appId: 'cli_old', ownerOpenId: 'ou_old_app_scoped', botId: 'fixture_bot', threadId: 'fixture_thread', records: [] };
  let entry;
  let created = 0;
  let authorized = false;
  let authCalls = 0;
  let preAuthScopeQueries = 0;
  let approvals = 0;
  let toolStartupReady = false;
  const browserStages = [];
  const transport = (directory) => (executable, args, options) => {
    assert.equal(executable, cliPath);
    assert.equal(options.shell, false);
    assert.equal(options.env.LARKSUITE_CLI_CONFIG_DIR, directory);
    const child = new EventEmitter();
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill: () => { child.emit('close', null); return true; } });
    queueMicrotask(async () => {
      try {
        child.emit('spawn');
        const emit = (value) => child.stdout.write(JSON.stringify(value) + '\n');
        if (args[0] === '--version') child.stdout.write('lark-cli version 1.0.93\n');
        else if (args[0] === 'auth' && args[1] === 'status') {
          if (directory === old) {
            emit({ appId: 'cli_old', brand: 'feishu', identities: {
              bot: { available: false, status: 'verify_failed', verified: false,
                message: 'Bot identity: verify failed: The specified app is not enabled.' },
              user: { available: false, status: 'missing', openId: 'ou_old_app_scoped' },
            } });
          } else {
            let configured = false;
            try { configured = !!await readFile(path.join(directory, 'config.json')); } catch { /* New empty context. */ }
            if (!configured) {
              child.stderr.write(JSON.stringify({ ok: false, error: { type: 'config', subtype: 'not_configured' } }));
              child.emit('close', 3);
              return;
            }
            emit({ appId: 'cli_new', brand: 'feishu', identities: {
              bot: { available: true, status: 'ready', verified: true },
              user: { available: authorized, status: authorized ? 'ready' : 'missing', verified: authorized,
                openId: 'ou_new_app_scoped', scope: authorized ? TOOL_SCOPES : '' },
            } });
          }
        } else if (args[0] === 'auth' && args[1] === 'scopes') {
          if (!authorized) preAuthScopeQueries++;
          emit({ appId: 'cli_new', brand: 'feishu', tokenType: 'user', userScopes: TOOL_SCOPES.split(' '), count: TOOL_SCOPES.split(' ').length });
        } else if (args[0] === 'config') {
          created++;
          assert.equal(directory === old, false);
          assert.equal(disk.appId, 'cli_old');
          child.stderr.write('https://open.feishu.cn/page/cli?user_code=FIXTURE&lpv=1.0.93&ocv=1.0.93&from=cli\n');
          await writeFile(path.join(directory, 'config.json'), '{"fixture":"new app"}');
          emit({ appId: 'cli_new', appSecret: '****', brand: 'feishu' });
        } else if (args[0] === 'auth' && args[1] === 'login') {
          authCalls++;
          emit({ event: 'device_authorization', verification_uri_complete: 'https://accounts.feishu.cn/device?user_code=FIXTURE' });
          emit({ event: 'authorization_complete', user_open_id: 'ou_new_app_scoped',
            scope: TOOL_SCOPES, granted: TOOL_SCOPES.split(' '), missing: [],
            access_token: 'FIXTURE_SECRET_MUST_NOT_PERSIST' });
          authorized = true;
        } else assert.fail('unexpected fixture CLI operation');
        child.emit('close', 0);
      } catch (error) { child.emit('error', error); child.emit('close', 1); }
    });
    return child;
  };
  const make = () => createConnector({
    mcpPath: path.join(root, 'mcp.mjs'),
    store: { load: async () => structuredClone(disk), save: async (value) => {
      assert.doesNotMatch(JSON.stringify(value), /FIXTURE_SECRET|user_code/);
      disk = structuredClone(value);
    } },
    kernel: {
      bots: async () => [{ id: 'fixture_bot', threadId: 'fixture_thread', tasks: [{ threadId: 'fixture_thread' }] }],
      request: async (route, options = {}) => {
        if (route === '/api/mcp/servers' && options.method === 'POST') entry = options.body;
        else if (route.endsWith('/test')) return { ok: toolStartupReady, tools: TOOL_DEFINITIONS };
        else if (options.method === 'PATCH') entry.enabled = options.body.enabled;
        else if (options.method === 'PUT') entry = { name: 'tuantuan-feishu', ...options.body };
        return { servers: entry ? [entry] : [] };
      },
    },
    prepareRuntime: async ({ existing }) => ({ cliPath, nodePath: process.execPath, configDir: existing.configDir }),
    createRecoveryContext: ({ signal }) => createRecoveryContext({ root, signal }),
    createCliImpl: ({ configDir }) => {
      const cli = createCli({ executable: cliPath, configDir, spawnImpl: transport(configDir), env: {} });
      return { ...cli, consume: ({ onReady }) => { onReady(); return { stop() {} }; } };
    },
    validateNode: async () => true,
    confirm: async () => {
      approvals++;
      return false;
    },
    openExternal: async (url) => browserStages.push(new URL(url).pathname),
  });
  const first = make();
  t.after(() => first.close());
  assert.equal((await first.invoke('oneClickConnect')).errorCode, 'APP_UNAVAILABLE');
  assert.equal(authCalls, 0);
  assert.equal((await first.invoke('recreateApp')).phase, 'error');
  assert.equal(preAuthScopeQueries, 1, 'new app preflight is reused within this connection, not queried twice before OAuth');
  assert.equal(disk.appId, 'cli_old');
  assert.equal(disk.recovery.appId, 'cli_new');
  const staged = disk.recovery.configDir;
  await first.close();
  toolStartupReady = true;
  const restarted = make();
  t.after(() => restarted.close());
  const result = await restarted.invoke('oneClickConnect');
  assert.equal(result.phase, 'ready');
  assert.equal(disk.configDir, staged);
  assert.equal(disk.appId, 'cli_new');
  assert.equal(disk.ownerOpenId, 'ou_new_app_scoped');
  assert.equal(disk.recovery, undefined);
  assert.equal(created, 1);
  assert.equal(authCalls, 1, 'verified complete consent is reused after restart');
  assert.equal(approvals, 0);
  assert.deepEqual(browserStages, ['/page/cli', '/device']);
  assert.equal(await readFile(path.join(old, 'config.json'), 'utf8'), originalBytes);
});
