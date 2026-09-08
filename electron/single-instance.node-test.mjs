import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { activateExistingWindow, releaseSingleInstanceLock } from "./single-instance.mjs";

test("main imports Electron's native updater before subscribing to update quit", () => {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const electronImport = source.match(/import\s*\{([^}]+)\}\s*from\s*["']electron["']/)?.[1] ?? "";
  assert.match(source, /nativeAutoUpdater\.on\("before-quit-for-update"/);
  assert.match(electronImport, /\bautoUpdater\s+as\s+nativeAutoUpdater\b/);
});

test("main declares the upstream desktop security and companion dependencies it calls", () => {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.match(source, /createTrustedApprovalModeCoordinator\s*}\s*=\s*require\(["']\.\/approval-trusted-mode\.cjs["']\)/);
  assert.match(source, /DESKTOP_MUTATION_HEADER,\s*desktopServerHeaders\s*}\s*=\s*require\(["']\.\/desktop-server-auth\.cjs["']\)/);
  assert.match(source, /desktopCompanionAccess[\s\S]*from\s*["']\.\/desktop-companion-client\.mjs["']/);
});

test("the ESM CUA entrypoint does not rely on CommonJS __dirname", () => {
  const source = readFileSync(new URL("./cua.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b__dirname\b/);
});

function fakeWindow({ destroyed = false, minimized = false, focused = false, maximized = false } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    isMaximized: () => maximized,
    isFocused: () => focused,
    restore: () => calls.push("restore"),
    maximize: () => calls.push("maximize"),
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
  };
}

test("shows and focuses the only living window", () => {
  const win = fakeWindow();
  assert.equal(activateExistingWindow([win]), true);
  assert.deepEqual(win.calls, ["maximize", "show", "focus"]);
});

test("restores a minimized window before showing it", () => {
  const win = fakeWindow({ minimized: true });
  assert.equal(activateExistingWindow([win]), true);
  assert.deepEqual(win.calls, ["restore", "maximize", "show", "focus"]);
});

test("skips destroyed windows without touching them", () => {
  const dead = fakeWindow({ destroyed: true });
  const alive = fakeWindow();
  assert.equal(activateExistingWindow([dead, alive]), true);
  assert.deepEqual(dead.calls, []);
  assert.deepEqual(alive.calls, ["maximize", "show", "focus"]);
});

test("prefers the focused window among several", () => {
  const first = fakeWindow();
  const second = fakeWindow({ focused: true });
  assert.equal(activateExistingWindow([first, second]), true);
  assert.deepEqual(first.calls, []);
  assert.deepEqual(second.calls, ["maximize", "show", "focus"]);
});

test("reports failure when no window can be activated", () => {
  const dead = fakeWindow({ destroyed: true });
  assert.equal(activateExistingWindow([]), false);
  assert.equal(activateExistingWindow([dead]), false);
  assert.deepEqual(dead.calls, []);
});

function fakeApp({ holdsLock = true } = {}) {
  const calls = [];
  let held = holdsLock;
  return {
    calls,
    hasSingleInstanceLock: () => held,
    releaseSingleInstanceLock: () => {
      held = false;
      calls.push("releaseSingleInstanceLock");
    },
  };
}

test("releases a held single-instance lock for an update relaunch", () => {
  const app = fakeApp();
  assert.equal(releaseSingleInstanceLock(app), true);
  assert.deepEqual(app.calls, ["releaseSingleInstanceLock"]);
});

test("stays a no-op when the lock is not held", () => {
  const app = fakeApp({ holdsLock: false });
  assert.equal(releaseSingleInstanceLock(app), false);
  assert.deepEqual(app.calls, []);
});

test("releases the lock only once when the update signal fires twice", () => {
  const app = fakeApp();
  assert.equal(releaseSingleInstanceLock(app), true);
  assert.equal(releaseSingleInstanceLock(app), false);
  assert.deepEqual(app.calls, ["releaseSingleInstanceLock"]);
});
