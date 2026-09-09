import assert from "node:assert/strict";
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
  assert.equal(ready.summary.billing.remaining, 75);
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
