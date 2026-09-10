import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const builderRequire = createRequire(import.meta.resolve("electron-builder"));
const { getConfig, validateConfiguration } = builderRequire("app-builder-lib/out/util/config/config.js");

test("Ruijie packaging resolves WYunS without losing upstream resources or app identity", async () => {
  const config = await getConfig(root, "electron-builder.ruijie.mjs", null);
  await validateConfiguration(config);
  assert.deepEqual(config.publish, [{ provider: "github", owner: "WYunS", repo: "OpenMausBot" }]);
  assert.equal(config.appId, "com.openmausbot.app");
  assert.equal(config.productName, "OpenMausBot");
  assert.equal(config.afterPack, "./scripts/after-pack.mjs");
  assert.equal(config.nsis.shortcutName, "锐捷Bot");
  for (const platform of ["win", "mac"]) {
    assert(config[platform].extraResources.some((entry) => entry.to === "browser-engine"));
    assert(config[platform].extraResources.some((entry) => entry.to === "cloudflared/cloudflared" || entry.to === "cloudflared/cloudflared.exe"));
  }
  assert(config.extraResources.some((entry) => entry.to === "server"));
  assert(config.extraResources.some((entry) => entry.to === "ui"));
  assert(config.extraResources.some((entry) => entry.to === "companion"));
});

test("internal Mac candidate flags retain the downstream feed and explicitly request ad-hoc signing", async () => {
  const config = await getConfig(root, "electron-builder.ruijie.mjs", { mac: { identity: "-" }, dmg: { sign: false } });
  await validateConfiguration(config);
  assert.equal(config.mac.identity, "-");
  assert.equal(config.mac.notarize, false);
  assert.equal(config.dmg.sign, false);
  assert.equal(config.publish[0].owner, "WYunS");
});
