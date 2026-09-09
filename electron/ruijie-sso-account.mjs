import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

export const RUIJIE_SSO_ACCESS_TOKEN_FIELD = "ruijieSsoAccessToken";
export const RUIJIE_SSO_REFRESH_TOKEN_FIELD = "ruijieSsoRefreshToken";

const DEFAULT_ISSUER = "https://gptauth.ruijie.com.cn";
const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REQUEST_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const REFRESH_SKEW_MS = 60_000;

class SessionRejectedError extends Error {}

function ownText(value, key) {
  return typeof value?.[key] === "string" ? value[key].trim() : "";
}

function issuerFrom(environment) {
  const value = environment.OMB_RUIJIE_OAUTH_ISSUER?.trim() || DEFAULT_ISSUER;
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("GPTAuth 登录地址必须使用 HTTPS");
  }
  return url.toString();
}

function callbackPort(environment) {
  const configured = environment.OMB_RUIJIE_OAUTH_CALLBACK_PORT?.trim();
  if (!configured) return DEFAULT_CALLBACK_PORT;
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("SSO 回调端口无效");
  return port;
}

export function buildRuijieAuthorizationUrl({ issuer, clientId, redirectUri, challenge, state }) {
  const url = new URL("/oauth/authorize", issuer);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "codex_cli_rs",
  }).toString();
  return url.toString();
}

function jwtClaims(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function jwtExpiresAt(token) {
  const exp = jwtClaims(token).exp;
  return typeof exp === "number" ? exp * 1000 : 0;
}

function optionalClaim(claims, ...names) {
  for (const name of names) {
    const value = claims[name];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function finiteNonnegative(value, message) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(message);
  return value;
}

export function ruijieAccountSummary(accessToken, usagePayload, subscriptionPayload) {
  const claims = jwtClaims(accessToken);
  const used = finiteNonnegative(usagePayload.total_usage, "GPTAuth 用量数据无效") / 100;
  const total = finiteNonnegative(subscriptionPayload.hard_limit_usd, "GPTAuth 额度数据无效");
  return {
    authentication: "sso",
    account: {
      id: optionalClaim(claims, "sub", "user_id", "uid") ?? "sso-user",
      name: optionalClaim(claims, "name", "preferred_username", "username"),
      email: optionalClaim(claims, "email"),
    },
    billing: {
      currency: "CNY",
      total,
      used,
      remaining: Math.max(0, total - used),
      usedPercent: total === 0 ? 0 : Math.min(100, (used / total) * 100),
    },
    fetchedAt: new Date().toISOString(),
  };
}

function ruijieAccountIdentity(accessToken) {
  const claims = jwtClaims(accessToken);
  return {
    authentication: "sso",
    account: {
      id: optionalClaim(claims, "sub", "user_id", "uid") ?? "sso-user",
      name: optionalClaim(claims, "name", "preferred_username", "username"),
      email: optionalClaim(claims, "email"),
    },
    fetchedAt: new Date().toISOString(),
  };
}

function publicState(status, extra = {}) {
  return Object.freeze({ status, ...extra });
}

async function jsonRequest(fetchImpl, url, init, operation, sessionRejectedStatuses = [400, 401, 403]) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (cause) {
    throw new Error(`${operation}失败，请检查网络或代理`, { cause });
  }
  if (!response.ok) {
    const error = new Error(`${operation}失败（HTTP ${response.status}）`);
    if (sessionRejectedStatuses.includes(response.status)) throw new SessionRejectedError(error.message);
    throw error;
  }
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`${operation}返回格式无效`);
  return payload;
}

async function receiveAuthorizationCode({ state, redirectUri, authorizeUrl, port, openAuthorization }) {
  let settle;
  let reject;
  const result = new Promise((resolve, rejectResult) => {
    settle = resolve;
    reject = rejectResult;
  });
  let done = false;
  let timer;
  const finish = (action) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    action();
  };
  const server = createServer((request, response) => {
    const callback = new URL(request.url ?? "/", redirectUri);
    if (callback.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end("Not Found");
      return;
    }
    if (callback.searchParams.get("state") !== state) {
      response.writeHead(400).end("State mismatch");
      finish(() => reject(new Error("SSO 登录校验失败")));
      return;
    }
    const code = callback.searchParams.get("code");
    if (!code) {
      response.writeHead(400).end("Missing authorization code");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "cache-control": "no-store",
      connection: "close",
    });
    response.end("<!doctype html><meta charset=utf-8><title>登录完成</title><style>body{font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#111}main{text-align:center}h1{font-size:24px}</style><main><h1>锐捷Bot 登录完成</h1><p>正在返回应用…</p></main><script>history.replaceState(null,'','/auth/callback');const closePage=()=>{window.open('','_self');window.close()};setTimeout(closePage,450);</script>");
    finish(() => settle(code));
  });
  await new Promise((resolve, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "localhost", resolve);
  });
  timer = setTimeout(() => finish(() => reject(new Error("等待 SSO 登录超时"))), LOGIN_TIMEOUT_MS);
  let authorization;
  try {
    authorization = await openAuthorization(authorizeUrl);
    if (authorization?.closed) {
      void authorization.closed.then(() => finish(() => reject(new Error("已取消登录"))));
    }
    return await result;
  } finally {
    authorization?.close?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

export function createRuijieSsoAccountService({
  readCredentials,
  updateCredentials,
  openAuthorization,
  environment = process.env,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const issuer = issuerFrom(environment);
  const clientId = environment.OMB_RUIJIE_OAUTH_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
  const port = callbackPort(environment);
  const redirectUri = `http://localhost:${port}${CALLBACK_PATH}`;
  let phase = null;
  let cached = null;
  let transition = Promise.resolve();
  const serialize = (work) => {
    const next = transition.then(work, work);
    transition = next.then(() => {}, () => {});
    return next;
  };
  const tokens = () => {
    const document = readCredentials?.() ?? {};
    const accessToken = ownText(document, RUIJIE_SSO_ACCESS_TOKEN_FIELD);
    const refreshToken = ownText(document, RUIJIE_SSO_REFRESH_TOKEN_FIELD);
    return accessToken && refreshToken ? { accessToken, refreshToken } : null;
  };
  const saveTokens = async (next) => updateCredentials((document) => ({
    ...document,
    [RUIJIE_SSO_ACCESS_TOKEN_FIELD]: next.accessToken,
    [RUIJIE_SSO_REFRESH_TOKEN_FIELD]: next.refreshToken,
  }));
  const clearTokens = async () => updateCredentials((document) => {
    delete document[RUIJIE_SSO_ACCESS_TOKEN_FIELD];
    delete document[RUIJIE_SSO_REFRESH_TOKEN_FIELD];
    return document;
  });
  const refreshedTokens = async (current) => {
    if (jwtExpiresAt(current.accessToken) > now() + REFRESH_SKEW_MS) return current;
    const payload = await jsonRequest(fetchImpl, new URL("/oauth/token", issuer), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: clientId }),
    }, "GPTAuth 会话刷新");
    const next = {
      accessToken: ownText(payload, "access_token"),
      refreshToken: ownText(payload, "refresh_token") || current.refreshToken,
    };
    if (!next.accessToken) throw new SessionRejectedError("GPTAuth 会话刷新未返回令牌");
    await saveTokens(next);
    return next;
  };
  const summary = async (current) => {
    const valid = await refreshedTokens(current);
    const headers = { authorization: `Bearer ${valid.accessToken}` };
    try {
      const [usage, subscription] = await Promise.all([
        jsonRequest(fetchImpl, new URL("/v1/dashboard/billing/usage", issuer), { headers }, "GPTAuth 用量读取", [401]),
        jsonRequest(fetchImpl, new URL("/v1/dashboard/billing/subscription", issuer), { headers }, "GPTAuth 额度读取", [401]),
      ]);
      return ruijieAccountSummary(valid.accessToken, usage, subscription);
    } catch (cause) {
      if (cause instanceof SessionRejectedError) throw cause;
      // Billing is supplemental account metadata. A valid SSO token must not
      // be discarded merely because this account lacks billing scope or the
      // usage service is temporarily unavailable.
      return ruijieAccountIdentity(valid.accessToken);
    }
  };
  const stateWork = async () => {
    if (phase) return phase;
    const current = tokens();
    if (!current) return publicState("signed-out");
    try {
      cached = await summary(current);
      return publicState("ready", { summary: cached });
    } catch (cause) {
      if (cause instanceof SessionRejectedError) {
        await clearTokens();
        cached = null;
        return publicState("signed-out", { message: "登录已过期，请重新登录" });
      }
      return publicState("error", {
        ...(cached ? { summary: cached } : {}),
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };
  return Object.freeze({
    state: () => serialize(stateWork),
    signIn: () => serialize(async () => {
      phase = publicState("authorizing");
      try {
        const state = randomBytes(32).toString("base64url");
        const verifier = randomBytes(32).toString("base64url");
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        const authorizeUrl = buildRuijieAuthorizationUrl({ issuer, clientId, redirectUri, challenge, state });
        const code = await receiveAuthorizationCode({ state, redirectUri, authorizeUrl, port, openAuthorization });
        const payload = await jsonRequest(fetchImpl, new URL("/oauth/token", issuer), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier,
          }),
        }, "GPTAuth 登录");
        const next = { accessToken: ownText(payload, "access_token"), refreshToken: ownText(payload, "refresh_token") };
        if (!next.accessToken || !next.refreshToken) throw new Error("GPTAuth 登录未返回完整会话");
        await saveTokens(next);
        cached = await summary(next);
        phase = null;
        return publicState("ready", { summary: cached });
      } catch (cause) {
        phase = null;
        return publicState("signed-out", { message: cause instanceof Error ? cause.message : String(cause) });
      }
    }),
    signOut: () => serialize(async () => {
      const current = tokens();
      await clearTokens();
      cached = null;
      phase = null;
      if (current?.refreshToken) {
        void fetchImpl(new URL("/oauth/revoke", issuer), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: current.refreshToken, client_id: clientId }),
          signal: AbortSignal.timeout(2_000),
        }).catch(() => {});
      }
      return publicState("signed-out");
    }),
  });
}
