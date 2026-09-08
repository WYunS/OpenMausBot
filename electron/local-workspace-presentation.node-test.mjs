import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = new URL("./main.mjs", import.meta.url);
const preload = new URL("./preload.cjs", import.meta.url);
const panel = new URL("../src/components/ComputerPanel.tsx", import.meta.url);
const capabilities = new URL("./capabilities.cjs", import.meta.url);

test("This computer keeps the upstream presentation without a forced Windows control overlay", async () => {
  const [mainSource, preloadSource, panelSource, capabilitiesSource] = await Promise.all([
    readFile(main, "utf8"),
    readFile(preload, "utf8"),
    readFile(panel, "utf8"),
    readFile(capabilities, "utf8"),
  ]);

  assert.doesNotMatch(mainSource, /localWorkspacePresentation|screen:capture-shield|screen:desktop-input/);
  assert.doesNotMatch(preloadSource, /setScreenCaptureShield|localDesktopInput/);
  assert.doesNotMatch(panelSource, /LocalScreenViewer|openLocalViewer|takeLocalControl/);
  assert.match(panelSource, /window\.ogb!\.screenFrame\(\)/);
  assert.match(capabilitiesSource, /platform === "win32"/);
  assert.match(capabilitiesSource, /connection\?\.mode === "windows-direct"/);
});
