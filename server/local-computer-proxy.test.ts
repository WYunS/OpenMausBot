import { describe, expect, it, vi } from "vitest";

import { createLocalComputerProxyInterceptor } from "./local-computer-proxy.ts";

const frame = (value: unknown) => JSON.stringify(value);

describe("local computer MCP proxy", () => {
  it("publishes the raw CUA screenshot before Harness replaces it for a text-only model", async () => {
    const toDriver: string[] = [];
    const toClient: string[] = [];
    const publishFrame = vi.fn(async () => undefined);
    const proxy = createLocalComputerProxyInterceptor({
      toDriver: (line) => toDriver.push(line),
      toClient: (line) => toClient.push(line),
      publishFrame,
      schedule: () => undefined,
    });

    proxy.fromClient(frame({
      jsonrpc: "2.0", id: 7, method: "tools/call",
      params: { name: "get_window_state", arguments: { pid: 22, window_id: 33 } },
    }));
    proxy.fromDriver(frame({
      jsonrpc: "2.0", id: 7,
      result: { content: [
        { type: "text", text: "window state" },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
      ] },
    }));
    await Promise.resolve();

    expect(toDriver).toHaveLength(1);
    expect(toClient).toHaveLength(1);
    expect(publishFrame).toHaveBeenCalledWith({ png: "iVBORw0KGgo=", mime: "image/png" });
  });

  it("preserves normal foreground controls instead of forcing demo background mode", () => {
    const toDriver: string[] = [];
    const toClient: string[] = [];
    const proxy = createLocalComputerProxyInterceptor({
      toDriver: (line) => toDriver.push(line),
      toClient: (line) => toClient.push(line),
      publishFrame: async () => undefined,
      schedule: () => undefined,
    });

    proxy.fromClient(frame({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
    proxy.fromDriver(frame({ jsonrpc: "2.0", id: 1, result: { tools: [
      { name: "click" }, { name: "bring_to_front" }, { name: "get_window_state" },
    ] } }));
    proxy.fromClient(frame({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "press_key", arguments: { pid: 22, window_id: 33, key: "return", delivery_mode: "foreground" } },
    }));
    proxy.fromClient(frame({
      jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "bring_to_front", arguments: { pid: 22 } },
    }));

    expect(JSON.parse(toClient[0]!).result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "click", "bring_to_front", "get_window_state",
    ]);
    expect(JSON.parse(toDriver[1]!).params.arguments.delivery_mode).toBe("foreground");
    expect(JSON.parse(toDriver[2]!).params.name).toBe("bring_to_front");
    expect(toDriver).toHaveLength(3);
  });

  it("coalesces follow-up screenshots after a mutating action", () => {
    const toDriver: string[] = [];
    const scheduled: Array<() => void> = [];
    const proxy = createLocalComputerProxyInterceptor({
      toDriver: (line) => toDriver.push(line),
      toClient: () => undefined,
      publishFrame: async () => undefined,
      schedule: (callback) => { scheduled.push(callback); },
    });

    proxy.fromClient(frame({
      jsonrpc: "2.0", id: 9, method: "tools/call",
      params: { name: "click", arguments: { pid: 22, window_id: 33, x: 10, y: 20 } },
    }));
    expect(JSON.parse(toDriver[0]!).params.arguments.delivery_mode).toBeUndefined();
    proxy.fromDriver(frame({ jsonrpc: "2.0", id: 9, result: { content: [{ type: "text", text: "ok" }] } }));
    for (const callback of scheduled) callback();

    const observations = toDriver.slice(1).map((line) => JSON.parse(line));
    expect(observations).toHaveLength(1);
    expect(observations.every((message) =>
      message.method === "tools/call"
      && message.params.name === "get_window_state"
      && message.params.arguments.pid === 22
      && message.params.arguments.window_id === 33
      && message.params.arguments.max_depth === 1
      && message.params.arguments.max_elements === 10
    )).toBe(true);

    proxy.fromDriver(frame({
      jsonrpc: "2.0", id: observations[0].id,
      result: { content: [{ type: "image", mimeType: "image/png", data: "settling-frame" }] },
    }));
    expect(toDriver.slice(1).map((line) => JSON.parse(line))).toHaveLength(2);

  });

  it("does not queue stale observations ahead of the next real action", () => {
    const toDriver: string[] = [];
    const scheduled: Array<() => void> = [];
    const proxy = createLocalComputerProxyInterceptor({
      toDriver: (line) => toDriver.push(line),
      toClient: () => undefined,
      publishFrame: async () => undefined,
      schedule: (callback) => { scheduled.push(callback); },
    });

    proxy.fromClient(frame({
      jsonrpc: "2.0", id: 30, method: "tools/call",
      params: { name: "click", arguments: { pid: 22, window_id: 33, x: 10, y: 20 } },
    }));
    proxy.fromDriver(frame({ jsonrpc: "2.0", id: 30, result: { content: [{ type: "text", text: "ok" }] } }));
    for (const callback of scheduled) callback();

    const syntheticBeforeNextAction = toDriver
      .map((line) => JSON.parse(line))
      .filter((message) => String(message.id).startsWith("omb-screen-"));
    expect(syntheticBeforeNextAction).toHaveLength(1);

    proxy.fromClient(frame({
      jsonrpc: "2.0", id: 31, method: "tools/call",
      params: { name: "press_key", arguments: { pid: 22, window_id: 33, key: "return" } },
    }));
    expect(JSON.parse(toDriver.at(-1)!).id).toBe(31);

    proxy.fromDriver(frame({
      jsonrpc: "2.0", id: syntheticBeforeNextAction[0].id,
      result: { content: [{ type: "image", mimeType: "image/png", data: "new-frame" }] },
    }));
    expect(toDriver.map((line) => JSON.parse(line)).filter((message) =>
      String(message.id).startsWith("omb-screen-")
    )).toHaveLength(1);
  });

  it("observes a browser opened directly from a search URL", () => {
    const toDriver: string[] = [];
    const scheduled: Array<() => void> = [];
    const proxy = createLocalComputerProxyInterceptor({
      toDriver: (line) => toDriver.push(line),
      toClient: () => undefined,
      publishFrame: async () => undefined,
      schedule: (callback) => { scheduled.push(callback); },
    });
    proxy.fromClient(frame({
      jsonrpc: "2.0", id: 12, method: "tools/call",
      params: { name: "launch_app", arguments: { urls: ["https://www.baidu.com/s?wd=AI"] } },
    }));
    proxy.fromDriver(frame({
      jsonrpc: "2.0", id: 12,
      result: { structuredContent: { windows: [{ pid: 44, window_id: 55 }] }, content: [] },
    }));
    expect(JSON.parse(toDriver[1]!).params).toEqual({
      name: "bring_to_front",
      arguments: { pid: 44, window_id: 55 },
    });
    for (const callback of scheduled) callback();

    expect(toDriver.slice(2).map((line) => JSON.parse(line).params.arguments)).toEqual([
      { pid: 44, window_id: 55, max_depth: 1, max_elements: 10 },
    ]);
  });

  it("restores a minimized target without activation before requesting its frame", async () => {
    const order: string[] = [];
    const proxy = createLocalComputerProxyInterceptor({
      toDriver: () => order.push("forward"),
      toClient: () => undefined,
      publishFrame: async () => undefined,
      prepareWindow: async ({ pid, window_id }) => {
        expect({ pid, window_id }).toEqual({ pid: 1820, window_id: 1115096 });
        order.push("restore-no-activate");
      },
      schedule: () => undefined,
    });

    await proxy.fromClient(frame({
      jsonrpc: "2.0", id: 20, method: "tools/call",
      params: { name: "get_window_state", arguments: { pid: 1820, window_id: 1115096 } },
    }));

    expect(order).toEqual(["restore-no-activate", "forward"]);
  });
});
