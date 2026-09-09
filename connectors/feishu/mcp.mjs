/* eslint-disable no-control-regex -- Reject URL controls before WHATWG normalization. */
import http from 'node:http';
import https from 'node:https';
import { realpathSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { TOOL_DEFINITIONS, validateTool } from './tools.mjs';

const MAX_LINE = 64 * 1024;
const MAX_RESPONSE = 1024 * 1024;
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const toolError = (code) => ({ isError: true, content: [{ type: 'text', text: code }] });
const safeCodes = new Set(['APPROVAL_REQUIRED', 'APPROVAL_DENIED', 'APPROVAL_TIMEOUT',
  'AUTH_REQUIRED', 'FORBIDDEN', 'UNKNOWN_TOOL', 'INVALID_ARGUMENTS', 'NOT_CONNECTED']);

// Broker contract: POST /tools {name,arguments}, Bearer dedicated bridge token.
// Response: {ok:true,result:<JSON>} or {ok:false,error:{code:<safe code>}}.
// No redirects, proxy env, CLI, kernel credentials, or IM lifecycle in this process.
function invokeBroker(env, name, args, timeoutMs, signal) {
  let url;
  const token = env.TT_FEISHU_BRIDGE_TOKEN;
  try {
    const raw = env.TT_FEISHU_BRIDGE_URL;
    if (typeof raw !== 'string' || /[\x00-\x20\x7f\\]/.test(raw)) throw new Error();
    url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) ||
        !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        typeof token !== 'string' || !/^[A-Za-z0-9._~-]{16,4096}$/.test(token)) throw new Error();
    // Avoid DNS/rebinding even if the host's resolver has a non-loopback localhost entry.
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    url.pathname = '/tools';
  } catch { return Promise.resolve(toolError('BRIDGE_CONFIG_INVALID')); }

  return new Promise((resolve) => {
    let settled = false;
    let request;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(value);
    };
    const abort = () => { finish(toolError('BRIDGE_ABORTED')); request?.destroy(); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    const body = JSON.stringify({ name, arguments: args });
    try {
      request = (url.protocol === 'https:' ? https : http).request(url, {
        method: 'POST', agent: false,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body), Accept: 'application/json' },
      }, (response) => {
        if (response.statusCode !== 200) {
          const code = response.statusCode === 403 ? 'APPROVAL_DENIED' :
            response.statusCode === 401 ? 'BRIDGE_UNAUTHORIZED' :
              response.statusCode >= 300 && response.statusCode < 400 ? 'BRIDGE_REDIRECT_REJECTED' : 'BRIDGE_HTTP_ERROR';
          finish(toolError(code));
          response.destroy();
          return;
        }
        let total = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          total += chunk.length;
          if (total > MAX_RESPONSE) {
            finish(toolError('BRIDGE_OUTPUT_LIMIT'));
            response.destroy();
          } else chunks.push(chunk);
        });
        response.on('error', () => finish(toolError('BRIDGE_UNAVAILABLE')));
        response.on('aborted', () => finish(toolError('BRIDGE_UNAVAILABLE')));
        response.on('end', () => {
          if (settled) return;
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!object(value) || typeof value.ok !== 'boolean') throw new Error();
            if (!value.ok) {
              finish(toolError(safeCodes.has(value.error?.code) ? value.error.code : 'BRIDGE_OPERATION_FAILED'));
            } else if (Object.hasOwn(value, 'result')) {
              finish({ content: [{ type: 'text', text: JSON.stringify(value.result) }] });
            } else throw new Error();
          } catch { finish(toolError('BRIDGE_INVALID_OUTPUT')); }
        });
      });
      request.on('error', () => finish(toolError('BRIDGE_UNAVAILABLE')));
      timer = setTimeout(() => {
        finish(toolError('APPROVAL_TIMEOUT'));
        request.destroy();
      }, timeoutMs);
      request.end(body);
    } catch { finish(toolError('BRIDGE_UNAVAILABLE')); request?.destroy(); }
  });
}

// Importing is side-effect free. stop() aborts pending broker requests and detaches input.
export function startMcp({ input = process.stdin, output = process.stdout,
  env = process.env, timeoutMs = 300000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) {
    throw Object.assign(new Error('INVALID_TIMEOUT'), { code: 'INVALID_TIMEOUT' });
  }
  const bridgeEnv = { TT_FEISHU_BRIDGE_URL: env.TT_FEISHU_BRIDGE_URL,
    TT_FEISHU_BRIDGE_TOKEN: env.TT_FEISHU_BRIDGE_TOKEN };
  const decoder = new StringDecoder('utf8');
  const pending = new Map();
  let buffer = '';
  let initialized = false;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    input.off('data', receive);
    input.off('end', end);
    input.off('error', stop);
    output.off('drain', drain);
    input.pause();
    buffer = '';
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  };
  const send = (value) => {
    if (stopped) return;
    if (output.writableLength > 2 * MAX_RESPONSE) { stop(); return; }
    try { if (!output.write(`${JSON.stringify(value)}\n`)) input.pause(); }
    catch { stop(); }
  };
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  const result = (id, value) => send({ jsonrpc: '2.0', id, result: value });
  const handle = (line) => {
    let message;
    try { message = JSON.parse(line); }
    catch { error(null, -32700, 'Parse error'); return; }
    const hasId = object(message) && Object.hasOwn(message, 'id');
    if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
        (hasId && !(typeof message.id === 'string' && message.id.length <= 256) &&
          !Number.isSafeInteger(message.id)) ||
        (message.params !== undefined && !object(message.params))) {
      error(null, -32600, 'Invalid Request'); return;
    }
    const { id, method, params = {} } = message;
    if (!hasId) {
      if (method === 'notifications/cancelled') pending.get(params.requestId)?.abort();
      return; // Notifications never execute operations and never receive replies.
    }
    if (pending.has(id)) { error(id, -32600, 'Duplicate request ID'); return; }
    if (method === 'initialize') {
      if (initialized || typeof params.protocolVersion !== 'string' || !object(params.capabilities) ||
          !object(params.clientInfo) || typeof params.clientInfo.name !== 'string' ||
          typeof params.clientInfo.version !== 'string') { error(id, -32602, 'Invalid params'); return; }
      initialized = true;
      result(id, { protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: '@tuantuan/feishu-connector', version: '0.1.0' } });
      return;
    }
    if (method === 'ping') { result(id, {}); return; }
    if (!initialized) { error(id, -32000, 'Not initialized'); return; }
    if (method === 'tools/list') { result(id, { tools: TOOL_DEFINITIONS }); return; }
    if (method !== 'tools/call') { error(id, -32601, 'Method not found'); return; }
    try {
      if (Object.keys(params).some((key) => !['name', 'arguments', '_meta'].includes(key))) throw new Error();
      validateTool(params.name, params.arguments);
    } catch { error(id, -32602, 'Invalid tool or arguments'); return; }
    if (pending.size >= 8) { error(id, -32000, 'Too many pending requests'); return; }
    const controller = new AbortController();
    pending.set(id, controller);
    invokeBroker(bridgeEnv, params.name, params.arguments, timeoutMs, controller.signal)
      .then((value) => result(id, value))
      .catch(() => result(id, toolError('BRIDGE_UNAVAILABLE')))
      .finally(() => pending.delete(id));
  };
  const receive = (chunk) => {
    if (stopped) return;
    // Process slices so a single large chunk of short lines cannot force a large buffer.
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (let offset = 0; !stopped && offset < bytes.length; offset += 4096) {
      buffer += decoder.write(bytes.subarray(offset, offset + 4096));
      let newline;
      while (!stopped && (newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > MAX_LINE) { error(null, -32600, 'Input limit'); stop(); return; }
        if (line.trim()) handle(line);
      }
      if (Buffer.byteLength(buffer) > MAX_LINE) { error(null, -32600, 'Input limit'); stop(); }
    }
  };
  const end = () => {
    if ((buffer + decoder.end()).trim()) error(null, -32700, 'Incomplete frame');
    stop();
  };
  const drain = () => { if (!stopped) input.resume(); };
  input.on('data', receive);
  input.on('end', end);
  input.on('error', stop);
  output.on('error', stop);
  output.on('drain', drain);
  return { stop };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const entryPath = realpathSync(process.argv[1]);
    return process.platform === 'win32'
      ? modulePath.toLowerCase() === entryPath.toLowerCase()
      : modulePath === entryPath;
  } catch { return false; }
}

if (isMainModule()) {
  const server = startMcp();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.stop();
    process.exitCode = 0;
  });
}
