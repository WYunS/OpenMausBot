import assert from "node:assert/strict";
import test from "node:test";

import {
  createDesktopViewerTakeoverNotifier,
  desktopViewerInputTakesControl,
} from "./desktop-viewer-takeover.mjs";

test("focus, resize and pointer movement remain view-only", () => {
  for (const input of [
    { source: "window", type: "focus" },
    { source: "window", type: "resize" },
    { source: "mouse", type: "mouseMove" },
    { source: "mouse", type: "mouseEnter" },
  ]) {
    assert.equal(desktopViewerInputTakesControl(input), false, `${input.source}:${input.type}`);
  }
});

test("a deliberate click, wheel or key press takes control", () => {
  for (const input of [
    { source: "mouse", type: "mouseDown" },
    { source: "mouse", type: "mouseWheel" },
    { source: "keyboard", type: "keyDown" },
    { source: "keyboard", type: "char" },
  ]) {
    assert.equal(desktopViewerInputTakesControl(input), true, `${input.source}:${input.type}`);
  }
});

test("one viewer session emits at most one takeover request", () => {
  const sent = [];
  const notify = createDesktopViewerTakeoverNotifier((message) => sent.push(message), "bot-a");

  notify({ source: "window", type: "focus" });
  notify({ source: "mouse", type: "mouseMove" });
  notify({ source: "mouse", type: "mouseDown" });
  notify({ source: "keyboard", type: "keyDown" });

  assert.deepEqual(sent, [{ contextId: "bot-a" }]);
});
