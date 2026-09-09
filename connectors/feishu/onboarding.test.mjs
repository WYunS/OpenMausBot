import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, symlink, readFile, link, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createCli } from './cli.mjs';
import { inspectConfigDir, TOOL_SCOPES } from './onboarding.mjs';

const appUrl = 'https://open.feishu.cn/page/cli?user_code=REDACTED&lpv=1.0.93&ocv=1.0.93&from=cli';
const authUrl = 'https://accounts.feishu.cn/oauth/v1/authorize?user_code=REDACTED';
const recoveryUrl = 'https://open.feishu.cn/page/scope-apply?clientID=cli_app&scopes=im%3Amessage.send_as_user';
const app = { appId: 'cli_app', appSecret: '****', brand: 'feishu' };
const complete = { event: 'authorization_complete', user_open_id: 'ou_owner', user_name: 'Owner',
  scope: TOOL_SCOPES, granted: TOOL_SCOPES.split(' '), missing: [], requested: TOOL_SCOPES.split(' '),
  newly_granted: [], already_granted: [], access_token: 'SECRET_ACCESS', refresh_token: 'SECRET_REFRESH' };
const device = (url = authUrl) => ({ event: 'device_authorization', verification_uri_complete: url,
  verification_uri: 'https://evil.example', user_code: 'SECRET_CODE', agent_hint: 'SECRET_HINT', expires_in: 600 });
const options = { onAuthorization: () => {}, isManagedEmpty: () => true };

test('deleted app blocks OAuth with APP_UNAVAILABLE without opening an authorization URL', async (t) => {
  const f = await fixture(t, (child) => {
    child.stderr.write(JSON.stringify({ ok: false,
      error: { type: 'config', subtype: 'invalid_client', code: 20069, message: 'The specified app is not enabled.', secret: 'PRIVATE' } }));
    child.close(3);
  });
  let opens = 0;
  const result = await f.cli.authorize({ onAuthorization: () => { opens++; } });
  assert.deepEqual(result, { ok: false, error: { code: 'APP_UNAVAILABLE' } });
  assert.equal(opens, 0);
});

async function fileSymlink(t, target, destination) {
  try { await symlink(target, destination, 'file'); return true; }
  catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    t.skip('Windows file symlink privilege unavailable; native file-link case not verified');
    return false;
  }
}

async function fixture(t, behavior = () => {}) {
  const configDir = await mkdtemp(join(tmpdir(), 'feishu-onboarding-'));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const calls = [];
  const spawnImpl = (executable, args, launchOptions) => {
    const child = new EventEmitter();
    for (const key of ['stdin', 'stdout', 'stderr']) child[key] = new PassThrough();
    child.signals = [];
    child.kill = (signal) => { child.signals.push(signal); return true; };
    child.close = (code = 0) => child.emit('close', code);
    child.json = (value) => child.stdout.write(`${JSON.stringify(value)}\n`);
    calls.push({ executable, args, options: launchOptions, child });
    queueMicrotask(() => behavior(child, args));
    return child;
  };
  t.after(() => { for (const { child } of calls) child.close(); });
  const cli = createCli({ executable: 'lark-cli.exe', configDir, spawnImpl, env: {} });
  return { configDir, calls, spawnImpl, cli };
}

test('host configDir is validated exactly and never comes from global env', async (t) => {
  for (const configDir of ['', '.', 'relative', '/tmp/../shared', '/tmp/./shared', '/', '/tmp/bad\n', null, 4]) {
    assert.throws(() => createCli({ executable: 'lark-cli.exe', configDir }), { code: 'INVALID_CONFIG_DIR' });
  }
  const f = await fixture(t, (child) => { child.json({ ok: true }); child.close(); });
  const env = { PATH: '/safe', LARKSUITE_CLI_CONFIG_DIR: '/other', larksuite_cli_config_dir: '/other2',
    LARKSUITE_CLI_REMOTE_META: 'on', LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '0', OPENCLAW_HOME: '/other', HERMES_QUIET: '1', LARK_CHANNEL: '1' };
  const cli = createCli({ executable: '/safe/lark-cli.exe', configDir: `${f.configDir}/`, env, spawnImpl: f.spawnImpl });
  await cli.permissions();
  await cli.login();
  await cli.completeLogin('device');
  await cli.inspect();
  await cli.sendReply('om_x', 'text');
  const consumer = cli.consume();
  f.calls.at(-1).child.close();
  await consumer.stop();
  for (const call of f.calls) {
    assert.deepEqual(call.options.env, { PATH: '/safe', LARKSUITE_CLI_CONFIG_DIR: `${f.configDir}/`,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1', LARKSUITE_CLI_REMOTE_META: 'off' });
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
  }
  assert.equal(env.LARKSUITE_CLI_CONFIG_DIR, '/other');
});

test('initialization requires explicit managed-empty assertion and real empty directory', async (t) => {
  const f = await fixture(t);
  const unmanaged = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
  assert.equal((await unmanaged.initialize(options)).error.code, 'PRIVATE_CONFIG_REQUIRED');
  assert.equal((await f.cli.initialize({ onAuthorization() {} })).error.code, 'MANAGED_EMPTY_REQUIRED');
  assert.equal((await f.cli.initialize({ ...options, isManagedEmpty: () => false })).error.code, 'MANAGED_EMPTY_REQUIRED');
  assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'empty' });
  await writeFile(join(f.configDir, 'unrelated'), 'SECRET');
  assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'not_empty' });
  assert.equal((await f.cli.initialize(options)).error.code, 'CONFIG_NOT_EMPTY');
  assert.equal(f.calls.length, 0);
});

test('any existing config, including malformed, empty, directory and dangling symlink, blocks replacement', async (t) => {
  for (const kind of ['malformed', 'empty', 'directory', 'symlink']) {
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      const path = join(f.configDir, 'config.json');
      if (kind === 'directory') await mkdir(path);
      else if (kind === 'symlink') {
        if (!await fileSymlink(t, join(f.configDir, 'missing'), path)) return;
      } else await writeFile(path, kind === 'empty' ? '' : '{SECRET');
      assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'configured' });
      assert.equal((await f.cli.initialize(options)).error.code, 'CONFIG_EXISTS');
      assert.equal(f.calls.length, 0);
    });
  }
  const f = await fixture(t);
  await mkdir(join(f.configDir, 'target'));
  await symlink(join(f.configDir, 'target'), join(f.configDir, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(await inspectConfigDir(join(f.configDir, 'link')), { status: 'unsafe' });
  assert.deepEqual(await inspectConfigDir(join(f.configDir, 'absent')), { status: 'missing' });
});

test('registration streams only the standalone pinned URL once, ignores QR/prose, returns no secrets', async (t) => {
  const f = await fixture(t);
  const opened = Promise.withResolvers();
  const urls = [];
  const pending = f.cli.initialize({ ...options, onAuthorization: async (url) => {
    urls.push(url); opened.resolve(); await delay(5);
  } });
  while (!f.calls.length) await delay(1);
  const child = f.calls[0].child;
  child.stderr.write(`QR SECRET\nOpen ${appUrl}\nhttps://evil.example/page/cli\n`);
  for (const byte of Buffer.from(`  ${appUrl}\r\n`)) child.stderr.write(Buffer.from([byte]));
  await opened.promise;
  assert.deepEqual(urls, [appUrl]);
  child.stderr.write(`  ${appUrl}\n`);
  child.stdout.write(JSON.stringify({ ...app, access_token: 'SECRET_ACCESS' }, null, 2));
  child.close();
  assert.deepEqual(await pending, { appId: 'cli_app', brand: 'feishu' });
  assert.equal(urls.length, 1);
  assert.deepEqual(f.calls[0].args, ['config', 'init', '--new', '--brand=feishu', '--lang=en']);
  assert.equal(f.calls[0].options.env.LARKSUITE_CLI_CONFIG_DIR, f.configDir);
  assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'attempted' });
});

test('registration rejects unsafe or altered URLs and unmasked/malformed stdout', async (t) => {
  for (const url of [appUrl.replace('https:', 'http:'), appUrl.replace('open.feishu.cn', 'open.feishu.cn.evil'),
    appUrl.replace('/page/cli?', '/page/other?'), `${appUrl}&redirect_uri=https://evil`, `${appUrl}&from=cli`,
    `${appUrl}#SECRET`, appUrl.replace('1.0.93', '1.0.94'), appUrl.replace('open.feishu.cn', 'user@open.feishu.cn'),
    appUrl.replace('open.feishu.cn', 'open.feishu.cn:443'), appUrl.replace('/page/cli', '/foo/../page/cli')]) {
    const f = await fixture(t, (child) => { child.stderr.write(`  ${url}\n`); child.json(app); child.close(); });
    let opened = false;
    const result = await f.cli.initialize({ ...options, onAuthorization: () => { opened = true; } });
    assert.equal(opened, false, url);
    assert.equal(result.error.code, 'INVALID_OUTPUT', url);
  }
  for (const output of ['{', JSON.stringify({ ...app, appSecret: 'SECRET' }), `${JSON.stringify(app)}{}`, '{}']) {
    const f = await fixture(t, (child) => { child.stderr.write(`${appUrl}\n`); child.stdout.write(output); child.close(); });
    const result = await f.cli.initialize(options);
    assert.equal(result.error.code, 'INVALID_OUTPUT');
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
});

test('failed/cancelled initialization preserves saved config and app and never repeats --new', async (t) => {
  for (const outcome of ['probe', 'abort', 'timeout']) {
    const f = await fixture(t);
    const controller = new AbortController();
    const pending = f.cli.initialize({ ...options, signal: controller.signal, timeoutMs: 200 });
    while (!f.calls.length) await delay(1);
    const child = f.calls[0].child;
    child.stderr.write(`${appUrl}\n`);
    child.json(app);
    await writeFile(join(f.configDir, 'config.json'), 'SAVED_SECRET');
    if (outcome === 'probe') { child.stderr.write('denied SECRET\n'); child.close(3); }
    if (outcome === 'abort') controller.abort();
    const result = await pending;
    assert.equal(result.error.code, { probe: 'AUTH_REQUIRED', abort: 'ABORTED', timeout: 'TIMEOUT' }[outcome]);
    assert.deepEqual(result.app, { appId: 'cli_app', brand: 'feishu' });
    child.close();
    const restarted = createCli({ executable: 'lark-cli.exe', configDir: f.configDir, spawnImpl: f.spawnImpl });
    assert.equal((await restarted.initialize(options)).error.code, 'CONFIG_EXISTS');
    assert.equal(await readFile(join(f.configDir, 'config.json'), 'utf8'), 'SAVED_SECRET');
    assert.equal(f.calls.length, 1);
  }
});

test('concurrent and uncertain attempts cannot create duplicate apps across wrapper instances', async (t) => {
  const f = await fixture(t, (child) => { child.stderr.write(`${appUrl}\n`); child.close(4); });
  const other = createCli({ executable: 'lark-cli.exe', configDir: f.configDir, spawnImpl: f.spawnImpl });
  const results = await Promise.all([f.cli.initialize(options), other.initialize(options)]);
  assert.equal(f.calls.length, 1);
  assert.ok(results.some((r) => r.error.code === 'INITIALIZATION_UNCERTAIN'));
  assert.equal((await other.initialize(options)).error.code, 'INITIALIZATION_UNCERTAIN');
});

test('OAuth uses one blocking child, opens before exit, and requires full actual grants', async (t) => {
  for (const url of [authUrl, authUrl.replace('feishu.cn', 'larksuite.com'), recoveryUrl,
    recoveryUrl.replace('open.feishu.cn', 'open.larksuite.com')]) {
    const f = await fixture(t);
    const seen = [];
    const pending = f.cli.authorize({ onAuthorization: async (value) => { seen.push(value); await delay(5); } });
    const child = f.calls[0].child;
    for (const byte of Buffer.from(`${JSON.stringify(device(url))}\n`)) child.stdout.write(Buffer.from([byte]));
    assert.deepEqual(seen, [url]);
    child.json(device(url));
    child.json(complete);
    child.close();
    assert.deepEqual(await pending, { complete: true, user: { openId: 'ou_owner', name: 'Owner' },
      granted: TOOL_SCOPES.split(' '), missing: [] });
    assert.deepEqual(f.calls[0].args, ['auth', 'login', `--scope=${TOOL_SCOPES}`, '--json']);
    assert.equal(seen.length, 1);
    assert.equal(JSON.stringify(f.calls[0].args).includes('SECRET'), false);
  }
});

test('partial grants, exit 3 and missing-scope envelopes never report ready or leak raw errors', async (t) => {
  for (const code of [0, 3]) {
    const missing = complete.granted.slice(1);
    const f = await fixture(t, (child) => {
      child.json(device());
      child.json({ ...complete, scope: 'docx:document:readonly', granted: ['docx:document:readonly'],
        newly_granted: ['docx:document:readonly'], missing,
        warning: { type: 'missing_scope', message: 'SECRET', hint: `SECRET ${recoveryUrl}` } });
      child.close(code);
    });
    assert.deepEqual(await f.cli.authorize(options), { ok: false, error: { code: 'SCOPE_REQUIRED', missing } });
  }
  for (const console_url of [recoveryUrl, 'https://evil.example', 'https://open.feishu.cn/app/cli_app',
    `${recoveryUrl}&redirect_uri=https://evil`, recoveryUrl.replace('cli_app', '../secret')]) {
    const f = await fixture(t, (child) => {
      child.stderr.write(`Progress SECRET\n${JSON.stringify({ ok: false, error: {
        type: 'permission', subtype: 'missing_scope', console_url, message: 'SECRET', hint: 'SECRET',
      } }, null, 2)}\n`);
      child.close(3);
    });
    assert.deepEqual(await f.cli.authorize(options), { ok: false, error: { code: 'SCOPE_REQUIRED',
      ...(console_url === recoveryUrl ? { consoleUrl: recoveryUrl } : {}) } });
  }
  const f = await fixture(t, (child) => { child.json(device()); child.json(complete); child.close(3); });
  assert.equal((await f.cli.authorize(options)).error.code, 'AUTH_REQUIRED');
  const empty = await fixture(t, (child) => {
    child.json(device()); child.json({ ...complete, granted: [], scope: '', missing: complete.granted }); child.close(3);
  });
  assert.deepEqual(await empty.cli.authorize(options), { ok: false, error: { code: 'SCOPE_REQUIRED', missing: complete.granted } });
});

test('partial errors expose only pinned missing scopes from consistent granted sets or explicit missing', async (t) => {
  for (const reported of [[], ['SECRET_SCOPE', complete.granted[0], complete.granted[0]]]) {
    const granted = complete.granted.slice(0, -1);
    const f = await fixture(t, (child) => {
      child.json(device());
      child.json({ ...complete, scope: granted.join(' '), granted, missing: reported,
        warning: { type: 'missing_scope', message: 'SECRET', hint: 'https://evil.example/SECRET' } });
      child.close(3);
    });
    const missing = complete.granted.filter((s) => !granted.includes(s) || reported.includes(s));
    assert.deepEqual(await f.cli.authorize(options), { ok: false, error: { code: 'SCOPE_REQUIRED', missing } });
  }
});

test('OAuth rejects malformed events, missing grants, conflicting grants, unsafe URLs and false success', async (t) => {
  for (const value of [{ ...complete, missing: undefined }, { ...complete, granted: undefined },
    { ...complete, scope: 'offline_access' }, { ...complete, user_open_id: '' },
    { ...complete, event: 'unknown' }, { event: 'authorization_failed', error: 'SECRET' }]) {
    const f = await fixture(t, (child) => { child.json(device()); child.json(value); child.close(); });
    const result = await f.cli.authorize(options);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
  for (const url of ['https://evil.example', `${authUrl}#SECRET`, authUrl.replace('https:', 'http:'),
    authUrl.replace('accounts.feishu.cn', 'accounts.feishu.cn:444'), appUrl,
    recoveryUrl.replace('/page/scope-apply', '/page/cli')]) {
    const f = await fixture(t, (child) => { child.json(device(url)); child.json(complete); child.close(); });
    let opened = false;
    assert.equal((await f.cli.authorize({ onAuthorization: () => { opened = true; } })).error.code, 'INVALID_OUTPUT');
    assert.equal(opened, false);
  }
  for (const text of ['SECRET\n', '{}\n', '{', `${JSON.stringify(complete)}\n`,
    `${JSON.stringify(device())}\n${JSON.stringify(complete)}\n{}\n`]) {
    const f = await fixture(t, (child) => { child.stdout.write(text); child.close(); });
    assert.equal((await f.cli.authorize(options)).error.code, 'INVALID_OUTPUT');
  }
});

test('onboarding cancels on callback throw/rejection, abort, timeout, invalid UTF-8 and output limits', async (t) => {
  for (const mode of ['initialize', 'authorize']) {
    for (const outcome of ['throw', 'reject', 'hang', 'abort', 'limit', 'line', 'utf8']) {
      const f = await fixture(t);
      const controller = new AbortController();
      const pending = f.cli[mode]({ ...options, signal: controller.signal, timeoutMs: 100,
        onAuthorization: () => {
          if (outcome === 'throw') throw new Error('SECRET');
          if (outcome === 'reject') return Promise.reject(new Error('SECRET'));
          if (outcome === 'hang') return new Promise(() => {});
        } });
      while (!f.calls.length) await delay(1);
      const child = f.calls[0].child;
      if (mode === 'initialize') child.stderr.write(`${appUrl}\n`);
      else child.json(device());
      if (outcome === 'abort') controller.abort();
      if (outcome === 'limit') child.stderr.write('x\n'.repeat(1024 * 1024));
      if (outcome === 'line') child.stdout.write('x'.repeat(65537));
      if (outcome === 'utf8') child.stdout.write(Buffer.from([0xff]));
      const result = await pending;
      assert.equal(result.error.code, { throw: 'CALLBACK_ERROR', reject: 'CALLBACK_ERROR', hang: 'TIMEOUT',
        abort: 'ABORTED', limit: 'OUTPUT_LIMIT', line: 'OUTPUT_LIMIT', utf8: 'INVALID_OUTPUT' }[outcome]);
      assert.deepEqual(child.signals, ['SIGTERM']);
      child.close();
      if (mode === 'initialize') assert.equal((await f.cli.initialize(options)).error.code, 'INITIALIZATION_UNCERTAIN');
    }
  }
});

test('invalid options and pre-aborted signals do not spawn or reserve the config', async (t) => {
  const f = await fixture(t);
  for (const method of ['initialize', 'authorize']) {
    for (const invalid of [null, [], {}, { ...options, signal: {} }, { ...options, timeoutMs: 0 },
      { ...options, timeoutMs: 600001 }, { ...options, timeoutMs: NaN }]) {
      assert.equal((await f.cli[method](invalid)).error.code, 'INVALID_ARGUMENTS');
    }
    assert.equal((await f.cli[method]({ ...options, signal: AbortSignal.abort() })).error.code, 'ABORTED');
  }
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'empty' });
});

test('permissions and inspect distinguish app-enabled scopes from stored user consent', async (t) => {
  const f = await fixture(t, (child) => {
    child.json({ appId: 'cli_app', brand: 'feishu', tokenType: 'user', userScopes: ['im:message'], count: 1, secret: 'SECRET' });
    child.close();
  });
  assert.deepEqual(await f.cli.permissions(), { appId: 'cli_app', brand: 'feishu', tokenType: 'user', userScopes: ['im:message'] });
  assert.deepEqual(f.calls[0].args, ['auth', 'scopes', '--json']);
  const status = (scope) => ({ appId: 'cli_app', brand: 'feishu', identities: {
    bot: { available: false, status: 'missing' }, user: { available: true, status: 'ready', verified: true,
      openId: 'ou_owner', scope },
  } });
  for (const scope of [TOOL_SCOPES, undefined, 'im:message']) {
    const f = await fixture(t, (child) => { child.json(status(scope)); child.close(); });
    const result = await f.cli.inspect();
    assert.equal(result.botReady, false);
    assert.deepEqual(result.grants, scope === undefined ? null : {
      granted: TOOL_SCOPES.split(' ').filter((s) => scope.split(' ').includes(s)),
      missing: TOOL_SCOPES.split(' ').filter((s) => !scope.split(' ').includes(s)),
    });
  }
});

test('isolated real subprocess streams URL before completion and cancellation closes the child', async (t) => {
  const f = await fixture(t);
  for (const mode of ['initialize', 'authorize']) {
    let child;
    const initial = mode === 'initialize' ? `process.stderr.write(${JSON.stringify(`QR\n  ${appUrl}\n`)});` :
      `process.stdout.write(${JSON.stringify(`${JSON.stringify(device())}\n`)});`;
    const cli = createCli({ executable: 'fixture-native.exe', configDir: f.configDir, env: {},
      spawnImpl: (_executable, _args, opts) => {
        child = spawn(process.execPath, ['-e', `${initial} setInterval(() => {}, 1000);`], opts);
        return child;
      } });
    const controller = new AbortController();
    const opened = Promise.withResolvers();
    const pending = cli[mode]({ ...options, signal: controller.signal, onAuthorization: opened.resolve });
    assert.equal(await opened.promise, mode === 'initialize' ? appUrl : authUrl);
    const closed = once(child, 'close');
    controller.abort();
    assert.equal((await pending).error.code, 'ABORTED');
    await closed;
  }
});

test('isolated real subprocess completes fragmented registration and NDJSON OAuth', async (t) => {
  for (const mode of ['initialize', 'authorize']) {
    const f = await fixture(t);
    const initial = mode === 'initialize' ? `  ${appUrl}\n` : `${JSON.stringify(device())}\n`;
    const output = JSON.stringify(mode === 'initialize' ? app : complete);
    const cli = createCli({ executable: 'fixture-native.exe', configDir: f.configDir, env: {},
      spawnImpl: (_exe, _args, opts) => spawn(process.execPath, ['-e', `
        const stream = process.${mode === 'initialize' ? 'stderr' : 'stdout'};
        stream.write(${JSON.stringify(initial.slice(0, 20))});
        setTimeout(() => stream.write(${JSON.stringify(initial.slice(20))}), 10);
        setTimeout(() => process.stdout.write(${JSON.stringify(output)}), 50);
      `], opts) });
    let opened = false;
    const result = await cli[mode]({ ...options, onAuthorization: () => { opened = true; } });
    assert.equal(opened, true);
    assert.equal(result.ok, undefined);
    assert.equal(mode === 'initialize' ? result.appId : result.user.openId, mode === 'initialize' ? 'cli_app' : 'ou_owner');
  }
});

test('managed-empty callback is bounded and cannot leak arbitrary error objects', async (t) => {
  const f = await fixture(t);
  for (const isManagedEmpty of [() => { throw new Error('SECRET'); }, () => Promise.reject(new Error('SECRET')),
    () => ({ ok: false, error: { code: 'SECRET' } })]) {
    const result = await f.cli.initialize({ ...options, isManagedEmpty });
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
  assert.equal((await f.cli.initialize({ ...options, timeoutMs: 10,
    isManagedEmpty: () => new Promise(() => {}) })).error.code, 'TIMEOUT');
  const controller = new AbortController();
  const pending = f.cli.initialize({ ...options, signal: controller.signal, isManagedEmpty: () => new Promise(() => {}) });
  controller.abort();
  assert.equal((await pending).error.code, 'ABORTED');
  assert.equal(f.calls.length, 0);
});

test('spawn and stream errors are sanitized, callback rejection after close cannot become success', async (t) => {
  const cli = createCli({ executable: 'fixture-native.exe', spawnImpl: () => { throw new Error('SECRET'); } });
  assert.deepEqual(await cli.authorize(options), { ok: false, error: { code: 'SPAWN_FAILED' } });
  for (const target of ['child', 'stdin', 'stdout', 'stderr']) {
    const f = await fixture(t, (child) => {
      (target === 'child' ? child : child[target]).emit('error', new Error('SECRET'));
    });
    assert.equal((await f.cli.authorize(options)).error.code, target === 'child' ? 'SPAWN_FAILED' : 'CLI_IO_ERROR');
    assert.deepEqual(f.calls[0].child.signals, ['SIGTERM']);
  }
  const f = await fixture(t, (child) => { child.json(device()); child.json(complete); child.close(); });
  const callback = Promise.withResolvers();
  const pending = f.cli.authorize({ onAuthorization: () => callback.promise });
  await delay(0);
  callback.reject(new Error('SECRET'));
  assert.equal((await pending).error.code, 'CALLBACK_ERROR');
});

test('onboarding timeout escalates only its child and remains bounded without close', async (t) => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = f.cli.authorize({ ...options, timeoutMs: 10 });
  t.mock.timers.tick(10);
  assert.equal((await pending).error.code, 'TIMEOUT');
  assert.deepEqual(f.calls[0].child.signals, ['SIGTERM']);
  t.mock.timers.tick(1000);
  assert.deepEqual(f.calls[0].child.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(f.calls[0].child.stdout.destroyed, true);
  assert.equal(f.calls[0].child.stderr.destroyed, true);
});

test('known CLI metadata caches are initialization-empty and never modified', async (t) => {
  for (const names of [[], ['remote_meta.meta.json'], ['remote_meta.json', 'remote_meta.meta.json']]) {
    const f = await fixture(t, (child) => { child.stderr.write(`${appUrl}\n`); child.json(app); child.close(); });
    const cache = join(f.configDir, 'cache');
    await mkdir(cache);
    for (const name of names) await writeFile(join(cache, name), 'OPAQUE_METADATA');
    assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'empty' });
    assert.deepEqual(await f.cli.initialize(options), { appId: 'cli_app', brand: 'feishu' });
    for (const name of names) assert.equal(await readFile(join(cache, name), 'utf8'), 'OPAQUE_METADATA');
  }
});

test('cache, log and marker links, unknown files and non-owned contents block even explicit recovery', async (t) => {
  for (const kind of ['cache-link', 'cache-file', 'unknown-cache', 'metadata-link', 'metadata-hardlink',
    'logs-link', 'logs-file', 'unknown-log', 'auth-log-hardlink', 'auth-log-directory',
    'metadata-directory', 'marker-link', 'marker-hardlink', 'marker-directory', 'marker-content']) {
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      const cache = join(f.configDir, 'cache');
      const marker = join(f.configDir, '.tuantuan-init-attempt');
      const elsewhere = await mkdtemp(join(tmpdir(), 'feishu-marker-target-'));
      t.after(() => rm(elsewhere, { recursive: true, force: true }));
      const target = join(elsewhere, 'target');
      await writeFile(target, 'KEEP', { mode: 0o600 });
      if (kind === 'cache-link') await symlink(elsewhere, cache, process.platform === 'win32' ? 'junction' : 'dir');
      else if (kind === 'cache-file') await writeFile(cache, 'KEEP');
      else if (kind.startsWith('logs') || kind === 'unknown-log' || kind.startsWith('auth-log')) {
        const logs = join(f.configDir, 'logs');
        if (kind === 'logs-link') await symlink(elsewhere, logs, process.platform === 'win32' ? 'junction' : 'dir');
        else if (kind === 'logs-file') await writeFile(logs, 'KEEP');
        else {
          await mkdir(logs);
          const log = join(logs, kind === 'unknown-log' ? 'unknown.log' : 'auth-2026-09-09.log');
          if (kind === 'auth-log-hardlink') await link(target, log);
          else if (kind === 'auth-log-directory') await mkdir(log);
          else await writeFile(log, 'KEEP');
        }
      }
      else if (kind.startsWith('marker')) {
        if (kind === 'marker-link' && !await fileSymlink(t, target, marker)) return;
        if (kind === 'marker-hardlink') await link(target, marker);
        if (kind === 'marker-directory') await mkdir(marker);
        if (kind === 'marker-content') await writeFile(marker, 'KEEP', { mode: 0o600 });
      } else {
        await mkdir(cache);
        const metadata = join(cache, 'remote_meta.meta.json');
        if (kind === 'unknown-cache') await writeFile(join(cache, 'unknown'), 'KEEP');
        if (kind === 'metadata-link' && !await fileSymlink(t, target, metadata)) return;
        if (kind === 'metadata-hardlink') await link(target, metadata);
        if (kind === 'metadata-directory') await mkdir(metadata);
      }
      const result = await f.cli.initialize({ ...options, retryUncertain: true });
      assert.equal(result.error.code, 'CONFIG_NOT_EMPTY', kind);
      assert.equal(f.calls.length, 0);
      assert.equal(await readFile(target, 'utf8'), 'KEEP');
    });
  }
});

test('spawn throws and native ENOENT permit a safe retry with no permanent marker', async (t) => {
  for (const kind of ['throw', 'enoent']) {
    const f = await fixture(t);
    const cli = createCli({ executable: join(f.configDir, 'nonexistent-native.exe'), configDir: f.configDir, env: {},
      ...(kind === 'throw' ? { spawnImpl: () => { throw new Error('SECRET'); } } : {}) });
    for (let i = 0; i < 2; i++) {
      assert.equal((await cli.initialize(options)).error.code, 'SPAWN_FAILED');
      assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'empty' });
    }
  }
});

test('closed begin failure before authorization clears only its own marker and retries', async (t) => {
  const f = await fixture(t, (child) => {
    child.stderr.write(JSON.stringify({ ok: false, error: { type: 'network', subtype: 'transport', message: 'SECRET' } }));
    child.close(4);
  });
  await mkdir(join(f.configDir, 'cache'));
  await writeFile(join(f.configDir, 'cache', 'remote_meta.meta.json'), 'KEEP');
  for (let i = 0; i < 2; i++) {
    assert.equal((await f.cli.initialize(options)).error.code, 'CLI_NETWORK_ERROR');
    assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'empty' });
  }
  assert.equal(f.calls.length, 2);
  assert.equal(await readFile(join(f.configDir, 'cache', 'remote_meta.meta.json'), 'utf8'), 'KEEP');
});

test('after URL emission only explicit uncertain retry can replace the owned marker', async (t) => {
  const f = await fixture(t, (child) => { child.stderr.write(`${appUrl}\n`); child.close(4); });
  assert.equal((await f.cli.initialize(options)).error.code, 'CLI_NETWORK_ERROR');
  const marker = join(f.configDir, '.tuantuan-init-attempt');
  const previous = await readFile(marker, 'utf8');
  assert.match(previous, /^tuantuan-init-v1:/);
  assert.equal(previous.includes('REDACTED'), false);
  for (const retryUncertain of [undefined, false]) {
    assert.equal((await f.cli.initialize({ ...options, retryUncertain })).error.code, 'INITIALIZATION_UNCERTAIN');
  }
  assert.equal(f.calls.length, 1);
  assert.equal((await f.cli.initialize({ ...options, retryUncertain: true })).error.code, 'CLI_NETWORK_ERROR');
  assert.notEqual(await readFile(marker, 'utf8'), previous);
  assert.equal(f.calls.length, 2);
  await writeFile(join(f.configDir, 'config.json'), '{malformed SECRET');
  assert.equal((await f.cli.initialize({ ...options, retryUncertain: true })).error.code, 'CONFIG_EXISTS');
  assert.equal(f.calls.length, 2);
});

test('explicit recovery tolerates the CLI auth log created by the interrupted browser flow', async (t) => {
  let f;
  f = await fixture(t, async (child) => {
    const logs = join(f.configDir, 'logs');
    await mkdir(logs, { recursive: true });
    await writeFile(join(logs, 'auth-2026-09-09.log'), 'CLI LOG');
    child.stderr.write(`${appUrl}\n`);
    child.close(4);
  });
  assert.equal((await f.cli.initialize(options)).error.code, 'CLI_NETWORK_ERROR');
  assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'attempted' });
  assert.equal((await f.cli.initialize({ ...options, retryUncertain: true })).error.code, 'CLI_NETWORK_ERROR');
  assert.equal(f.calls.length, 2);
});

test('explicit recovery supports shipped empty marker but cannot race a live cancelled child', async (t) => {
  const f = await fixture(t);
  const marker = join(f.configDir, '.tuantuan-init-attempt');
  await writeFile(marker, '', { mode: 0o600 });
  const controller = new AbortController();
  const pending = f.cli.initialize({ ...options, retryUncertain: true, signal: controller.signal });
  while (!f.calls.length) await delay(1);
  f.calls[0].child.stderr.write(`${appUrl}\n`);
  controller.abort();
  assert.equal((await pending).error.code, 'ABORTED');
  const other = createCli({ executable: 'lark-cli.exe', configDir: f.configDir, spawnImpl: f.spawnImpl });
  assert.equal((await other.initialize({ ...options, retryUncertain: true })).error.code, 'INITIALIZATION_UNCERTAIN');
  f.calls[0].child.close();
  assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'attempted' });
});

test('cleanup refuses replaced markers and keeps the original safe error with a warning', async (t) => {
  const f = await fixture(t);
  const pending = f.cli.initialize(options);
  while (!f.calls.length) await delay(1);
  const marker = join(f.configDir, '.tuantuan-init-attempt');
  const replacement = 'tuantuan-init-v1:00000000-0000-0000-0000-000000000000\n';
  await writeFile(marker, replacement);
  f.calls[0].child.close(4);
  assert.deepEqual(await pending, { ok: false, error: { code: 'CLI_NETWORK_ERROR' }, warning: { code: 'INITIALIZATION_UNCERTAIN' } });
  assert.equal(await readFile(marker, 'utf8'), replacement);
  assert.equal((await lstat(marker)).nlink, 1);
});

test('an app result without a URL and late malformed output remain uncertain', async (t) => {
  const f = await fixture(t, (child) => {
    child.json(app);
    child.stdout.write('BROKEN');
    child.close(4);
  });
  assert.equal((await f.cli.initialize(options)).error.code, 'CLI_NETWORK_ERROR');
  assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'attempted' });
  assert.equal((await f.cli.initialize(options)).error.code, 'INITIALIZATION_UNCERTAIN');
});

test('late ENOENT close cannot release a newer initialization lock', async (t) => {
  const f = await fixture(t);
  const first = f.cli.initialize(options);
  while (f.calls.length < 1) await delay(1);
  const old = f.calls[0].child;
  old.emit('error', Object.assign(new Error('SECRET'), { code: 'ENOENT' }));
  assert.equal((await first).error.code, 'SPAWN_FAILED');
  const next = f.cli.initialize(options);
  while (f.calls.length < 2) await delay(1);
  old.close();
  assert.equal((await f.cli.initialize({ ...options, retryUncertain: true })).error.code, 'INITIALIZATION_UNCERTAIN');
  f.calls[1].child.close(4);
  assert.equal((await next).error.code, 'CLI_NETWORK_ERROR');
});

test('pinned denial and expiry errors map safely and preserve missing scopes with a terminal error', async (t) => {
  for (const [message, subtype, code] of [
    ['app registration denied by user', 'unknown', 'AUTH_DENIED'],
    ['SECRET', 'token_expired', 'AUTH_EXPIRED'],
    ['denied SECRET', 'unknown', 'AUTH_REQUIRED'],
  ]) {
    const f = await fixture(t, (child) => {
      child.stderr.write(`${appUrl}\n${JSON.stringify({ ok: false, error: { type: 'authentication', subtype, message } })}`);
      child.close(3);
    });
    assert.equal((await f.cli.initialize(options)).error.code, code);
    assert.equal((await f.cli.initialize(options)).error.code, 'INITIALIZATION_UNCERTAIN');
  }
  for (const [error, code] of [['Authorization denied by user', 'AUTH_DENIED'],
    ['Device code expired, please try again', 'AUTH_EXPIRED'],
    ['Authorization timed out, please try again', 'AUTH_EXPIRED'], ['denied SECRET', 'AUTH_REQUIRED']]) {
    const f = await fixture(t, (child) => {
      child.json(device()); child.json({ event: 'authorization_failed', error }); child.close(3);
    });
    assert.deepEqual(await f.cli.authorize(options), { ok: false, error: { code } });
  }
  const f = await fixture(t, (child) => {
    child.json(device());
    const granted = complete.granted.slice(0, -1);
    child.json({ ...complete, scope: granted.join(' '), granted, newly_granted: granted,
      missing: complete.granted.slice(-1),
      warning: { type: 'missing_scope', message: 'SECRET', hint: `SECRET ${recoveryUrl}` } });
    child.stderr.write(JSON.stringify({ ok: false, error: { type: 'permission', subtype: 'missing_scope', message: 'SECRET' } }));
    child.close(3);
  });
  assert.deepEqual(await f.cli.authorize(options), { ok: false, error: { code: 'SCOPE_REQUIRED', missing: complete.granted.slice(-1) } });
});

test('real fixture probes leave known metadata but initialization and retry still work', async (t) => {
  const f = await fixture(t);
  const cli = createCli({ executable: 'fixture-native.exe', configDir: f.configDir, env: {},
    spawnImpl: (_exe, args, opts) => spawn(process.execPath, ['-e', `
      const fs = require('node:fs'); const path = require('node:path');
      if (process.env.LARKSUITE_CLI_REMOTE_META !== 'off') process.exit(99);
      const cache = path.join(process.env.LARKSUITE_CLI_CONFIG_DIR, 'cache');
      fs.mkdirSync(cache, { recursive: true });
      fs.writeFileSync(path.join(cache, 'remote_meta.meta.json'), 'KEEP');
      if (${JSON.stringify(args[0])} === '--version') console.log('lark-cli version 1.0.93');
      else { console.error(JSON.stringify({ok:false,error:{type:'network',subtype:'transport'}})); process.exitCode=4; }
    `], opts) });
  assert.equal((await cli.version()).supported, true);
  for (let i = 0; i < 2; i++) {
    assert.equal((await cli.initialize(options)).error.code, 'CLI_NETWORK_ERROR');
    assert.deepEqual(await inspectConfigDir(f.configDir), { status: 'empty' });
  }
});
