/* eslint-disable no-control-regex -- Explicitly reject control characters at subprocess boundaries. */
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { createOnboarding, TOOL_SCOPES, validConfigDir } from './onboarding.mjs';

// Pinned primary contracts, commit 2aebe8970f0a472dfc864b6ac3d19d080e75041f:
// https://github.com/larksuite/cli/blob/v1.0.93/cmd/auth/login.go
// https://github.com/larksuite/cli/blob/v1.0.93/cmd/auth/status.go
// https://github.com/larksuite/cli/blob/v1.0.93/cmd/auth/login_result.go
// https://github.com/larksuite/cli/blob/v1.0.93/internal/identitydiag/diagnostics.go
// https://github.com/larksuite/cli/blob/v1.0.93/skills/lark-event/SKILL.md
const LIMIT = 1024 * 1024;
const LINE_LIMIT = 64 * 1024;
const CLEANUP_MS = 1000;
const EVENT = 'im.message.receive_v1';
const SCOPES = TOOL_SCOPES;
const ENV_KEYS = new Set(['PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'SYSTEMROOT', 'WINDIR', 'APPDATA', 'LOCALAPPDATA', 'TMP', 'TEMP', 'TMPDIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'LANG', 'LC_ALL', 'TZ']);
const fail = (code) => ({ ok: false, error: { code } });
const exitCode = (code) => ({ 1: 'CLI_API_ERROR', 2: 'CLI_VALIDATION_ERROR', 3: 'AUTH_REQUIRED',
  4: 'CLI_NETWORK_ERROR', 5: 'CLI_INTERNAL_ERROR', 6: 'CONTENT_BLOCKED', 10: 'APPROVAL_REQUIRED' }[code] ?? 'CLI_EXIT');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value, prefix = '') => typeof value === 'string' && value.length <= 256 &&
  new RegExp(`^${prefix}[A-Za-z0-9_-]+$`).test(value);
const safeName = (value) => typeof value === 'string' && value.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(value) ? value : null;

function identity(value) {
  if (!object(value) || typeof value.available !== 'boolean' ||
      !['ready', 'not_configured', 'missing', 'needs_refresh', 'verify_failed'].includes(value.status) ||
      (value.verified !== undefined && typeof value.verified !== 'boolean')) return null;
  return { status: value.status, available: value.available, verified: value.verified ?? null,
    openId: id(value.openId, 'ou_') ? value.openId : null,
    name: safeName(value.userName ?? value.appName) };
}

// run is a host-only subprocess primitive, not a tool exposed to agents. Its command/flag
// allowlist excludes configuration, logout, credential overrides, media, plugins and --yes.
function validatedArgs(args) {
  if (!Array.isArray(args) || args.length === 0 || args.length > 40 ||
      args.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
      args.join('').length > 100000) return false;
  if (args.length === 1 && args[0] === '--version') return [...args];
  const flags = {
    'auth status': { '--json': 0, '--verify': 0 },
    'auth scopes': { '--json': 0 },
    'auth login': { '--scope': 1, '--no-wait': 0, '--json': 0, '--device-code': 1 },
    'docs +fetch': { '--doc': 1, '--doc-format': 1, '--as': 1, '--format': 1 },
    'docs +create': { '--content': 1, '--doc-format': 1, '--as': 1, '--format': 1 },
    'calendar +agenda': { '--calendar-id': 1, '--start': 1, '--end': 1, '--as': 1, '--format': 1 },
    'calendar +create': { '--calendar-id': 1, '--summary': 1, '--start': 1, '--end': 1, '--as': 1, '--format': 1 },
    'im +messages-send': { '--user-id': 1, '--text': 1, '--idempotency-key': 1, '--as': 1, '--format': 1 },
    'im +messages-reply': { '--message-id': 1, '--text': 1, '--idempotency-key': 1, '--as': 1, '--format': 1 },
  }[args.slice(0, 2).join(' ')];
  if (!flags) return false;
  const argv = args.slice(0, 2);
  const seen = new Set();
  for (let i = 2; i < args.length; i++) {
    const flag = args[i];
    if (!Object.hasOwn(flags, flag) || seen.has(flag)) return false;
    seen.add(flag);
    if (flags[flag]) {
      const value = args[++i];
      if (!value || (flag === '--as' && !['user', 'bot'].includes(value)) ||
          (flag === '--format' && value !== 'json') ||
          (flag === '--content' && (value.startsWith('@') || value === '-'))) return false;
      // BootstrapInvocationContext parses globals before command flags are known.
      // Bind values so literal --profile/--help cannot become bootstrap options.
      // https://github.com/larksuite/cli/blob/v1.0.93/cmd/bootstrap.go
      // https://github.com/spf13/pflag/blob/v1.0.9/flag.go (parseLongArg)
      argv.push(`${flag}=${value}`);
    } else argv.push(flag);
  }
  const valid = args[0] === 'auth' ? seen.has('--json') : seen.has('--as') && seen.has('--format');
  return valid ? argv : false;
}

export function createCli({ executable, configDir, spawnImpl = spawn, env = process.env } = {}) {
  const basename = typeof executable === 'string' ? executable.split(/[\\/]/).at(-1) : '';
  if (!basename || /[\x00-\x1f]/.test(executable) || /\.(cmd|bat|ps1|sh)$/i.test(basename) ||
      /^(cmd|powershell|pwsh|sh|bash|dash|zsh|fish|wscript|cscript)(\.exe)?$/i.test(basename) ||
      (process.platform === 'win32' && !/\.exe$/i.test(basename))) {
    throw Object.assign(new Error('INVALID_EXECUTABLE'), { code: 'INVALID_EXECUTABLE' });
  }
  if (configDir !== undefined && !validConfigDir(configDir)) {
    throw Object.assign(new Error('INVALID_CONFIG_DIR'), { code: 'INVALID_CONFIG_DIR' });
  }
  const childEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (ENV_KEYS.has(key.toUpperCase()) && typeof value === 'string' && !value.includes('\0')) {
      // Windows environment names are case-insensitive; never pass duplicate spellings.
      childEnv[process.platform === 'win32' ? key.toUpperCase() : key] = value;
    }
  }
  if (configDir !== undefined) childEnv.LARKSUITE_CLI_CONFIG_DIR = configDir;
  childEnv.LARKSUITE_CLI_NO_UPDATE_NOTIFIER = '1';
  childEnv.LARKSUITE_CLI_NO_SKILLS_NOTIFIER = '1';
  childEnv.LARKSUITE_CLI_REMOTE_META = 'off';
  const launch = (args) => spawnImpl(executable, args, {
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...childEnv },
  });

  function execute(args, options = {}, versionOutput = false, defaultTimeoutMs = 30000) {
    if (!object(options)) return Promise.resolve(fail('INVALID_ARGUMENTS'));
    const { signal, timeoutMs = defaultTimeoutMs } = options;
    const argv = validatedArgs(args);
    if (!argv || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000 ||
        (signal !== undefined && !(signal instanceof AbortSignal))) return Promise.resolve(fail('INVALID_ARGUMENTS'));
    if (signal?.aborted) return Promise.resolve(fail('ABORTED'));
    return new Promise((resolve) => {
      let child;
      try { child = launch(argv); } catch { resolve(fail('SPAWN_FAILED')); return; }
      let finished = false;
      let closed = false;
      let killTimer;
      let total = 0;
      let stdout = '';
      let stderr = '';
      const decoder = new StringDecoder('utf8');
      const errorDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
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
          }, CLEANUP_MS);
          killTimer.unref?.();
        }
        resolve(result);
      };
      const abort = () => finish(fail('ABORTED'), true);
      const timer = setTimeout(() => finish(fail('TIMEOUT'), true), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => finish(fail('SPAWN_FAILED'), true));
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        stream.on('error', () => finish(fail('CLI_IO_ERROR'), true));
      }
      const receive = (chunk, out) => {
        if (finished) return;
        total += Buffer.byteLength(chunk);
        if (total > LIMIT) { finish(fail('OUTPUT_LIMIT'), true); return; }
        if (out) stdout += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        else if (stderr !== null) {
          try { stderr += errorDecoder.decode(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), { stream: true }); }
          catch { stderr = null; }
        }
      };
      child.stdout.on('data', (chunk) => receive(chunk, true));
      child.stderr.on('data', (chunk) => receive(chunk, false));
      child.on('close', (code) => {
        closed = true;
        clearTimeout(killTimer);
        if (finished) return;
        if (code !== 0) {
          let safeCode = exitCode(code);
          // Exit 3 covers both authentication and config errors. Only this exact
          // structured subtype refines it; never return stderr messages, hints or tokens.
          // https://github.com/larksuite/cli/blob/v1.0.93/errs/subtypes.go
          if (code === 3 && stderr !== null) {
            try {
              const diagnostic = stderr + errorDecoder.decode();
              const envelope = JSON.parse(args[0] === 'auth' && args[1] === 'scopes'
                ? diagnostic.replace(/^Querying app scopes\.\.\.\r?\n\s*/, '') : diagnostic);
              if (object(envelope) && envelope.ok === false && object(envelope.error) &&
                  envelope.error.type === 'config' && envelope.error.subtype === 'not_configured') {
                safeCode = 'CLI_NOT_CONFIGURED';
              } else if (object(envelope) && envelope.ok === false && object(envelope.error) &&
                  envelope.error.type === 'config' && envelope.error.subtype === 'invalid_client' && envelope.error.code === 20069) {
                safeCode = 'APP_UNAVAILABLE';
              }
            } catch { /* Malformed/noisy stderr retains the safe exit-code fallback. */ }
          }
          finish(fail(safeCode));
          return;
        }
        stdout += decoder.end();
        if (versionOutput) {
          const match = /^lark-cli version (\d+\.\d+\.\d+)\s*$/.exec(stdout);
          finish(match ? { version: match[1], supported: match[1] === '1.0.93' } : fail('INVALID_OUTPUT'));
          return;
        }
        try {
          const value = JSON.parse(stdout);
          if (!object(value) && !Array.isArray(value)) { finish(fail('INVALID_OUTPUT')); return; }
          finish(value.ok === false ? fail('CLI_API_ERROR') : value);
        } catch { finish(fail('INVALID_OUTPUT')); }
      });
      child.stdin.end();
      if (signal?.aborted) abort();
    });
  }

  const run = (args, options) => execute(args, options);
  async function inspect(options) {
    const value = await run(['auth', 'status', '--json', '--verify'], options);
    if (value.ok === false) return value;
    const bot = identity(value.identities?.bot);
    const user = identity(value.identities?.user);
    if (!id(value.appId, 'cli_') || !bot || !user || !['feishu', 'lark'].includes(value.brand)) return fail('INVALID_OUTPUT');
    // v1.0.93 diagnostics drops the numeric API code here. Match only the
    // observed exact provider failure, never arbitrary message substrings.
    if (bot.status === 'verify_failed' && !bot.available && bot.verified === false &&
        value.identities.bot.message === 'Bot identity: verify failed: The specified app is not enabled.') {
      return fail('APP_UNAVAILABLE');
    }
    let appPermissions;
    if (!bot.available || bot.status !== 'ready' || bot.verified !== true || !user.available || user.verified !== true) {
      const app = await permissions(options);
      if (app?.ok === false && ['APP_UNAVAILABLE', 'CLI_NETWORK_ERROR', 'TIMEOUT', 'ABORTED'].includes(app.error?.code)) return app;
      if (app?.appId === value.appId && app.brand === value.brand) appPermissions = app;
    }
    const scope = value.identities.user.scope;
    const grants = typeof scope === 'string' && scope.length <= LINE_LIMIT &&
      scope.split(/\s+/).filter(Boolean).every((s) => /^[A-Za-z0-9_:.-]{1,256}$/.test(s)) ?
      new Set(scope.split(/\s+/)) : null;
    return { appId: value.appId, brand: value.brand, bot, user,
      ...(appPermissions ? { appPermissions } : {}),
      grants: grants ? { granted: SCOPES.split(' ').filter((s) => grants.has(s)),
        missing: SCOPES.split(' ').filter((s) => !grants.has(s)) } : null,
      botReady: bot.available && bot.status === 'ready' && bot.verified === true };
  }

  async function permissions(options) {
    const value = await run(['auth', 'scopes', '--json'], options);
    if (value.ok === false) return value;
    if (!id(value.appId, 'cli_') || !['feishu', 'lark'].includes(value.brand) || value.tokenType !== 'user' ||
        !Array.isArray(value.userScopes) || value.userScopes.length > 1024 || value.count !== value.userScopes.length ||
        !value.userScopes.every((s) => typeof s === 'string' && /^[A-Za-z0-9_:.-]{1,256}$/.test(s))) return fail('INVALID_OUTPUT');
    // App-enabled user scopes, NOT user consent or bot grants.
    return { appId: value.appId, brand: value.brand, tokenType: 'user', userScopes: value.userScopes };
  }

  async function login(options) {
    const value = await run(['auth', 'login', '--scope', SCOPES, '--no-wait', '--json'], options);
    if (value.ok === false) return value;
    try {
      const url = new URL(value.verification_url);
      if (url.protocol !== 'https:' || !['accounts.feishu.cn', 'accounts.larksuite.com'].includes(url.hostname) ||
          url.username || url.password || url.port || url.hash ||
          typeof value.verification_url !== 'string' || value.verification_url.length > 4096 ||
          /[\x00-\x20\x7f\\]/.test(value.verification_url) ||
          !id(value.device_code) || !Number.isSafeInteger(value.expires_in) ||
          value.expires_in <= 0 || value.expires_in > 86400) return fail('INVALID_OUTPUT');
      // No hint, access token, refresh token, or arbitrary URL fields cross this boundary.
      return { verificationUrl: value.verification_url, deviceCode: value.device_code, expiresIn: value.expires_in };
    } catch { return fail('INVALID_OUTPUT'); }
  }

  async function completeLogin(deviceCode, options) {
    if (!id(deviceCode)) return fail('INVALID_ARGUMENTS');
    const value = await execute(['auth', 'login', '--device-code', deviceCode, '--json'], options, false, 300000);
    if (value.ok === false) return value;
    if (value.event !== 'authorization_complete' || !id(value.user_open_id, 'ou_')) return fail('INVALID_OUTPUT');
    return { complete: true, user: { openId: value.user_open_id, name: safeName(value.user_name) } };
  }

  function sendReply(messageId, text, uuid, options) {
    if (!id(messageId, 'om_') || typeof text !== 'string' || !text.trim() || text.length > 12000 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || !text.isWellFormed() ||
        (uuid !== undefined && (!id(uuid) || uuid.length > 50))) return Promise.resolve(fail('INVALID_ARGUMENTS'));
    const args = ['im', '+messages-reply', '--message-id', messageId, '--text', text];
    if (uuid !== undefined) args.push('--idempotency-key', uuid);
    return run([...args, '--as', 'bot', '--format', 'json'], options);
  }

  function consume({ onMessage = () => {}, onReady = () => {}, onExit = () => {} } = {}) {
    let child;
    let ended = false;
    let stopping = false;
    let ready = false;
    let killTimer;
    let reason;
    let startupTimer;
    let callbacks = 0;
    const cleanup = Promise.withResolvers();
    const notify = (callback, value) => {
      try {
        const pending = callback(value);
        if (pending && typeof pending.then === 'function') {
          callbacks++;
          Promise.resolve(pending).catch(() => stop('CALLBACK_ERROR')).finally(() => { callbacks--; });
          if (callbacks >= 32) stop('CALLBACK_BACKPRESSURE');
        }
      }
      catch { stop('CALLBACK_ERROR'); }
    };
    const finish = (result) => {
      if (ended) return;
      ended = true;
      clearTimeout(startupTimer);
      clearTimeout(killTimer);
      cleanup.resolve(result);
      notify(onExit, result);
    };
    const stop = (code = 'STOPPED') => {
      if (ended || stopping) return cleanup.promise;
      stopping = true;
      reason = code;
      clearTimeout(startupTimer);
      child?.stdin.end();
      if (ended) return cleanup.promise;
      killTimer = setTimeout(() => {
        child?.kill('SIGTERM');
        if (ended) return;
        killTimer = setTimeout(() => {
          child?.kill('SIGKILL');
          child?.stdout.destroy();
          child?.stderr.destroy();
          child?.stdin.destroy();
          // SIGKILL delivery is not the close event. Allow one final bounded wait.
          if (!ended) killTimer = setTimeout(() => finish(fail('CLEANUP_TIMEOUT')), CLEANUP_MS);
        }, CLEANUP_MS);
      }, CLEANUP_MS);
      return cleanup.promise;
    };
    try { child = launch(['event', 'consume', EVENT, '--as=bot']); }
    catch { queueMicrotask(() => finish(fail('SPAWN_FAILED'))); return { stop: () => stop() }; }
    startupTimer = setTimeout(() => stop('READY_TIMEOUT'), 30000);
    const lines = (stream, limit, handle) => {
      const decoder = new StringDecoder('utf8');
      let pending = '';
      stream.on('data', (chunk) => {
        if (ended || stopping) return;
        if (Buffer.byteLength(chunk) > LIMIT) { stop('OUTPUT_LIMIT'); return; }
        pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        let newline;
        while (!stopping && (newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline).replace(/\r$/, '');
          pending = pending.slice(newline + 1);
          if (Buffer.byteLength(line) > limit) { stop('OUTPUT_LIMIT'); return; }
          handle(line);
        }
        if (Buffer.byteLength(pending) > limit) stop('OUTPUT_LIMIT');
      });
      stream.on('end', () => {
        if (!stopping && (pending + decoder.end()).trim()) stop('INVALID_OUTPUT');
      });
    };
    lines(child.stderr, LINE_LIMIT, (line) => {
      if (!ready && line === `[event] ready event_key=${EVENT}`) {
        ready = true;
        clearTimeout(startupTimer);
        notify(onReady);
      }
    });
    lines(child.stdout, LINE_LIMIT, (line) => {
      if (!line.trim()) return;
      try {
        const message = JSON.parse(line);
        if (!object(message) || message.type !== EVENT || !id(message.message_id, 'om_') ||
            !id(message.chat_id, 'oc_') || !id(message.sender_id, 'ou_') ||
            !['p2p', 'group'].includes(message.chat_type) || !['user', 'bot'].includes(message.sender_type) ||
            typeof message.message_type !== 'string' ||
            (message.content !== undefined && typeof message.content !== 'string')) { stop('INVALID_OUTPUT'); return; }
        notify(onMessage, message);
      } catch { stop('INVALID_OUTPUT'); }
    });
    child.on('error', () => { stop('SPAWN_FAILED'); });
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => stop('CLI_IO_ERROR'));
    child.on('close', (code) => finish(reason ? fail(reason) : code === 0 ? { ok: true } : fail(exitCode(code))));
    // Keep stdin live. stop() resolves on close, or CLEANUP_TIMEOUT after 3 seconds;
    // it never rejects and does not claim successful cleanup when close is missing.
    return { stop: () => stop() };
  }

  return { run, version: (options) => execute(['--version'], options, true), inspect, permissions,
    ...createOnboarding({ launch, configDir, exitCode }), login, completeLogin, consume, sendReply };
}
