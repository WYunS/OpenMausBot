/* eslint-disable no-control-regex -- Validate subprocess and browser boundaries. */
import { lstat, readdir, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, dirname, parse, resolve } from 'node:path';

export const TOOL_SCOPES = 'docx:document:readonly docx:document:create calendar:calendar.event:read calendar:calendar.event:create calendar:calendar.event:update im:message.send_as_user im:message';
const SCOPES = TOOL_SCOPES.split(' ');
const LIMIT = 1024 * 1024;
const LINE_LIMIT = 64 * 1024;
const ATTEMPT = '.tuantuan-init-attempt';
const activeInitializations = new Map();
const fail = (code) => ({ ok: false, error: { code } });
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v, prefix) => typeof v === 'string' && v.length <= 256 && new RegExp(`^${prefix}[A-Za-z0-9_-]+$`).test(v);
const scopeList = (v) => Array.isArray(v) && v.length <= 1024 &&
  v.every((s) => typeof s === 'string' && /^[A-Za-z0-9_:.-]{1,256}$/.test(s));

// Accept the previous empty marker only for explicitly confirmed recovery.
async function attemptMarker(configDir, expected, remove = false) {
  const path = join(configDir, ATTEMPT);
  const info = await lstat(path);
  if (!info.isFile() || info.nlink !== 1 || info.size > 64 ||
      (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600))) throw new Error('UNSAFE_MARKER');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await handle.stat();
    if (current.ino !== info.ino || current.dev !== info.dev || current.size !== info.size) throw new Error('UNSAFE_MARKER');
    const bytes = Buffer.alloc(65);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const text = bytes.subarray(0, bytesRead).toString('utf8');
    if (text !== '' && !/^tuantuan-init-v1:[a-f0-9-]{36}\n$/.test(text)) throw new Error('UNSAFE_MARKER');
    if (expected !== undefined && text !== expected) throw new Error('UNSAFE_MARKER');
    if (remove) {
      const latest = await lstat(path);
      if (latest.ino !== info.ino || latest.dev !== info.dev || latest.nlink !== 1 || !latest.isFile()) throw new Error('UNSAFE_MARKER');
      await unlink(path);
    }
    return text;
  } finally { await handle.close(); }
}

export function validConfigDir(value) {
  return typeof value === 'string' && value.length <= 4096 && isAbsolute(value) &&
    value !== parse(value).root && !/[\x00-\x1f\x7f]/.test(value) &&
    !value.split(/[\\/]/).some((part) => part === '..' || part === '.') &&
    (process.platform !== 'win32' || /^[A-Za-z]:[\\/]/.test(value));
}

// Host-only filesystem status, never read config/credential contents. The host must
// own this directory and serialize setup with other writers for the whole flow.
export async function inspectConfigDir(configDir) {
  if (!validConfigDir(configDir)) return fail('INVALID_CONFIG_DIR');
  try {
    for (let path = configDir.replace(/[\\/]+$/, ''); ; path = dirname(path)) {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) return { status: 'unsafe' };
      if (path === dirname(path)) break;
    }
    try {
      await lstat(join(configDir, 'config.json'));
      return { status: 'configured' }; // Even malformed files and dangling links block --new.
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const entries = await readdir(configDir);
    for (const entry of entries) {
      if (entry === ATTEMPT) {
        try { await attemptMarker(configDir); } catch { return { status: 'unsafe' }; }
      } else if (entry === 'cache') {
        const cache = join(configDir, entry);
        if (!(await lstat(cache)).isDirectory()) return { status: 'unsafe' };
        for (const name of await readdir(cache)) {
          if (!['remote_meta.json', 'remote_meta.meta.json'].includes(name)) return { status: 'not_empty' };
          const info = await lstat(join(cache, name));
          if (!info.isFile() || info.nlink !== 1 || (process.getuid && info.uid !== process.getuid())) return { status: 'unsafe' };
        }
      } else if (entry === 'logs') {
        const logs = join(configDir, entry);
        if (!(await lstat(logs)).isDirectory()) return { status: 'unsafe' };
        for (const name of await readdir(logs)) {
          if (!/^auth-\d{4}-\d{2}-\d{2}\.log$/.test(name)) return { status: 'not_empty' };
          const info = await lstat(join(logs, name));
          if (!info.isFile() || info.nlink !== 1 || (process.getuid && info.uid !== process.getuid())) return { status: 'unsafe' };
        }
      } else return { status: 'not_empty' };
    }
    return { status: entries.includes(ATTEMPT) ? 'attempted' : 'empty' };
  } catch (error) {
    return error.code === 'ENOENT' ? { status: 'missing' } : fail('CONFIG_IO_ERROR');
  }
}

function browserUrl(value, mode) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\x7f\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
        !value.startsWith(`https://${url.hostname}/`)) return false;
    if (mode === 'authorize' && ['accounts.feishu.cn', 'accounts.larksuite.com'].includes(url.hostname)) return true;
    if (!['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname)) return false;
    if (!value.startsWith(`https://${url.hostname}${url.pathname}?`)) return false;
    const params = url.searchParams;
    const keys = [...params.keys()];
    if (new Set(keys).size !== keys.length) return false;
    if (mode === 'initialize') {
      return url.hostname === 'open.feishu.cn' && url.pathname === '/page/cli' &&
        keys.length === 4 && keys.every((key) => ['user_code', 'lpv', 'ocv', 'from'].includes(key)) &&
        /^[A-Za-z0-9_+-]{1,256}$/.test(params.get('user_code') ?? '') &&
        params.get('lpv') === '1.0.93' && params.get('ocv') === '1.0.93' && params.get('from') === 'cli';
    }
    return url.pathname === '/page/scope-apply' && keys.every((key) => ['clientID', 'scopes'].includes(key)) &&
      id(params.get('clientID'), 'cli_') &&
      (!params.has('scopes') || scopeList(params.get('scopes').split(',')));
  } catch { return false; }
}

// One blocking native child keeps device secrets out of argv. Only approved URL,
// identity and scope fields escape; QR/prose and raw error messages are discarded.
export function createOnboarding({ launch, configDir, exitCode }) {
  function stream(mode, { signal, onAuthorization, timeoutMs = 600000 }, attempt = {}) {
    return new Promise((resolve) => {
      let child;
      try {
        child = launch(mode === 'initialize' ? ['config', 'init', '--new', '--brand=feishu', '--lang=en'] :
          ['auth', 'login', `--scope=${TOOL_SCOPES}`, '--json']);
      } catch { attempt.safeRetry = true; resolve(fail('SPAWN_FAILED')); return; }
      attempt.alive = true;
      let spawned = false;
      child.on('spawn', () => { spawned = true; });
      let finished = false;
      let closed = false;
      let killTimer;
      let total = 0;
      let stdout = '';
      let errorJson = '';
      let terminalError;
      let app;
      let emittedApp = false;
      let completion;
      let authFailed = false;
      let openedUrl;
      let emittedUrl = false;
      let opening = Promise.resolve();
      const finish = (result, terminate = false) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (terminate && !closed) {
          child.stdin.destroy();
          child.kill('SIGTERM');
          killTimer = setTimeout(() => {
            if (!closed) child.kill('SIGKILL');
            child.stdout.destroy();
            child.stderr.destroy();
          }, 1000);
          killTimer.unref?.();
        }
        stdout = '';
        errorJson = '';
        if (closed && result.ok === false && !terminate && !emittedUrl && !emittedApp) attempt.safeRetry = true;
        resolve(result.ok === false && app ? { ...result, app } : result);
      };
      const abort = () => finish(fail('ABORTED'), true);
      const timer = setTimeout(() => finish(fail('TIMEOUT'), true), timeoutMs);
      const invalid = () => finish(fail('INVALID_OUTPUT'), true);
      const openUrl = (url) => {
        emittedUrl = true;
        if (!browserUrl(url, mode) || (openedUrl && openedUrl !== url)) { invalid(); return; }
        if (openedUrl) return;
        openedUrl = url;
        try {
          opening = Promise.resolve(onAuthorization(url)).catch(() => finish(fail('CALLBACK_ERROR'), true));
        } catch { finish(fail('CALLBACK_ERROR'), true); }
      };
      const readApp = () => {
        try {
          const value = JSON.parse(stdout);
          if (object(value) && id(value.appId, 'cli_') && value.brand === 'feishu' && value.appSecret === '****') {
            app = { appId: value.appId, brand: value.brand };
            emittedApp = true;
          }
        } catch { /* Pretty JSON can arrive in fragments. */ }
      };
      const handleError = (line) => {
        // Official typed errors are pretty JSON, possibly after QR/progress lines.
        if (!errorJson && !line.startsWith('{')) return;
        errorJson += `${line}\n`;
        if (Buffer.byteLength(errorJson) > LINE_LIMIT) { finish(fail('OUTPUT_LIMIT'), true); return; }
        try {
          const value = JSON.parse(errorJson);
          if (object(value) && value.ok === false && object(value.error)) {
            const error = value.error;
            if (error.type === 'permission' && error.subtype === 'missing_scope') {
              terminalError = fail('SCOPE_REQUIRED');
              if (browserUrl(error.console_url, 'recovery')) terminalError.error.consoleUrl = error.console_url;
            } else if (error.type === 'config' && error.subtype === 'not_configured') {
              terminalError = fail('CLI_NOT_CONFIGURED');
            } else if (error.type === 'config' && error.subtype === 'invalid_client' && error.code === 20069) {
              terminalError = fail('APP_UNAVAILABLE');
            } else if (error.type === 'authentication' && error.subtype === 'token_expired') {
              terminalError = fail('AUTH_EXPIRED');
            } else if (error.type === 'authentication' && error.subtype === 'unknown' &&
                error.message === 'app registration denied by user') {
              terminalError = fail('AUTH_DENIED');
            }
          }
          errorJson = '';
        } catch { /* Wait for the rest of this bounded terminal envelope. */ }
      };
      const decoders = [];
      const lines = (input, out) => {
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
        let pending = '';
        const line = (raw) => {
          const text = raw.trim();
          if (!text || finished) return;
          if (!out) {
            if (mode === 'initialize' && text.startsWith('https://')) {
              emittedUrl = true;
              if (browserUrl(text, mode)) openUrl(text);
              return;
            }
            handleError(text);
            return;
          }
          try {
            const value = JSON.parse(text);
            if (!object(value) || completion || authFailed) { invalid(); return; }
            if (value.event === 'device_authorization') openUrl(value.verification_uri_complete);
            else if (value.event === 'authorization_complete' && openedUrl) completion = value;
            else if (value.event === 'authorization_failed' && openedUrl) {
              authFailed = true;
              // v1.0.93 emits only a message here; match its exact fallback text,
              // never classify arbitrary server prose by substrings.
              if (value.error === 'Authorization denied by user') terminalError = fail('AUTH_DENIED');
              else if (['Device code expired, please try again', 'Authorization timed out, please try again'].includes(value.error)) {
                terminalError = fail('AUTH_EXPIRED');
              }
            }
            else invalid();
          } catch { invalid(); }
        };
        const receive = (chunk, end = false) => {
          if (finished) return;
          total += Buffer.byteLength(chunk);
          if (total > LIMIT) { finish(fail('OUTPUT_LIMIT'), true); return; }
          let text;
          try { text = decoder.decode(chunk, { stream: !end }); } catch { invalid(); return; }
          if (out && mode === 'initialize') {
            stdout += text;
            readApp();
          }
          pending += text;
          let newline;
          while (!finished && (newline = pending.indexOf('\n')) !== -1) {
            const raw = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            if (Buffer.byteLength(raw) > LINE_LIMIT) { finish(fail('OUTPUT_LIMIT'), true); return; }
            if (!(out && mode === 'initialize')) line(raw);
          }
          if (Buffer.byteLength(pending) > LINE_LIMIT) { finish(fail('OUTPUT_LIMIT'), true); return; }
          if (end && pending) {
            if (!(out && mode === 'initialize')) line(pending);
            pending = '';
          }
        };
        input.on('data', (chunk) => receive(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        decoders.push(() => receive(Buffer.alloc(0), true));
      };
      lines(child.stdout, true);
      lines(child.stderr, false);
      child.on('error', (error) => {
        if (!spawned && !child.pid && error.code === 'ENOENT' && !emittedUrl && !app) {
          attempt.safeRetry = true;
          attempt.alive = false;
        }
        finish(fail('SPAWN_FAILED'), true);
      });
      for (const input of [child.stdin, child.stdout, child.stderr]) {
        input.on('error', () => finish(fail('CLI_IO_ERROR'), true));
      }
      child.on('close', async (code) => {
        closed = true;
        attempt.alive = false;
        if (finished && activeInitializations.get(attempt.key) === attempt) activeInitializations.delete(attempt.key);
        clearTimeout(killTimer);
        if (finished) return;
        for (const flush of decoders) flush();
        await opening;
        if (finished) return;
        if (code !== 0 && terminalError &&
            !(code === 3 && completion && terminalError.error.code === 'SCOPE_REQUIRED')) {
          finish(terminalError); return;
        }
        if (mode === 'initialize') {
          // Reparse the whole document; an earlier valid prefix is not success.
          app = undefined;
          readApp();
          finish(code !== 0 ? fail(exitCode(code)) : app && openedUrl ? app : fail('INVALID_OUTPUT'));
          return;
        }
        if (completion && (code === 0 || code === 3)) {
          const value = completion;
          if (!id(value.user_open_id, 'ou_') || !scopeList(value.granted) || !scopeList(value.missing) ||
              typeof value.scope !== 'string' || !scopeList(value.scope.split(/\s+/).filter(Boolean))) {
            invalid(); return;
          }
          const granted = new Set(value.granted);
          const scope = new Set(value.scope.split(/\s+/).filter(Boolean));
          if (granted.size !== scope.size || [...granted].some((s) => !scope.has(s))) { invalid(); return; }
          const missing = SCOPES.filter((s) => !granted.has(s) || value.missing.includes(s));
          if (value.missing.length || missing.length || value.warning?.type === 'missing_scope' ||
              (code === 3 && terminalError?.error.code === 'SCOPE_REQUIRED')) {
            const result = code === 3 && terminalError ? terminalError : fail('SCOPE_REQUIRED');
            // v1.0.93 warnings contain only type/message/hint. The host can build
            // recovery from these pinned scopes and its trusted app ID, not hints.
            result.error.missing = missing;
            finish(result);
            return;
          }
          if (code === 0 && value.warning === undefined) {
            finish({ complete: true, user: { openId: value.user_open_id,
              name: typeof value.user_name === 'string' && value.user_name.length <= 256 &&
                !/[\x00-\x1f\x7f]/.test(value.user_name) ? value.user_name : null },
            granted: SCOPES.filter((s) => granted.has(s)), missing: [] });
            return;
          }
        }
        finish(code !== 0 ? fail(exitCode(code)) : authFailed ? fail('AUTH_REQUIRED') : fail('INVALID_OUTPUT'));
      });
      signal?.addEventListener('abort', abort, { once: true });
      child.stdin.end();
      if (signal?.aborted) abort();
    });
  }

  async function start(mode, options = {}, attempt = {}) {
    if (!object(options) || typeof options.onAuthorization !== 'function' ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal)) ||
        (options.retryUncertain !== undefined && typeof options.retryUncertain !== 'boolean') ||
        (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 600000))) {
      return fail('INVALID_ARGUMENTS');
    }
    if (options.signal?.aborted) return fail('ABORTED');
    if (mode === 'initialize') {
      if (!configDir) return fail('PRIVATE_CONFIG_REQUIRED');
      // Supplying an absolute path is not proof of ownership. The trusted host
      // explicitly asserts exclusive ownership, in addition to our real fs check.
      if (typeof options.isManagedEmpty !== 'function') return fail('MANAGED_EMPTY_REQUIRED');
      const started = Date.now();
      const timeoutMs = options.timeoutMs ?? 600000;
      const timedOut = Symbol();
      const aborted = Symbol();
      let timer;
      let abort;
      try {
        const assertion = await Promise.race([
          Promise.resolve().then(() => options.isManagedEmpty(configDir)),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(timedOut), timeoutMs);
            abort = () => resolve(aborted);
            options.signal?.addEventListener('abort', abort, { once: true });
            if (options.signal?.aborted) abort();
          }),
        ]);
        if (assertion === timedOut) return fail('TIMEOUT');
        if (assertion === aborted) return fail('ABORTED');
        if (assertion !== true) return fail('MANAGED_EMPTY_REQUIRED');
      } catch { return fail('CALLBACK_ERROR'); }
      finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
      }
      const state = await inspectConfigDir(configDir);
      if (state.ok === false) return state;
      if (state.status === 'attempted' && options.retryUncertain === true) {
        // Host-only assertion: set only after native confirmation discloses that
        // the previous browser flow may already have created an app.
        try {
          const previous = await attemptMarker(configDir);
          const checked = await inspectConfigDir(configDir);
          if (checked.status !== 'attempted') return fail(checked.status === 'configured' ? 'CONFIG_EXISTS' : 'CONFIG_NOT_EMPTY');
          if (options.signal?.aborted) return fail('ABORTED');
          await attemptMarker(configDir, previous, true);
        } catch { return fail('CONFIG_IO_ERROR'); }
      } else if (state.status !== 'empty') return fail(state.status === 'configured' ? 'CONFIG_EXISTS' :
        state.status === 'attempted' ? 'INITIALIZATION_UNCERTAIN' : 'CONFIG_NOT_EMPTY');
      if (options.signal?.aborted) return fail('ABORTED');
      try {
        // Persist before spawning: no automatic duplicate app after cancellation,
        // crash or probe failure. Host reconciliation must precede any new attempt.
        const marker = await open(join(configDir, ATTEMPT), 'wx', 0o600);
        try {
          attempt.marker = `tuantuan-init-v1:${randomUUID()}\n`;
          await marker.writeFile(attempt.marker);
          await marker.sync();
        } finally { await marker.close(); }
        attempt.safeRetry = true;
      } catch (error) { return fail(error.code === 'EEXIST' ? 'INITIALIZATION_UNCERTAIN' : 'CONFIG_IO_ERROR'); }
      if (options.signal?.aborted) return fail('ABORTED');
      const checked = await inspectConfigDir(configDir);
      if (options.signal?.aborted) return fail('ABORTED');
      if (checked.ok === false) return checked;
      if (checked.status !== 'attempted') return fail(checked.status === 'configured' ? 'CONFIG_EXISTS' : 'CONFIG_NOT_EMPTY');
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining < 1) return fail('TIMEOUT');
      options = { ...options, timeoutMs: remaining };
    }
    attempt.safeRetry = false;
    return stream(mode, options, attempt);
  }
  async function initialize(options) {
    const key = configDir && resolve(configDir);
    if (activeInitializations.has(key)) return fail('INITIALIZATION_UNCERTAIN');
    const attempt = { key };
    activeInitializations.set(key, attempt);
    try {
      const result = await start('initialize', options, attempt);
      if (result.ok === false && attempt.safeRetry && attempt.marker) {
        const state = await inspectConfigDir(configDir);
        if (state.status === 'attempted') {
          try { await attemptMarker(configDir, attempt.marker, true); }
          catch { return { ...result, warning: { code: 'INITIALIZATION_UNCERTAIN' } }; }
        }
      }
      return result;
    } finally {
      // A cancelled child may still write config. Explicit recovery cannot race
      // its teardown in this host; other hosts must honor exclusive ownership.
      if (!attempt.alive && activeInitializations.get(key) === attempt) activeInitializations.delete(key);
    }
  }
  return { initialize, authorize: (options) => start('authorize', options) };
}
