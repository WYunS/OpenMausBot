import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createLocalDesktopInputController, normalizedPoint, selectElementAtPoint, selectUnderlyingWindow } = require("./local-desktop-input.cjs");

describe("local desktop input mapping", () => {
  it("clamps viewer coordinates to the captured display", () => {
    expect(normalizedPoint({ xRatio: -1, yRatio: 2 })).toEqual({ x: 0, y: 1 });
    expect(normalizedPoint({ xRatio: "bad", yRatio: 0.5 })).toBeNull();
  });

  it("selects the top visible window under the point but never OpenMausBot", () => {
    const windows = [
      { pid: 10, window_id: 1, app_name: "electron.exe", is_on_screen: true, minimized: false, z_index: 9, bounds: { x: 0, y: 0, width: 1000, height: 800 } },
      { pid: 20, window_id: 2, app_name: "chrome.exe", is_on_screen: true, minimized: false, z_index: 8, bounds: { x: 100, y: 100, width: 700, height: 500 } },
      { pid: 30, window_id: 3, app_name: "explorer.exe", is_on_screen: true, minimized: false, z_index: 7, bounds: { x: 0, y: 0, width: 1000, height: 800 } },
    ];
    expect(selectUnderlyingWindow(windows, { x: 400, y: 300 }, 10)?.pid).toBe(20);
  });

  it("selects the deepest desktop element under the clicked point", () => {
    const elements = [
      { depth: 1, enabled: true, element_token: "desktop", frame: { x: 0, y: 0, w: 1000, h: 800 } },
      { depth: 2, enabled: true, element_token: "folder", frame: { x: 100, y: 100, w: 150, h: 134 } },
    ];
    expect(selectElementAtPoint(elements, { x: 180, y: 160 })?.element_token).toBe("folder");
  });

  it("clicks the matching background window without moving or raising it", async () => {
    const calls = [];
    const runProcess = async (_binary, args) => {
      calls.push(args);
      if (args[0] === "status") return "running";
      if (args[1] === "get_screen_size") return JSON.stringify({ width: 1000, height: 800 });
      if (args[1] === "list_windows") return JSON.stringify({
        windows: [
          { pid: 10, window_id: 1, app_name: "electron.exe", is_on_screen: true, minimized: false, z_index: 2, bounds: { x: 0, y: 0, width: 1000, height: 800 } },
          { pid: 20, window_id: 2, app_name: "chrome.exe", is_on_screen: true, minimized: false, z_index: 1, bounds: { x: 100, y: 100, width: 700, height: 500 } },
        ],
      });
      return "{}";
    };
    const controller = createLocalDesktopInputController({
      binary: "driver",
      hostPid: 10,
      socketPath: "pipe",
      spawnProcess: () => ({ kill() {} }),
      runProcess,
    });

    await expect(controller.input({ kind: "click", xRatio: 0.4, yRatio: 0.375 })).resolves.toBe(true);
    const listWindows = calls.find((args) => args[0] === "call" && args[1] === "list_windows");
    expect(JSON.parse(listWindows[2])).toEqual({ on_screen_only: true });
    expect(calls.some((args) => args[0] === "call" && args[1] === "bring_to_front")).toBe(false);
    const click = calls.find((args) => args[0] === "call" && args[1] === "click");
    expect(JSON.parse(click[2])).toMatchObject({ pid: 20, window_id: 2, x: 300, y: 200, delivery_mode: "background" });
    await controller.stop();
  });

  it("accepts the driver's plain-text success status for input actions", async () => {
    const runProcess = async (_binary, args) => {
      if (args[0] === "status") return "running";
      if (args[1] === "get_screen_size") return JSON.stringify({ width: 1000, height: 800 });
      if (args[1] === "list_windows") return JSON.stringify({
        windows: [
          { pid: 20, window_id: 2, app_name: "msedge.exe", is_on_screen: true, minimized: false, z_index: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } },
        ],
      });
      return "foreground_only";
    };
    const controller = createLocalDesktopInputController({
      binary: "driver",
      hostPid: 10,
      socketPath: "pipe",
      spawnProcess: () => ({ kill() {} }),
      runProcess,
    });

    await expect(controller.input({ kind: "click", xRatio: 0.4, yRatio: 0.375 })).resolves.toBe(true);
    await controller.stop();
  });

  it("restarts the input daemon after it exits unexpectedly", async () => {
    const exits = [];
    let spawnCount = 0;
    const controller = createLocalDesktopInputController({
      binary: "driver",
      hostPid: 10,
      socketPath: "pipe",
      spawnProcess: () => {
        spawnCount += 1;
        return {
          kill() {},
          once(event, listener) {
            if (event === "exit") exits.push(listener);
          },
        };
      },
      runProcess: async (_binary, args) => {
        if (args[0] === "status") return "running";
        if (args[1] === "get_screen_size") return JSON.stringify({ width: 1000, height: 800 });
        if (args[1] === "list_windows") return JSON.stringify({
          windows: [{ pid: 20, window_id: 2, app_name: "msedge.exe", is_on_screen: true, minimized: false, z_index: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }],
        });
        return "ok";
      },
    });

    await controller.input({ kind: "click", xRatio: 0.4, yRatio: 0.4 });
    exits[0]();
    await controller.input({ kind: "click", xRatio: 0.5, yRatio: 0.5 });
    expect(spawnCount).toBe(2);
    await controller.stop();
  });

  it("opens a desktop icon through its accessibility token", async () => {
    const calls = [];
    const runProcess = async (_binary, args) => {
      calls.push(args);
      if (args[0] === "status") return "running";
      if (args[1] === "get_screen_size") return JSON.stringify({ width: 1000, height: 800 });
      if (args[1] === "list_windows") return JSON.stringify({
        windows: [
          { pid: 20, window_id: 2, app_name: "explorer.exe", title: "Program Manager", is_on_screen: true, minimized: false, z_index: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } },
        ],
      });
      if (args[1] === "get_window_state") return JSON.stringify({
        elements: [
          { depth: 2, enabled: true, element_token: "s00000001:3", frame: { x: 100, y: 100, w: 150, h: 134 } },
        ],
      });
      return JSON.stringify({ delivery: { mode: "background" }, route: "accessibility" });
    };
    const controller = createLocalDesktopInputController({
      binary: "driver",
      hostPid: 10,
      socketPath: "pipe",
      spawnProcess: () => ({ kill() {} }),
      runProcess,
    });

    await controller.input({ kind: "click", xRatio: 0.18, yRatio: 0.2, double: true });
    const click = calls.find((args) => args[0] === "call" && args[1] === "click");
    expect(JSON.parse(click[2])).toMatchObject({
      pid: 20,
      window_id: 2,
      element_token: "s00000001:3",
      count: 2,
      delivery_mode: "background",
    });
    await controller.stop();
  });
});
