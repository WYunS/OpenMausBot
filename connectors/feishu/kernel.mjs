import { isIP } from 'node:net';

const WAIT_MS = 120_000;
const REQUEST_MS = 15_000;
const ID = /^[A-Za-z0-9_-]+$/;
const SEND_ID = /^[A-Za-z0-9_-]{16,80}$/;

function fail(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}

function id(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw fail('INVALID_ID');
  return value;
}

function scope(signal, ms) {
  const controller = new AbortController();
  const abort = () => controller.abort(fail('ABORTED'));
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(fail('TIMEOUT')), ms);
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}

// Also bounds injected transports/callbacks that ignore AbortSignal.
async function bounded(work, signal) {
  signal.throwIfAborted();
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      signal.throwIfAborted();
      return work();
    }), cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function pause(signal) {
  let timer;
  try {
    await bounded(() => new Promise((resolve) => { timer = setTimeout(resolve, 500); }), signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Local REST adapter only. No credentials, transcripts, or errors are logged.
 * Persist {botId, threadId, sendId, text} in the caller before delivery.
 * createSession is explicit: the existing API creates AND activates a task.
 * sendAndWait never creates/switches tasks and returns {text, threadId}.
 * Abort stops local waiting/requests, not the provider or its server-side queue.
 */
export function createKernel({ baseUrl, ownerToken, expectedPid, fetchImpl = fetch }) {
  const match = typeof baseUrl === 'string' &&
    /^(https?):\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\]):([0-9]{1,5})\/?$/.exec(baseUrl);
  if (!match || Number(match[3]) < 1 || Number(match[3]) > 65535 ||
      (match[2].startsWith('127.') && isIP(match[2]) !== 4)) throw fail('INVALID_BASE_URL');
  const origin = new URL(`${match[1]}://${match[2] === 'localhost' ? '127.0.0.1' : match[2]}:${Number(match[3])}`).origin;
  if (ownerToken !== undefined && (typeof ownerToken !== 'string' || !/^[\x21-\x7e]+$/.test(ownerToken))) {
    throw fail('INVALID_OWNER_TOKEN');
  }
  if (expectedPid !== undefined && (!Number.isSafeInteger(expectedPid) || expectedPid < 1)) {
    throw fail('INVALID_PID');
  }
  if (typeof fetchImpl !== 'function') throw fail('INVALID_FETCH');
  let pinnedPid = expectedPid;
  const attempts = new Map();

  async function raw(path, { method = 'GET', body, signal } = {}, authenticated = true) {
    const operation = scope(signal, REQUEST_MS);
    try {
      return await bounded(async () => {
        let response;
        try {
          response = await fetchImpl(`${origin}${path}`, {
            method,
            headers: {
              accept: 'application/json',
              ...(body === undefined ? {} : { 'content-type': 'application/json' }),
              ...(authenticated && ownerToken ? { 'x-openmausbot-desktop-owner': ownerToken } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: operation.signal,
            redirect: 'error',
            credentials: 'omit',
          });
        } catch {
          throw fail('NETWORK_ERROR');
        }
        if (response.redirected || (response.status >= 300 && response.status < 400)) {
          throw fail('REDIRECT_REJECTED');
        }
        if (!response.ok) throw fail('HTTP_ERROR', { status: response.status });
        try {
          return await response.json();
        } catch {
          throw fail('INVALID_RESPONSE');
        }
      }, operation.signal);
    } finally {
      operation.close();
    }
  }

  async function health({ signal } = {}) {
    const value = await raw('/api/health', { signal }, false);
    if (value?.app !== 'openmausbot' || !Number.isSafeInteger(value.pid) || value.pid < 1 ||
        (pinnedPid !== undefined && value.pid !== pinnedPid)) throw fail('IDENTITY_MISMATCH');
    pinnedPid = value.pid;
    return value;
  }

  async function request(path, { method = 'GET', body, signal } = {}) {
    if (typeof path !== 'string' || !/^\/api\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\?[^#\\\s]*)?$/.test(path)) {
      throw fail('INVALID_PATH');
    }
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].includes(method) ||
        (body !== undefined && ['GET', 'HEAD'].includes(method))) throw fail('INVALID_REQUEST');
    if (path === '/api/health' && method === 'GET') return health({ signal });
    await health({ signal });
    return raw(path, { method, body, signal });
  }

  async function bots({ signal } = {}) {
    const value = await request('/api/bots?messages=0', { signal });
    if (!Array.isArray(value?.bots)) throw fail('INVALID_RESPONSE');
    return value.bots;
  }

  async function target(botId, signal) {
    const bot = (await bots({ signal })).find((candidate) => candidate?.id === botId);
    if (!bot || bot.hidden || bot.archived) throw fail('BOT_UNAVAILABLE');
    id(bot.threadId);
    if (!Array.isArray(bot.tasks)) throw fail('INVALID_RESPONSE');
    return bot;
  }

  async function createSession({ botId, title, signal }) {
    id(botId);
    if (typeof title !== 'string' || !title.trim()) throw fail('INVALID_TITLE');
    const bot = await target(botId, signal);
    if (bot.busy) throw fail('BOT_BUSY');
    // No retry: task creation has no idempotency key in the current REST API.
    const value = await request(`/api/bots/${botId}/tasks`, { method: 'POST', body: { title: title.trim() }, signal });
    const threadId = id(value?.task?.threadId);
    if (value?.bot?.id !== botId || value.bot.threadId !== threadId) throw fail('INVALID_RESPONSE');
    return { threadId };
  }

  async function transcript(threadId, signal) {
    const pages = [];
    const seen = new Set();
    let before;
    for (;;) {
      const page = await request(`/api/threads/${threadId}/messages?limit=200${before ? `&before=${before}` : ''}`, { signal });
      if (!Array.isArray(page?.messages) || typeof page.hasMore !== 'boolean') throw fail('INVALID_RESPONSE');
      for (const message of page.messages) {
        id(message?.id);
        if (seen.has(message.id)) throw fail('INVALID_PAGINATION');
        seen.add(message.id);
      }
      pages.push(page.messages);
      if (!page.hasMore) return pages.reverse().flat();
      if (!page.messages.length) throw fail('INVALID_PAGINATION');
      before = page.messages[0].id;
    }
  }

  function accepted(messages, entry) {
    const matches = messages.filter((message) => message.sendId === entry.sendId);
    if (matches.length > 1) throw fail('CORRELATION_AMBIGUOUS');
    const message = matches[0];
    if (message) id(message.id);
    if (message && (message.role !== 'user' || message.kind !== 'text' || message.text !== entry.text || message.replyToId)) {
      throw fail('SEND_ID_CONFLICT');
    }
    if (message && entry.receipt?.message && message.id !== entry.receipt.message.id) throw fail('CORRELATION_AMBIGUOUS');
    if (message && entry.receipt?.queueId && message.queueId !== entry.receipt.queueId) throw fail('CORRELATION_AMBIGUOUS');
    return message;
  }

  function reply(messages, user) {
    if (user.steered) throw fail('CORRELATION_AMBIGUOUS');
    // Parent links matter: scrollback includes abandoned branches. Never pick
    // the first terminal after an array index, or cross a later ordinary ask.
    const descendants = new Map([[user.id, { turnId: undefined }]]);
    const candidates = [];
    for (const message of messages) {
      const parent = descendants.get(message.parentId);
      if (!parent) continue;
      if (message.kind === 'activity' && message.tool?.ok === false && (message.tool.name ?? '').startsWith('error:')) continue;
      if (message.role === 'user') {
        // Adjacent queued lines may share a dispatch, but no durable batch id
        // proves that an empty intervening turn did not already settle.
        if (user.queueId && message.queueId && !parent.turnId) throw fail('CORRELATION_AMBIGUOUS');
        continue;
      }
      let turnId = parent.turnId;
      if (message.role === 'bot' && message.kind === 'text') {
        if (!message.turnId || (turnId && turnId !== message.turnId)) continue;
        turnId = message.turnId;
        if (message.turnTerminal === true && typeof message.text === 'string' && message.text.trim()) candidates.push(message);
      }
      descendants.set(message.id, { turnId });
    }
    if (candidates.length > 1) throw fail('CORRELATION_AMBIGUOUS');
    return candidates[0]?.text;
  }

  /** onProgress receives metadata only: {state, botId, threadId, sendId}.
   * A stable sendId is required. Successful attempts are released; replay them
   * with the returned threadId so the persisted transcript supplies the reply.
   * Unfinished/uncertain attempts remain non-resendable. Concurrent duplicates reject.
   * After a caller restart, resumeOnly must be true for uncertain/queued sends:
   * server queues are volatile and a repeated POST could create new work.
   * Errors carry code, threadId, sendId, delivery (not a later-reply promise).
   */
  async function sendAndWait({ botId, text, sendId, threadId, signal, onProgress, resumeOnly = false }) {
    id(botId);
    if (typeof text !== 'string' || !text.trim()) throw fail('INVALID_TEXT');
    if (typeof sendId !== 'string' || !SEND_ID.test(sendId)) throw fail('INVALID_SEND_ID');
    if (threadId !== undefined) id(threadId);
    if (onProgress !== undefined && typeof onProgress !== 'function') throw fail('INVALID_PROGRESS');
    if (typeof resumeOnly !== 'boolean' || (resumeOnly && threadId === undefined)) throw fail('INVALID_RESUME');
    text = text.trim();
    const operation = scope(signal, WAIT_MS);
    const key = `${botId}:${sendId}`;
    let entry = attempts.get(key);
    let ownsEntry = false;
    let delivery = entry?.delivery ?? 'not-sent';
    try {
      if (entry && (entry.text !== text || (threadId !== undefined && entry.threadId !== threadId))) throw fail('SEND_ID_CONFLICT');
      if (entry?.active) throw fail('SEND_IN_FLIGHT');
      const bot = await target(botId, operation.signal);
      threadId = entry?.threadId ?? threadId ?? bot.threadId;
      if (!bot.tasks.some((task) => task.threadId === threadId)) throw fail('THREAD_UNAVAILABLE');
      // Recheck after the await: simultaneous identical calls must not write twice.
      if (attempts.get(key) !== entry || entry?.active) throw fail('SEND_IN_FLIGHT');
      if (!entry) {
        if (attempts.size >= 1000) throw fail('ATTEMPT_CAPACITY');
        entry = { text, sendId, threadId, delivery: 'not-sent', written: false };
        attempts.set(key, entry);
      }
      entry.active = true;
      ownsEntry = true;
      if (resumeOnly && !entry.written) {
        entry.written = true;
        delivery = entry.delivery = 'unknown';
      }
      let messages = await transcript(threadId, operation.signal);
      let user = accepted(messages, entry);
      if (user) {
        delivery = entry.delivery = 'accepted';
        entry.written = true;
      }
      if (!user && !entry.written) {
        if (bot.threadId !== threadId) throw fail('TASK_SWITCHED');
        // Handshake failures occur before any write; request() cannot tell us
        // whether a failed POST committed, so all failures below are retained.
        await health({ signal: operation.signal });
        entry.written = true;
        delivery = entry.delivery = 'unknown';
        try {
          const receipt = await raw(`/api/bots/${botId}/messages`, {
            method: 'POST', body: { text, sendId, threadId }, signal: operation.signal,
          });
          if (receipt?.ok !== true || receipt.threadId !== threadId ||
              (receipt.queued === true ? !ID.test(receipt.queueId ?? '') : !receipt.message)) throw fail('INVALID_RECEIPT');
          entry.receipt = receipt;
          if (receipt.queued === true) delivery = entry.delivery = 'queued';
          else {
            if (!accepted([receipt.message], entry)) throw fail('INVALID_RECEIPT');
            delivery = entry.delivery = 'accepted';
          }
          if (receipt.steered || receipt.message?.steered) throw fail('CORRELATION_AMBIGUOUS');
        } catch (error) {
          if (error.code === 'HTTP_ERROR' && error.status < 500) {
            delivery = entry.delivery = 'not-sent';
            entry.rejection = error;
            throw error;
          }
          if (!['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'].includes(error.code) &&
              !(error.code === 'HTTP_ERROR' && error.status >= 500)) throw error;
          // Read-only reconciliation. A queued write may not be visible yet.
        }
        messages = await transcript(threadId, operation.signal);
        user = accepted(messages, entry);
      }
      if (!user && entry.rejection) throw entry.rejection;
      let previousState;
      for (;;) {
        operation.signal.throwIfAborted();
        const current = await target(botId, operation.signal);
        if (!current.tasks.some((task) => task.threadId === threadId)) throw fail('THREAD_UNAVAILABLE');
        if (user) {
          delivery = entry.delivery = 'accepted';
          const text = reply(messages, user);
          if (text !== undefined) {
            // The correlated terminal reply is durable; only unfinished work
            // needs an in-memory guard against an uncertain duplicate write.
            attempts.delete(key);
            return { text, threadId };
          }
        }
        if (current.threadId !== threadId) throw fail('TASK_SWITCHED');
        const state = user ? 'waiting' : delivery;
        if (state !== previousState && onProgress) {
          try {
            await bounded(() => onProgress({ state, botId, threadId, sendId }), operation.signal);
          } catch {
            operation.signal.throwIfAborted();
            throw fail('PROGRESS_ERROR');
          }
        }
        previousState = state;
        await pause(operation.signal);
        messages = await transcript(threadId, operation.signal);
        user = accepted(messages, entry);
      }
    } catch (error) {
      const reason = operation.signal.aborted ? operation.signal.reason : error;
      throw fail(reason.code ?? 'KERNEL_ERROR', { ...(reason.status ? { status: reason.status } : {}), threadId, sendId, delivery });
    } finally {
      if (ownsEntry) entry.active = false;
      operation.close();
    }
  }

  return { health, bots, listBots: bots, request, createSession, sendAndWait };
}
