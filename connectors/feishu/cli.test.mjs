import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createCli } from './cli.mjs';
import { validateTool } from './tools.mjs';

function fixture(behavior = () => {}) {
  const calls = [];
  const spawnImpl = (executable, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.signals = [];
    child.kill = (signal) => { child.signals.push(signal); return true; };
    child.close = (code = 0) => child.emit('close', code);
    child.json = (value, code = 0) => { child.stdout.write(JSON.stringify(value)); child.close(code); };
    calls.push({ executable, args, options, child });
    queueMicrotask(() => behavior(child, args));
    return child;
  };
  return { calls, spawnImpl };
}

const authStatus = {
  appId: 'cli_app', brand: 'feishu', defaultAs: 'auto', identity: 'user', secret: 'OWNER_SECRET',
  identities: {
    bot: { status: 'ready', available: true, verified: true, openId: 'ou_bot', appName: 'App', token: 'BOT_TOKEN' },
    user: { status: 'ready', available: true, verified: true, openId: 'ou_user', userName: 'User',
      scope: 'all', hint: 'SECRET_HINT', refresh_token: 'REFRESH_TOKEN' },
  },
};
const message = { type: 'im.message.receive_v1', message_id: 'om_123', chat_id: 'oc_123',
  sender_id: 'ou_123', sender_type: 'user', chat_type: 'p2p', message_type: 'text', content: '\u4f60\u597d' };

test('bootstrap cannot reinterpret literal profile/help values after validation', async () => {
  // Primary contract: cmd/bootstrap.go at larksuite/cli v1.0.93 allows unknown
  // interspersed flags. pflag v1.0.9 flag.go parseLongArg/stripUnknownFlagValue
  // leaves a separate dash-prefixed value for global parsing; --unknown=value is atomic.
  for (const text of ['--profile=other', '--help']) {
    const f = fixture((child) => child.json({ ok: true }));
    const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
    const args = validateTool('feishu_user_send', { userId: 'ou_x', text }).args;
    await cli.run(args);
    assert.deepEqual(f.calls[0].args, ['im', '+messages-send', '--user-id=ou_x',
      `--text=${text}`, '--as=user', '--format=json']);
    await cli.sendReply('om_x', text, '--help');
    assert.deepEqual(f.calls[1].args, ['im', '+messages-reply', '--message-id=om_x',
      `--text=${text}`, '--idempotency-key=--help', '--as=bot', '--format=json']);
  }
});

test('all convenience methods honor pre-aborted signals without spawning', async () => {
  const f = fixture((child) => child.json(authStatus));
  const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
  const options = { signal: AbortSignal.abort() };
  for (const operation of [() => cli.version(options), () => cli.inspect(options), () => cli.login(options),
    () => cli.completeLogin('device_123', options), () => cli.sendReply('om_x', 'text', undefined, options)]) {
    assert.deepEqual(await operation(), { ok: false, error: { code: 'ABORTED' } });
  }
  assert.equal(f.calls.length, 0);
});

test('all convenience methods forward in-flight aborts, timeouts and invalid options', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
  for (const operation of [(options) => cli.version(options), (options) => cli.inspect(options),
    (options) => cli.login(options), (options) => cli.completeLogin('device_123', options),
    (options) => cli.sendReply('om_x', 'text', 'uuid', options)]) {
    const controller = new AbortController();
    const pending = operation({ signal: controller.signal });
    controller.abort();
    assert.deepEqual(await pending, { ok: false, error: { code: 'ABORTED' } });
    assert.deepEqual(f.calls.at(-1).child.signals, ['SIGTERM']);
    f.calls.at(-1).child.close();
    const timed = operation({ timeoutMs: 50 });
    t.mock.timers.tick(49);
    assert.deepEqual(f.calls.at(-1).child.signals, []);
    t.mock.timers.tick(1);
    assert.deepEqual(await timed, { ok: false, error: { code: 'TIMEOUT' } });
    f.calls.at(-1).child.close();
    const count = f.calls.length;
    for (const options of [null, [], 'bad', { signal: {} }, { timeoutMs: 0 }, { timeoutMs: NaN }]) {
      assert.deepEqual(await operation(options), { ok: false, error: { code: 'INVALID_ARGUMENTS' } });
    }
    assert.equal(f.calls.length, count);
  }
});

test('completeLogin retains five-minute default even with signal-only options', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
  for (const options of [undefined, { signal: new AbortController().signal }, { timeoutMs: undefined }]) {
    const pending = cli.completeLogin('device_123', options);
    t.mock.timers.tick(299999);
    assert.deepEqual(f.calls.at(-1).child.signals, []);
    t.mock.timers.tick(1);
    assert.equal((await pending).error.code, 'TIMEOUT');
    f.calls.at(-1).child.close();
  }
});

test('auth and every tool value flag are bound at launch, not only message text', async () => {
  const f = fixture((child) => child.json({ ok: true }));
  const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
  await cli.run(['auth', 'login', '--scope', '--profile=other', '--no-wait', '--json']);
  assert.deepEqual(f.calls.at(-1).args, ['auth', 'login', '--scope=--profile=other', '--no-wait', '--json']);
  await cli.completeLogin('--help');
  assert.deepEqual(f.calls.at(-1).args, ['auth', 'login', '--device-code=--help', '--json']);
  const calendar = { calendarId: '--help', start: '2026-09-07T09:00:00Z', end: '2026-09-07T10:00:00Z' };
  for (const [name, values] of [
    ['feishu_document_read', { documentId: '--help' }],
    ['feishu_document_create', { title: '--profile=other', text: '--help' }],
    ['feishu_calendar_list', calendar],
    ['feishu_calendar_event_create', { ...calendar, summary: '--profile=other' }],
    ['feishu_user_send', { userId: 'ou_x', text: '--help', uuid: '--help' }],
  ]) {
    const args = validateTool(name, values).args;
    await cli.run(args);
    const actual = f.calls.at(-1).args;
    assert.deepEqual(actual.slice(0, 2), args.slice(0, 2));
    for (let i = 2; i < args.length; i += 2) {
      assert.equal(actual[1 + i / 2], `${args[i]}=${args[i + 1]}`);
    }
    assert.equal(actual.length, 2 + (args.length - 2) / 2);
    assert.equal(actual.includes('--help'), false);
    assert.equal(actual.includes('--profile=other'), false);
  }
});

test('consume stop returns one promise that waits for actual close', async () => {
  const f = fixture();
  const consumer = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).consume();
  const stopped = consumer.stop();
  assert.ok(stopped instanceof Promise);
  assert.equal(consumer.stop(), stopped);
  let settled = false;
  stopped.then(() => { settled = true; });
  await delay(0);
  assert.equal(settled, false);
  f.calls[0].child.close();
  assert.deepEqual(await stopped, { ok: false, error: { code: 'STOPPED' } });
  assert.equal(consumer.stop(), stopped);
});

test('run uses pipes and no shell, filters all non-allowlisted environment without mutating host', async () => {
  const f = fixture((child) => child.json({ ok: true, data: {} }));
  const env = { PATH: '/safe/bin', HOME: '/safe/home', HTTPS_PROXY: 'http://proxy:8080',
    OMB_OWNER_TOKEN: 'secret', OGB_OWNER_TOKEN: 'secret', TT_FEISHU_BRIDGE_TOKEN: 'secret',
    LARKSUITE_CLI_CONFIG_DIR: '/other', LARKSUITE_CLI_APP_SECRET: 'secret',
    FEISHU_APP_SECRET: 'secret', NODE_OPTIONS: '--require evil', LD_PRELOAD: 'evil',
    BASH_ENV: 'evil', npm_config_script_shell: 'evil', RANDOM_SECRET: 'secret', LANG: 'bad\0value' };
  const cli = createCli({ executable: '/Program Files/lark-cli.exe', spawnImpl: f.spawnImpl, env });
  const argv = validateTool('feishu_user_send', { userId: 'ou_x', text: '--yes; whoami' }).args;
  assert.deepEqual(await cli.run(argv), { ok: true, data: {} });
  assert.deepEqual(f.calls[0].args, ['im', '+messages-send', '--user-id=ou_x',
    '--text=--yes; whoami', '--as=user', '--format=json']);
  assert.deepEqual(argv, validateTool('feishu_user_send', { userId: 'ou_x', text: '--yes; whoami' }).args);
  assert.equal(f.calls[0].options.shell, false);
  assert.deepEqual(f.calls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.deepEqual(f.calls[0].options.env, { PATH: '/safe/bin', HOME: '/safe/home', HTTPS_PROXY: 'http://proxy:8080',
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1', LARKSUITE_CLI_REMOTE_META: 'off' });
  assert.equal(env.OMB_OWNER_TOKEN, 'secret');
  assert.equal(f.calls[0].child.stdin.writableEnded, true);
});

test('reject shell wrappers, unsafe commands, credential flags and blanket approval', async () => {
  for (const executable of ['', 'cmd.exe', 'C:\\Windows\\cmd.exe', 'powershell', 'pwsh.exe',
    '/bin/sh', '/bin/bash', 'lark-cli.cmd', 'lark-cli.BAT', 'lark-cli\0']) {
    assert.throws(() => createCli({ executable }), { code: 'INVALID_EXECUTABLE' });
  }
  const f = fixture();
  const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
  for (const args of [[], null, ['config', 'show'], ['auth', 'logout'], ['api', 'https://evil'],
    ['auth', 'status', '--json', '--profile', 'other'], ['auth', 'status', '--json', '--yes'],
    ['auth', 'status', '--json', '--json'], ['auth', 'status', '--json', '--token', 'secret'],
    ['im', '+messages-send', '--text', 'x'], ['im', '+messages-send', '--as', 'auto', '--format', 'json']]) {
    assert.equal((await cli.run(args)).error.code, 'INVALID_ARGUMENTS');
  }
  assert.equal(f.calls.length, 0);
});

test('safe exit codes, invalid output, thrown and emitted spawn errors', async () => {
  for (const [code, expected] of [[1, 'CLI_API_ERROR'], [2, 'CLI_VALIDATION_ERROR'], [3, 'AUTH_REQUIRED'],
    [4, 'CLI_NETWORK_ERROR'], [5, 'CLI_INTERNAL_ERROR'], [6, 'CONTENT_BLOCKED'], [10, 'APPROVAL_REQUIRED'], [null, 'CLI_EXIT']]) {
    const f = fixture((child) => { child.stderr.write('SECRET'); child.json({ secret: 'SECRET' }, code); });
    const value = await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).inspect();
    assert.deepEqual(value, { ok: false, error: { code: expected } });
    assert.equal(f.calls.length, 1);
  }
  for (const output of ['SECRET', '{}{}', 'null', '"SECRET"', 'true']) {
    const f = fixture((child) => { child.stdout.write(output); child.close(); });
    assert.equal((await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl })
      .run(['auth', 'status', '--json'])).error.code, 'INVALID_OUTPUT');
  }
  for (const spawnImpl of [() => { throw new Error('SECRET'); }, fixture((child) => {
    child.emit('error', new Error('SECRET')); child.close();
  }).spawnImpl]) {
    assert.deepEqual(await createCli({ executable: 'lark-cli.exe', spawnImpl }).inspect(),
      { ok: false, error: { code: 'SPAWN_FAILED' } });
  }
});

test('captured unconfigured auth status envelope maps to CLI_NOT_CONFIGURED', async () => {
  // Offline official v1.0.93 capture supplied by the reviewer: exit 3, stderr only.
  const captured = '{"ok":false,"error":{"type":"config","subtype":"not_configured"}}';
  const f = fixture((child) => { child.stderr.write(`${captured}\n`); child.close(3); });
  const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
  assert.deepEqual(await cli.run(['auth', 'status', '--json']),
    { ok: false, error: { code: 'CLI_NOT_CONFIGURED' } });
  assert.deepEqual(await cli.inspect(), { ok: false, error: { code: 'CLI_NOT_CONFIGURED' } });
});

test('deleted app error 20069 is not misreported as incomplete user authorization', async () => {
  const captured = { ok: false, error: { type: 'config', subtype: 'invalid_client', code: 20069,
    message: 'The specified app is not enabled.', hint: 'SECRET_HINT', access_token: 'SECRET' } };
  for (const prefix of ['', 'Querying app scopes...\n\n']) {
    const f = fixture((child) => { child.stderr.write(prefix + JSON.stringify(captured)); child.close(3); });
    const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
    assert.deepEqual(await cli.permissions(), { ok: false, error: { code: 'APP_UNAVAILABLE' } });
  }
  for (const patch of [{ code: 99999 }, { type: 'network' }, { subtype: 'not_configured', code: 20069 }]) {
    const f = fixture((child) => {
      child.stderr.write(JSON.stringify({ ...captured, error: { ...captured.error, ...patch } })); child.close(3);
    });
    const result = await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).permissions();
    assert.notEqual(result.error.code, 'APP_UNAVAILABLE');
  }
});

test('verified status of a deleted app requests exact app failure, not OAuth replay', async () => {
  const f = fixture((child) => child.json({ ...authStatus, identities: {
    ...authStatus.identities, bot: { status: 'verify_failed', available: false, verified: false,
      message: 'Bot identity: verify failed: The specified app is not enabled.' },
  } }));
  assert.deepEqual(await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).inspect(),
    { ok: false, error: { code: 'APP_UNAVAILABLE' } });
});

test('deleted app with variable diagnostic wording is classified by a fresh structured app preflight', async () => {
  const f = fixture((child, args) => {
    if (args[1] === 'status') {
      child.json({ ...authStatus, identities: { ...authStatus.identities,
        bot: { available: false, status: 'verify_failed', verified: false, message: 'Localized diagnostic PRIVATE' } } });
    } else {
      child.stderr.write('Querying app scopes...\n\n' + JSON.stringify({
        ok: false, error: { type: 'config', subtype: 'invalid_client', code: 20069, message: 'PRIVATE' },
      }));
      child.close(3);
    }
  });
  const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
  assert.deepEqual(await cli.inspect(), { ok: false, error: { code: 'APP_UNAVAILABLE' } });
  assert.deepEqual(f.calls.map((call) => call.args.slice(0, 2)), [['auth', 'status'], ['auth', 'scopes']]);
});

test('cached bot identity cannot hide a deleted application when user login is missing', async () => {
  const f = fixture((child, args) => {
    if (args[1] === 'status') {
      child.json({ ...authStatus, identities: { ...authStatus.identities,
        user: { available: false, status: 'missing', openId: 'ou_previous' } } });
    } else {
      child.stderr.write('Querying app scopes...\n\n' + JSON.stringify({
        ok: false, error: { type: 'config', subtype: 'invalid_client', code: 20069 },
      }));
      child.close(3);
    }
  });
  assert.deepEqual(await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).inspect(),
    { ok: false, error: { code: 'APP_UNAVAILABLE' } });
});

test('missing-user inspection returns only sanitized same-app live preflight for immediate OAuth reuse', async () => {
  for (const appId of ['cli_app', 'cli_other']) {
    const f = fixture((child, args) => {
      if (args[1] === 'status') child.json({ ...authStatus, identities: { ...authStatus.identities,
        user: { available: false, status: 'missing' } } });
      else child.json({ appId, brand: 'feishu', tokenType: 'user', userScopes: ['docx:document'],
        count: 1, secret: 'PRIVATE_MUST_NOT_ESCAPE' });
    });
    const info = await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).inspect();
    assert.equal(info.user.available, false, 'app permissions are never personal authorization');
    if (appId === 'cli_app') assert.deepEqual(info.appPermissions, {
      appId, brand: 'feishu', tokenType: 'user', userScopes: ['docx:document'],
    });
    else assert.equal(info.appPermissions, undefined);
    assert.doesNotMatch(JSON.stringify(info), /PRIVATE_MUST_NOT_ESCAPE/);
  }
});

test('split UTF-8 stderr envelopes expose only the known safe code, never secret fields', async () => {
  const f = fixture((child) => {
    const envelope = { ok: false, error: { type: 'config', subtype: 'not_configured',
      message: '\u672a\u914d\u7f6e SECRET_TOKEN', hint: 'SECRET_PATH', access_token: 'SECRET_ACCESS' },
    refresh_token: 'SECRET_REFRESH', identity: 'SECRET_IDENTITY' };
    for (const byte of Buffer.from(` \n${JSON.stringify(envelope, null, 2)}\r\n`)) {
      child.stderr.write(Buffer.from([byte]));
    }
    child.stdout.write('SECRET_STDOUT');
    child.close(3);
  });
  assert.deepEqual(await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).inspect(),
    { ok: false, error: { code: 'CLI_NOT_CONFIGURED' } });
});

test('malformed, noisy, wrong-shape or unknown stderr never overrides the safe exit code', async () => {
  const captured = '{"ok":false,"error":{"type":"config","subtype":"not_configured"}}';
  for (const stderr of ['', 'SECRET_TOKEN config not_configured', '{', `${captured}\nSECRET`,
    `SECRET\n${captured}`, `${captured}\n${captured}`, 'null', '[]', `[${captured}]`,
    JSON.stringify(captured), '{"error":{"type":"config","subtype":"not_configured"}}',
    '{"ok":true,"error":{"type":"config","subtype":"not_configured"}}',
    '{"ok":"false","error":{"type":"config","subtype":"not_configured"}}',
    '{"ok":false,"error":[{"type":"config","subtype":"not_configured"}]}',
    '{"ok":false,"error":{"type":"authentication","subtype":"not_configured"}}',
    '{"ok":false,"error":{"type":"config","subtype":"SECRET_UNKNOWN"}}',
    '{"ok":false,"error":{"type":["config"],"subtype":"not_configured"}}',
    Buffer.concat([Buffer.from(captured.slice(0, -1) + ',"message":"'), Buffer.from([0xff]), Buffer.from('"}')])]) {
    const f = fixture((child) => { child.stderr.write(stderr); child.close(3); });
    assert.deepEqual(await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).inspect(),
      { ok: false, error: { code: 'AUTH_REQUIRED' } });
  }
  for (const [code, expected] of [[1, 'CLI_API_ERROR'], [2, 'CLI_VALIDATION_ERROR'], [4, 'CLI_NETWORK_ERROR'],
    [5, 'CLI_INTERNAL_ERROR'], [6, 'CONTENT_BLOCKED'], [10, 'APPROVAL_REQUIRED'], [null, 'CLI_EXIT']]) {
    const f = fixture((child) => { child.stderr.write(captured); child.close(code); });
    assert.deepEqual(await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).inspect(),
      { ok: false, error: { code: expected } });
    assert.equal(f.calls.length, 1);
  }
});

test('stderr classification cannot override success, cancellation, timeout or output limits', async () => {
  const captured = '{"ok":false,"error":{"type":"config","subtype":"not_configured"}}';
  for (const outcome of ['success', 'abort', 'timeout', 'limit']) {
    const controller = new AbortController();
    const f = fixture((child) => {
      child.stderr.write(captured);
      if (outcome === 'success') child.json({ ok: true });
      if (outcome === 'abort') controller.abort();
      if (outcome === 'limit') child.stderr.write(' '.repeat(1024 * 1024));
    });
    const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
    const result = await cli.run(['auth', 'status', '--json'], { signal: controller.signal, timeoutMs: 20 });
    f.calls[0].child.close(3);
    assert.deepEqual(result, outcome === 'success' ? { ok: true } : { ok: false, error: {
      code: { abort: 'ABORTED', timeout: 'TIMEOUT', limit: 'OUTPUT_LIMIT' }[outcome],
    } });
  }
});

test('run decodes split UTF-8 and bounds both stdout and stderr', async () => {
  const f = fixture((child) => {
    const bytes = Buffer.from(JSON.stringify({ text: '\u4f60\u597d' }));
    for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
    child.close();
  });
  assert.deepEqual(await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl })
    .run(['auth', 'status', '--json']), { text: '\u4f60\u597d' });
  for (const stream of ['stdout', 'stderr']) {
    const f = fixture((child) => { child[stream].write('x'.repeat(1024 * 1024 + 1)); child.close(); });
    assert.equal((await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).inspect()).error.code, 'OUTPUT_LIMIT');
    assert.deepEqual(f.calls[0].child.signals, ['SIGTERM']);
  }
});

test('timeout, cancellation, invalid options and forced cleanup are bounded', async () => {
  const f = fixture();
  const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
  const args = ['auth', 'status', '--json'];
  assert.equal((await cli.run(args, { timeoutMs: 5 })).error.code, 'TIMEOUT');
  assert.deepEqual(f.calls[0].child.signals, ['SIGTERM']);
  await delay(1050);
  assert.deepEqual(f.calls[0].child.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(f.calls[0].child.stdout.destroyed, true);
  const controller = new AbortController();
  const pending = cli.run(args, { signal: controller.signal });
  controller.abort();
  assert.equal((await pending).error.code, 'ABORTED');
  f.calls[1].child.close();
  const count = f.calls.length;
  assert.equal((await cli.run(args, { signal: controller.signal })).error.code, 'ABORTED');
  for (const timeoutMs of [0, -1, Infinity, NaN, 600001, '5']) {
    assert.equal((await cli.run(args, { timeoutMs })).error.code, 'INVALID_ARGUMENTS');
  }
  assert.equal((await cli.run(args, { signal: {} })).error.code, 'INVALID_ARGUMENTS');
  assert.equal((await cli.run(args, null)).error.code, 'INVALID_ARGUMENTS');
  assert.equal(f.calls.length, count);
});

test('version uses actual Cobra text and reports pinned compatibility', async () => {
  for (const version of ['1.0.93', '1.0.94']) {
    const f = fixture((child) => { child.stdout.write(`lark-cli version ${version}\n`); child.close(); });
    assert.deepEqual(await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).version(),
      { version, supported: version === '1.0.93' });
    assert.deepEqual(f.calls[0].args, ['--version']);
  }
});

test('inspect verifies actual independent identities and only returns approved fields', async () => {
  const f = fixture((child) => child.json(authStatus));
  const result = await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).inspect();
  assert.deepEqual(f.calls[0].args, ['auth', 'status', '--json', '--verify']);
  assert.deepEqual(result, { appId: 'cli_app', brand: 'feishu', botReady: true,
    grants: { granted: [], missing: 'docx:document:readonly docx:document:create calendar:calendar.event:read calendar:calendar.event:create calendar:calendar.event:update im:message.send_as_user im:message'.split(' ') },
    bot: { status: 'ready', available: true, verified: true, openId: 'ou_bot', name: 'App' },
    user: { status: 'ready', available: true, verified: true, openId: 'ou_user', name: 'User' } });
  for (const bot of [{ status: 'ready', available: true },
    { status: 'verify_failed', available: false, verified: false }]) {
    const f = fixture((child) => child.json({ ...authStatus, identities: { ...authStatus.identities, bot } }));
    assert.equal((await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).inspect()).botReady, false);
  }
  const malformed = fixture((child) => child.json({ identity: 'user', appId: 'cli_app' }));
  assert.equal((await createCli({ executable: 'lark-cli.exe', spawnImpl: malformed.spawnImpl }).inspect()).error.code, 'INVALID_OUTPUT');
  const refreshing = fixture((child) => child.json({ ...authStatus, identities: {
    ...authStatus.identities, user: { ...authStatus.identities.user, status: 'needs_refresh', verified: undefined },
  } }));
  assert.deepEqual((await createCli({ executable: 'lark-cli.exe', spawnImpl: refreshing.spawnImpl }).inspect()).user,
    { status: 'needs_refresh', available: true, verified: null, openId: 'ou_user', name: 'User' });
});

test('split device authorization has fixed scopes and sanitized results, no automatic completion', async () => {
  const url = 'https://accounts.feishu.cn/oauth/v1/authorize?user_code=A%2BB';
  const f = fixture((child, args) => child.json(args.includes('--no-wait') ? {
    verification_url: url, device_code: 'device_123', expires_in: 600, access_token: 'SECRET', hint: 'SECRET',
  } : { event: 'authorization_complete', user_open_id: 'ou_user', user_name: 'User', refresh_token: 'SECRET' }));
  const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
  assert.deepEqual(await cli.login(), { verificationUrl: url, deviceCode: 'device_123', expiresIn: 600 });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].args, ['auth', 'login',
    '--scope=docx:document:readonly docx:document:create calendar:calendar.event:read calendar:calendar.event:create calendar:calendar.event:update im:message.send_as_user im:message',
    '--no-wait', '--json']);
  assert.deepEqual(await cli.completeLogin('device_123'), { complete: true, user: { openId: 'ou_user', name: 'User' } });
  assert.deepEqual(f.calls[1].args, ['auth', 'login', '--device-code=device_123', '--json']);
  assert.equal((await cli.completeLogin('@file')).error.code, 'INVALID_ARGUMENTS');
});

test('login rejects untrusted URLs and malformed payloads without returning tokens', async () => {
  for (const verification_url of ['http://accounts.feishu.cn/x', 'https://accounts.feishu.cn.evil/x',
    'https://evil@accounts.feishu.cn/x', 'https://accounts.feishu.cn:444/x',
    'https://accounts.feishu.cn/x#token', 'file:///secret', 'https://accounts.feishu.cn/x\n']) {
    const f = fixture((child) => child.json({ verification_url, device_code: 'dc', expires_in: 600 }));
    assert.deepEqual(await createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).login(),
      { ok: false, error: { code: 'INVALID_OUTPUT' } });
  }
});

test('bot reply exact argv, plain text and idempotency key never switch user identity', async () => {
  const f = fixture((child) => child.json({ ok: true, data: { message_id: 'om_reply' } }));
  const cli = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl });
  await cli.sendReply('om_anchor', '@file\n--yes; $(x)', 'unique-123');
  assert.deepEqual(f.calls[0].args, ['im', '+messages-reply', '--message-id=om_anchor',
    '--text=@file\n--yes; $(x)', '--idempotency-key=unique-123', '--as=bot', '--format=json']);
  await cli.sendReply('om_anchor', 'hello');
  assert.equal(f.calls[1].args.some((arg) => arg.startsWith('--idempotency-key=')), false);
  for (const values of [['bad', 'x'], ['om_x', ''], ['om_x', 'x', 'a'.repeat(51)]]) {
    assert.equal((await cli.sendReply(...values)).error.code, 'INVALID_ARGUMENTS');
  }
});

test('consume preserves stdin, parses fragmented ready/UTF-8 NDJSON and notifies exit once', async () => {
  const f = fixture();
  const received = [];
  const exits = [];
  let ready = 0;
  const consumer = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).consume({
    onMessage: (value) => received.push(value), onReady: () => ready++, onExit: (value) => exits.push(value),
  });
  const child = f.calls[0].child;
  assert.equal(child.stdin.writableEnded, false);
  assert.deepEqual(f.calls[0].args, ['event', 'consume', 'im.message.receive_v1', '--as=bot']);
  child.stderr.write('SECRET\n[event] ready event_key=other\n[event] rea');
  assert.equal(ready, 0);
  child.stderr.write('dy event_key=im.message.receive_v1\r\n');
  child.stderr.write('[event] ready event_key=im.message.receive_v1\n');
  assert.equal(ready, 1);
  for (const byte of Buffer.from(`${JSON.stringify(message)}\n`)) child.stdout.write(Buffer.from([byte]));
  child.stdout.write(`\n${JSON.stringify(message)}\n`);
  assert.deepEqual(received, [message, message]);
  consumer.stop();
  consumer.stop();
  assert.equal(child.stdin.writableEnded, true);
  child.close();
  child.close(4);
  assert.deepEqual(exits, [{ ok: false, error: { code: 'STOPPED' } }]);
});

test('consume fails closed on malformed or oversized data and handles startup errors', async () => {
  for (const [stream, data, code] of [['stdout', 'SECRET\n', 'INVALID_OUTPUT'],
    ['stdout', '{}\n', 'INVALID_OUTPUT'], ['stdout', `${JSON.stringify({ ...message, sender_id: {} })}\n`, 'INVALID_OUTPUT'],
    ['stdout', 'x'.repeat(65537), 'OUTPUT_LIMIT'], ['stderr', 'x'.repeat(65537), 'OUTPUT_LIMIT']]) {
    const f = fixture();
    const exits = [];
    createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).consume({ onExit: (value) => exits.push(value) });
    const child = f.calls[0].child;
    child[stream].write(data);
    assert.equal(child.stdin.writableEnded, true);
    child.close();
    assert.deepEqual(exits, [{ ok: false, error: { code } }]);
  }
  const exits = [];
  createCli({ executable: 'lark-cli.exe', spawnImpl: () => { throw new Error('SECRET'); } })
    .consume({ onExit: (value) => exits.push(value) });
  await delay(0);
  assert.deepEqual(exits, [{ ok: false, error: { code: 'SPAWN_FAILED' } }]);
});

test('isolated real subprocess timeout and stdin EOF cleanup without touching real CLI credentials', async () => {
  let child;
  const cli = createCli({ executable: 'fake-lark-cli.exe', env: {}, spawnImpl: (_exe, _args, options) => {
    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
    return child;
  } });
  const pending = cli.run(['auth', 'status', '--json'], { timeoutMs: 100 });
  const closed = once(child, 'close');
  assert.equal((await pending).error.code, 'TIMEOUT');
  await closed;
  const ready = Promise.withResolvers();
  const exited = Promise.withResolvers();
  const streamCli = createCli({ executable: 'fake-lark-cli.exe', env: {}, spawnImpl: (_exe, _args, options) =>
    spawn(process.execPath, ['-e', `process.stderr.write('[event] ready event_key=im.message.receive_v1\\n');
      process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`], options) });
  const consumer = streamCli.consume({ onReady: ready.resolve, onExit: exited.resolve });
  await ready.promise;
  const stopped = consumer.stop();
  assert.deepEqual(await exited.promise, { ok: false, error: { code: 'STOPPED' } });
  assert.deepEqual(await stopped, await exited.promise);
});

test('consume startup deadline escalates only its own process and settles without close', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const exits = [];
  const consumer = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).consume({ onExit: (value) => exits.push(value) });
  const child = f.calls[0].child;
  t.mock.timers.tick(30000);
  assert.equal(child.stdin.writableEnded, true);
  t.mock.timers.tick(1000);
  assert.deepEqual(child.signals, ['SIGTERM']);
  t.mock.timers.tick(1000);
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(exits, []);
  assert.equal(child.stdout.destroyed, true);
  const stopped = consumer.stop();
  t.mock.timers.tick(1000);
  assert.deepEqual(await stopped, { ok: false, error: { code: 'CLEANUP_TIMEOUT' } });
  assert.deepEqual(exits, [{ ok: false, error: { code: 'CLEANUP_TIMEOUT' } }]);
});

test('consume stop awaits post-SIGKILL close and cancels the final cleanup timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const exits = [];
  const consumer = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).consume({ onExit: (value) => exits.push(value) });
  const stopped = consumer.stop();
  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  assert.deepEqual(f.calls[0].child.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(exits, []);
  f.calls[0].child.close(null);
  assert.deepEqual(await stopped, { ok: false, error: { code: 'STOPPED' } });
  t.mock.timers.tick(1000);
  assert.equal(exits.length, 1);
});

test('consume stop remains awaitable after spontaneous exit or a thrown spawn', async () => {
  const f = fixture();
  const consumer = createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).consume();
  f.calls[0].child.close(4);
  assert.deepEqual(await consumer.stop(), { ok: false, error: { code: 'CLI_NETWORK_ERROR' } });
  const failed = createCli({ executable: 'lark-cli.exe', spawnImpl: () => { throw new Error('SECRET'); } }).consume();
  assert.deepEqual(await failed.stop(), { ok: false, error: { code: 'SPAWN_FAILED' } });
});

test('consume bounds outstanding callbacks and shuts down on callback errors or partial EOF', async () => {
  for (const mode of ['throw', 'reject', 'backpressure', 'partial']) {
    const f = fixture();
    const exits = [];
    let count = 0;
    createCli({ executable: 'lark-cli.exe', spawnImpl: f.spawnImpl }).consume({
      onMessage: () => {
        count++;
        if (mode === 'throw') throw new Error('SECRET');
        if (mode === 'reject') return Promise.reject(new Error('SECRET'));
        return new Promise(() => {});
      }, onExit: (value) => exits.push(value),
    });
    const child = f.calls[0].child;
    if (mode === 'partial') child.stdout.end('{');
    else child.stdout.write(`${JSON.stringify(message)}\n`.repeat(mode === 'backpressure' ? 100 : 1));
    await delay(0);
    child.close();
    assert.equal(exits[0].error.code, mode === 'partial' ? 'INVALID_OUTPUT' :
      mode === 'backpressure' ? 'CALLBACK_BACKPRESSURE' : 'CALLBACK_ERROR');
    if (mode === 'backpressure') assert.equal(count, 32);
  }
});
