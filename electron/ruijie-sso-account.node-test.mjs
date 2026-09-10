import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  RUIJIE_SSO_ACCESS_TOKEN_FIELD,
  RUIJIE_SSO_REFRESH_TOKEN_FIELD,
  buildRuijieAuthorizationUrl,
  createRuijieSsoAccountService,
  ruijieAccountSummary,
} from "./ruijie-sso-account.mjs";

function jwt(payload) {
  return `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.x`;
}

test("builds the company PKCE authorization request for OpenMaus", () => {
  const url = new URL(buildRuijieAuthorizationUrl({
    issuer: "https://gptauth.ruijie.com.cn",
    clientId: "client",
    redirectUri: "http://localhost:1455/auth/callback",
    challenge: "challenge",
    state: "state",
  }));
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("code_challenge"), "challenge");
  assert.match(url.searchParams.get("scope"), /openid/);
});

test("normalizes the GPTAuth identity and CNY wallet", () => {
  const summary = ruijieAccountSummary(
    jwt({ sub: "608", name: "王允尚", email: "wangyunshang@ruijie.com.cn" }),
    { total_usage: 2500 },
    { hard_limit_usd: 100 },
  );
  assert.equal(summary.account.id, "608");
  assert.equal(summary.account.email, "wangyunshang@ruijie.com.cn");
  assert.deepEqual(summary.billing, {
    currency: "CNY", total: 100, used: 25, remaining: 75, usedPercent: 25,
  });
});

test("restores and signs out an independent OpenMaus SSO session", async () => {
  let credentials = {
    [RUIJIE_SSO_ACCESS_TOKEN_FIELD]: jwt({
      sub: "608", name: "王允尚", email: "wangyunshang@ruijie.com.cn", exp: 4_102_444_800,
    }),
    [RUIJIE_SSO_REFRESH_TOKEN_FIELD]: "refresh",
  };
  const fetchImpl = async (input) => {
    const pathname = new URL(input).pathname;
    if (pathname.endsWith("/usage")) return Response.json({ total_usage: 2500 });
    if (pathname.endsWith("/subscription")) return Response.json({ hard_limit_usd: 100 });
    if (pathname.endsWith("/revoke")) return new Response(null, { status: 204 });
    throw new Error(`unexpected request: ${pathname}`);
  };
  const service = createRuijieSsoAccountService({
    readCredentials: () => structuredClone(credentials),
    updateCredentials: async (derive) => { credentials = await derive(structuredClone(credentials)); },
    openAuthorization: async () => { throw new Error("not expected"); },
    fetchImpl,
  });
  const ready = await service.state();
  assert.equal(ready.status, "ready");
  assert.equal(ready.summary.billing, undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await service.state()).summary.billing.remaining, 75);
  assert.equal((await service.signOut()).status, "signed-out");
  assert.equal(credentials[RUIJIE_SSO_ACCESS_TOKEN_FIELD], undefined);
  assert.equal(credentials[RUIJIE_SSO_REFRESH_TOKEN_FIELD], undefined);
});

test("keeps a valid SSO session when billing scope is unavailable", async () => {
  let credentials = {
    [RUIJIE_SSO_ACCESS_TOKEN_FIELD]: jwt({ sub: "608", name: "王允尚", exp: 4_102_444_800 }),
    [RUIJIE_SSO_REFRESH_TOKEN_FIELD]: "refresh",
  };
  const service = createRuijieSsoAccountService({
    readCredentials: () => structuredClone(credentials),
    updateCredentials: async (derive) => { credentials = await derive(structuredClone(credentials)); },
    openAuthorization: async () => { throw new Error("not expected"); },
    fetchImpl: async () => new Response(null, { status: 403 }),
  });

  const ready = await service.state();
  assert.equal(ready.status, "ready");
  assert.equal(ready.summary.account.name, "王允尚");
  assert.equal(ready.summary.billing, undefined);
  assert.equal(credentials[RUIJIE_SSO_REFRESH_TOKEN_FIELD], "refresh");
});

test("completes sign-in before slow billing requests settle", async () => {
  const portProbe = createServer();
  await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  let credentials = {};
  let releaseBilling;
  const billingGate = new Promise((resolve) => { releaseBilling = resolve; });
  const accessToken = jwt({ sub: "608", name: "王允尚", email: "wangyunshang@ruijie.com.cn", exp: 4_102_444_800 });
  const service = createRuijieSsoAccountService({
    environment: {
      OMB_RUIJIE_OAUTH_ISSUER: "http://127.0.0.1:18999",
      OMB_RUIJIE_OAUTH_CALLBACK_PORT: String(port),
    },
    readCredentials: () => structuredClone(credentials),
    updateCredentials: async (derive) => { credentials = await derive(structuredClone(credentials)); },
    openAuthorization: async (authorizeUrl) => {
      const state = new URL(authorizeUrl).searchParams.get("state");
      void fetch(`http://localhost:${port}/auth/callback?state=${encodeURIComponent(state)}&code=fixture`);
      return { close() {} };
    },
    fetchImpl: async (input) => {
      const pathname = new URL(input).pathname;
      if (pathname.endsWith("/oauth/token")) {
        return Response.json({ access_token: accessToken, refresh_token: "refresh" });
      }
      await billingGate;
      if (pathname.endsWith("/usage")) return Response.json({ total_usage: 2500 });
      if (pathname.endsWith("/subscription")) return Response.json({ hard_limit_usd: 100 });
      throw new Error(`unexpected request: ${pathname}`);
    },
  });

  const ready = await Promise.race([
    service.signIn(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("sign-in waited for billing")), 1_000)),
  ]);
  assert.equal(ready.status, "ready");
  assert.equal(ready.summary.account.email, "wangyunshang@ruijie.com.cn");
  assert.equal(ready.summary.billing, undefined);
  assert.equal(credentials[RUIJIE_SSO_ACCESS_TOKEN_FIELD], accessToken);
  releaseBilling();
});
