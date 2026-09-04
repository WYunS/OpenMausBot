import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = new URL("./main.mjs", import.meta.url);

test("Windows local workspace stays above applications launched by the bot", async () => {
  const source = await readFile(main, "utf8");
  assert.match(source, /setAlwaysOnTop\(localWorkspacePresentation,[\s\S]*"screen-saver"/);
  assert.match(source, /\["show", "restore", "maximize", "focus", "blur"\]/);
  assert.match(source, /setImmediate\(\(\) => applyLocalWorkspacePresentation\(win\)\)/);
});
