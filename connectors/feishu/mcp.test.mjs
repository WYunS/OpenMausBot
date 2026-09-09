import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { startMcp } from './mcp.mjs';
import { TOOL_DEFINITIONS } from './tools.mjs';

const token = 'dedicated-bridge-token-123456789';
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fixture', version: '1' },
} };
const call = (id = 2, name = 'feishu_document_read', args = { documentId: 'doc123' }) =>
  ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

async function broker(t, handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ path: request.url, method: request.method, headers: request.headers, body: JSON.parse(body) });
      handler(response, requests.at(-1));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return { requests, url: `http://127.0.0.1:${server.address().port}` };
}

function fixture(t, options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const responses = [];
  let raw = '';
  output.on('data', (chunk) => {
    raw += chunk;
    let newline;
    while ((newline = raw.indexOf('\n')) !== -1) {
      responses.push(JSON.parse(raw.slice(0, newline)));
      raw = raw.slice(newline + 1);
    }
  });
  const server = startMcp({ input, output, env: {}, ...options });
  t.after(() => { server.stop(); input.destroy(); output.destroy(); });
  const send = (message) => input.write(`${JSON.stringify(message)}\n`);
  const wait = async (id) => {
    for (let i = 0; i < 500; i++) {
      const response = responses.find((value) => value.id === id);
      if (response) return response;
      await delay(5);
    }
    assert.fail(`No response for ${id}`);
  };
  return { input, output, responses, send, wait, stop: server.stop };
}

test('MCP handshake, ping and static list work without broker credentials or CLI', async (t) => {
  const f = fixture(t);
  f.send(initialize);
  assert.deepEqual((await f.wait(1)).result, {
    protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } },
    serverInfo: { name: '@tuantuan/feishu-connector', version: '0.1.0' },
  });
  f.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  f.send({ jsonrpc: '2.0', id: 'ping', method: 'ping' });
  assert.deepEqual((await f.wait('ping')).result, {});
  f.send({ jsonrpc: '2.0', id: 'list', method: 'tools/list' });
  assert.deepEqual((await f.wait('list')).result.tools, TOOL_DEFINITIONS);
  assert.equal(f.responses.length, 3);
  f.send(call());
  assert.equal((await f.wait(2)).result.content[0].text, 'BRIDGE_CONFIG_INVALID');
});

test('all actual operations POST only to broker with dedicated token and unchanged arguments', async (t) => {
  const b = await broker(t, (response) => response.end(JSON.stringify({ ok: true, result: { document: '\u5185\u5bb9' } })));
  const f = fixture(t, { env: { TT_FEISHU_BRIDGE_URL: b.url, TT_FEISHU_BRIDGE_TOKEN: token,
    OMB_OWNER_TOKEN: 'KERNEL_SECRET', OGB_OWNER_TOKEN: 'KERNEL_SECRET' } });
  f.send(initialize);
  f.send(call());
  assert.deepEqual((await f.wait(2)).result, { content: [{ type: 'text', text: '{"document":"\u5185\u5bb9"}' }] });
  const args = { userId: 'ou_123', text: 'literal --yes; $(whoami)' };
  f.send(call(3, 'feishu_user_send', args));
  await f.wait(3);
  assert.deepEqual(b.requests.map((value) => value.body), [
    { name: 'feishu_document_read', arguments: { documentId: 'doc123' } },
    { name: 'feishu_user_send', arguments: args },
  ]);
  for (const request of b.requests) {
    assert.equal(request.path, '/tools');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(JSON.stringify(request).includes('KERNEL_SECRET'), false);
    assert.equal(Object.hasOwn(request.body, 'args'), false);
  }
});

test('denials and approval-required are safe tool errors, never retried', async (t) => {
  for (const code of ['APPROVAL_DENIED', 'APPROVAL_REQUIRED', 'FORBIDDEN', 'SECRET_UNKNOWN']) {
    const b = await broker(t, (response) => response.end(JSON.stringify({
      ok: false, error: { code, message: 'KERNEL_SECRET', stack: 'PRIVATE_PATH' },
    })));
    const f = fixture(t, { env: { TT_FEISHU_BRIDGE_URL: b.url, TT_FEISHU_BRIDGE_TOKEN: token } });
    f.send(initialize);
    f.send(call());
    assert.deepEqual((await f.wait(2)).result, {
      isError: true, content: [{ type: 'text', text: code === 'SECRET_UNKNOWN' ? 'BRIDGE_OPERATION_FAILED' : code }],
    });
    assert.equal(b.requests.length, 1);
  }
});

test('reject nonloopback URLs, credentials in URL and invalid/missing bridge token', async (t) => {
  for (const url of ['https://example.com', 'http://127.0.0.1.evil', 'file:///tmp/sock',
    'http://user:secret@127.0.0.1', 'http://127.0.0.1/other', 'http://127.0.0.1?x=y',
    'http://127.0.0.1#x', 'http://192.168.1.2', 'http://[::ffff:c000:201]', 'http://localhost\n']) {
    const f = fixture(t, { env: { TT_FEISHU_BRIDGE_URL: url, TT_FEISHU_BRIDGE_TOKEN: token } });
    f.send(initialize); f.send(call());
    assert.equal((await f.wait(2)).result.content[0].text, 'BRIDGE_CONFIG_INVALID');
  }
  for (const value of [undefined, '', 'token\r\nEvil: yes', 'short']) {
    const f = fixture(t, { env: { TT_FEISHU_BRIDGE_URL: 'http://127.0.0.1', TT_FEISHU_BRIDGE_TOKEN: value,
      OMB_OWNER_TOKEN: token, OGB_OWNER_TOKEN: token } });
    f.send(initialize); f.send(call());
    assert.equal((await f.wait(2)).result.content[0].text, 'BRIDGE_CONFIG_INVALID');
  }
});

test('localhost is pinned to loopback, redirects are rejected without a second request', async (t) => {
  const target = await broker(t, (response) => response.end('{"ok":true,"result":{}}'));
  const b = await broker(t, (response) => {
    response.writeHead(307, { Location: `${target.url}/tools` });
    response.end('SECRET');
  });
  const f = fixture(t, { env: { TT_FEISHU_BRIDGE_URL: b.url.replace('127.0.0.1', 'localhost'), TT_FEISHU_BRIDGE_TOKEN: token } });
  f.send(initialize); f.send(call());
  assert.equal((await f.wait(2)).result.content[0].text, 'BRIDGE_REDIRECT_REJECTED');
  assert.equal(b.requests.length, 1);
  assert.equal(target.requests.length, 0);
});

test('human approval wall-clock timeout includes response body and is never retried', async (t) => {
  const b = await broker(t, (response) => { response.writeHead(200); response.write('{'); });
  const f = fixture(t, { timeoutMs: 30, env: { TT_FEISHU_BRIDGE_URL: b.url, TT_FEISHU_BRIDGE_TOKEN: token } });
  f.send(initialize); f.send(call());
  assert.equal((await f.wait(2)).result.content[0].text, 'APPROVAL_TIMEOUT');
  assert.equal(b.requests.length, 1);
});

test('broker chunked JSON, HTTP errors, malformed and oversized responses', async (t) => {
  const cases = [
    [(response) => { for (const byte of Buffer.from('{"ok":true,"result":"\u4f60\u597d"}')) response.write(Buffer.from([byte])); response.end(); }, '"\u4f60\u597d"'],
    [(response) => { response.writeHead(403); response.end('SECRET'); }, 'APPROVAL_DENIED'],
    [(response) => { response.writeHead(401); response.end('SECRET'); }, 'BRIDGE_UNAUTHORIZED'],
    [(response) => { response.writeHead(500); response.end('SECRET'); }, 'BRIDGE_HTTP_ERROR'],
    [(response) => response.end('SECRET'), 'BRIDGE_INVALID_OUTPUT'],
    [(response) => response.end('null'), 'BRIDGE_INVALID_OUTPUT'],
    [(response) => response.end('{"ok":true}'), 'BRIDGE_INVALID_OUTPUT'],
    [(response) => response.end('x'.repeat(1024 * 1024 + 1)), 'BRIDGE_OUTPUT_LIMIT'],
  ];
  for (const [handler, expected] of cases) {
    const b = await broker(t, handler);
    const f = fixture(t, { env: { TT_FEISHU_BRIDGE_URL: b.url, TT_FEISHU_BRIDGE_TOKEN: token } });
    f.send(initialize); f.send(call());
    assert.equal((await f.wait(2)).result.content[0].text, expected);
  }
});

test('malformed JSON-RPC and tool arguments never reach broker; UTF-8 byte chunks work', async (t) => {
  const b = await broker(t, (response) => response.end('{"ok":true,"result":{}}'));
  const f = fixture(t, { env: { TT_FEISHU_BRIDGE_URL: b.url, TT_FEISHU_BRIDGE_TOKEN: token } });
  f.input.write('SECRET\nnull\n[]\n');
  assert.deepEqual(f.responses.map((value) => value.error.code), [-32700, -32600, -32600]);
  f.send(call('early'));
  assert.equal((await f.wait('early')).error.code, -32000);
  for (const byte of Buffer.from(`${JSON.stringify(initialize)}\n`)) f.input.write(Buffer.from([byte]));
  await f.wait(1);
  f.send({ jsonrpc: '2.0', id: 'unknown', method: 'exec' });
  assert.equal((await f.wait('unknown')).error.code, -32601);
  f.send(call('badtool', 'exec', {}));
  f.send(call('badargs', 'feishu_document_read', { documentId: '../secret' }));
  assert.equal((await f.wait('badtool')).error.code, -32602);
  assert.equal((await f.wait('badargs')).error.code, -32602);
  const notification = call(); delete notification.id;
  f.send(notification);
  assert.equal(b.requests.length, 0);
  const args = { userId: 'ou_123', text: '\u4f60\u597d' };
  for (const byte of Buffer.from(`${JSON.stringify(call('utf8', 'feishu_user_send', args))}\n`)) f.input.write(Buffer.from([byte]));
  await f.wait('utf8');
  assert.equal(b.requests.length, 1);
  assert.deepEqual(b.requests[0].body.arguments, args);
});

test('input is bounded, unterminated frames do not execute, invalid initialization is rejected', async (t) => {
  const f = fixture(t);
  f.input.write('x'.repeat(65537));
  assert.equal(f.responses[0].error.message, 'Input limit');
  assert.equal(f.input.listenerCount('data'), 0);
  const g = fixture(t);
  g.input.end(JSON.stringify(initialize));
  await delay(0);
  assert.equal(g.responses[0].error.message, 'Incomplete frame');
  const h = fixture(t);
  h.send({ ...initialize, params: {} });
  assert.equal((await h.wait(1)).error.code, -32602);
});

test('cancellation, EOF cleanup and pending-call concurrency limit', async (t) => {
  const b = await broker(t, () => {});
  const f = fixture(t, { env: { TT_FEISHU_BRIDGE_URL: b.url, TT_FEISHU_BRIDGE_TOKEN: token } });
  f.send(initialize);
  for (let i = 2; i <= 10; i++) f.send(call(i));
  assert.equal((await f.wait(10)).error.message, 'Too many pending requests');
  f.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } });
  assert.equal((await f.wait(2)).result.content[0].text, 'BRIDGE_ABORTED');
  f.input.end();
  await delay(10);
  assert.equal(f.input.listenerCount('data'), 0);
  assert.equal(f.responses.some((value) => value.id === 3), false);
});

test('standalone stdio process handshake and broker invocation without CLI or owner env', async (t) => {
  const b = await broker(t, (response) => response.end('{"ok":false,"error":{"code":"APPROVAL_DENIED"}}'));
  // Launch through the workspace spelling, which may be a Windows junction.
  // Node canonicalizes import.meta.url, so entry detection must tolerate aliases.
  const child = spawn(process.execPath, [path.resolve('connectors/feishu/mcp.mjs')], {
    env: { TT_FEISHU_BRIDGE_URL: b.url, TT_FEISHU_BRIDGE_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write(`${JSON.stringify(initialize)}\n${JSON.stringify(call())}\n`);
  for (let i = 0; i < 500 && stdout.split('\n').length < 3; i++) await delay(5);
  const responses = stdout.trim().split('\n').map(JSON.parse);
  assert.equal(responses[0].result.serverInfo.name, '@tuantuan/feishu-connector');
  assert.equal(responses[1].result.content[0].text, 'APPROVAL_DENIED');
  assert.equal(stderr, '');
  const closed = once(child, 'close');
  child.stdin.end();
  assert.equal((await closed)[0], 0);
  assert.equal(b.requests.length, 1);
});

test('MCP keeps flag-looking message text literal across the broker boundary', async (t) => {
  const b = await broker(t, (response) => response.end('{"ok":true,"result":{}}'));
  const f = fixture(t, { env: { TT_FEISHU_BRIDGE_URL: b.url, TT_FEISHU_BRIDGE_TOKEN: token } });
  f.send(initialize);
  for (const [index, text] of ['--profile=other', '--help'].entries()) {
    const args = { userId: 'ou_123', text };
    f.send(call(index + 2, 'feishu_user_send', args));
    await f.wait(index + 2);
    assert.deepEqual(b.requests[index].body, { name: 'feishu_user_send', arguments: args });
  }
});
