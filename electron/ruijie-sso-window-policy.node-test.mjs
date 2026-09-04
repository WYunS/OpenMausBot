import assert from "node:assert/strict";
import test from "node:test";

import {
  RuijieAuthorizationRecovery,
  authorizationRecoveryForNavigation,
  authorizationWindowOptions,
  authorizationWindowSize,
  isRuijieEnterpriseSsoNavigation,
  loadAuthorizationWithDirectFallback,
} from "./ruijie-sso-window-policy.mjs";

const AUTHORIZE = "https://gptauth.ruijie.com.cn/oauth/authorize?client_id=openmaus&state=state";

test("recognizes only the enterprise SSO origin", () => {
  assert.equal(isRuijieEnterpriseSsoNavigation("https://sid.ruijie.com.cn/login"), true);
  assert.equal(isRuijieEnterpriseSsoNavigation("https://evil.example/login"), false);
});

test("uses the system route first and retries direct only for transport failures", async () => {
  const normalLoads = [];
  assert.equal(await loadAuthorizationWithDirectFallback({
    loadURL: async (url) => { normalLoads.push(url); },
    useDirectProxy: async () => { throw new Error("direct fallback must stay idle"); },
  }, AUTHORIZE), "system");
  assert.deepEqual(normalLoads, [AUTHORIZE]);

  const fallbackLoads = [];
  let directSelections = 0;
  assert.equal(await loadAuthorizationWithDirectFallback({
    loadURL: async (url) => {
      fallbackLoads.push(url);
      if (fallbackLoads.length === 1) throw new Error("ERR_TIMED_OUT (-7)");
    },
    useDirectProxy: async () => { directSelections += 1; },
  }, AUTHORIZE), "direct");
  assert.deepEqual(fallbackLoads, [AUTHORIZE, AUTHORIZE]);
  assert.equal(directSelections, 1);

  await assert.rejects(loadAuthorizationWithDirectFallback({
    loadURL: async () => { throw new Error("OAuth state rejected"); },
    useDirectProxy: async () => { directSelections += 1; },
  }, AUTHORIZE), /OAuth state rejected/u);
  assert.equal(directSelections, 1);
});

test("fits the Harness login window to the current work area", () => {
  assert.deepEqual(authorizationWindowSize({ width: 1920, height: 1040 }), { width: 920, height: 720 });
  assert.deepEqual(authorizationWindowSize({ width: 800, height: 600 }), { width: 752, height: 552 });
});

test("keeps the Harness login window above its OpenMaus parent", () => {
  const parent = { id: "main-window" };
  assert.deepEqual(authorizationWindowOptions(parent, { width: 1920, height: 1040 }), {
    parent,
    modal: true,
    width: 920,
    height: 720,
  });
});

test("recovers GPTAuth dashboard and user landings but not callbacks", () => {
  assert.equal(authorizationRecoveryForNavigation(AUTHORIZE, false, "https://gptauth.ruijie.com.cn/dashboard", false), AUTHORIZE);
  assert.equal(authorizationRecoveryForNavigation(AUTHORIZE, false, "https://gptauth.ruijie.com.cn/user", false), AUTHORIZE);
  assert.equal(authorizationRecoveryForNavigation(AUTHORIZE, true, "http://localhost:1455/auth/callback?code=x", false), undefined);
});

test("recovers a lost enterprise return target exactly once", () => {
  const recovery = new RuijieAuthorizationRecovery(AUTHORIZE);
  assert.equal(recovery.observe("https://sid.ruijie.com.cn/login"), undefined);
  assert.equal(recovery.observe("https://gptauth.ruijie.com.cn/dashboard"), AUTHORIZE);
  assert.equal(recovery.observe("https://gptauth.ruijie.com.cn/dashboard"), undefined);
});

test("replays the real Harness redirect sequence without forming a loop", () => {
  const recovery = new RuijieAuthorizationRecovery(AUTHORIZE);
  const sequence = [
    AUTHORIZE,
    "https://gptauth.ruijie.com.cn/sign-in?redirect=oauth",
    "https://sid.ruijie.com.cn/login?service=callback",
    "https://gptauth.ruijie.com.cn/oauth/ruijie",
    ...Array.from({ length: 50 }, (_, index) => index % 2 === 0
      ? "https://gptauth.ruijie.com.cn/dashboard"
      : "https://gptauth.ruijie.com.cn/dashboard/overview"),
  ];
  assert.deepEqual(sequence.map((url) => recovery.observe(url)).filter(Boolean), [AUTHORIZE]);
});

test("does not recover an unrelated cross-origin dashboard", () => {
  assert.equal(authorizationRecoveryForNavigation(AUTHORIZE, false, "https://evil.example/dashboard", false), undefined);
});
