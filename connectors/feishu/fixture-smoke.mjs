// Run: node --experimental-strip-types connectors/feishu/fixture-smoke.mjs
// Real isolated REST server and fake engine; only the Feishu transport is mocked.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runControlOmb } from '../../scripts/control-omb.ts';
import { createKernel } from './kernel.mjs';
import { createConnector } from './index.mjs';
import { TOOL_DEFINITIONS, validateTool } from './tools.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mcpPath = fileURLToPath(new URL('./mcp.mjs', import.meta.url));
const mcpRoute = '/api/mcp/servers/tuantuan-feishu';
const evidenceDir = mkdtempSync(join(tmpdir(), 'feishu-fixture-evidence-'));
const evidencePath = join(evidenceDir, 'verification.json');
const evidence = { command: 'node --experimental-strip-types connectors/feishu/fixture-smoke.mjs',
  launcherCommand: 'node --experimental-strip-types scripts/control-omb.ts launch',
  actions: [], http: [], checks: [], enginePids: [] };
const stop = new AbortController();
const deadline = setTimeout(() => stop.abort(new Error('fixture smoke exceeded 90 seconds')), 90_000);
const interrupt = () => stop.abort(new Error('fixture smoke interrupted'));
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
const launcher = spawn(process.execPath, ['--experimental-strip-types', 'scripts/control-omb.ts', 'launch'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: dirname(process.execPath), LANG: 'C.UTF-8' },
});
let stdout = '';
let stderr = '';
let launchError;
let exit;
let connector;
let info;
let bridgeEnv;
const privateValues = new Set();
let mcp;
let mcpExit;
let mcpError;
let mcpStderr = '';

// Registration credentials are write-only: retain them for the child, never artifacts.
function redact(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (key === 'TT_FEISHU_BRIDGE_TOKEN' || key === 'TT_FEISHU_BRIDGE_URL') return '[redacted]';
    if (typeof item !== 'string') return item;
    for (const secret of privateValues) item = item.replaceAll(secret, '[redacted]');
    return item;
  }));
}
launcher.stdout.on('data', (chunk) => { stdout += chunk; });
launcher.stderr.on('data', (chunk) => { stderr += chunk; });
launcher.on('error', (error) => { launchError = error; });
launcher.on('close', (code, signal) => { exit = { code, signal }; });

async function until(predicate, ms = 25_000, signal = stop.signal) {
  const end = Date.now() + ms;
  for (;;) {
    signal?.throwIfAborted();
    const result = await predicate();
    if (result) return result;
    assert.ok(Date.now() < end, 'bounded fixture wait expired');
    await delay(25, undefined, signal ? { signal } : {});
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

try {
  info = await until(() => {
    if (launchError) throw launchError;
    assert.equal(exit, undefined, `launcher exited before ready: ${stderr}`);
    try { return JSON.parse(stdout); } catch { return false; }
  });
  assert.equal(info.ok, true);
  assert.match(info.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(Number.isSafeInteger(info.pid) && info.pid > 0);
  evidence.fixture = { ...info, launcherPid: launcher.pid };
  console.log(JSON.stringify({ evidencePath, ...evidence.fixture }, null, 2));
  const control = async (...args) => {
    const result = await runControlOmb([...args, '--url', info.url], { env: {} });
    evidence.actions.push({ command: ['control-omb', ...args, '--url', info.url], result });
    return result;
  };
  const doctor = await control('doctor');
  assert.equal(doctor.ok, true);
  assert.deepEqual(doctor.availableEngines, ['verification']);
  const { bot } = await control('new-bot', '--name', 'Feishu fixture smoke');
  let loseSendId;
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, info.url, 'never contact an unowned server');
    const request = options.body ? JSON.parse(options.body) : undefined;
    if (['POST', 'PUT'].includes(options.method) && new URL(url).pathname.startsWith('/api/mcp/servers') && request?.env) {
      bridgeEnv = { TT_FEISHU_BRIDGE_URL: request.env.TT_FEISHU_BRIDGE_URL,
        TT_FEISHU_BRIDGE_TOKEN: request.env.TT_FEISHU_BRIDGE_TOKEN };
      for (const value of Object.values(bridgeEnv)) if (typeof value === 'string' && value) privateValues.add(value);
    }
    const response = await fetch(url, { ...options,
      signal: AbortSignal.any([stop.signal, options.signal]) });
    const body = await response.clone().json();
    evidence.http.push(redact({ method: options.method, path: new URL(url).pathname + new URL(url).search,
      contentType: options.headers['content-type'] ?? null, hasBody: options.body !== undefined,
      request, status: response.status, response: body }));
    if (request?.sendId === loseSendId && loseSendId) {
      loseSendId = undefined;
      throw new Error('fixture deliberately discards the real committed receipt');
    }
    return response;
  };
  const kernelOptions = { baseUrl: info.url, expectedPid: info.pid, fetchImpl };
  const kernel = createKernel(kernelOptions);
  assert.equal((await kernel.health()).pid, info.pid);
  // The current app defaults new bots to Local Computer. This fixture owns no
  // CUA driver, so explicitly disable computer access before exercising chat.
  await kernel.request(`/api/bots/${bot.id}`, { method: 'PATCH', body: { computer: 'off' } });
  const initial = (await kernel.bots()).find((candidate) => candidate.id === bot.id);
  const session = await kernel.createSession({ botId: bot.id, title: ' Direct fixture task ', signal: stop.signal });
  evidence.actions.push({ operation: 'createSession', result: session });
  assert.notEqual(session.threadId, initial.threadId);
  const active = (await kernel.bots()).find((candidate) => candidate.id === bot.id);
  assert.equal(active.threadId, session.threadId);
  assert.equal(active.tasks.length, initial.tasks.length + 1);
  assert.equal(active.tasks.find((task) => task.threadId === session.threadId).title, 'Direct fixture task');
  const taskReceipt = evidence.http.find((call) => call.method === 'POST' && call.path.endsWith('/tasks'));
  assert.equal(taskReceipt.status, 201);
  assert.equal(taskReceipt.response.task.threadId, session.threadId);
  evidence.checks.push('POST tasks returns 201 and creates AND activates exactly one task');

  const sends = () => evidence.http.filter((call) => call.method === 'POST' && call.path.endsWith('/messages'));
  const snapshot = async (threadId, sendId, result) => {
    const wait = await control('wait', '--bot', bot.id, '--timeout', '20');
    assert.equal(wait.status, 'settled');
    await control('messages', '--bot', bot.id, '--limit', '30');
    const page = await kernel.request(`/api/threads/${threadId}/messages?limit=200`);
    assert.equal(page.hasMore, false);
    const users = page.messages.filter((message) => message.sendId === sendId);
    assert.equal(users.length, 1);
    const user = users[0];
    assert.equal(user.role, 'user');
    assert.equal(user.kind, 'text');
    const byId = new Map(page.messages.map((message) => [message.id, message]));
    const chains = page.messages.filter((message) => message.turnTerminal === true).map((terminal) => {
      const chain = [];
      let current = terminal;
      while (current) {
        assert.ok(!chain.includes(current.id), 'parent links must not cycle');
        chain.push(current.id);
        if (current.id === user.id) return { terminal, chain };
        if (current.role === 'user') break;
        current = byId.get(current.parentId);
      }
      return null;
    }).filter(Boolean);
    assert.equal(chains.length, 1, 'one terminal descends from this exact accepted send');
    assert.ok(chains[0].terminal.turnId);
    assert.equal(chains[0].terminal.text, result.text);
    assert.deepEqual(result, { text: 'hello from fake claude', threadId });
    evidence.actions.push({ operation: 'raw-transcript-and-parent-chain', sendId, page,
      parentChain: chains[0].chain, turnId: chains[0].terminal.turnId, result });
    const dump = JSON.parse(readFileSync(join(info.dataDir, 'fake-claude-dump.json'), 'utf8'));
    assert.equal(dump.env.HOME, info.dataDir);
    assert.equal(dump.env.OMB_DATA_DIR, info.dataDir);
    assert.equal(dump.env.FAKE_CLAUDE_MODE, 'happy');
    assert.equal(dump.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(dump.env.OPENAI_API_KEY, undefined);
    if (!evidence.enginePids.includes(dump.pid)) evidence.enginePids.push(dump.pid);
  };
  const input = { botId: bot.id, threadId: session.threadId,
    sendId: 'feishu_fixture_direct_0001', text: 'first isolated connector turn', signal: stop.signal };
  const first = await kernel.sendAndWait(input);
  await snapshot(session.threadId, input.sendId, first);
  const receipt = sends()[0];
  assert.equal(receipt.status, 202);
  assert.equal(receipt.response.ok, true);
  assert.equal(receipt.response.threadId, session.threadId);
  assert.equal(receipt.response.message.sendId, input.sendId);
  assert.equal(receipt.response.message.text, input.text);
  assert.notEqual(receipt.response.queued, true);
  evidence.checks.push('real 202 send receipt and terminal parent traversal match sendAndWait');

  const secondInput = { ...input, sendId: 'feishu_fixture_lost_receipt_0002', text: 'second isolated turn' };
  loseSendId = secondInput.sendId;
  const second = await kernel.sendAndWait(secondInput);
  await snapshot(session.threadId, secondInput.sendId, second);
  assert.equal(sends().length, 2);
  assert.deepEqual(await kernel.sendAndWait(input), first);
  assert.deepEqual(await createKernel(kernelOptions).sendAndWait({ ...secondInput, resumeOnly: true }), second);
  assert.equal(sends().length, 2);
  evidence.checks.push('lost real POST receipt reconciles; repeated and restarted callers do not POST again');

  let saved = { cliPath: '/fixture-only/lark', nodePath: process.execPath, botId: bot.id, records: [] };
  const consumers = [];
  const replies = [];
  const runs = [];
  let allow = true;
  let confirmations = 0;
  const fakeResult = { ok: true, document: { id: 'doc_fixture', text: 'fixed fixture document' } };
  const fakeCli = {
    version: async () => ({ version: '1.0.93', supported: true }),
    inspect: async () => ({ appId: 'cli_fixture', botReady: true,
      bot: { available: true, status: 'ready', verified: true },
      user: { available: true, status: 'ready', verified: true, openId: 'ou_fixture' } }),
    consume(callbacks) {
      const consumer = { ...callbacks, stopped: false,
        stop() { this.stopped = true; callbacks.onExit(); } };
      consumers.push(consumer);
      callbacks.onReady();
      return consumer;
    },
    async sendReply(messageId, text, uuid) { replies.push({ messageId, text, uuid }); return { ok: true }; },
    async run(args) { runs.push(structuredClone(args)); return structuredClone(fakeResult); },
  };
  connector = createConnector({ kernel, mcpPath,
    store: { load: async () => structuredClone(saved), save: async (value) => { saved = structuredClone(value); } },
    createCliImpl: () => fakeCli, confirm: async () => { confirmations++; return allow; },
    chooseExecutable: async () => assert.fail('no executable selection allowed'),
    openExternal: async () => assert.fail('no external login allowed'),
    validateNode: async (executable) => { assert.equal(executable, process.execPath); return true; },
  });
  const event = (messageId, text) => ({ type: 'im.message.receive_v1', chat_type: 'p2p',
    chat_id: 'oc_fixture', sender_type: 'user', sender_id: 'ou_fixture', message_id: messageId,
    message_type: 'text', content: text });
  const paired = await connector.invoke('pair', { botId: bot.id });
  assert.ok(paired.pairingCode);
  consumers.at(-1).onMessage(event('om_fixture_pair', paired.pairingCode));
  await until(async () => (await connector.state()).ownerOpenId === 'ou_fixture');
  const connected = await connector.invoke('connect', { botId: bot.id });
  assert.equal(connected.error, undefined);
  assert.equal(connected.im, 'ready');
  assert.notEqual(saved.threadId, session.threadId);
  const messageId = 'om_fixture_roundtrip';
  const sendId = createHash('sha256').update(messageId).digest('hex');
  consumers.at(-1).onMessage(event(messageId, 'fake Feishu to real kernel'));
  await until(async () => {
    assert.equal((await connector.state()).error, undefined);
    return replies.length === 1;
  });
  assert.equal(replies[0].text, 'hello from fake claude');
  assert.equal(replies[0].messageId, messageId);
  assert.ok(saved.records.includes(messageId));
  await snapshot(saved.threadId, sendId, { text: replies[0].text, threadId: saved.threadId });
  consumers.at(-1).onMessage(event(messageId, 'fake Feishu to real kernel'));
  await delay(100);
  assert.equal(replies.length, 1);
  assert.equal(sends().length, 3);
  evidence.actions.push({ operation: 'fake-Feishu-roundtrip', replies, threadId: saved.threadId });
  evidence.checks.push('fake Feishu pairing/connect creates a real task; delivery returns exact fake-engine reply once');

  const enabled = await connector.invoke('enableTools', { botId: bot.id });
  assert.equal(enabled.error, undefined);
  assert.equal(enabled.toolsEnabled, true);
  const listing = await kernel.request('/api/mcp/servers');
  const registered = listing.servers.find((server) => server.name === 'tuantuan-feishu');
  assert.equal(registered?.enabled, true);
  assert.equal(registered.command, process.execPath);
  assert.deepEqual(registered.args, [mcpPath]);
  assert.ok(bridgeEnv && Object.values(bridgeEnv).every((value) => typeof value === 'string' && value.length > 0));
  assert.match(bridgeEnv.TT_FEISHU_BRIDGE_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(bridgeEnv.TT_FEISHU_BRIDGE_TOKEN, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(listing).includes(bridgeEnv.TT_FEISHU_BRIDGE_TOKEN), 'listing must not reveal the dedicated token');
  const registration = evidence.http.find((call) => call.path === '/api/mcp/servers' && call.method === 'POST');
  assert.equal(registration.status, 201);
  assert.equal(registration.contentType, 'application/json');
  assert.equal(registration.request.enabled, false);
  const probe = evidence.http.find((call) => call.path === `${mcpRoute}/test` && call.method === 'POST');
  assert.equal(probe.status, 200);
  assert.equal(probe.contentType, null);
  assert.equal(probe.hasBody, false);
  assert.equal(probe.response.ok, true);
  assert.deepEqual(probe.response.tools.map((tool) => tool.name).sort(), TOOL_DEFINITIONS.map((tool) => tool.name).sort());
  const enablePatch = evidence.http.find((call) => call.path === mcpRoute && call.method === 'PATCH' && call.request.enabled);
  assert.equal(enablePatch.status, 200);
  assert.equal(enablePatch.contentType, 'application/json');
  assert.ok(evidence.http.indexOf(registration) < evidence.http.indexOf(probe));
  assert.ok(evidence.http.indexOf(probe) < evidence.http.indexOf(enablePatch));
  evidence.checks.push('real MCP register 201, empty POST test 200 with five tools, JSON enable PATCH and enabled listing');

  mcp = spawn(process.execPath, [mcpPath], { cwd: info.dataDir,
    env: { HOME: info.dataDir, TMPDIR: join(info.dataDir, 'tmp'), PATH: dirname(process.execPath), ...bridgeEnv },
    stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  evidence.mcpPid = mcp.pid;
  const responses = new Map();
  let buffer = '';
  let bytes = 0;
  mcp.on('error', () => { mcpError = new Error('owned MCP subprocess failed'); });
  mcp.on('close', (code, signal) => { mcpExit = { code, signal }; });
  for (const stream of [mcp.stdin, mcp.stdout, mcp.stderr]) {
    stream.on('error', () => { mcpError = new Error('owned MCP pipe failed'); });
  }
  mcp.stdout.setEncoding('utf8');
  mcp.stdout.on('data', (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 1024 * 1024) { mcpError = new Error('owned MCP output exceeded limit'); mcp.kill('SIGTERM'); return; }
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const response = JSON.parse(line);
        assert.equal(response.jsonrpc, '2.0');
        assert.ok(!responses.has(response.id));
        responses.set(response.id, response);
      } catch { mcpError = new Error('owned MCP returned invalid JSON-RPC'); }
    }
  });
  mcp.stderr.on('data', (chunk) => {
    if (mcpStderr.length + chunk.length > 65536) { mcpError = new Error('owned MCP stderr exceeded limit'); mcp.kill('SIGTERM'); return; }
    mcpStderr += chunk;
  });
  let rpcId = 0;
  const rpc = async (method, params) => {
    const request = { jsonrpc: '2.0', id: ++rpcId, method, params };
    mcp.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
      if (error) mcpError = new Error('owned MCP request write failed');
    });
    const response = await until(() => {
      if (mcpError) throw mcpError;
      assert.equal(mcpExit, undefined, 'owned MCP exited before replying');
      return responses.get(request.id);
    }, 10_000);
    evidence.actions.push(redact({ operation: 'actual-mcp-stdio', request, response }));
    assert.equal(response.error, undefined);
    return response.result;
  };
  const initialized = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'isolated-feishu-fixture', version: '1' } });
  assert.equal(initialized.serverInfo.name, '@tuantuan/feishu-connector');
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  assert.deepEqual((await rpc('tools/list', {})).tools, TOOL_DEFINITIONS);
  const tool = { name: 'feishu_document_read', arguments: { documentId: 'doc_fixture' } };
  const beforeAllow = confirmations;
  const allowed = await rpc('tools/call', tool);
  assert.notEqual(allowed.isError, true);
  assert.deepEqual(JSON.parse(allowed.content[0].text), fakeResult);
  assert.equal(confirmations, beforeAllow + 1);
  assert.deepEqual(runs, [validateTool(tool.name, tool.arguments).args]);
  allow = false;
  const denied = await rpc('tools/call', tool);
  assert.equal(denied.isError, true);
  assert.equal(denied.content[0].text, 'APPROVAL_DENIED');
  assert.equal(confirmations, beforeAllow + 2);
  assert.equal(runs.length, 1);
  evidence.checks.push('actual mcp.mjs subprocess lists five tools; allow returns fixed fake JSON; deny never runs CLI');
  allow = true;
  const disconnected = await connector.invoke('disconnect');
  assert.equal(disconnected.error, undefined);
  assert.equal(disconnected.toolsEnabled, false);
  assert.equal(disconnected.im, 'off');
  const disabled = await kernel.request('/api/mcp/servers');
  assert.equal(disabled.servers.find((server) => server.name === 'tuantuan-feishu').enabled, false);
  const afterDisconnect = await rpc('tools/call', tool);
  assert.equal(afterDisconnect.isError, true);
  assert.equal(afterDisconnect.content[0].text, 'BRIDGE_UNAVAILABLE');
  assert.equal(confirmations, beforeAllow + 2);
  assert.equal(runs.length, 1);
  mcp.stdin.end();
  await until(() => mcpExit, 5_000);
  assert.deepEqual(mcpExit, { code: 0, signal: null });
  evidence.checks.push('disconnect disables persisted MCP entry and revokes existing subprocess access; stdin EOF exits cleanly');

  assert.deepEqual(await createKernel(kernelOptions).sendAndWait({ ...input, resumeOnly: true }), first);
  await assert.rejects(kernel.sendAndWait({ ...input, sendId: 'feishu_fixture_stale_0004' }),
    { code: 'TASK_SWITCHED', delivery: 'not-sent' });
  assert.equal(sends().length, 3);
  assert.equal(evidence.http.filter((call) => call.method === 'POST' && call.path.endsWith('/tasks')).length, 2);
  assert.equal((await kernel.bots()).find((candidate) => candidate.id === bot.id).threadId, saved.threadId);
  evidence.checks.push('old-task resume traverses its original turn; fresh old-task send rejects without mutation');
  await connector.close();
  assert.ok(consumers.every((consumer) => consumer.stopped));
  evidence.ok = true;
} catch (error) {
  evidence.ok = false;
  evidence.error = { message: error.message, code: error.code, stack: error.stack };
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  stop.abort();
  try {
    if (mcp && !mcpExit) {
      mcp.stdin.end();
      mcp.kill('SIGTERM');
      await until(() => mcpExit, 3_000, null);
    }
    await connector?.close();
    // SIGINT goes to the official launcher, which owns server and data cleanup.
    // Windows terminates a spawned console child instead of delivering a
    // catchable SIGINT, so remove only the launcher's verified temp directory.
    if (!exit) launcher.kill('SIGINT');
    await until(() => exit, 12_000, null);
    if (info) {
      await until(() => [info.pid, ...evidence.enginePids, mcp?.pid].every((pid) => !pid || !alive(pid)), 5_000, null);
      if (process.platform === 'win32' && existsSync(info.dataDir)) {
        const dataDir = resolve(info.dataDir);
        const tempRoot = resolve(tmpdir()) + sep;
        assert.ok((dataDir + sep).startsWith(tempRoot), 'fixture data must stay under the OS temp directory');
        rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      }
      assert.equal(existsSync(info.dataDir), false, 'official launcher removes its temporary home/data');
      assert.equal(existsSync(info.logPath), true, 'server log survives cleanup');
    }
    assert.deepEqual(exit, process.platform === 'win32'
      ? { code: null, signal: 'SIGINT' }
      : { code: 0, signal: null });
    evidence.cleanup = { ok: true, launcherExit: exit, mcpExit, mcpGone: !mcp?.pid || !alive(mcp.pid),
      serverGone: true, enginesGone: true, dataRemoved: true };
  } catch (error) {
    evidence.ok = false;
    evidence.cleanup = { ok: false, error: error.message, launcherExit: exit };
    process.exitCode = 1;
    // Last resort: only exact PIDs reported by this owned fixture, never names/groups.
    for (const pid of [info?.pid, ...evidence.enginePids, mcp?.pid]) {
      if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    }
    if (!exit) launcher.kill('SIGKILL');
    try { await until(() => exit && [info?.pid, ...evidence.enginePids, mcp?.pid].every((pid) => !pid || !alive(pid)), 5_000, null); }
    catch (failure) { evidence.cleanup.fallbackError = failure.message; }
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  writeFileSync(join(evidenceDir, 'launcher.stdout.log'), redact(stdout), { mode: 0o600 });
  writeFileSync(join(evidenceDir, 'launcher.stderr.log'), redact(stderr), { mode: 0o600 });
  writeFileSync(join(evidenceDir, 'mcp.stderr.log'), redact(mcpStderr), { mode: 0o600 });
  writeFileSync(evidencePath, JSON.stringify(redact(evidence), null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(redact({ ok: evidence.ok, checks: evidence.checks, error: evidence.error,
    cleanup: evidence.cleanup, evidencePath, serverLog: info?.logPath }), null, 2));
}
