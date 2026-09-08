import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateReleaseManifest } from "./local-vm-release-manifest.mjs";

test("release manifests require both reviewed enterprise applications", () => {
  assert.throws(() => validateReleaseManifest({ enterpriseApps: [] }, "fixture"), /Feishu and Feilian/);
  assert.throws(() => validateReleaseManifest({ enterpriseApps: ["feishu"] }, "fixture"), /Feishu and Feilian/);
  assert.doesNotThrow(() => validateReleaseManifest({ enterpriseApps: ["feishu", "feilian"] }, "fixture"));
});

test("every desktop packaging entry point verifies its Local VM bundle first", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of ["package:win", "package:mac", "package:linux", "package:linux:offline", "package:linux:dir"]) {
    assert.match(packageJson.scripts[name], /^pnpm verify:local-vm-bundle /, name);
  }
});
