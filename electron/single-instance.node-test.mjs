import assert from "node:assert/strict";
import test from "node:test";

import { activateExistingWindow } from "./single-instance.mjs";

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
