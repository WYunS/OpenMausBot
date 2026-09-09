import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConnector } from './index.mjs';
import { TOOL_DEFINITIONS } from './tools.mjs';
import { TOOL_SCOPES } from './onboarding.mjs';

const MCP = '/api/mcp/servers/tuantuan-feishu';
const nodeExe = process.platform === 'win32' ? 'C:\\runtime\\node.exe' : '/runtime/node';
const cliExe = process.platform === 'win32' ? 'C:\\runtime\\lark.exe' : '/runtime/lark';
const mcpPath = process.platform === 'win32' ? 'C:\\app\\mcp.mjs' : '/app/mcp.mjs';
const configDir = process.platform === 'win32' ? 'C:\\runtime\\context' : '/runtime/context';
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('condition did not settle');
}
function fakeClock() {
  let time = 0;
  let next = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout(fn, ms) { const key = ++next; timers.set(key, { fn, at: time + ms }); return key; },
    clearTimeout(key) { timers.delete(key); },
    async advance(ms) {
      time += ms;
      for (const [key, timer] of timers) if (timer.at <= time) { timers.delete(key); timer.fn(); }
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
function fixture(t, options = {}) {
  const state = {
    disk: { cliPath: cliExe, nodePath: nodeExe, botId: 'bot1', appId: 'cli_app', ...options.disk },
    info: { appId: 'cli_app', botReady: true,
      bot: { available: true, status: 'ready', verified: true },
      user: { available: true, status: 'ready', verified: true, openId: 'ou_owner' } },
    version: { version: '1.0.93', supported: true }, loads: 0, saves: [], dialogs: [], enableDialogs: [], consumers: [],
    sends: [], replies: [], runs: [], requests: [], entries: [], sessions: [], opened: [], chosen: [],
    bot: { id: 'bot1', threadId: 'original', tasks: [{ threadId: 'original' }] },
    approve: async () => true, testResult: { ok: true, tools: TOOL_DEFINITIONS },
    validate: async () => true, preparations: [], cliOptions: [], authorizations: [], initializations: [],
    prepare: async ({ existing }) => ({ cliPath: cliExe, nodePath: nodeExe,
      ...(!existing.appId || existing.configDir ? { configDir: existing.configDir ?? configDir } : {}) }),
  };
  const cli = {
    version: async () => state.version,
    inspect: async () => structuredClone(state.info),
    initialize: async (options) => { state.initializations.push(options); return { appId: 'cli_app', brand: 'feishu' }; },
    authorize: async (options) => {
      state.authorizations.push(options);
      await options.onAuthorization('https://accounts.feishu.cn/device?code=public');
      return { complete: true, user: { openId: state.info.user.openId, name: 'Owner' } };
    },
    login: async () => ({ verificationUrl: 'https://accounts.feishu.cn/device?code=public', deviceCode: 'secret_device', expiresIn: 600 }),
    completeLogin: async (code) => { state.completedCode = code; return { complete: true, user: { openId: state.info.user.openId } }; },
    consume(callbacks) {
      const consumer = { ...callbacks, stopped: false, stop() { this.stopped = true; callbacks.onExit(); return Promise.resolve(); } };
      state.consumers.push(consumer);
      callbacks.onReady();
      return consumer;
    },
    sendReply: async (...args) => { state.replies.push(args); return { ok: true }; },
    run: async (...args) => { state.runs.push(args); return { data: 'safe result' }; },
  };
  const kernel = {
    bots: async () => [structuredClone(state.bot)],
    createSession: async (args) => {
      state.sessions.push(args);
      state.bot.threadId = 'feishu_thread';
      state.bot.tasks.push({ threadId: 'feishu_thread' });
      return { threadId: 'feishu_thread' };
    },
    sendAndWait: async (args) => {
      assert.ok(state.disk.records.includes(state.currentMessage ?? 'om_one'), 'persist before send');
      state.sends.push(args);
      return { text: 'reply', threadId: args.threadId };
    },
    async request(url, opts = {}) {
      state.requests.push({ url, ...structuredClone(opts) });
      if (state.requestHook) await state.requestHook(url, opts);
      const method = opts.method ?? 'GET';
      if (url === '/api/mcp/servers' && method === 'GET') return { servers: structuredClone(state.entries) };
      if (url === '/api/mcp/servers' && method === 'POST') {
        assert.equal(state.entries.length, 0);
        state.entries.push(structuredClone(opts.body));
      } else if (url === MCP && method === 'PUT') state.entries = [{ name: 'tuantuan-feishu', ...structuredClone(opts.body) }];
      else if (url === `${MCP}/test`) return state.testResult;
      else if (url === MCP && method === 'PATCH') state.entries[0].enabled = opts.body.enabled;
      else throw new Error('unexpected kernel route');
      return { servers: structuredClone(state.entries) };
    },
  };
  const store = {
    async load() { state.loads++; if (options.load) return options.load(); return structuredClone(state.disk); },
    async save(value) {
      if (state.saveHook) await state.saveHook(value);
      state.disk = structuredClone(value);
      state.saves.push(structuredClone(value));
    },
  };
  const controller = createConnector({ kernel, store, mcpPath,
    ...(options.automaticTools ? { authorizeTool: async () => {
      await state.authorizeTool?.();
      return true;
    } } : {}),
    createCliImpl: (options) => { state.cliOptions.push(options); state.executable = options.executable; return cli; },
    prepareRuntime: (options) => { state.preparations.push(options); return state.prepare(options); },
    chooseExecutable: async (kind) => { state.chosen.push(kind); return state.choice ?? (kind === 'cli' ? cliExe : nodeExe); },
    validateNode: (...args) => state.validate(...args),
    createRecoveryContext: (args) => state.createRecovery?.(args),
    confirm: async (dialog) => {
      (dialog.title === '\u542f\u7528\u98de\u4e66\u5de5\u5177' ? state.enableDialogs : state.dialogs).push(dialog);
      return state.approve(dialog);
    },
    openExternal: async (url) => { state.opened.push(url); await state.openHook?.(url); }, clock: options.clock,
  });
  t.after(() => controller.close());
  return { state, cli, kernel, store, controller };
}
function message(sender = 'ou_owner', messageId = 'om_one', text = 'hello', extra = {}) {
  return { type: 'im.message.receive_v1', chat_type: 'p2p', chat_id: 'oc_chat', sender_type: 'user',
    sender_id: sender, message_id: messageId, message_type: 'text', content: text, ...extra };
}
async function pair(f) {
  const paired = await f.controller.invoke('pair', { botId: 'bot1' });
  assert.ok(paired.pairingCode);
  f.state.consumers.at(-1).onMessage(message('ou_owner', 'om_pair', paired.pairingCode));
  await until(async () => (await f.controller.state()).ownerOpenId === 'ou_owner');
}
async function connect(f) {
  await pair(f);
  const result = await f.controller.invoke('connect', { botId: 'bot1' });
  assert.equal(result.im, 'ready');
  return f.state.consumers.at(-1);
}
function request(entry, body = { name: 'feishu_document_read', arguments: { documentId: 'doc123' } }, headers = {}, raw) {
  return new Promise((resolve) => {
    const encoded = raw ?? JSON.stringify(body);
    const req = http.request(`${entry.env.TT_FEISHU_BRIDGE_URL}/tools`, { method: 'POST', agent: false,
      headers: { authorization: `Bearer ${entry.env.TT_FEISHU_BRIDGE_TOKEN}`, 'content-type': 'application/json', ...headers } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); });
      res.on('error', () => resolve({ closed: true }));
    });
    req.on('error', () => resolve({ closed: true }));
    req.end(encoded);
  });
}

test('one-click prepares a managed runtime, configures in browser and binds OAuth owner for both channels', async (t) => {
  const f = fixture(t, { disk: { cliPath: '', nodePath: '', appId: undefined } });
  let configured = false;
  const inspect = f.cli.inspect;
  f.cli.inspect = (options) => configured ? inspect(options) : { ok: false, error: { code: 'CLI_NOT_CONFIGURED' } };
  f.cli.initialize = async (options) => {
    assert.equal(f.state.disk.configDir, configDir, 'context saved before browser setup');
    assert.equal(f.state.disk.cliPath, cliExe);
    assert.equal((await f.controller.state()).phase, 'openingApp');
    assert.equal((await f.controller.state()).error, undefined);
    assert.equal((await f.controller.state()).errorCode, undefined);
    assert.equal(await options.isManagedEmpty(configDir), true);
    assert.equal(await options.isManagedEmpty('/not-managed'), false);
    f.state.initializations.push(options);
    await options.onAuthorization('https://accounts.feishu.cn/app/setup');
    assert.equal((await f.controller.state()).error, undefined, 'browser setup must not show the expected probe error');
    configured = true;
    return { appId: 'cli_app', brand: 'feishu' };
  };
  f.state.approve = async () => false;
  const result = await f.controller.invoke('oneClickConnect');
  assert.equal(result.error, undefined);
  assert.equal(result.phase, 'ready');
  assert.equal(result.im, 'ready');
  assert.equal(result.toolsEnabled, true);
  assert.equal(result.ownerOpenId, 'ou_owner');
  assert.equal(result.pairingCode, undefined);
  assert.equal(result.login, undefined);
  assert.equal(f.state.disk.schemaVersion, 2);
  assert.equal(f.state.disk.threadId, 'feishu_thread');
  assert.equal(f.state.cliOptions[0].configDir, configDir);
  assert.equal(f.state.initializations.length, 1);
  assert.equal(f.state.authorizations.length, 1);
  assert.equal(f.state.opened.length, 2);
  assert.equal(f.state.dialogs.length + f.state.enableDialogs.length, 0);
  assert.equal(f.state.chosen.length, 0);
  assert.equal((await request(f.state.entries[0])).body.error.code, 'APPROVAL_DENIED');
  assert.equal(f.state.dialogs.length, 1, 'tool reads still require native confirmation');
  assert.equal(f.state.runs.length, 0);
});

test('host automatic tool policy executes all five office tools repeatedly without native prompts', async (t) => {
  const f = fixture(t, { automaticTools: true });
  f.state.approve = async () => false;
  assert.equal((await f.controller.invoke('oneClickConnect')).phase, 'ready');
  const interval = { calendarId: 'fixture_calendar', start: '2026-09-08T09:00:00+08:00', end: '2026-09-08T10:00:00+08:00' };
  const calls = [
    { name: 'feishu_document_read', arguments: { documentId: 'fixture_doc' } },
    { name: 'feishu_document_create', arguments: { title: 'Tuesday poem fixture', text: 'A test poem.' } },
    { name: 'feishu_calendar_list', arguments: interval },
    { name: 'feishu_calendar_event_create', arguments: { ...interval, summary: 'Fixture event' } },
    { name: 'feishu_user_send', arguments: { userId: 'ou_fixture', text: 'Fixture only' } },
  ];
  for (const call of [...calls, ...calls]) {
    const result = await request(f.state.entries[0], call);
    assert.equal(result.body.ok, true, call.name);
  }
  assert.equal(f.state.runs.length, 10);
  assert.equal(f.state.dialogs.length + f.state.enableDialogs.length, 0);
});

test('successful connection survives exit and host resume restores IM without browser setup or another task', async (t) => {
  const first = fixture(t);
  await first.controller.invoke('oneClickConnect');
  assert.equal(first.state.disk.reconnect, true);
  await first.controller.close();
  assert.equal(first.state.disk.reconnect, true, 'exit is not an explicit disconnect');
  assert.ok(first.state.consumers.every((item) => item.stopped));
  const next = fixture(t, { disk: first.state.disk });
  next.state.bot = structuredClone(first.state.bot);
  next.state.info.grants = { granted: TOOL_SCOPES.split(' '), missing: [] };
  assert.equal(typeof next.controller.resume, 'function');
  await Promise.all([next.controller.resume(), next.controller.resume()]);
  assert.equal((await next.controller.state()).phase, 'ready');
  assert.equal(next.state.consumers.length, 1);
  assert.equal(next.state.opened.length, 0);
  assert.equal(next.state.sessions.length, 0);
  next.state.consumers[0].onMessage(message());
  await until(() => next.state.replies.length === 1);
  await next.controller.invoke('disconnect');
  assert.equal(next.state.disk.reconnect, false);
  const stopped = fixture(t, { disk: next.state.disk });
  await stopped.controller.resume();
  assert.equal(stopped.state.consumers.length, 0);
  assert.equal(stopped.state.preparations.length, 0);
});

test('host resume never creates an app or opens OAuth when stored credentials need attention', async (t) => {
  for (const reason of ['missing', 'expired', 'app', 'network']) {
    const f = fixture(t, { disk: { reconnect: true, ownerOpenId: 'ou_owner', configDir, threadId: 'original' } });
    if (reason === 'missing') f.cli.inspect = async () => ({ ok: false, error: { code: 'CLI_NOT_CONFIGURED' } });
    if (reason === 'expired') f.state.info.user.available = false;
    if (reason === 'app') f.state.info.appId = 'cli_other';
    if (reason === 'network') f.cli.inspect = async () => ({ ok: false, error: { code: 'CLI_NETWORK_ERROR' } });
    await f.controller.resume();
    assert.equal((await f.controller.state()).phase, 'error', reason);
    assert.equal(f.state.opened.length + f.state.initializations.length + f.state.authorizations.length, 0);
    assert.equal(f.state.disk.reconnect, true);
    assert.equal(f.state.consumers.length, 0);
    await f.controller.resume();
    assert.equal(f.state.preparations.length, 1, 'no retry loop on every view read');
  }
});

test('disconnect cancels startup recovery durably and prevents a late result from restoring it', async (t) => {
  const f = fixture(t, { disk: { reconnect: true, ownerOpenId: 'ou_owner' } });
  const gate = deferred();
  f.state.prepare = () => gate.promise;
  const resuming = f.controller.resume();
  await until(() => f.state.preparations.length === 1);
  await f.controller.invoke('disconnect');
  gate.resolve({ cliPath: cliExe, nodePath: nodeExe });
  await resuming;
  assert.equal(f.state.disk.reconnect, false);
  assert.equal(f.state.consumers.length, 0);
  await f.controller.resume();
  assert.equal(f.state.preparations.length, 1);
});

test('automatic office policy never permits unknown tools, extra arguments or forged bridge requests', async (t) => {
  const f = fixture(t, { automaticTools: true });
  let authorizations = 0;
  f.state.authorizeTool = async () => { authorizations++; };
  await f.controller.invoke('oneClickConnect');
  const entry = f.state.entries[0];
  for (const call of [
    { name: 'shell', arguments: { command: 'whoami' } },
    { name: 'feishu_document_create', arguments: { title: 'fixture', text: 'fixture', approve: true } },
    { name: 'feishu_document_read', arguments: { documentId: '../private' } },
  ]) assert.equal((await request(entry, call)).body.ok, false);
  assert.equal((await request(entry, undefined, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await request(entry, undefined, { origin: 'https://foreign.invalid' })).status, 401);
  assert.equal(authorizations, 0);
  assert.equal(f.state.runs.length, 0);
});

test('automatic office policy still rejects changed identities, failed host checks and CLI permission failures', async (t) => {
  for (const reason of ['user', 'app', 'host', 'permission']) {
    const f = fixture(t, { automaticTools: true });
    await f.controller.invoke('oneClickConnect');
    const entry = structuredClone(f.state.entries[0]);
    if (reason === 'user') f.state.authorizeTool = async () => { f.state.info.user.openId = 'ou_other'; };
    if (reason === 'app') f.state.authorizeTool = async () => { f.state.info.appId = 'cli_other'; };
    if (reason === 'host') f.state.authorizeTool = async () => { throw new Error('LOCAL_WINDOW_REQUIRED'); };
    if (reason === 'permission') f.cli.run = async () => ({ ok: false, error: { code: 'SCOPE_REQUIRED' } });
    const result = await request(entry);
    assert.ok(result.closed || result.body?.ok === false, reason);
    assert.equal(f.state.runs.length, 0);
    assert.equal(f.state.dialogs.length, 0);
  }
});

test('disconnect during automatic host authorization prevents execution and revokes the old capability', async (t) => {
  const f = fixture(t, { automaticTools: true });
  const gate = deferred();
  let reached = false;
  f.state.authorizeTool = () => { reached = true; return gate.promise; };
  await f.controller.invoke('oneClickConnect');
  const entry = structuredClone(f.state.entries[0]);
  const call = request(entry);
  await until(() => reached);
  await f.controller.invoke('disconnect');
  gate.resolve();
  const result = await call;
  assert.ok(result.closed || result.body?.ok === false);
  assert.equal((await request(entry)).closed, true);
  assert.equal(f.state.runs.length, 0);
  assert.equal(f.state.dialogs.length, 0);
});

test('one-click does not launch duplicate version probes before opening the configuration browser', async (t) => {
  const f = fixture(t, { disk: { appId: undefined, configDir } });
  let probes = 0;
  let configured = false;
  f.cli.version = async () => { probes++; return f.state.version; };
  f.cli.inspect = async () => configured ? f.state.info : { ok: false, error: { code: 'CLI_NOT_CONFIGURED' } };
  f.cli.initialize = async (options) => {
    await options.onAuthorization('https://accounts.feishu.cn/app/setup');
    assert.equal(probes, 1, 'one verified version is sufficient before the first browser handoff');
    configured = true;
    return { appId: 'cli_app' };
  };
  assert.equal((await f.controller.invoke('oneClickConnect')).phase, 'ready');
});

test('unavailable app stops before OAuth instead of repeatedly asking for user authorization', async (t) => {
  const f = fixture(t, { disk: { ownerOpenId: 'ou_owner', configDir, threadId: 'original' } });
  f.cli.inspect = async () => ({ ok: false, error: { code: 'APP_UNAVAILABLE' } });
  const result = await f.controller.invoke('oneClickConnect');
  assert.equal(result.errorCode, 'APP_UNAVAILABLE');
  assert.equal(result.im, 'off');
  assert.equal(f.state.authorizations.length, 0);
  assert.equal(f.state.initializations.length, 0);
  assert.equal(f.state.disk.appId, 'cli_app');
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
});

test('one-click migrates a verified earlier TuanTuan package registration without overwriting foreign tools', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tuantuan-mcp-upgrade-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'resources', 'tuantuan-feishu');
  await mkdir(folder, { recursive: true });
  for (const name of ['mcp.mjs', 'tools.mjs']) {
    await copyFile(new URL(`./${name}`, import.meta.url), path.join(folder, name));
  }
  const f = fixture(t);
  f.state.entries = [{ name: 'tuantuan-feishu', command: nodeExe,
    args: [path.join(folder, 'mcp.mjs')], enabled: true,
    envKeys: ['TT_FEISHU_BRIDGE_TOKEN', 'TT_FEISHU_BRIDGE_URL'] }];
  const result = await f.controller.invoke('oneClickConnect');
  assert.equal(result.errorCode, undefined);
  assert.equal(result.phase, 'ready');
  assert.deepEqual(f.state.entries[0].args, [mcpPath]);
  assert.equal(f.state.entries[0].enabled, true);
  await f.controller.invoke('disconnect');
  assert.equal(f.state.entries[0].enabled, false);
});

test('an unverified bot cannot continue into user OAuth or look like an incomplete user login', async (t) => {
  const f = fixture(t, { disk: { ownerOpenId: 'ou_owner', configDir } });
  f.state.info.botReady = false;
  f.state.info.bot = { available: false, status: 'verify_failed', verified: false };
  f.state.info.user = { available: false, status: 'missing' };
  const result = await f.controller.invoke('oneClickConnect');
  assert.equal(result.errorCode, 'BOT_AUTH_REQUIRED');
  assert.equal(f.state.authorizations.length, 0);
  assert.equal(f.state.initializations.length, 0);
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.appId, 'cli_app');
});

test('live application preflight blocks OAuth when a deleted app still has a cached valid bot token', async (t) => {
  const f = fixture(t);
  f.cli.permissions = async () => ({ ok: false, error: { code: 'APP_UNAVAILABLE' } });
  const result = await f.controller.invoke('oneClickConnect');
  assert.equal(result.errorCode, 'APP_UNAVAILABLE');
  assert.equal(f.state.authorizations.length, 0);
  assert.equal(f.state.opened.length, 0);
});

test('reconnect reuses verified complete consent but missing or unverified grants still require OAuth', async (t) => {
  for (const complete of [true, false]) {
    const f = fixture(t, { disk: { ownerOpenId: 'ou_owner', configDir } });
    const scopes = TOOL_SCOPES.split(' ');
    f.state.info.grants = { granted: complete ? scopes : scopes.slice(1), missing: complete ? [] : scopes.slice(0, 1) };
    const result = await f.controller.invoke('oneClickConnect');
    assert.equal(result.phase, 'ready');
    assert.equal(f.state.authorizations.length, complete ? 0 : 1);
    assert.equal(f.state.opened.length, complete ? 0 : 1);
  }
  const f = fixture(t);
  f.state.info.grants = { granted: TOOL_SCOPES.split(' '), missing: [] };
  f.state.info.user.verified = false;
  const result = await f.controller.invoke('oneClickConnect');
  assert.notEqual(result.phase, 'ready');
  assert.equal(f.state.authorizations.length, 1);
});

function recoveryFixture(t, options = {}) {
  const f = fixture(t, { disk: { ownerOpenId: 'ou_owner', configDir, threadId: 'original', ...options.disk } });
  const directory = configDir + '-replacement';
  let initialized = false;
  let created = 0;
  f.state.createRecovery = async () => { created++; return directory; };
  f.cli.inspect = async () => {
    if (f.state.cliOptions.at(-1)?.configDir === configDir) return { ok: false, error: { code: options.oldInspectCode ?? 'APP_UNAVAILABLE' } };
    if (!initialized) return { ok: false, error: { code: 'CLI_NOT_CONFIGURED' } };
    return { ...structuredClone(f.state.info), appId: 'cli_replacement' };
  };
  f.cli.initialize = async (args) => {
    f.state.initializations.push(args);
    assert.equal(f.state.disk.configDir, configDir, 'old binding stays authoritative until success');
    assert.equal(f.state.disk.recovery.configDir, directory);
    assert.equal(await args.isManagedEmpty(directory), true);
    await args.onAuthorization('https://accounts.feishu.cn/app/setup');
    if (options.failFirstInitialization && f.state.initializations.length === 1) {
      return { ok: false, error: { code: 'AUTH_DENIED' }, app: { appId: 'cli_replacement' } };
    }
    initialized = true;
    return { appId: 'cli_replacement', brand: 'feishu' };
  };
  return { ...f, directory, creations: () => created };
}

test('explicit recreation stages a new context, opens browser, and commits only after verification', async (t) => {
  const f = recoveryFixture(t);
  const result = await f.controller.invoke('recreateApp', { botId: 'bot1' });
  assert.equal(result.phase, 'ready');
  assert.equal(result.im, 'ready');
  assert.equal(result.toolsEnabled, true);
  assert.equal(f.state.disk.appId, 'cli_replacement');
  assert.equal(f.state.disk.configDir, f.directory);
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.threadId, 'original');
  assert.equal(f.state.disk.recovery, undefined);
  assert.equal(result.recoveryPending, undefined);
  assert.equal(f.state.opened.length, 2);
  assert.equal(f.creations(), 1);
  assert.equal(f.state.sessions.length, 0);
});

test('interrupted setup can explicitly recover from a preserved known config in a separate context', async (t) => {
  const f = recoveryFixture(t, { oldInspectCode: 'CLI_NOT_CONFIGURED' });
  const blocked = await f.controller.invoke('oneClickConnect', { botId: 'bot1' });
  assert.equal(blocked.errorCode, 'CONFIG_EXISTS');
  assert.equal(f.state.disk.appId, 'cli_app');
  assert.equal(f.creations(), 0);

  const ready = await f.controller.invoke('recreateApp', { botId: 'bot1' });
  assert.equal(ready.phase, 'ready');
  assert.equal(f.state.disk.appId, 'cli_replacement');
  assert.equal(f.state.disk.configDir, f.directory);
  assert.equal(f.creations(), 1);
});

test('continuing a partially-created recovery app resumes setup instead of looping on CONFIG_EXISTS', async (t) => {
  const f = recoveryFixture(t, { failFirstInitialization: true });
  const interrupted = await f.controller.invoke('recreateApp', { botId: 'bot1' });
  assert.equal(interrupted.errorCode, 'AUTH_DENIED');
  assert.equal(f.state.disk.appId, 'cli_app');
  assert.equal(f.state.disk.recovery.appId, 'cli_replacement');

  const ready = await f.controller.invoke('oneClickConnect', { botId: 'bot1' });
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.errorCode, undefined);
  assert.equal(f.state.initializations.length, 2);
  assert.equal(f.state.disk.appId, 'cli_replacement');
  assert.equal(f.state.disk.recovery, undefined);
});

test('failed recreation preserves the old binding and retries the same initialized candidate', async (t) => {
  const f = recoveryFixture(t);
  const authorize = f.cli.authorize;
  f.cli.authorize = async () => ({ ok: false, error: { code: 'AUTH_DENIED' } });
  const failed = await f.controller.invoke('recreateApp');
  assert.equal(failed.errorCode, 'AUTH_DENIED');
  assert.equal(f.state.disk.appId, 'cli_app');
  assert.equal(f.state.disk.configDir, configDir);
  assert.equal(f.state.disk.recovery.appId, 'cli_replacement');
  assert.equal(failed.recoveryPending, true);
  assert.equal(failed.im, 'off');
  f.cli.authorize = authorize;
  const ready = await f.controller.invoke('oneClickConnect');
  assert.equal(ready.phase, 'ready');
  assert.equal(f.creations(), 1);
  assert.equal(f.state.initializations.length, 1);
  assert.equal(f.state.disk.recovery, undefined);
});

test('recreation never replaces a healthy app or one failing for a network reason', async (t) => {
  for (const code of [undefined, 'CLI_NETWORK_ERROR', 'AUTH_REQUIRED', 'IDENTITY_CONFLICT']) {
    const f = fixture(t);
    let created = false;
    f.state.createRecovery = () => { created = true; return configDir + '-new'; };
    if (code) f.cli.inspect = async () => ({ ok: false, error: { code } });
    const result = await f.controller.invoke('recreateApp');
    assert.notEqual(result.phase, 'ready');
    assert.equal(created, false);
    assert.equal(f.state.initializations.length, 0);
    assert.equal(f.state.disk.appId, 'cli_app');
  }
});

test('recreation cancellation waits for rollback; late OAuth completion cannot replace old binding', async (t) => {
  const f = recoveryFixture(t);
  const gate = deferred();
  f.cli.authorize = async (args) => { f.state.authorizations.push(args); return gate.promise; };
  const active = f.controller.invoke('recreateApp');
  await until(() => f.state.authorizations.length === 1);
  await f.controller.invoke('disconnect');
  await active;
  const preserved = structuredClone(f.state.disk);
  assert.equal(preserved.appId, 'cli_app');
  assert.equal(preserved.ownerOpenId, 'ou_owner');
  assert.equal(preserved.recovery.appId, 'cli_replacement');
  gate.resolve({ complete: true, user: { openId: 'ou_owner' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.state.disk, preserved);
  assert.equal((await f.controller.state()).im, 'off');
});

test('exit during recovery waits for durable old binding and candidate metadata without enabling channels', async (t) => {
  const f = recoveryFixture(t);
  const gate = deferred();
  f.cli.authorize = async (args) => { f.state.authorizations.push(args); return gate.promise; };
  const active = f.controller.invoke('recreateApp');
  await until(() => f.state.authorizations.length === 1);
  await f.controller.close();
  await active;
  assert.equal(f.state.disk.appId, 'cli_app');
  assert.equal(f.state.disk.configDir, configDir);
  assert.equal(f.state.disk.recovery.appId, 'cli_replacement');
  assert.equal((await f.controller.state()).toolsEnabled, false);
  gate.resolve({ complete: true, user: { openId: 'ou_owner' } });
});

test('recreation rejects an identity that differs from the completed OAuth result', async (t) => {
  const f = recoveryFixture(t);
  f.state.info.user.openId = 'ou_other';
  f.state.approve = async () => false;
  f.cli.authorize = async () => ({ complete: true, user: { openId: 'ou_authorized' } });
  const result = await f.controller.invoke('recreateApp');
  assert.equal(result.errorCode, 'IDENTITY_CONFLICT');
  assert.equal(f.state.dialogs.length, 0);
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.appId, 'cli_app');
  assert.equal(result.toolsEnabled, false);
});

test('explicit recreation and verified OAuth bind the app-scoped owner without another setup prompt', async (t) => {
  const f = recoveryFixture(t);
  f.state.info.user.openId = 'ou_new_app_scoped';
  f.state.approve = async () => false;
  const result = await f.controller.invoke('recreateApp');
  assert.equal(result.phase, 'ready');
  assert.equal(f.state.disk.ownerOpenId, 'ou_new_app_scoped');
  assert.equal(f.state.dialogs.length, 0);
  assert.equal((await request(f.state.entries[0])).body.error.code, 'APPROVAL_DENIED');
  assert.equal(f.state.dialogs.length, 1, 'per-call office confirmation is not setup consent');
  assert.equal(f.state.runs.length, 0);
});

test('restart resumes saved replacement metadata without recreating an already configured app', async (t) => {
  const f = fixture(t, { disk: { configDir, ownerOpenId: 'ou_owner', threadId: 'original',
    recovery: { configDir: configDir + '-replacement', appId: 'cli_replacement' } } });
  f.state.info.appId = 'cli_replacement';
  f.state.createRecovery = () => assert.fail('must reuse saved replacement');
  assert.equal((await f.controller.state()).recoveryPending, true);
  const result = await f.controller.invoke('oneClickConnect');
  assert.equal(result.phase, 'ready');
  assert.equal(f.state.disk.appId, 'cli_replacement');
  assert.equal(f.state.disk.configDir, configDir + '-replacement');
  assert.equal(f.state.disk.recovery, undefined);
  assert.equal(f.state.initializations.length, 0);
});

test('one-click requires a valid selected bot before preparing and never guesses the only bot', async (t) => {
  for (const botId of ['', 'missing']) {
    const f = fixture(t, { disk: { botId } });
    assert.match((await f.controller.invoke('oneClickConnect')).error, /bot/);
    assert.equal(f.state.preparations.length, 0);
    assert.equal(f.state.saves.length, 0);
    assert.equal(f.state.authorizations.length, 0);
  }
});

test('missing scopes open the safe admin page once, keep both channels off and retry the same app', async (t) => {
  const f = fixture(t, { disk: { ownerOpenId: 'ou_owner', threadId: 'saved_thread' } });
  const consoleUrl = 'https://open.feishu.cn/page/scope-apply?clientID=cli_app&scopes=docx:document:readonly';
  const authorize = f.cli.authorize;
  f.cli.authorize = async () => ({ ok: false, error: { code: 'SCOPE_REQUIRED', consoleUrl, detail: 'secret' } });
  const result = await f.controller.invoke('oneClickConnect');
  assert.equal(result.errorCode, 'SCOPE_REQUIRED');
  assert.match(result.error, /\u7ba1\u7406\u5458/);
  assert.match(result.error, /\u7b49\u5f85/);
  assert.equal(result.phase, 'error');
  assert.equal(result.toolsEnabled, false);
  assert.equal(result.im, 'off');
  assert.deepEqual(f.state.opened, [consoleUrl]);
  assert.doesNotMatch(JSON.stringify([result, f.state.disk]), /consoleUrl|scope-apply|secret/);
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.threadId, 'saved_thread');
  f.cli.authorize = authorize;
  const retry = await f.controller.invoke('oneClickConnect');
  assert.equal(retry.phase, 'ready');
  assert.equal(retry.errorCode, undefined);
  assert.equal(f.state.disk.appId, 'cli_app');
  assert.equal(f.state.initializations.length, 0);
});

test('source-shaped missing scopes construct the branded same-app recovery URL after OAuth and retry without initialization', async (t) => {
  for (const [brand, host] of [['feishu', 'feishu.cn'], ['lark', 'larksuite.com']]) {
    const f = fixture(t, { disk: { ownerOpenId: 'ou_owner', threadId: 'saved_thread' } });
    f.state.info.brand = brand;
    const authorize = f.cli.authorize;
    const userUrl = `https://accounts.${host}/device?code=public`;
    const recoveryUrl = `https://open.${host}/page/scope-apply?clientID=cli_app&scopes=docx:document:readonly,im:message`;
    f.cli.authorize = async ({ onAuthorization }) => {
      await onAuthorization(userUrl);
      return { ok: false, error: { code: 'SCOPE_REQUIRED', missing: ['docx:document:readonly', 'im:message'] } };
    };
    const result = await f.controller.invoke('oneClickConnect');
    assert.deepEqual(f.state.opened, [userUrl, recoveryUrl]);
    assert.equal(result.errorCode, 'SCOPE_REQUIRED');
    assert.equal(result.phase, 'error');
    assert.equal(result.im, 'off');
    assert.equal(result.toolsEnabled, false);
    assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
    assert.equal(f.state.disk.threadId, 'saved_thread');
    assert.doesNotMatch(JSON.stringify([result, f.state.disk]), /scope-apply|missing|code=public/);
    f.cli.authorize = authorize;
    assert.equal((await f.controller.invoke('oneClickConnect')).phase, 'ready');
    assert.equal(f.state.disk.appId, 'cli_app');
    assert.equal(f.state.initializations.length, 0);
  }
});

test('scope recovery never guesses permissions or parses raw warning hints', async (t) => {
  for (const missing of [undefined, null, [], 'im:message', ['admin:all'], ['im:message', 'unknown'],
    ['im:message&token=secret'], Array(8).fill('im:message')]) {
    const f = fixture(t);
    f.state.info.brand = 'feishu';
    f.cli.authorize = async () => ({ ok: false, error: { code: 'SCOPE_REQUIRED', missing,
      hint: 'https://open.feishu.cn/page/scope-apply?clientID=cli_app&scopes=im:message' } });
    const result = await f.controller.invoke('oneClickConnect');
    assert.equal(f.state.opened.length, 0);
    assert.equal(result.errorCode, 'SCOPE_REQUIRED');
    assert.doesNotMatch(result.error, /\u5df2\u6253\u5f00/);
  }
});

test('constructed scope recovery preserves the generic error when the host cannot open the browser', async (t) => {
  const f = fixture(t);
  f.state.info.brand = 'feishu';
  f.state.openHook = async () => { throw new Error('private browser failure'); };
  f.cli.authorize = async () => ({ ok: false, error: { code: 'SCOPE_REQUIRED', missing: ['im:message'] } });
  const result = await f.controller.invoke('oneClickConnect');
  assert.deepEqual(f.state.opened, ['https://open.feishu.cn/page/scope-apply?clientID=cli_app&scopes=im:message']);
  assert.equal(result.errorCode, 'SCOPE_REQUIRED');
  assert.equal(result.phase, 'error');
  assert.equal(result.toolsEnabled, false);
  assert.equal(result.im, 'off');
  assert.doesNotMatch(result.error, /\u5df2\u6253\u5f00|private/);
});

test('uncertain initialization only retries once after explicit native approval', async (t) => {
  for (const outcome of ['denied', 'accepted', 'stillUncertain', 'cancelled']) {
    const f = fixture(t, { disk: { appId: undefined, configDir, ownerOpenId: 'ou_owner', threadId: 'saved_thread' } });
    const inspect = f.cli.inspect;
    f.cli.inspect = async () => ({ ok: false, error: { code: 'CLI_NOT_CONFIGURED' } });
    f.cli.initialize = async (options) => {
      f.state.initializations.push(options);
      if (!options.retryUncertain || outcome === 'stillUncertain') {
        return { ok: false, error: { code: 'INITIALIZATION_UNCERTAIN', detail: 'secret' } };
      }
      assert.equal(f.state.dialogs.length, 1);
      f.cli.inspect = inspect;
      return { appId: 'cli_app', brand: 'feishu' };
    };
    const approval = deferred();
    f.state.approve = async () => outcome === 'cancelled' ? approval.promise : outcome !== 'denied';
    const pending = f.controller.invoke('oneClickConnect');
    if (outcome === 'cancelled') {
      await until(() => f.state.dialogs.length === 1);
      await f.controller.invoke('disconnect');
      approval.resolve(true);
    }
    const result = await pending;
    assert.equal(f.state.dialogs.length, 1, outcome);
    assert.match(f.state.dialogs[0].message, /\u4e2d\u65ad/);
    assert.match(f.state.dialogs[0].detail, /\u91cd\u590d\u521b\u5efa/);
    assert.match(f.state.dialogs[0].detail, /\u5df2\u6709\u5e94\u7528/);
    assert.equal(f.state.initializations[0].retryUncertain, undefined);
    assert.equal(f.state.initializations.length, ['accepted', 'stillUncertain'].includes(outcome) ? 2 : 1);
    if (f.state.initializations.length === 2) assert.equal(f.state.initializations[1].retryUncertain, true);
    assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
    if (outcome === 'accepted') assert.equal(result.phase, 'ready');
    else {
      assert.equal(result.toolsEnabled, false);
      assert.equal(result.im, 'off');
      assert.equal(f.state.disk.threadId, 'saved_thread');
      assert.equal(result.errorCode, outcome === 'cancelled' ? undefined : 'INITIALIZATION_UNCERTAIN');
    }
  }
});

test('partial initialization pins only the safe app ID, preserves owner and resumes without duplicate creation', async (t) => {
  for (const recovery of ['sameApp', 'differentApp', 'missingConfig']) {
    const f = fixture(t, { disk: { appId: undefined, configDir, ownerOpenId: 'ou_owner', threadId: 'saved_thread' } });
    const inspect = f.cli.inspect;
    f.cli.inspect = async () => ({ ok: false, error: { code: 'CLI_NOT_CONFIGURED' } });
    f.cli.initialize = async (options) => {
      f.state.initializations.push(options);
      return { ok: false, error: { code: 'CLI_NETWORK_ERROR', detail: 'secret' },
        app: { appId: 'cli_app', brand: 'feishu', appSecret: 'never-persist' } };
    };
    const result = await f.controller.invoke('oneClickConnect');
    assert.equal(result.errorCode, 'CLI_NETWORK_ERROR');
    assert.equal(f.state.disk.appId, 'cli_app');
    assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
    assert.equal(f.state.disk.threadId, 'saved_thread');
    assert.equal(result.phase, 'error');
    assert.doesNotMatch(JSON.stringify([result, f.state.disk]), /secret|never-persist|appSecret/);
    if (recovery !== 'missingConfig') f.cli.inspect = inspect;
    if (recovery === 'differentApp') f.state.info.appId = 'cli_other';
    const retry = await f.controller.invoke('oneClickConnect');
    assert.equal(retry.phase, recovery === 'sameApp' ? 'ready' : 'error');
    assert.equal(f.state.initializations.length, 1, 'never create again once an app ID is known');
    assert.equal(f.state.disk.appId, 'cli_app');
    assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
    assert.equal(f.state.dialogs.length, 0);
  }
});

test('scope recovery rejects unsafe, unrelated-app and secret-bearing URLs without losing the safe error', async (t) => {
  for (const consoleUrl of [undefined, 'https://evil.example/page/scope-apply?clientID=cli_app',
    'https://open.feishu.cn/page/scope-apply?clientID=cli_other',
    'https://open.feishu.cn/page/scope-apply?clientID=cli_app&token=secret',
    'https://open.feishu.cn/page/scope-apply?clientID=cli_app&clientID=cli_app',
    'https://open.feishu.cn:443/page/scope-apply?clientID=cli_app',
    'https://open.feishu.cn/page/scope-apply?clientID=cli_app#secret',
    'https://open.feishu.cn/page/scope-apply?clientID=cli_app&scopes=bad%20scope',
    'https://open.feishu.cn/page/scope-apply?clientID=cli_app\n']) {
    const f = fixture(t);
    f.cli.authorize = async () => ({ ok: false, error: { code: 'SCOPE_REQUIRED', consoleUrl } });
    const result = await f.controller.invoke('oneClickConnect');
    assert.equal(result.errorCode, 'SCOPE_REQUIRED');
    assert.equal(result.phase, 'error');
    assert.equal(f.state.opened.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /secret|https:/);
  }
});

test('scope page open failure and cancellation cannot enable channels or expose browser errors', async (t) => {
  for (const cancel of [false, true]) {
    const f = fixture(t, { disk: { ownerOpenId: 'ou_owner', threadId: 'saved_thread' } });
    const opening = deferred();
    f.state.openHook = async () => {
      if (cancel) await opening.promise;
      else throw new Error('private browser error');
    };
    f.cli.authorize = async () => ({ ok: false, error: { code: 'SCOPE_REQUIRED',
      consoleUrl: 'https://open.larksuite.com/page/scope-apply?clientID=cli_app' } });
    const pending = f.controller.invoke('oneClickConnect');
    if (cancel) {
      await until(() => f.state.opened.length === 1);
      await f.controller.invoke('disconnect');
      opening.resolve();
    }
    const result = await pending;
    assert.equal(result.errorCode, cancel ? undefined : 'SCOPE_REQUIRED');
    assert.equal(result.phase, cancel ? undefined : 'error');
    assert.equal(result.toolsEnabled, false);
    assert.equal(result.im, 'off');
    assert.equal(f.state.opened.length, 1);
    assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
    assert.equal(f.state.disk.threadId, 'saved_thread');
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
});

test('setup error codes are allowlisted and license review never mutates prior configuration', async (t) => {
  const f = fixture(t, { disk: { ownerOpenId: 'ou_owner', threadId: 'saved_thread' } });
  const before = structuredClone(f.state.disk);
  f.state.prepare = async () => { throw Object.assign(new Error('private'), { code: 'LICENSE_REVIEW_REQUIRED' }); };
  const result = await f.controller.invoke('oneClickConnect');
  assert.equal(result.errorCode, 'LICENSE_REVIEW_REQUIRED');
  assert.match(result.error, /\u8bb8\u53ef\u5ba1\u6838/);
  assert.deepEqual(f.state.disk, before);
  f.state.prepare = async () => { throw Object.assign(new Error('private'), { code: 'RAW_SECRET_CODE' }); };
  const unknown = await f.controller.invoke('oneClickConnect');
  assert.equal(unknown.errorCode, undefined);
  assert.doesNotMatch(JSON.stringify(unknown), /private|RAW_SECRET/);
});

test('known app blocks uncertain registration and renderer cannot request retryUncertain', async (t) => {
  const f = fixture(t, { disk: { configDir, ownerOpenId: 'ou_owner', threadId: 'saved_thread' } });
  f.cli.inspect = async () => ({ ok: false, error: { code: 'CLI_NOT_CONFIGURED' } });
  f.cli.initialize = async () => assert.fail('must not replace a known app');
  assert.equal((await f.controller.invoke('oneClickConnect')).errorCode, 'CONFIG_EXISTS');
  assert.equal(f.state.disk.appId, 'cli_app');
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.threadId, 'saved_thread');
  assert.equal(f.state.dialogs.length, 0);
  const calls = f.state.preparations.length;
  assert.ok((await f.controller.invoke('oneClickConnect', { retryUncertain: true })).error);
  assert.equal(f.state.preparations.length, calls);
});

test('download failure preserves prior paths, app, owner and task and exposes no raw errors', async (t) => {
  const f = fixture(t, { disk: { ownerOpenId: 'ou_owner', threadId: 'old_thread', records: ['om_old'] } });
  const before = structuredClone(f.state.disk);
  f.state.prepare = async ({ onPhase }) => { onPhase('downloadingNode'); throw new Error('secret download path'); };
  const result = await f.controller.invoke('oneClickConnect', { botId: 'bot1' });
  assert.equal(result.phase, 'error');
  assert.equal(result.toolsEnabled, false);
  assert.equal(result.im, 'off');
  assert.doesNotMatch(result.error, /secret/);
  assert.deepEqual(f.state.disk, before);
});

test('failed app creation resumes the persisted managed context without replacing legacy native config', async (t) => {
  const f = fixture(t, { disk: { appId: undefined, cliPath: '', nodePath: '' } });
  const inspect = f.cli.inspect;
  f.cli.inspect = async () => ({ ok: false, error: { code: 'CLI_NOT_CONFIGURED' } });
  f.cli.initialize = async () => ({ ok: false, error: { code: 'CLI_NETWORK_ERROR' } });
  assert.equal((await f.controller.invoke('oneClickConnect')).phase, 'error');
  assert.equal(f.state.disk.configDir, configDir);
  assert.equal(f.state.disk.cliPath, cliExe);
  assert.equal(f.state.disk.ownerOpenId, undefined);
  f.cli.initialize = async () => { f.cli.inspect = inspect; return { appId: 'cli_app', brand: 'feishu' }; };
  assert.equal((await f.controller.invoke('oneClickConnect')).phase, 'ready');
  assert.equal(f.state.preparations[1].existing.configDir, configDir);
  assert.equal(f.state.sessions.length, 1);

  const legacy = fixture(t, { disk: { ownerOpenId: 'ou_owner', threadId: 'old_thread' } });
  legacy.cli.inspect = async () => ({ ok: false, error: { code: 'CLI_NOT_CONFIGURED' } });
  const result = await legacy.controller.invoke('oneClickConnect');
  assert.match(result.error, /\u6062\u590d.*CLI/);
  assert.equal(legacy.state.disk.configDir, undefined);
  assert.equal(legacy.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(legacy.state.disk.threadId, 'old_thread');
  assert.equal(legacy.state.initializations.length, 0);
  assert.equal(legacy.state.authorizations.length, 0);
});

test('one-click rejects app or OAuth owner changes without overwriting saved bindings', async (t) => {
  for (const change of ['initialApp', 'initialUser', 'oauthUser', 'verifiedUser', 'verifiedApp', 'incomplete']) {
    const f = fixture(t, { disk: { ownerOpenId: 'ou_owner', threadId: 'old_thread' } });
    if (change === 'initialApp') f.state.info.appId = 'cli_other';
    if (change === 'initialUser') f.state.info.user.openId = 'ou_other';
    f.cli.authorize = async () => {
      if (change === 'verifiedUser') f.state.info.user.openId = 'ou_other';
      if (change === 'verifiedApp') f.state.info.appId = 'cli_other';
      return { complete: change !== 'incomplete', user: { openId: change === 'oauthUser' ? 'ou_other' : 'ou_owner' } };
    };
    const result = await f.controller.invoke('oneClickConnect');
    assert.equal(result.phase, 'error', change);
    assert.ok(result.error);
    assert.equal(result.im, 'off');
    assert.equal(result.toolsEnabled, false);
    assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
    assert.equal(f.state.disk.appId, 'cli_app');
    assert.equal(f.state.disk.threadId, 'old_thread');
    assert.equal(f.state.sessions.length, 0);
  }
});

test('one-click waits for listener READY and MCP registration, then tears down both on partial failure', async (t) => {
  const f = fixture(t);
  f.cli.consume = (callbacks) => {
    const consumer = { ...callbacks, stopped: false, stop() { this.stopped = true; } };
    f.state.consumers.push(consumer);
    return consumer;
  };
  const pending = f.controller.invoke('oneClickConnect');
  await until(() => f.state.consumers.length === 1);
  assert.equal((await f.controller.state()).phase, 'starting');
  assert.equal((await f.controller.state()).pending, true);
  assert.equal((await f.controller.state()).toolsEnabled, false);
  const registration = deferred();
  f.state.requestHook = async (url) => { if (url.endsWith('/test')) await registration.promise; };
  f.state.consumers[0].onReady();
  await until(() => f.state.requests.some((v) => v.url.endsWith('/test')));
  assert.equal((await f.controller.state()).phase, 'starting');
  f.state.testResult = { ok: false };
  registration.resolve();
  const result = await pending;
  assert.equal(result.phase, 'error');
  assert.equal(result.im, 'off');
  assert.equal(result.toolsEnabled, false);
  assert.equal(f.state.consumers[0].stopped, true);
  assert.equal(f.state.entries[0].enabled, false);
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.threadId, 'feishu_thread');
  f.state.testResult = { ok: true };
  const retry = f.controller.invoke('oneClickConnect');
  await until(() => f.state.consumers.length === 2);
  f.state.consumers[1].onReady();
  assert.equal((await retry).phase, 'ready');
  assert.equal(f.state.sessions.length, 1);
});

test('selectBot offline only saves selection; online it validates before stopping and retains tool capability', async (t) => {
  const f = fixture(t, { disk: { cliPath: '', nodePath: '', appId: undefined, botId: '' } });
  assert.equal((await f.controller.invoke('selectBot', { botId: 'bot1' })).botId, 'bot1');
  assert.equal(f.state.preparations.length, 0);
  assert.equal(f.state.cliOptions.length, 0);
  assert.equal(f.state.sessions.length, 0);
  assert.equal((await f.controller.invoke('oneClickConnect')).phase, 'ready');
  const old = f.state.consumers[0];
  const entry = structuredClone(f.state.entries[0]);
  assert.ok((await f.controller.invoke('selectBot', { botId: 'missing' })).error);
  assert.equal(old.stopped, false, 'invalid target must not interrupt the current connection');
  assert.equal(f.state.disk.botId, 'bot1');
  assert.equal(f.state.disk.threadId, 'feishu_thread');
  f.state.bot = { id: 'bot2', threadId: 'original2', tasks: [] };
  f.kernel.createSession = async (args) => { f.state.sessions.push(args); return { threadId: 'new_thread' }; };
  const result = await f.controller.invoke('selectBot', { botId: 'bot2' });
  assert.equal(result.phase, 'ready');
  assert.equal(result.botId, 'bot2');
  assert.equal(result.im, 'ready');
  assert.equal(result.toolsEnabled, true);
  assert.equal(old.stopped, true);
  assert.equal(f.state.disk.threadId, 'new_thread');
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.appId, 'cli_app');
  assert.deepEqual(f.state.entries[0], entry);
  assert.equal(f.state.authorizations.length, 1);
  assert.equal(f.state.preparations.length, 1);
  assert.equal(f.state.dialogs.length + f.state.enableDialogs.length, 0);
  f.state.consumers.at(-1).onMessage(message());
  await until(() => f.state.sends.length === 1);
  assert.equal(f.state.sends[0].botId, 'bot2');
  assert.equal(f.state.sends[0].threadId, 'new_thread');
});

test('one-click cancellation at every setup boundary aborts work and rejects late callbacks without enabling', async (t) => {
  for (const boundary of ['bots', 'prepare', 'version', 'inspect', 'initialize', 'authorize', 'browser',
    'saveRuntime', 'saveOwner', 'saveThread', 'createSession', 'ready', 'validateNode', 'register', 'test', 'enable']) {
    for (const stop of ['disconnect', 'close']) {
      const f = fixture(t, { disk: { appId: undefined } });
      const gate = deferred();
      let reached = false;
      let signal;
      let authCallback;
      const block = async (options, result) => {
        reached = true;
        signal = options?.signal;
        await gate.promise;
        return result;
      };
      if (boundary === 'bots') f.kernel.bots = (options) => block(options, [f.state.bot]);
      if (boundary === 'prepare') f.state.prepare = (options) => block(options, { cliPath: cliExe, nodePath: nodeExe, configDir });
      if (boundary === 'version') f.cli.version = (options) => block(options, f.state.version);
      if (boundary === 'inspect') f.cli.inspect = (options) => block(options, f.state.info);
      if (boundary === 'initialize') {
        f.cli.inspect = async () => ({ ok: false, error: { code: 'CLI_NOT_CONFIGURED' } });
        f.cli.initialize = (options) => { authCallback = options.onAuthorization; return block(options, { appId: 'cli_app', brand: 'feishu' }); };
      }
      if (boundary === 'authorize' || boundary === 'browser') f.cli.authorize = async (options) => {
        authCallback = options.onAuthorization;
        if (boundary === 'browser') await authCallback('https://accounts.feishu.cn/device');
        return block(options, { complete: true, user: { openId: 'ou_owner' } });
      };
      if (boundary.startsWith('save')) f.state.saveHook = async (value) => {
        if ((boundary === 'saveRuntime' && !value.appId) ||
            (boundary === 'saveOwner' && value.ownerOpenId) || (boundary === 'saveThread' && value.threadId)) await block();
      };
      if (boundary === 'createSession') f.kernel.createSession = (options) => block(options, { threadId: 'late_thread' });
      if (boundary === 'ready') f.cli.consume = (callbacks) => {
        const consumer = { ...callbacks, stopped: false, stop() { this.stopped = true; } };
        f.state.consumers.push(consumer);
        reached = true;
        return consumer;
      };
      if (boundary === 'validateNode') f.state.validate = (_path, options) => block(options, true);
      f.state.requestHook = async (url, opts) => {
        if ((boundary === 'register' && opts.body?.name) || (boundary === 'test' && url.endsWith('/test')) ||
            (boundary === 'enable' && opts.method === 'PATCH' && opts.body.enabled)) await block(opts);
      };
      const pending = f.controller.invoke('oneClickConnect');
      await until(() => reached);
      const stopping = stop === 'close' ? f.controller.close() : f.controller.invoke('disconnect');
      assert.equal((await f.controller.state()).pending, false, `${boundary}/${stop}`);
      assert.equal((await f.controller.state()).im, 'off');
      assert.equal((await f.controller.state()).toolsEnabled, false);
      if (signal) assert.equal(signal.aborted, true);
      gate.resolve();
      await Promise.all([pending, stopping]);
      f.state.preparations[0]?.onPhase('downloadingCli');
      if (authCallback) await assert.rejects(authCallback('https://accounts.feishu.cn/stale'));
      for (const consumer of f.state.consumers) { consumer.onReady(); consumer.onMessage(message()); }
      await new Promise((resolve) => setImmediate(resolve));
      const result = await f.controller.state();
      assert.equal(result.phase, undefined, `${boundary}/${stop}`);
      assert.equal(result.toolsEnabled, false);
      assert.equal(result.im, 'off');
      assert.equal(f.state.entries.some((entry) => entry.enabled), false);
      assert.equal(f.state.sends.length, 0);
    }
  }
});

test('runtime progress is generation-safe and the overall one-click deadline allows fifteen minutes', async (t) => {
  const clock = fakeClock();
  const f = fixture(t, { clock });
  const old = deferred();
  f.state.prepare = (options) => { options.onPhase('downloadingCli'); return old.promise; };
  const first = f.controller.invoke('oneClickConnect');
  await until(() => f.state.preparations.length === 1);
  await clock.advance(360001);
  assert.equal((await f.controller.state()).pending, true);
  assert.equal((await f.controller.state()).phase, 'downloadingCli');
  await clock.advance(540000);
  assert.equal((await first).phase, 'error');
  assert.equal(f.state.preparations[0].signal.aborted, true);
  const next = deferred();
  f.state.prepare = (options) => { options.onPhase('downloadingNode'); return next.promise; };
  const second = f.controller.invoke('oneClickConnect');
  await until(() => f.state.preparations.length === 2);
  f.state.preparations[0].onPhase('detecting');
  old.resolve({ cliPath: cliExe, nodePath: nodeExe });
  assert.equal((await f.controller.state()).phase, 'downloadingNode');
  next.resolve({ cliPath: cliExe, nodePath: nodeExe });
  assert.equal((await second).phase, 'ready');
  f.state.preparations[1].onPhase('downloadingCli');
  assert.equal((await f.controller.state()).phase, 'ready');
});

test('configDir is host-only, absolute, persistent and cannot silently replace a saved app context', async (t) => {
  for (const invalid of ['relative', '/context\ninvalid', null]) {
    const f = fixture(t, { disk: { configDir: invalid } });
    assert.ok((await f.controller.invoke('oneClickConnect')).error);
    assert.equal(f.state.preparations.length, 0);
    assert.equal(f.state.saves.length, 0);
  }
  const f = fixture(t);
  assert.ok((await f.controller.invoke('oneClickConnect', { configDir })).error);
  assert.equal(f.state.preparations.length, 0);
  f.state.prepare = async () => ({ cliPath: cliExe, nodePath: nodeExe, configDir });
  assert.equal((await f.controller.invoke('oneClickConnect')).phase, 'error');
  assert.equal(f.state.disk.configDir, undefined);
  assert.equal(f.state.saves.length, 0);
  const reopened = fixture(t, { disk: { configDir, schemaVersion: 2, ownerOpenId: 'ou_owner' } });
  assert.equal((await reopened.controller.invoke('oneClickConnect')).phase, 'ready');
  assert.equal(reopened.state.preparations[0].existing.configDir, configDir);
  assert.equal(reopened.state.cliOptions[0].configDir, configDir);
  assert.equal(reopened.state.initializations.length, 0);
});

test('failed or cancelled bot switching retains identity and cannot restart a stale listener', async (t) => {
  for (const cancel of [false, true]) {
    const f = fixture(t);
    await f.controller.invoke('oneClickConnect');
    f.state.bot = { id: 'bot2', threadId: 'original2', tasks: [] };
    const creating = deferred();
    let signal;
    f.kernel.createSession = (options) => { signal = options.signal; return creating.promise; };
    const pending = f.controller.invoke('selectBot', { botId: 'bot2' });
    await until(() => signal);
    assert.equal(f.state.consumers[0].stopped, true);
    assert.equal(f.state.disk.threadId, undefined);
    if (cancel) await f.controller.invoke('disconnect');
    if (cancel) creating.resolve({ threadId: 'stale_thread' });
    else creating.reject(new Error('private task failure'));
    const result = await pending;
    assert.equal(result.phase, cancel ? undefined : 'error');
    assert.equal(result.toolsEnabled, false);
    assert.equal(result.im, 'off');
    assert.equal(f.state.entries[0].enabled, false);
    assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
    assert.equal(f.state.disk.appId, 'cli_app');
    assert.equal(f.state.disk.threadId, undefined);
    assert.equal(f.state.consumers.length, 1);
    assert.equal(signal.aborted, true);
  }
});

test('bot switching refuses a changed identity before discarding the saved task', async (t) => {
  const f = fixture(t);
  await f.controller.invoke('oneClickConnect');
  f.state.bot = { id: 'bot2', threadId: 'original2', tasks: [] };
  f.state.info.user.openId = 'ou_other';
  const result = await f.controller.invoke('selectBot', { botId: 'bot2' });
  assert.equal(result.phase, 'error');
  assert.equal(result.toolsEnabled, false);
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.botId, 'bot1');
  assert.equal(f.state.disk.threadId, 'feishu_thread');
});

test('one-click verifies sanitized CLI version before any browser work and never renders raw progress', async (t) => {
  const f = fixture(t);
  f.state.version = { version: '1.0.94 private', supported: false, error: { code: 'CLI_VERSION', detail: 'secret' } };
  f.state.prepare = async ({ onPhase }) => {
    onPhase({ phase: 'downloadingCli', secret: 'private' });
    onPhase('raw secret progress');
    return { cliPath: cliExe, nodePath: nodeExe };
  };
  const result = await f.controller.invoke('oneClickConnect');
  assert.equal(result.phase, 'error');
  assert.equal(result.version, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private|secret/);
  assert.equal(f.state.initializations.length + f.state.authorizations.length, 0);
});

test('listener reconnect never leaves one-click phase green without a READY listener', async (t) => {
  const clock = fakeClock();
  const f = fixture(t, { clock });
  assert.equal((await f.controller.invoke('oneClickConnect')).phase, 'ready');
  f.state.consumers[0].onExit();
  assert.equal((await f.controller.state()).phase, 'starting');
  await clock.advance(1000);
  assert.equal((await f.controller.state()).phase, 'ready');
  await f.controller.invoke('disconnect');
  f.state.consumers.at(-1).onReady();
  assert.equal((await f.controller.state()).phase, undefined);
});

test('lazy initialization filters persistence and snapshots are immutable with no auto-start', async (t) => {
  const f = fixture(t, { disk: { toolsEnabled: true, im: 'ready', token: 'never', login: { deviceCode: 'never' },
    ownerOpenId: 'ou_owner', records: ['om_one', 'bad', 'om_one'] } });
  assert.equal(f.state.loads, 0);
  const [a, b] = await Promise.all([f.controller.state(), f.controller.state()]);
  assert.equal(f.state.loads, 1);
  assert.equal(a.supported, true);
  assert.equal(a.toolsEnabled, false);
  assert.equal(a.im, 'off');
  assert.ok(Object.isFrozen(a));
  assert.notEqual(a, b);
  assert.equal(f.state.consumers.length, 0);
  await f.controller.invoke('probe');
  assert.deepEqual(f.state.disk.records, ['om_one']);
  assert.deepEqual(Object.keys(f.state.disk).sort(), ['appId', 'botId', 'cliPath', 'nodePath', 'ownerOpenId', 'records']);
});

test('failed load fails closed without overwriting encrypted configuration', async (t) => {
  const f = fixture(t, { load: () => { throw new Error('raw private path'); } });
  const result = await f.controller.invoke('pair');
  assert.ok(result.error);
  assert.doesNotMatch(result.error, /raw private/);
  assert.equal(f.state.saves.length, 0);
  assert.equal(f.state.consumers.length, 0);
});

test('native path selection and version probes reject renderer execution inputs and wrong versions', async (t) => {
  const f = fixture(t);
  await f.controller.invoke('chooseCli', { executable: '/evil' });
  assert.equal(f.state.chosen.length, 0);
  f.state.choice = 'relative';
  assert.ok((await f.controller.invoke('chooseCli')).error);
  f.state.choice = cliExe;
  f.state.version = { version: '1.0.94', supported: true };
  assert.ok((await f.controller.invoke('chooseCli')).error);
  f.state.version = { version: '1.0.93', supported: true };
  assert.equal((await f.controller.invoke('chooseCli')).version, '1.0.93');
  f.state.choice = cliExe;
  assert.ok((await f.controller.invoke('chooseNode')).error);
  f.state.choice = nodeExe;
  f.state.validate = async () => false;
  assert.ok((await f.controller.invoke('chooseNode')).error);
  f.state.validate = async (selected) => selected === nodeExe;
  assert.equal((await f.controller.invoke('chooseNode')).nodePath, nodeExe);
  f.state.info.bot.verified = false;
  f.state.info.user.verified = false;
  const result = await f.controller.invoke('probe');
  assert.equal(result.botAuthorized, false);
  assert.equal(result.userAuthorized, false);
});

test('login keeps device code in memory and whitelists the CLI URL independently', async (t) => {
  const f = fixture(t);
  const result = await f.controller.invoke('login');
  assert.equal(result.login.url, f.state.opened[0]);
  assert.ok(Object.isFrozen(result.login));
  assert.doesNotMatch(JSON.stringify([result, f.state.disk]), /secret_device/);
  await f.controller.invoke('completeLogin');
  assert.equal(f.state.completedCode, 'secret_device');
  assert.equal((await f.controller.state()).login, undefined);
  f.cli.login = async () => ({ verificationUrl: 'https://evil.example/', deviceCode: 'device', expiresIn: 100 });
  assert.ok((await f.controller.invoke('login')).error);
  assert.equal(f.state.opened.length, 1);
});

test('pairing rejects unknown bot, missing bot auth, strangers, wrong code, groups and denial', async (t) => {
  const f = fixture(t);
  assert.ok((await f.controller.invoke('pair', { botId: 'missing' })).error);
  f.state.info.botReady = false;
  assert.ok((await f.controller.invoke('pair', { botId: 'bot1' })).error);
  assert.equal(f.state.consumers.length, 0);
  f.state.info.botReady = true;
  const result = await f.controller.invoke('pair', { botId: 'bot1' });
  assert.match(result.pairingCode, /^[a-f0-9]{32}$/);
  const consumer = f.state.consumers.at(-1);
  consumer.onMessage(message('ou_stranger', 'om_stranger', result.pairingCode));
  consumer.onMessage(message('ou_owner', 'om_wrong', `${result.pairingCode} `));
  consumer.onMessage(message('ou_owner', 'om_group', result.pairingCode, { chat_type: 'group' }));
  consumer.onMessage(message('ou_owner', 'om_bot', result.pairingCode, { sender_type: 'bot' }));
  consumer.onMessage(message('ou_owner', 'om_task', 'do a task'));
  consumer.onMessage(message('ou_owner', 'om_json', JSON.stringify({ text: result.pairingCode })));
  assert.equal(f.state.dialogs.length, 0);
  f.state.approve = async () => false;
  consumer.onMessage(message('ou_owner', 'om_deny', result.pairingCode));
  await until(async () => (await f.controller.state()).error);
  assert.match(f.state.dialogs[0].detail, /ou_owner/);
  assert.equal(f.state.disk.ownerOpenId, undefined);
  assert.equal(f.state.sends.length, 0);
});

test('pairing can precede OAuth, expires in five minutes, and stale approval cannot bind', async (t) => {
  const clock = fakeClock();
  const f = fixture(t, { clock });
  f.state.info.user = { available: false, status: 'missing', verified: false };
  const result = await f.controller.invoke('pair');
  const approval = deferred();
  f.state.approve = () => approval.promise;
  const consumer = f.state.consumers.at(-1);
  consumer.onMessage(message('ou_prelogin', 'om_pair', result.pairingCode));
  await until(() => f.state.dialogs.length === 1);
  await clock.advance(300000);
  approval.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await f.controller.state()).pairingCode, undefined);
  assert.equal(f.state.disk.ownerOpenId, undefined);
  assert.equal(consumer.stopped, true);
  f.state.approve = async () => true;
  const next = await f.controller.invoke('pair');
  assert.notEqual(next.pairingCode, result.pairingCode);
  f.state.consumers.at(-1).onMessage(message('ou_prelogin', 'om_pair2', next.pairingCode));
  await until(() => f.state.disk.ownerOpenId === 'ou_prelogin');
});

test('connect requires native task confirmation, pins target and never accepts stranger/bot/group', async (t) => {
  const f = fixture(t);
  assert.ok((await f.controller.invoke('connect')).error);
  await pair(f);
  f.state.approve = async () => false;
  assert.ok((await f.controller.invoke('connect')).error);
  assert.equal(f.state.sessions.length, 0);
  f.state.approve = async () => true;
  assert.equal((await f.controller.invoke('connect')).im, 'ready');
  assert.equal(f.state.sessions.length, 1);
  assert.match(f.state.dialogs.at(-1).message, /\u521b\u5efa.*\u6fc0\u6d3b.*\u98de\u4e66/);
  assert.equal(f.state.disk.threadId, 'feishu_thread');
  const consumer = f.state.consumers.at(-1);
  consumer.onMessage(message('ou_stranger'));
  consumer.onMessage(message('ou_owner', 'om_bot', 'hello', { sender_type: 'bot' }));
  consumer.onMessage(message('ou_owner', 'om_group', 'hello', { chat_type: 'group' }));
  consumer.onMessage(message('ou_owner', 'om_image', 'hello', { message_type: 'image' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.sends.length, 0);
  consumer.onMessage(message());
  consumer.onMessage(message());
  await until(() => f.state.replies.length === 1);
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.sends[0].sendId, createHash('sha256').update('om_one').digest('hex'));
  assert.equal(f.state.sends[0].threadId, 'feishu_thread');
  assert.equal(f.state.replies[0][0], 'om_one');
  await f.controller.invoke('disconnect');
  await f.controller.invoke('connect');
  assert.equal(f.state.sessions.length, 1);
});

test('attempt IDs persist bounded with no text and restart never replays uncertain tasks', async (t) => {
  const f = fixture(t, { disk: { records: Array.from({ length: 1000 }, (_, i) => `om_old${i}`) } });
  const consumer = await connect(f);
  f.kernel.sendAndWait = async (args) => { f.state.sends.push(args); throw new Error('raw kernel secret'); };
  consumer.onMessage(message());
  await until(async () => (await f.controller.state()).error);
  assert.equal(f.state.disk.records.length, 1000);
  assert.ok(f.state.disk.records.includes('om_one'));
  assert.doesNotMatch(JSON.stringify(f.state.disk), /hello|raw kernel/);
  assert.match((await f.controller.state()).error, /\u4e0d\u4fdd\u8bc1/);
  consumer.onMessage(message());
  assert.equal(f.state.sends.length, 1);
  await f.controller.close();
  const reopened = fixture(t, { disk: f.state.disk });
  reopened.state.bot = structuredClone(f.state.bot);
  await reopened.controller.invoke('connect');
  reopened.state.consumers.at(-1).onMessage(message());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reopened.state.sends.length, 0);
});

test('persistence failure prevents kernel delivery', async (t) => {
  const f = fixture(t);
  const consumer = await connect(f);
  f.state.saveHook = async (value) => { if (value.records.includes('om_one')) throw new Error('disk'); };
  consumer.onMessage(message());
  await until(async () => (await f.controller.state()).error);
  assert.equal(f.state.sends.length, 0);
});

test('owner queue is serialized and bounded to sixteen pending messages', async (t) => {
  const f = fixture(t);
  const consumer = await connect(f);
  const first = deferred();
  f.kernel.sendAndWait = async (args) => { f.state.sends.push(args); return first.promise; };
  consumer.onMessage(message());
  await until(() => f.state.sends.length === 1);
  for (let i = 0; i < 30; i++) consumer.onMessage(message('ou_owner', `om_more${i}`));
  assert.equal(f.state.sends.length, 1);
  first.resolve({ text: 'reply' });
  await until(() => f.state.replies.length === 17);
  assert.equal(f.state.sends.length, 17);
  assert.equal(f.state.disk.records.length, 17);
});

test('disconnect aborts waiting, drops queue and guards late consumer and kernel callbacks', async (t) => {
  const f = fixture(t);
  const consumer = await connect(f);
  const wait = deferred();
  f.kernel.sendAndWait = async (args) => { f.state.sends.push(args); return wait.promise; };
  consumer.onMessage(message());
  await until(() => f.state.sends.length === 1);
  consumer.onMessage(message('ou_owner', 'om_queued'));
  await f.controller.invoke('disconnect');
  assert.equal(f.state.sends[0].signal.aborted, true);
  assert.equal(consumer.stopped, true);
  consumer.onReady();
  consumer.onExit();
  consumer.onMessage(message('ou_owner', 'om_late'));
  wait.resolve({ text: 'late' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await f.controller.state()).im, 'off');
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.replies.length, 0);
  assert.match((await f.controller.state()).error, /\u4e0d\u4fdd\u8bc1/);
});

test('close immediately cancels a stale native create-task approval', async (t) => {
  const f = fixture(t);
  await pair(f);
  const approval = deferred();
  f.state.approve = () => approval.promise;
  const pending = f.controller.invoke('connect');
  await until(() => f.state.dialogs.length === 2);
  const closing = f.controller.close();
  approval.resolve(true);
  await Promise.all([pending, closing]);
  assert.equal(f.state.sessions.length, 0);
  assert.equal((await f.controller.state()).pending, false);
});

test('reply chunks preserve Unicode, stable UUIDs and never retry uncertain CLI writes', async (t) => {
  const f = fixture(t);
  const consumer = await connect(f);
  const text = `${'x'.repeat(11999)}\u{1f600}${'y'.repeat(13000)}`;
  f.kernel.sendAndWait = async () => ({ text });
  consumer.onMessage(message());
  await until(() => f.state.replies.length === 3);
  assert.equal(f.state.replies.map((v) => v[1]).join(''), text);
  for (const [target, chunk, uuid] of f.state.replies) {
    assert.equal(target, 'om_one');
    assert.ok(chunk.length <= 12000 && chunk.isWellFormed());
    assert.match(uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  }
  f.cli.sendReply = async (...args) => { f.state.replies.push(args); return { ok: false }; };
  consumer.onMessage(message('ou_owner', 'om_uncertain'));
  await until(async () => (await f.controller.state()).error);
  assert.equal(f.state.replies.length, 4);
});

test('consumer reconnection backs off, ignores old generations and stops after five retries', async (t) => {
  const clock = fakeClock();
  const f = fixture(t, { clock, disk: { ownerOpenId: 'ou_owner' } });
  await f.controller.invoke('connect');
  const first = f.state.consumers[0];
  for (const delay of [1000, 2000, 4000, 8000, 16000]) {
    f.state.consumers.at(-1).onExit();
    assert.equal((await f.controller.state()).im, 'reconnecting');
    await clock.advance(delay - 1);
    assert.equal((await f.controller.state()).im, 'reconnecting');
    await clock.advance(1);
    assert.equal((await f.controller.state()).im, 'ready');
  }
  first.onMessage(message());
  assert.equal(f.state.sends.length, 0);
  f.state.consumers.at(-1).onExit();
  assert.equal((await f.controller.state()).im, 'error');
  await clock.advance(100000);
  assert.equal(f.state.consumers.length, 6);
});

test('tools register narrow broker credentials then test and enable without IM', async (t) => {
  const f = fixture(t);
  const result = await f.controller.invoke('enableTools');
  assert.equal(result.toolsEnabled, true);
  assert.equal(result.im, 'off');
  assert.equal(f.state.consumers.length, 0);
  const entry = f.state.entries[0];
  assert.equal(entry.command, nodeExe);
  assert.deepEqual(entry.args, [mcpPath]);
  assert.deepEqual(Object.keys(entry.env).sort(), ['TT_FEISHU_BRIDGE_TOKEN', 'TT_FEISHU_BRIDGE_URL']);
  assert.match(entry.env.TT_FEISHU_BRIDGE_TOKEN, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify([result, f.state.disk]), /TT_FEISHU|BRIDGE|127\.0\.0\.1/);
  assert.deepEqual(f.state.requests.filter((v) => v.method).map((v) => [v.method, v.url]),
    [['POST', '/api/mcp/servers'], ['POST', `${MCP}/test`], ['PATCH', MCP]]);
});

const toolArguments = {
  feishu_document_read: { documentId: 'doc123' },
  feishu_document_create: { title: '<title>', text: '<literal> & text' },
  feishu_calendar_list: { calendarId: 'calendar', start: '2026-09-07T00:00:00Z', end: '2026-09-08T00:00:00Z' },
  feishu_calendar_event_create: { calendarId: 'calendar', summary: 'meeting', start: '2026-09-07T00:00:00Z', end: '2026-09-08T00:00:00Z' },
  feishu_user_send: { userId: 'ou_recipient', text: 'message' },
};
test('EVERY tool including reads confirms original parameters and current identity; refusal never runs', async (t) => {
  const f = fixture(t);
  await f.controller.invoke('enableTools');
  for (const [name, args] of Object.entries(toolArguments)) {
    const response = await request(f.state.entries[0], { name, arguments: args });
    assert.equal(response.body.ok, true);
    const detail = f.state.dialogs.at(-1).detail;
    assert.match(detail, /ou_owner/);
    assert.ok(detail.includes(JSON.stringify({ name, arguments: args }, null, 2)));
  }
  assert.equal(f.state.runs.length, 5);
  assert.equal(f.state.dialogs.length, 5);
  f.state.approve = async () => false;
  const refused = await request(f.state.entries[0]);
  assert.equal(refused.body.error.code, 'APPROVAL_DENIED');
  assert.equal(f.state.runs.length, 5);
  f.state.approve = async () => { throw new Error('private details'); };
  assert.equal((await request(f.state.entries[0])).body.ok, false);
  assert.equal(f.state.runs.length, 5);
});

test('broker rejects browsers, wrong token, malformed bodies and arbitrary tools before confirmation', async (t) => {
  const f = fixture(t);
  await f.controller.invoke('enableTools');
  const entry = f.state.entries[0];
  for (const headers of [{ origin: 'null' }, { 'sec-fetch-mode': 'cors' }, { referer: 'http://localhost/' },
    { authorization: 'Bearer wrong' }, { host: 'evil.example' }]) {
    assert.equal((await request(entry, undefined, headers)).status, 401);
  }
  assert.equal((await request(entry, { name: 'exec', arguments: { command: 'evil' } })).body.error.code, 'UNKNOWN_TOOL');
  assert.equal((await request(entry, { name: 'feishu_document_read', arguments: { documentId: 'x', url: 'https://evil' } })).body.error.code, 'INVALID_ARGUMENTS');
  assert.equal((await request(entry, undefined, {}, '{bad')).body.error.code, 'INVALID_ARGUMENTS');
  const large = await request(entry, undefined, {}, 'x'.repeat(65537));
  assert.ok(large.closed || large.body.ok === false);
  assert.equal(f.state.dialogs.length, 0);
  assert.equal(f.state.runs.length, 0);
});

test('tool calls are single-flight and approval timeout fails closed even after late acceptance', async (t) => {
  const clock = fakeClock();
  const f = fixture(t, { clock });
  await f.controller.invoke('enableTools');
  const approval = deferred();
  f.state.approve = () => approval.promise;
  const pending = request(f.state.entries[0]);
  await until(() => f.state.dialogs.length === 1);
  assert.equal((await request(f.state.entries[0])).status, 429);
  await clock.advance(120000);
  assert.equal((await pending).body.error.code, 'APPROVAL_TIMEOUT');
  approval.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.runs.length, 0);
});

test('disconnect/disable invalidate tool approvals and running calls before registry cleanup', async (t) => {
  for (const action of ['disconnect', 'disableTools']) {
    const f = fixture(t);
    await f.controller.invoke('enableTools');
    const old = structuredClone(f.state.entries[0]);
    const approval = deferred();
    f.state.approve = () => approval.promise;
    const pending = request(old);
    await until(() => f.state.dialogs.length === 1);
    const cleanup = deferred();
    f.state.requestHook = async (_url, opts) => { if (opts.method === 'PATCH') await cleanup.promise; };
    const stopping = f.controller.invoke(action);
    assert.equal((await f.controller.state()).toolsEnabled, false);
    approval.resolve(true);
    assert.ok((await pending).closed);
    assert.ok((await request(old)).closed);
    assert.equal(f.state.runs.length, 0);
    cleanup.resolve();
    await stopping;
    assert.equal(f.state.entries[0].enabled, false);
  }
  const f = fixture(t);
  await f.controller.invoke('enableTools');
  const run = deferred();
  f.cli.run = async (...args) => { f.state.runs.push(args); return run.promise; };
  const pending = request(f.state.entries[0]);
  await until(() => f.state.runs.length === 1);
  await f.controller.invoke('disableTools');
  assert.equal(f.state.runs[0][1].signal.aborted, true);
  run.resolve({ ok: true });
  assert.ok((await pending).closed);
});

test('account/app changes revoke runtime, preserve binding and recheck after native approval', async (t) => {
  const f = fixture(t);
  const consumer = await connect(f);
  await f.controller.invoke('enableTools');
  const approval = deferred();
  f.state.approve = () => approval.promise;
  const pending = request(f.state.entries[0]);
  await until(() => f.state.dialogs.length === 3);
  f.state.info.user.openId = 'ou_other';
  approval.resolve(true);
  await pending;
  await until(async () => !(await f.controller.state()).toolsEnabled);
  assert.equal(f.state.runs.length, 0);
  assert.equal(consumer.stopped, true);
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.threadId, 'feishu_thread');
  f.state.approve = async () => true;
  await f.controller.invoke('enableTools');
  f.state.info.appId = 'cli_changed';
  await f.controller.invoke('probe');
  assert.equal((await f.controller.state()).toolsEnabled, false);
});

test('every call verifies OAuth and cannot use a mismatched persisted owner', async (t) => {
  const f = fixture(t, { disk: { ownerOpenId: 'ou_owner' } });
  await f.controller.invoke('enableTools');
  f.state.info.user.verified = false;
  const result = await request(f.state.entries[0]);
  assert.ok(result.closed || result.body.ok === false);
  assert.equal(f.state.runs.length, 0);
  assert.equal(f.state.dialogs.length, 0);
  assert.equal((await f.controller.state()).toolsEnabled, false);
});

test('owned MCP re-registration rotates capability and failure leaves it disabled', async (t) => {
  const f = fixture(t);
  await f.controller.invoke('enableTools');
  const old = structuredClone(f.state.entries[0]);
  await f.controller.invoke('disableTools');
  await f.controller.invoke('enableTools');
  const next = f.state.entries[0];
  assert.notEqual(next.env.TT_FEISHU_BRIDGE_TOKEN, old.env.TT_FEISHU_BRIDGE_TOKEN);
  assert.ok(f.state.requests.some((v) => v.method === 'PUT'));
  assert.equal((await request(next, undefined, { authorization: `Bearer ${old.env.TT_FEISHU_BRIDGE_TOKEN}` })).status, 401);
  await f.controller.invoke('disableTools');
  f.state.testResult = { ok: false, error: 'private' };
  const result = await f.controller.invoke('enableTools');
  assert.equal(result.toolsEnabled, false);
  assert.ok(result.error);
  assert.equal(f.state.entries[0].enabled, false);
  assert.ok((await request(f.state.entries[0])).closed);
});

test('foreign same-name MCP entries are never overwritten or disabled', async (t) => {
  const f = fixture(t);
  const foreign = { name: 'tuantuan-feishu', command: nodeExe, args: ['/user/own.mjs'], enabled: true };
  f.state.entries = [structuredClone(foreign)];
  assert.ok((await f.controller.invoke('enableTools')).error);
  await f.controller.invoke('disableTools');
  await f.controller.close();
  assert.deepEqual(f.state.entries, [foreign]);
  assert.equal(f.state.requests.filter((v) => v.method).length, 0);
});

test('disable during an uncertain registration waits for cleanup but revokes capability immediately', async (t) => {
  const f = fixture(t);
  const write = deferred();
  f.state.requestHook = async (_url, opts) => { if (opts.method === 'POST' && opts.body?.name) await write.promise; };
  const enable = f.controller.invoke('enableTools');
  await until(() => f.state.requests.some((v) => v.body?.name));
  const stopping = f.controller.invoke('disableTools');
  write.resolve();
  await Promise.all([enable, stopping]);
  assert.equal((await f.controller.state()).toolsEnabled, false);
  assert.equal(f.state.entries[0].enabled, false);
  assert.equal(f.state.requests.some((v) => v.url.endsWith('/test')), false);
});

test('identity probe exceptions revoke both channels and never expose raw errors', async (t) => {
  const f = fixture(t);
  const consumer = await connect(f);
  await f.controller.invoke('enableTools');
  f.cli.inspect = async () => { throw new Error('private credential path'); };
  const result = await f.controller.invoke('probe');
  assert.equal(result.toolsEnabled, false);
  assert.equal(result.im, 'off');
  assert.equal(result.userAuthorized, false);
  assert.equal(result.botAuthorized, false);
  assert.equal(consumer.stopped, true);
  assert.doesNotMatch(result.error, /private/);
});

test('identity is rechecked before replying after a long kernel wait', async (t) => {
  const f = fixture(t);
  const consumer = await connect(f);
  const wait = deferred();
  f.kernel.sendAndWait = async (args) => { f.state.sends.push(args); return wait.promise; };
  consumer.onMessage(message());
  await until(() => f.state.sends.length === 1);
  f.state.info.appId = 'cli_other';
  wait.resolve({ text: 'must not send via a different app' });
  await until(async () => (await f.controller.state()).im === 'off');
  assert.equal(f.state.replies.length, 0);
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.appId, 'cli_app');
});

test('OAuth completion consumes the device code even when verified identity already changed', async (t) => {
  const f = fixture(t);
  f.state.info.user = { available: false, verified: false, status: 'missing' };
  await f.controller.invoke('login');
  f.state.info.user = { available: true, verified: true, status: 'ready', openId: 'ou_new' };
  const result = await f.controller.invoke('completeLogin');
  assert.equal(result.userAuthorized, true);
  assert.equal(result.error, undefined);
  assert.equal(f.state.completedCode, 'secret_device');
});

test('client disconnect cancels pending native approval without executing the tool', async (t) => {
  const f = fixture(t);
  await f.controller.invoke('enableTools');
  const approval = deferred();
  f.state.approve = () => approval.promise;
  const entry = f.state.entries[0];
  const req = http.request(`${entry.env.TT_FEISHU_BRIDGE_URL}/tools`, {
    method: 'POST', headers: { authorization: `Bearer ${entry.env.TT_FEISHU_BRIDGE_TOKEN}`,
      'content-type': 'application/json' },
  });
  req.on('error', () => {});
  req.end(JSON.stringify({ name: 'feishu_document_read', arguments: { documentId: 'doc' } }));
  await until(() => f.state.dialogs.length === 1);
  req.destroy();
  await new Promise((resolve) => setTimeout(resolve, 10));
  approval.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.runs.length, 0);
});

test('failed enable PATCH revokes broker; a foreign replacement is preserved during cleanup', async (t) => {
  const f = fixture(t);
  f.state.requestHook = async (_url, opts) => {
    if (opts.method === 'PATCH' && opts.body.enabled) throw new Error('uncertain patch');
  };
  assert.equal((await f.controller.invoke('enableTools')).toolsEnabled, false);
  assert.equal(f.state.entries[0].enabled, false);
  assert.ok((await request(f.state.entries[0])).closed);
  f.state.requestHook = undefined;
  await f.controller.invoke('enableTools');
  const foreign = { name: 'tuantuan-feishu', command: nodeExe, args: ['/user/mcp.mjs'], enabled: true };
  f.state.entries = [structuredClone(foreign)];
  await f.controller.invoke('disableTools');
  assert.deepEqual(f.state.entries, [foreign]);
});

test('default Node validation safely probes a real Node executable', async (t) => {
  const f = fixture(t);
  const controller = createConnector({ kernel: f.kernel, store: f.store, mcpPath,
    chooseExecutable: async () => process.execPath, confirm: async () => false,
    openExternal: async () => {}, createCliImpl: () => f.cli });
  t.after(() => controller.close());
  const result = await controller.invoke('chooseNode');
  assert.equal(result.error, undefined);
  assert.equal(result.nodePath, process.execPath);
});

test('disconnect during lazy loading prevents an earlier action from starting afterward', async (t) => {
  const load = deferred();
  const f = fixture(t, { load: () => load.promise });
  const starting = f.controller.invoke('pair', { botId: 'bot1' });
  const stopping = f.controller.invoke('disconnect');
  load.resolve(f.state.disk);
  await Promise.all([starting, stopping]);
  assert.equal(f.state.consumers.length, 0);
  assert.equal((await f.controller.state()).im, 'off');
});

test('flattened event content is delivered directly and JSON-looking text stays literal', async (t) => {
  const f = fixture(t);
  const consumer = await connect(f);
  const text = '{"text":"literal, not an event envelope"}';
  consumer.onMessage(message('ou_owner', 'om_one', text));
  await until(() => f.state.replies.length === 1);
  assert.equal(f.state.sends[0].text, text);
});

test('verified available needs_refresh is authorized for pairing and every tool call', async (t) => {
  const f = fixture(t);
  f.state.info.user.status = 'needs_refresh';
  assert.equal((await f.controller.invoke('probe')).userAuthorized, true);
  await pair(f);
  await f.controller.invoke('enableTools');
  assert.equal((await request(f.state.entries[0])).body.ok, true);
  assert.equal(f.state.runs.length, 1);
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
});

test('transient auth loss revokes runtime but preserves pairing/task through same-user recovery', async (t) => {
  for (const status of ['missing', 'needs_refresh', 'verify_failed']) {
    const f = fixture(t);
    const consumer = await connect(f);
    await f.controller.invoke('enableTools');
    f.state.info.user = { available: false, verified: false, status };
    const result = await f.controller.invoke('probe');
    assert.equal(result.toolsEnabled, false);
    assert.equal(result.im, 'off');
    assert.equal(consumer.stopped, true);
    assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
    assert.equal(f.state.disk.threadId, 'feishu_thread');
    assert.equal(result.ownerOpenId, 'ou_owner');
    f.state.info.user = { available: true, verified: true, status: 'needs_refresh', openId: 'ou_owner' };
    assert.equal((await f.controller.invoke('probe')).error, undefined);
    assert.equal((await f.controller.invoke('connect')).im, 'ready');
    assert.equal(f.state.sessions.length, 1);
  }
});

test('probe failures and known identity conflicts preserve persisted binding', async (t) => {
  const f = fixture(t);
  await connect(f);
  const inspect = f.cli.inspect;
  f.cli.inspect = async () => ({ ok: false, error: { code: 'CLI_NETWORK_ERROR', detail: 'secret' } });
  const result = await f.controller.invoke('probe');
  assert.match(result.error, /\u7f51\u7edc/);
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.threadId, 'feishu_thread');
  f.cli.inspect = inspect;
  f.state.info.user = { available: false, verified: false, status: 'verify_failed', openId: 'ou_unverified' };
  await f.controller.invoke('probe');
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  f.state.info.user = { available: true, verified: true, status: 'needs_refresh', openId: 'ou_changed' };
  const conflict = await f.controller.invoke('probe');
  assert.match(conflict.error, /\u4e0d\u4e00\u81f4/);
  assert.equal(f.state.disk.ownerOpenId, 'ou_owner');
  assert.equal(f.state.disk.threadId, 'feishu_thread');
});

test('enable confirmation discloses workspace scope, ignores bot selection and fails closed', async (t) => {
  const f = fixture(t);
  f.state.approve = async () => false;
  const denied = await f.controller.invoke('enableTools', { botId: 'not_a_real_bot' });
  assert.equal(denied.toolsEnabled, false);
  assert.equal(f.state.entries.length, 0);
  const dialog = f.state.enableDialogs[0];
  assert.match(dialog.message, /\u6574\u4e2a\u5de5\u4f5c\u533a/);
  assert.match(dialog.message, /\u6240\u6709 bot/);
  assert.match(dialog.detail, /ou_owner/);
  assert.equal(f.state.disk.botId, 'bot1');
  f.state.approve = async () => true;
  assert.equal((await f.controller.invoke('enableTools', { botId: 'not_a_real_bot' })).toolsEnabled, true);
  assert.equal((await request(f.state.entries[0])).body.ok, true);
  assert.match(f.state.dialogs.at(-1).detail, /\u6574\u4e2a\u5de5\u4f5c\u533a/);
});

test('stale enable confirmation cannot authorize a different OAuth user', async (t) => {
  const f = fixture(t);
  const approval = deferred();
  f.state.approve = () => approval.promise;
  const enable = f.controller.invoke('enableTools');
  await until(() => f.state.enableDialogs.length === 1);
  f.state.info.user.openId = 'ou_changed';
  approval.resolve(true);
  assert.equal((await enable).toolsEnabled, false);
  assert.equal(f.state.entries.length, 0);
});

test('all CLI subprocess entry points receive abort signals, including active OAuth children', async (t) => {
  for (const [method, action] of [['version', 'probe'], ['version', 'chooseCli'], ['inspect', 'probe'],
    ['login', 'login'], ['completeLogin', 'completeLogin']]) {
    for (const stop of ['disconnect', 'close']) {
      const f = fixture(t);
      if (action === 'completeLogin') await f.controller.invoke('login');
      let signal;
      f.cli[method] = (...args) => {
        signal = args.at(-1)?.signal;
        assert.ok(signal instanceof AbortSignal, `${method} gets signal`);
        return new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ ok: false, error: { code: 'ABORTED' } }), { once: true });
        });
      };
      const pending = f.controller.invoke(action);
      await until(() => signal);
      await (stop === 'close' ? f.controller.close() : f.controller.invoke('disconnect'));
      assert.equal(signal.aborted, true, `${stop} aborts ${method}`);
      await pending;
      const state = await f.controller.state();
      assert.equal(state.pending, false);
      assert.equal(state.login, undefined);
      assert.equal(state.im, 'off');
    }
  }
});

test('reply subprocess and Node probe receive cancellation and cannot continue after stop', async (t) => {
  const f = fixture(t);
  const consumer = await connect(f);
  let replySignal;
  f.cli.sendReply = (_id, _text, _uuid, { signal }) => {
    replySignal = signal;
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false }), { once: true }));
  };
  consumer.onMessage(message());
  await until(() => replySignal);
  await f.controller.invoke('disconnect');
  assert.equal(replySignal.aborted, true);
  let nodeSignal;
  f.state.validate = (_path, { signal }) => {
    nodeSignal = signal;
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve(false), { once: true }));
  };
  const choose = f.controller.invoke('chooseNode');
  await until(() => nodeSignal);
  await f.controller.close();
  assert.equal(nodeSignal.aborted, true);
  await choose;
});

test('close and disconnect await bounded consumer stop while state becomes off immediately', async (t) => {
  for (const action of ['close', 'disconnect']) {
    const f = fixture(t);
    const consumer = await connect(f);
    const stopped = deferred();
    consumer.stop = () => { consumer.stopped = true; return stopped.promise; };
    let settled = false;
    const closing = action === 'close' ? f.controller.close() : f.controller.invoke('disconnect');
    void closing.then(() => { settled = true; });
    if (action === 'close') assert.equal(f.controller.close(), closing);
    const state = await f.controller.state();
    assert.equal(consumer.stopped, true);
    assert.equal(state.im, 'off');
    assert.equal(state.pending, false);
    assert.equal(state.toolsEnabled, false);
    assert.equal(state.login, undefined);
    assert.equal(state.pairingCode, undefined);
    assert.equal(settled, false);
    consumer.onReady();
    consumer.onMessage(message());
    stopped.resolve();
    await closing;
    assert.equal((await f.controller.state()).im, 'off');
    if (action === 'close') {
      assert.equal(state.userAuthorized, false);
      assert.equal(state.botAuthorized, false);
      assert.equal((await f.controller.invoke('connect')).im, 'off');
    }
  }
});

test('localized probe errors explain recovery and login works despite failed auth inspection', async (t) => {
  const f = fixture(t);
  f.state.version = { version: '2.0.0', supported: false };
  assert.match((await f.controller.invoke('probe')).error, /1\.0\.93/);
  f.state.version = { ok: false, error: { code: 'SPAWN_FAILED' } };
  assert.match((await f.controller.invoke('probe')).error, /\u542f\u52a8 CLI/);
  f.state.version = { version: '1.0.93', supported: true };
  f.cli.inspect = async () => ({ ok: false, error: { code: 'AUTH_REQUIRED' } });
  assert.match((await f.controller.invoke('probe')).error, /\u767b\u5f55/);
  const login = await f.controller.invoke('login');
  assert.equal(login.error, undefined);
  assert.ok(login.login);
});

test('failed MCP cleanup cannot make close resolve before the consumer exits', async (t) => {
  const f = fixture(t);
  const consumer = await connect(f);
  const exited = deferred();
  consumer.stop = () => exited.promise;
  f.state.requestHook = async () => { throw new Error('kernel offline'); };
  let settled = false;
  const closing = f.controller.close();
  void closing.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  exited.resolve();
  await closing;
  assert.equal(settled, true);
});

test('personal tools without a bot coexist with owner pairing and a pending tool approval', async (t) => {
  const f = fixture(t, { disk: { botId: '' } });
  assert.equal((await f.controller.invoke('enableTools')).toolsEnabled, true);
  assert.equal(f.state.disk.botId, '');
  const entry = structuredClone(f.state.entries[0]);
  const writes = f.state.requests.filter((v) => v.method).length;
  const approval = deferred();
  f.state.approve = (dialog) => dialog.title === '\u98de\u4e66\u5de5\u5177\u8c03\u7528' ? approval.promise : true;
  const pending = request(entry);
  await until(() => f.state.dialogs.length === 1);
  await pair(f);
  const state = await f.controller.state();
  assert.equal(state.toolsEnabled, true);
  assert.equal(state.im, 'off');
  assert.equal(state.botId, 'bot1');
  assert.equal(state.ownerOpenId, 'ou_owner');
  assert.equal(f.state.consumers.at(-1).stopped, true);
  assert.deepEqual(f.state.entries[0], entry);
  assert.equal(f.state.requests.filter((v) => v.method).length, writes);
  approval.resolve(true);
  assert.equal((await pending).body.ok, true);
  assert.equal(f.state.runs.length, 1);
  assert.match(f.state.dialogs.at(-1).detail, /ou_owner/);
});

test('pairing alongside tools rejects strangers and denial without disabling tools', async (t) => {
  const f = fixture(t);
  await f.controller.invoke('enableTools');
  const entry = structuredClone(f.state.entries[0]);
  const state = await f.controller.invoke('pair');
  assert.ok(state.pairingCode);
  const consumer = f.state.consumers.at(-1);
  consumer.onMessage(message('ou_stranger', 'om_stranger', state.pairingCode));
  assert.equal(f.state.dialogs.length, 0);
  f.state.approve = async () => false;
  consumer.onMessage(message('ou_owner', 'om_pair', state.pairingCode));
  await until(async () => (await f.controller.state()).error);
  assert.equal((await f.controller.state()).toolsEnabled, true);
  assert.equal(f.state.disk.ownerOpenId, undefined);
  assert.deepEqual(f.state.entries[0], entry);
});

test('bot selection stays locked during pairing and connected IM even with tools enabled', async (t) => {
  const f = fixture(t);
  await f.controller.invoke('enableTools');
  const bots = f.kernel.bots;
  f.kernel.bots = async () => [...await bots(), { id: 'bot2', threadId: 'other', tasks: [{ threadId: 'other' }] }];
  const pairing = await f.controller.invoke('pair');
  assert.ok(pairing.pairingCode);
  assert.ok((await f.controller.invoke('pair', { botId: 'bot2' })).error);
  assert.equal(f.state.disk.botId, 'bot1');
  f.state.consumers.at(-1).onMessage(message('ou_owner', 'om_pair', pairing.pairingCode));
  await until(() => f.state.disk.ownerOpenId === 'ou_owner');
  assert.equal((await f.controller.invoke('connect')).im, 'ready');
  assert.ok((await f.controller.invoke('connect', { botId: 'bot2' })).error);
  assert.equal(f.state.disk.botId, 'bot1');
  assert.equal((await f.controller.state()).toolsEnabled, true);
});

test('pairing cannot revive tool approval from an earlier disabled capability epoch', async (t) => {
  const f = fixture(t);
  await f.controller.invoke('enableTools');
  const old = structuredClone(f.state.entries[0]);
  const approval = deferred();
  f.state.approve = (dialog) => dialog.title === '\u98de\u4e66\u5de5\u5177\u8c03\u7528' ? approval.promise : true;
  const pending = request(old);
  await until(() => f.state.dialogs.length === 1);
  await pair(f);
  await f.controller.invoke('disableTools');
  await f.controller.invoke('enableTools');
  approval.resolve(true);
  assert.ok((await pending).closed);
  assert.equal(f.state.runs.length, 0);
  assert.equal((await f.controller.state()).toolsEnabled, true);
  assert.notEqual(f.state.entries[0].env.TT_FEISHU_BRIDGE_TOKEN, old.env.TT_FEISHU_BRIDGE_TOKEN);
});

test('missing CLI configuration has concrete localized setup instructions', async (t) => {
  for (const info of [{ ok: false, error: { code: 'CLI_NOT_CONFIGURED' } },
    { appId: null, bot: { status: 'not_configured' }, user: { status: 'not_configured' } }]) {
    const f = fixture(t);
    f.cli.inspect = async () => info;
    const result = await f.controller.invoke('probe');
    assert.match(result.error, /App ID/);
    assert.match(result.error, /App Secret/);
    assert.match(result.error, /\u91cd\u65b0\u68c0\u6d4b/);
    assert.equal(result.toolsEnabled, false);
    assert.equal(result.botAuthorized, false);
  }
});

test('OAuth changes during pairing approval cannot bind an owner or reassign personal tools', async (t) => {
  const f = fixture(t);
  await f.controller.invoke('enableTools');
  const pairing = await f.controller.invoke('pair');
  assert.ok(pairing.pairingCode);
  const approval = deferred();
  f.state.approve = () => approval.promise;
  f.state.consumers.at(-1).onMessage(message('ou_owner', 'om_pair', pairing.pairingCode));
  await until(() => f.state.dialogs.length === 1);
  f.state.info.user.openId = 'ou_changed';
  approval.resolve(true);
  await until(async () => !(await f.controller.state()).pairingCode);
  assert.equal(f.state.disk.ownerOpenId, undefined);
  assert.equal((await f.controller.state()).toolsEnabled, false);
  assert.equal(f.state.runs.length, 0);
  assert.equal(f.state.enableDialogs.length, 1);
});
