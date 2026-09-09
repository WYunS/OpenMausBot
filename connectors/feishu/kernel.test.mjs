import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createKernel } from './kernel.mjs';

const BASE = 'http://127.0.0.1:32123';
const SEND = 'feishu_message_1234567890';
const INPUT = { botId: 'bot-1', text: 'hello', sendId: SEND, threadId: 'thread-1' };
const user = (extra = {}) => ({ id: 'user-1', role: 'user', kind: 'text', text: 'hello', sendId: SEND, parentId: null, ...extra });
const answer = (extra = {}) => ({ id: 'answer-1', role: 'bot', kind: 'text', text: 'the answer', turnId: 'turn-1', turnTerminal: true, parentId: 'user-1', ...extra });

function fixture(handler) {
  const state = {
    bot: { id: 'bot-1', threadId: 'thread-1', busy: false, tasks: [{ threadId: 'thread-1' }] },
    messages: [], calls: [], posts: 0, pid: 123,
  };
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, BASE);
    const call = { path: parsed.pathname, query: parsed.searchParams, ...options, body: options.body && JSON.parse(options.body) };
    state.calls.push(call);
    if (call.path === '/api/health') return Response.json({ app: 'openmausbot', pid: state.pid });
    if (call.method === 'POST' && call.path.endsWith('/messages')) state.posts++;
    const result = await handler?.(call, state);
    if (result !== undefined) return result;
    if (call.path === '/api/bots') return Response.json({ bots: state.bot ? [state.bot] : [] });
    if (call.method === 'POST' && call.path.endsWith('/messages')) {
      state.messages = [user(), answer()];
      return Response.json({ ok: true, threadId: 'thread-1', message: user() }, { status: 202 });
    }
    if (call.path === '/api/threads/thread-1/messages') {
      const before = call.query.get('before');
      const stop = before ? state.messages.findIndex((message) => message.id === before) : state.messages.length;
      assert.notEqual(stop, -1);
      const start = Math.max(0, stop - 200);
      return Response.json({ messages: state.messages.slice(start, stop), hasMore: start > 0 });
    }
    throw new Error('Unexpected fake request');
  };
  return { state, kernel: createKernel({ baseUrl: BASE, ownerToken: 'memory-only-token', expectedPid: 123, fetchImpl }) };
}

async function drive(t, work, max = 300) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let result;
  let error;
  let finished = false;
  const pending = work().then((value) => { result = value; }, (reason) => { error = reason; }).finally(() => { finished = true; });
  for (let n = 0; n < max && !finished; n++) {
    await setImmediate();
    if (!finished) t.mock.timers.tick(500);
  }
  assert.ok(finished, 'operation must settle within its bounded wait');
  await pending;
  if (error) throw error;
  return result;
}

test('accepts only explicit loopback origins with numeric ports', async () => {
  const invalid = [
    undefined, 'http://localhost', 'http://127.0.0.1:0', 'http://localhost:65536',
    'http://localhost:abc', 'http://127.1:123', 'http://2130706433:123',
    'http://127.00.0.1:123', 'http://127.0.0.999:123', 'http://example.com:123',
    'http://localhost.evil:123', 'http://0.0.0.0:123', 'http://[::]:123',
    'http://user:secret@localhost:123', 'http://localhost:123/api',
    'http://localhost:123?token=x', 'http://localhost:123#x',
    'http://localhost:123/../', ' http://localhost:123', 'file://localhost:123',
    'http://localhost:123\\@evil',
  ];
  for (const baseUrl of invalid) assert.throws(() => createKernel({ baseUrl }), { code: 'INVALID_BASE_URL' });
  for (const baseUrl of ['http://localhost:80/', 'https://[::1]:443', 'http://127.2.3.4:123']) {
    const calls = [];
    const kernel = createKernel({ baseUrl, fetchImpl: async (url) => {
      calls.push(url);
      return Response.json({ app: 'openmausbot', pid: 1 });
    } });
    await kernel.health();
    assert.ok(!calls[0].includes('localhost'), 'localhost is pinned to a literal address');
  }
});

test('validates configuration without echoing credentials', () => {
  assert.throws(() => createKernel({ baseUrl: BASE, ownerToken: 'secret\nheader' }), { code: 'INVALID_OWNER_TOKEN' });
  assert.throws(() => createKernel({ baseUrl: BASE, expectedPid: '123' }), { code: 'INVALID_PID' });
  assert.throws(() => createKernel({ baseUrl: BASE, fetchImpl: 3 }), { code: 'INVALID_FETCH' });
});

test('request uses owner capability header, JSON, redirect error, and no cookies', async () => {
  const { kernel, state } = fixture(() => Response.json({ bots: [] }));
  assert.deepEqual(await kernel.bots(), []);
  const [health, call] = state.calls;
  assert.equal(health.headers['x-openmausbot-desktop-owner'], undefined);
  assert.equal(call.headers['x-openmausbot-desktop-owner'], 'memory-only-token');
  assert.equal(call.headers.authorization, undefined);
  assert.equal(call.query.get('messages'), '0');
  assert.equal(call.redirect, 'error');
  assert.equal(call.credentials, 'omit');
  await kernel.request('/api/bots/bot-1/tasks', { method: 'POST', body: { title: 'session' } });
  assert.equal(state.calls.at(-1).headers['content-type'], 'application/json');
  assert.deepEqual(state.calls.at(-1).body, { title: 'session' });
});

test('arbitrary URLs, traversal, ambiguous paths, and GET bodies never reach fetch', async () => {
  const { kernel, state } = fixture();
  for (const path of ['https://evil/api/bots', '//evil/api/bots', '/api/../auth', '/api/%2e%2e/auth', '/api/bots#x', '/api\\evil', '/api/bots\n', '/api//bots', '/other']) {
    await assert.rejects(kernel.request(path), { code: 'INVALID_PATH' });
  }
  await assert.rejects(kernel.request('/api/bots', { body: {} }), { code: 'INVALID_REQUEST' });
  await assert.rejects(kernel.request('/api/bots', { method: 'TRACE' }), { code: 'INVALID_REQUEST' });
  assert.equal(state.calls.length, 0);
});

test('health validates app/PID and rechecks process identity before every request', async () => {
  for (const value of [{ app: 'other', pid: 123 }, { app: 'openmausbot', pid: 124 }, { app: 'openmausbot' }]) {
    const kernel = createKernel({ baseUrl: BASE, expectedPid: 123, fetchImpl: async () => Response.json(value) });
    await assert.rejects(kernel.bots(), { code: 'IDENTITY_MISMATCH' });
  }
  const { kernel, state } = fixture();
  await kernel.health();
  state.pid++;
  await assert.rejects(kernel.bots(), { code: 'IDENTITY_MISMATCH' });
  assert.ok(state.calls.every((call) => call.path === '/api/health'));
  let pid = 1;
  const autoPinned = createKernel({ baseUrl: BASE, fetchImpl: async () => Response.json({ app: 'openmausbot', pid }) });
  await autoPinned.health();
  pid++;
  await assert.rejects(autoPinned.health(), { code: 'IDENTITY_MISMATCH' });
});

test('redirect, HTTP, network, and malformed responses have sanitized errors', async () => {
  for (const [fetchImpl, code] of [
    [async () => new Response(null, { status: 302, headers: { location: 'http://evil/' } }), 'REDIRECT_REJECTED'],
    [async () => ({ redirected: true, status: 200 }), 'REDIRECT_REJECTED'],
    [async () => new Response('memory-only-token', { status: 401 }), 'HTTP_ERROR'],
    [async () => { throw new Error('memory-only-token'); }, 'NETWORK_ERROR'],
    [async () => new Response('memory-only-token'), 'INVALID_RESPONSE'],
  ]) {
    const kernel = createKernel({ baseUrl: BASE, ownerToken: 'memory-only-token', fetchImpl });
    await assert.rejects(kernel.health(), (error) => {
      assert.equal(error.code, code);
      assert.ok(!error.stack.includes('memory-only-token'));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('requests time out even when fake fetch ignores cancellation', async (t) => {
  const kernel = createKernel({ baseUrl: BASE, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(drive(t, () => kernel.health()), { code: 'TIMEOUT' });
});

test('explicit session creation activates once; messages never create tasks', async (t) => {
  const { kernel, state } = fixture((call) => {
    if (call.path.endsWith('/tasks')) return Response.json({ bot: { id: 'bot-1', threadId: 'thread-1' }, task: { threadId: 'thread-1' } });
  });
  assert.deepEqual(await kernel.createSession({ botId: 'bot-1', title: ' Feishu session ' }), { threadId: 'thread-1' });
  assert.deepEqual(await drive(t, () => kernel.sendAndWait(INPUT)), { text: 'the answer', threadId: 'thread-1' });
  assert.equal(state.calls.filter((call) => call.path.endsWith('/tasks')).length, 1);
});

test('session creation is not retried on an uncertain response', async () => {
  const { kernel, state } = fixture((call) => {
    if (call.path.endsWith('/tasks')) throw new Error('unknown');
  });
  await assert.rejects(kernel.createSession({ botId: 'bot-1', title: 'session' }), { code: 'NETWORK_ERROR' });
  assert.equal(state.calls.filter((call) => call.path.endsWith('/tasks')).length, 1);
});

test('rejects missing/hidden/archived bots without fallback or writes', async () => {
  for (const patch of [null, { hidden: true }, { archived: true }]) {
    const { kernel, state } = fixture();
    state.bot = patch === null ? null : { ...state.bot, ...patch };
    await assert.rejects(kernel.sendAndWait(INPUT), { code: 'BOT_UNAVAILABLE' });
    await assert.rejects(kernel.createSession({ botId: 'bot-1', title: 'session' }), { code: 'BOT_UNAVAILABLE' });
    assert.equal(state.posts, 0);
  }
});

test('requires safe IDs, text, and stable sendId before any requests', async () => {
  const { kernel, state } = fixture();
  for (const patch of [{ sendId: undefined }, { sendId: 'short' }, { text: ' ' }, { botId: '../bot' }, { threadId: '../thread' }, { onProgress: true }]) {
    await assert.rejects(kernel.sendAndWait({ ...INPUT, ...patch }));
  }
  assert.equal(state.calls.length, 0);
});

test('new sends reject a switched session; no auto-switch, fallback, or new task', async () => {
  const { kernel, state } = fixture();
  state.bot.threadId = 'thread-2';
  state.bot.tasks.push({ threadId: 'thread-2' });
  await assert.rejects(kernel.sendAndWait(INPUT), { code: 'TASK_SWITCHED', threadId: 'thread-1', delivery: 'not-sent' });
  assert.equal(state.posts, 0);
  assert.ok(state.calls.every((call) => call.method === 'GET'));
});

test('omitted threadId is returned for completed replay after a task switch', async (t) => {
  const { kernel, state } = fixture();
  const input = { ...INPUT, threadId: undefined };
  const { threadId } = await drive(t, () => kernel.sendAndWait(input));
  state.bot.threadId = 'thread-2';
  state.bot.tasks.push({ threadId: 'thread-2' });
  assert.deepEqual(await kernel.sendAndWait({ ...input, threadId }), { text: 'the answer', threadId: 'thread-1' });
  assert.equal(state.posts, 1);
});

test('persisted sendId dedup reconciles an old task without any POST', async () => {
  const { kernel, state } = fixture();
  state.messages = [user(), answer()];
  state.bot.threadId = 'thread-2';
  state.bot.tasks.push({ threadId: 'thread-2' });
  assert.deepEqual(await kernel.sendAndWait(INPUT), { text: 'the answer', threadId: 'thread-1' });
  assert.equal(state.posts, 0);
});

test('unfinished accepted send never resends if its transcript disappears', async (t) => {
  const { kernel, state } = fixture();
  state.messages = [user()];
  const stop = new AbortController();
  await assert.rejects(kernel.sendAndWait({ ...INPUT, signal: stop.signal, onProgress: () => stop.abort() }), { code: 'ABORTED', delivery: 'accepted' });
  state.messages = [];
  await assert.rejects(drive(t, () => kernel.sendAndWait(INPUT)), { code: 'TIMEOUT', delivery: 'accepted' });
  assert.equal(state.posts, 0);
});

test('bot archived between send and terminal read is rejected even with a reply', async () => {
  const { kernel } = fixture((call, state) => {
    if (call.method !== 'POST') return;
    state.bot.hidden = true;
    state.messages = [user(), answer()];
    return Response.json({ ok: true, threadId: 'thread-1', message: user() });
  });
  await assert.rejects(kernel.sendAndWait(INPUT), { code: 'BOT_UNAVAILABLE' });
});

test('unfinished sendId cannot be rebound to different text or thread', async () => {
  const { kernel, state } = fixture();
  state.messages = [user()];
  const stop = new AbortController();
  await assert.rejects(kernel.sendAndWait({ ...INPUT, signal: stop.signal, onProgress: () => stop.abort() }), { code: 'ABORTED' });
  for (const patch of [{ text: 'different' }, { threadId: 'thread-2' }]) {
    await assert.rejects(kernel.sendAndWait({ ...INPUT, ...patch }), { code: 'SEND_ID_CONFLICT' });
  }
  assert.equal(state.posts, 0);
});

test('completed sendId still rejects changed text using its persisted message', async () => {
  const { kernel, state } = fixture();
  await kernel.sendAndWait(INPUT);
  await assert.rejects(kernel.sendAndWait({ ...INPUT, text: 'different' }), { code: 'SEND_ID_CONFLICT' });
  assert.equal(state.posts, 1);
});

test('canonical receipt must carry our exact sendId, thread, and message', async () => {
  for (const receipt of [
    { ok: true, threadId: 'thread-2', message: user() },
    { ok: true, threadId: 'thread-1', message: user({ sendId: 'other_send_12345678' }) },
    { ok: true, threadId: 'thread-1', message: user({ text: 'different' }) },
    { ok: true, threadId: 'thread-1', queued: true },
  ]) {
    const { kernel, state } = fixture((call) => call.method === 'POST' ? Response.json(receipt) : undefined);
    await assert.rejects(kernel.sendAndWait(INPUT));
    assert.equal(state.posts, 1);
  }
});

test('queued receipt waits for sendId plus queueId, ignoring the previous terminal', async (t) => {
  let polls = 0;
  const progress = [];
  const { kernel, state } = fixture((call, state) => {
    if (call.method === 'POST') {
      state.messages = [answer({ id: 'old', parentId: null, turnId: 'old-turn', text: 'WRONG' })];
      return Response.json({ ok: true, queued: true, queueId: 'queue-1', threadId: 'thread-1' });
    }
    if (state.posts && call.path.includes('/threads/') && ++polls === 3) {
      state.messages.push(user({ queueId: 'queue-1', parentId: 'old' }), answer());
    }
  });
  assert.deepEqual(await drive(t, () => kernel.sendAndWait({ ...INPUT, onProgress: (event) => progress.push(event) })), { text: 'the answer', threadId: 'thread-1' });
  assert.equal(progress[0].state, 'queued');
  assert.equal(state.posts, 1);
  assert.equal(state.calls.find((call) => call.method === 'POST').body.sendId, SEND);
});

test('merged queued batch fails closed without a durable batch-to-turn mapping', async (t) => {
  const { kernel } = fixture((call, state) => {
    if (call.method !== 'POST') return;
    state.messages = [user({ queueId: 'queue-1' }), user({ id: 'user-2', sendId: 'another_send_12345678', queueId: 'queue-2', parentId: 'user-1' }), answer({ parentId: 'user-2' })];
    return Response.json({ ok: true, queued: true, queueId: 'queue-1', threadId: 'thread-1' });
  });
  await assert.rejects(drive(t, () => kernel.sendAndWait(INPUT)), { code: 'CORRELATION_AMBIGUOUS' });
});

test('queue identity mismatch fails closed', async () => {
  const { kernel } = fixture((call, state) => {
    if (call.method !== 'POST') return;
    state.messages = [user({ queueId: 'wrong-queue' }), answer()];
    return Response.json({ ok: true, queued: true, queueId: 'queue-1', threadId: 'thread-1' });
  });
  await assert.rejects(kernel.sendAndWait(INPUT), { code: 'CORRELATION_AMBIGUOUS' });
});

test('lost POST response reconciles read-only and deduplicates another call', async (t) => {
  const { kernel, state } = fixture((call, state) => {
    if (call.method !== 'POST') return;
    state.messages = [user(), answer()];
    throw new Error('write committed but response lost');
  });
  assert.deepEqual(await drive(t, () => kernel.sendAndWait(INPUT)), { text: 'the answer', threadId: 'thread-1' });
  assert.deepEqual(await kernel.sendAndWait(INPUT), { text: 'the answer', threadId: 'thread-1' });
  assert.equal(state.posts, 1);
});

test('5xx and non-JSON write outcomes are reconciled without another POST', async (t) => {
  await drive(t, async () => {
    for (const response of [new Response('failed', { status: 503 }), new Response('not JSON', { status: 202 })]) {
      const { kernel, state } = fixture((call, state) => {
        if (call.method !== 'POST') return;
        state.messages = [user(), answer()];
        return response;
      });
      assert.deepEqual(await kernel.sendAndWait(INPUT), { text: 'the answer', threadId: 'thread-1' });
      assert.equal(state.posts, 1);
    }
  });
});

test('process restart while queued aborts reconciliation without a new write', async () => {
  const { kernel, state } = fixture((call, state) => {
    if (call.method !== 'POST') return;
    state.pid++;
    return Response.json({ ok: true, queued: true, queueId: 'queue-1', threadId: 'thread-1' });
  });
  await assert.rejects(kernel.sendAndWait(INPUT), { code: 'IDENTITY_MISMATCH', delivery: 'queued' });
  assert.equal(state.posts, 1);
});

test('hidden bot during a wait is rejected, not replaced by another bot', async () => {
  const { kernel, state } = fixture((call, state) => {
    if (call.method !== 'POST') return;
    state.bot.hidden = true;
    state.messages = [user()];
    return Response.json({ ok: true, threadId: 'thread-1', message: user() });
  });
  await assert.rejects(kernel.sendAndWait(INPUT), { code: 'BOT_UNAVAILABLE' });
  assert.equal(state.posts, 1);
});

test('unknown write with no transcript times out in two minutes; never resends or promises later', async (t) => {
  const { kernel, state } = fixture((call) => {
    if (call.method === 'POST') throw new Error('unknown');
  });
  const progress = [];
  await assert.rejects(drive(t, () => kernel.sendAndWait({ ...INPUT, onProgress: (event) => progress.push(event.state) })), { code: 'TIMEOUT', delivery: 'unknown', threadId: 'thread-1', sendId: SEND });
  assert.deepEqual(progress, ['unknown']);
  assert.equal(state.posts, 1);
  const stop = new AbortController();
  const again = kernel.sendAndWait({ ...INPUT, signal: stop.signal });
  await setImmediate();
  stop.abort();
  await assert.rejects(again, { code: 'ABORTED', delivery: 'unknown' });
  assert.equal(state.posts, 1);
});

test('lost in-memory queue is bounded, never mistaken for an unrelated response', async (t) => {
  const { kernel, state } = fixture((call, state) => {
    if (call.method === 'POST') {
      state.messages = [answer({ parentId: null })];
      return Response.json({ ok: true, queued: true, queueId: 'queue-1', threadId: 'thread-1' });
    }
  });
  await assert.rejects(drive(t, () => kernel.sendAndWait(INPUT)), { code: 'TIMEOUT', delivery: 'queued' });
  assert.equal(state.posts, 1);
});

test('resumeOnly reconciles after router restart without recreating a lost queue', async (t) => {
  const { kernel, state } = fixture();
  await assert.rejects(drive(t, () => kernel.sendAndWait({ ...INPUT, resumeOnly: true })), { code: 'TIMEOUT', delivery: 'unknown' });
  assert.equal(state.posts, 0);
  state.messages = [user(), answer()];
  assert.deepEqual(await kernel.sendAndWait({ ...INPUT, resumeOnly: true }), { text: 'the answer', threadId: 'thread-1' });
  assert.equal(state.posts, 0);
  await assert.rejects(kernel.sendAndWait({ ...INPUT, threadId: undefined, resumeOnly: true }), { code: 'INVALID_RESUME' });
});

test('pagination finds old exact reply beyond unrelated newer turns and forks', async () => {
  const { kernel, state } = fixture();
  state.messages = [user(), answer({ id: 'progress', text: 'progress', turnTerminal: false }), answer({ parentId: 'progress' })];
  for (let n = 0; n < 451; n++) state.messages.push(answer({ id: `unrelated-${n}`, parentId: null, text: 'WRONG', turnId: `unrelated-turn-${n}` }));
  assert.deepEqual(await kernel.sendAndWait(INPUT), { text: 'the answer', threadId: 'thread-1' });
  assert.equal(state.calls.filter((call) => call.query.has('before')).length, 2);
  assert.equal(state.posts, 0);
});

test('pagination rejects repeated cursors instead of looping', async () => {
  const { kernel } = fixture((call) => call.path.includes('/threads/') ? Response.json({ messages: [user()], hasMore: true }) : undefined);
  await assert.rejects(kernel.sendAndWait(INPUT), { code: 'INVALID_PAGINATION' });
});

test('ordinary later asks, different turns, failed turns, and ambiguous branches are not replies', async (t) => {
  const cases = [
    [user(), user({ id: 'later-user', sendId: 'different_send_123456', parentId: 'user-1' }), answer({ parentId: 'later-user' })],
    [user(), answer({ id: 'progress', turnTerminal: false }), answer({ parentId: 'progress', turnId: 'later-turn' })],
    [user(), { id: 'error', role: 'bot', kind: 'activity', tool: { name: 'error: dispatch failed', ok: false }, parentId: 'user-1' }, answer({ parentId: 'error' })],
  ];
  await drive(t, async () => {
    await Promise.all(cases.map(async (messages) => {
      const { kernel, state } = fixture();
      state.messages = messages;
      await assert.rejects(kernel.sendAndWait(INPUT), { code: 'TIMEOUT' });
      assert.equal(state.posts, 0);
    }));
  });
  const { kernel, state } = fixture();
  state.messages = [user(), answer(), answer({ id: 'fork-answer', turnId: 'fork-turn' })];
  await assert.rejects(kernel.sendAndWait(INPUT), { code: 'CORRELATION_AMBIGUOUS' });
});

test('steered receipts fail closed because user messages have no provider turnId', async () => {
  const { kernel, state } = fixture((call, state) => {
    if (call.method !== 'POST') return;
    state.messages = [user({ steered: true }), answer()];
    return Response.json({ ok: true, steered: true, threadId: 'thread-1', message: user({ steered: true }) });
  });
  await assert.rejects(kernel.sendAndWait(INPUT), { code: 'CORRELATION_AMBIGUOUS', delivery: 'accepted' });
  assert.equal(state.posts, 1);
});

test('stop aborts local polling immediately without interrupting shared server work', async (t) => {
  const stop = new AbortController();
  const { kernel, state } = fixture((call, state) => {
    if (call.method !== 'POST') return;
    state.messages = [user()];
    return Response.json({ ok: true, threadId: 'thread-1', message: user() });
  });
  await assert.rejects(drive(t, () => kernel.sendAndWait({ ...INPUT, signal: stop.signal, onProgress: () => stop.abort('secret reason') })), { code: 'ABORTED', delivery: 'accepted' });
  const count = state.calls.length;
  t.mock.timers.tick(120_000);
  await setImmediate();
  assert.equal(state.calls.length, count);
  assert.ok(state.calls.every((call) => !call.path.endsWith('/interrupt')));
});

test('pre-aborted send never calls fetch; in-flight fetch receives stop signal', async () => {
  const { kernel, state } = fixture();
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(kernel.sendAndWait({ ...INPUT, signal: stop.signal }), { code: 'ABORTED' });
  assert.equal(state.calls.length, 0);
  const active = new AbortController();
  let fetchSignal;
  const blocked = createKernel({ baseUrl: BASE, fetchImpl: (_, options) => {
    fetchSignal = options.signal;
    return new Promise(() => {});
  } });
  const pending = blocked.health({ signal: active.signal });
  await setImmediate();
  active.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
  assert.equal(fetchSignal.aborted, true);
});

test('concurrent duplicates permit at most one POST', async (t) => {
  const { kernel, state } = fixture();
  const results = await drive(t, () => Promise.allSettled([kernel.sendAndWait(INPUT), kernel.sendAndWait(INPUT)]));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'SEND_IN_FLIGHT');
  assert.equal(state.posts, 1);
});

test('1001 successful sends release capacity while uncertain writes remain non-resendable', async () => {
  const messages = [];
  const posts = new Map();
  const unknownId = 'feishu_unknown_1234567890';
  let reads = 0;
  const kernel = createKernel({ baseUrl: BASE, expectedPid: 123, fetchImpl: async (url, options) => {
    const parsed = new URL(url);
    let value;
    if (parsed.pathname === '/api/health') value = { app: 'openmausbot', pid: 123 };
    else if (parsed.pathname === '/api/bots') {
      value = { bots: [{ id: 'bot-1', threadId: 'thread-1', tasks: [{ threadId: 'thread-1' }] }] };
    } else if (options.method === 'POST') {
      const { sendId, text } = JSON.parse(options.body);
      posts.set(sendId, (posts.get(sendId) ?? 0) + 1);
      if (sendId === unknownId) throw new Error('uncertain write');
      const message = user({ id: `user-${sendId}`, sendId, text });
      messages.push(message, answer({ id: `answer-${sendId}`, parentId: message.id, turnId: `turn-${sendId}` }));
      value = { ok: true, threadId: 'thread-1', message };
    } else {
      assert.equal(parsed.pathname, '/api/threads/thread-1/messages');
      reads++;
      const before = parsed.searchParams.get('before');
      const stop = before ? messages.findIndex((message) => message.id === before) : messages.length;
      assert.notEqual(stop, -1);
      const start = Math.max(0, stop - 200);
      value = { messages: messages.slice(start, stop), hasMore: start > 0 };
    }
    // Avoid Response serialization overhead in the capacity regression.
    return { ok: true, status: 200, json: async () => value };
  } });
  const uncertain = async () => {
    const stop = new AbortController();
    await assert.rejects(kernel.sendAndWait({
      ...INPUT, sendId: unknownId, signal: stop.signal, onProgress: () => stop.abort(),
    }), { code: 'ABORTED', delivery: 'unknown' });
  };
  await uncertain();
  for (let n = 0; n < 1001; n++) {
    assert.deepEqual(await kernel.sendAndWait({ ...INPUT, sendId: `feishu_success_${n}` }), {
      text: 'the answer', threadId: 'thread-1',
    });
  }
  const previousReads = reads;
  await kernel.sendAndWait({ ...INPUT, sendId: 'feishu_success_0' });
  assert.ok(reads > previousReads, 'completed duplicates must recheck the persisted transcript');
  await uncertain();
  assert.equal(posts.size, 1002);
  assert.ok([...posts.values()].every((count) => count === 1), 'neither completed nor uncertain sends may be duplicated');
});

test('POST task-switch conflict is retained, never retried or redirected', async () => {
  const { kernel, state } = fixture((call) => call.method === 'POST' ? Response.json({ error: 'task switched' }, { status: 409 }) : undefined);
  for (let n = 0; n < 2; n++) await assert.rejects(kernel.sendAndWait(INPUT), { code: 'HTTP_ERROR', status: 409, delivery: 'not-sent' });
  assert.equal(state.posts, 1);
});

test('task switched while queued stops waiting without following the new task', async () => {
  const { kernel, state } = fixture((call, state) => {
    if (call.method !== 'POST') return;
    state.bot.threadId = 'thread-2';
    state.bot.tasks.push({ threadId: 'thread-2' });
    return Response.json({ ok: true, queued: true, queueId: 'queue-1', threadId: 'thread-1' });
  });
  await assert.rejects(kernel.sendAndWait(INPUT), { code: 'TASK_SWITCHED', delivery: 'queued' });
  assert.equal(state.posts, 1);
  assert.ok(state.calls.every((call) => !call.path.includes('/threads/thread-2')));
});

test('async progress callback cannot bypass the two-minute deadline or leak its error', async (t) => {
  const { kernel, state } = fixture();
  state.messages = [user()];
  await assert.rejects(drive(t, () => kernel.sendAndWait({ ...INPUT, onProgress: () => new Promise(() => {}) })), { code: 'TIMEOUT' });
  await assert.rejects(kernel.sendAndWait({ ...INPUT, onProgress: () => { throw new Error('memory-only-token'); } }), { code: 'PROGRESS_ERROR' });
});
