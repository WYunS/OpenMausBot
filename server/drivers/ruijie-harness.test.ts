import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuijieHarnessDriver, defaultRuijieBridgePath, toolResultImageAttachment } from "./ruijie-harness.ts";
import type { RuntimeEvent } from "../contracts.ts";

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;

  constructor(readonly url: URL) {
    super();
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  frame(payload: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
      type: "server-request", rpcId: crypto.randomUUID(), method: "events.mux", payload,
    }) }));
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

describe("Ruijie Harness driver", () => {
  const calls: Array<{ method: string; payload: any }> = [];
  let sessionCreateFailuresRemaining = 0;

  beforeEach(() => {
    FakeSocket.instances = [];
    sessionCreateFailuresRemaining = 0;
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/__dsh_desktop/ruijie-account")) {
        return Response.json({
          authentication: "sso",
          account: { id: "608", name: "王允尚", email: "wangyunshang@ruijie.com.cn" },
          billing: { currency: "CNY", total: 100, used: 25, remaining: 75, usedPercent: 25 },
          fetchedAt: "2026-09-03T00:00:00.000Z",
        });
      }
      const body = JSON.parse(String(init?.body)) as { rpcId: string; method: string; payload: any };
      calls.push({ method: body.method, payload: body.payload });
      if (url.pathname.endsWith("session.create") && sessionCreateFailuresRemaining > 0) {
        sessionCreateFailuresRemaining -= 1;
        return Response.json({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: false, error: { message: "preset failed to mount" } },
        });
      }
      let value: unknown = {};
      if (url.pathname.endsWith("host.describe")) value = { version: "0.0.1" };
      if (url.pathname.endsWith("llm.models")) value = {
        groups: [{ id: "gpt", name: "GPT", models: [{ id: "gpt-5.6-luna", name: "GPT-5.6-Luna" }] }],
        failures: [],
      };
      if (url.pathname.endsWith("agentPreset.list")) value = {
        presets: [{ id: "standard", trust: "system", isDefault: true }],
        authorable: true,
        hasDocument: true,
      };
      if (url.pathname.endsWith("agentPreset.read")) value = {
        agentPreset: "standard",
        trust: "system",
        content: "- id: tool-pwsh\n  name: '@deepseek-ai/dsh-tool-pwsh'\n",
      };
      if (url.pathname.endsWith("session.create")) value = { sessionId: "session-fixture" };
      if (url.pathname.endsWith("session.selectModel")) value = { selected: body.payload };
      if (url.pathname.endsWith("session.attachment")) value = {
        attachment: { mediaType: "image/png" },
        data: "cG5nLWZyYW1l",
      };
      if (url.pathname.endsWith("session.prompt") || url.pathname.endsWith("session.cancel")) value = { accepted: true };
      return Response.json({ type: "server-response", rpcId: body.rpcId, result: { ok: true, value } });
    }));
  });

  afterEach(() => {
    calls.length = 0;
    vi.unstubAllGlobals();
  });

  it("uses the shared app-data discovery location on Windows", () => {
    expect(defaultRuijieBridgePath("win32", { APPDATA: "C:\\Users\\test\\AppData\\Roaming" }, "C:\\Users\\test"))
      .toBe("C:\\Users\\test\\AppData\\Roaming\\锐捷 Harness\\openmaus-bridge.json");
  });

  it("reports the same SSO identity and wallet as the running Harness", async () => {
    const instance = await RuijieHarnessDriver.create({
      instanceId: "ruijieHarness", displayName: "锐捷 Harness", enabled: true, environment: {},
      config: { endpoint: "http://127.0.0.1:49724", expectedAccountEmail: "wangyunshang@ruijie.com.cn" },
    });

    expect(await instance.snapshot()).toMatchObject({
      state: "available",
      authenticated: true,
      sso: {
        authentication: "sso",
        account: { id: "608", name: "王允尚", email: "wangyunshang@ruijie.com.cn" },
        billing: { currency: "CNY", remaining: 75 },
      },
    });
  });

  it("forwards a turn through the live Harness session API and maps its result", async () => {
    const instance = await RuijieHarnessDriver.create({
      instanceId: "ruijieHarness", displayName: "锐捷 Harness", enabled: true, environment: {},
      config: { endpoint: "http://127.0.0.1:49724", expectedAccountEmail: "wangyunshang@ruijie.com.cn" },
    });
    const events: RuntimeEvent[] = [];
    instance.adapter.onEvent((event) => events.push(event));
    await instance.refreshModels?.();
    const started = await instance.adapter.sendTurn({ threadId: "thread-1", text: "你好", model: "gpt::gpt-5.6-luna", cwd: "C:\\work" });

    const socket = FakeSocket.instances[0]!;
    socket.frame({ type: "session/event", sessionId: "session-fixture", event: { type: "turn/start", data: { turn: 1 } } });
    socket.frame({ type: "session/event", sessionId: "session-fixture", event: { type: "assistant/chunk", data: { turn: 1, chunk: { type: "text-delta", text: "完成" } } } });
    socket.frame({ type: "session/event", sessionId: "session-fixture", event: { type: "assistant/message", data: { turn: 1, message: { content: [{ type: "text", text: "完成" }] } } } });
    socket.frame({ type: "session/event", sessionId: "session-fixture", event: { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } } });

    expect(calls.map((call) => call.method)).toEqual([
      "llm.models", "session.create", "session.selectModel", "session.prompt",
    ]);
    expect(calls.find((call) => call.method === "session.create")?.payload).toEqual({ cwd: "C:\\work" });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "session.started", sessionId: "session-fixture", turnId: started.turnId }),
      expect.objectContaining({ type: "content.delta", delta: "完成" }),
      expect.objectContaining({ type: "item.completed", itemType: "assistant_text", text: "完成" }),
      expect.objectContaining({ type: "turn.completed", ok: true, stopReason: "completed" }),
    ]));
  });

  it("emits the target-window screenshot returned by a CUA observation", async () => {
    const instance = await RuijieHarnessDriver.create({
      instanceId: "ruijieHarness", displayName: "锐捷 Harness", enabled: true, environment: {},
      config: { endpoint: "http://127.0.0.1:49724", expectedAccountEmail: "wangyunshang@ruijie.com.cn" },
    });
    const events: RuntimeEvent[] = [];
    instance.adapter.onEvent((event) => events.push(event));
    const started = await instance.adapter.sendTurn({ threadId: "thread-screen", text: "演示", cwd: "C:\\work" });
    const socket = FakeSocket.instances[0]!;
    const callId = "call-screen";
    socket.frame({ type: "session/event", sessionId: "session-fixture", event: {
      type: "tool/call", data: { turn: 1, callId, name: "mcp__computer__get_window_state" },
    } });
    socket.frame({ type: "session/event", sessionId: "session-fixture", event: {
      type: "tool/result", data: { turn: 1, message: {
        source: { kind: "tool", callId },
        content: [{ type: "tool-result", toolCallId: callId, content: [{
          type: "image",
          attachment: { attachmentId: `sha256:${"b".repeat(64)}`, mediaType: "image/png" },
        }] }],
      } },
    } });
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
      type: "screen.frame",
      threadId: "thread-screen",
      turnId: started.turnId,
      png: "cG5nLWZyYW1l",
      mime: "image/png",
    })));
    expect(calls).toContainEqual({
      method: "session.attachment",
      payload: { sessionId: "session-fixture", attachmentId: `sha256:${"b".repeat(64)}` },
    });
  });

  it("mounts OpenMaus computer MCP through a managed Harness user preset", async () => {
    const dshHome = await mkdtemp(join(tmpdir(), "openmaus-rjh-test-"));
    try {
      const instance = await RuijieHarnessDriver.create({
        instanceId: "ruijieHarness", displayName: "锐捷 Harness", enabled: true, environment: {},
        config: {
          endpoint: "http://127.0.0.1:49724",
          expectedAccountEmail: "wangyunshang@ruijie.com.cn",
          dshHome,
        },
      });

      expect(instance.adapter.capabilities).toMatchObject({ computerMcp: true, localComputerMcp: true });
      await instance.adapter.sendTurn({
        threadId: "thread-computer",
        text: "查看桌面",
        cwd: "C:\\work",
        integrations: {
          localComputer: {
            command: "C:\\OpenMaus\\cua-driver.exe",
            args: ["mcp", "--socket", "C:\\Temp\\cua.sock"],
            env: { OMB_CONTROL_TOKEN: "secret" },
            scope: "local-computer",
          },
        },
      });

      const create = calls.find((call) => call.method === "session.create");
      expect(create?.payload).toMatchObject({ cwd: "C:\\work", agentPreset: expect.stringMatching(/^openmaus-computer-/) });
      const preset = await readFile(join(dshHome, ".agent-presets", create!.payload.agentPreset, "agent.cordis.yml"), "utf8");
      expect(preset).toContain("@deepseek-ai/dsh-mcp-client");
      expect(preset).toContain('command: "C:\\\\OpenMaus\\\\cua-driver.exe"');
      expect(preset).toContain('"OMB_CONTROL_TOKEN":"secret"');
    } finally {
      await rm(dshHome, { recursive: true, force: true });
    }
  });

  it("uses a distinct computer MCP preset for each Harness session", async () => {
    const dshHome = await mkdtemp(join(tmpdir(), "openmaus-rjh-test-"));
    try {
      const instance = await RuijieHarnessDriver.create({
        instanceId: "ruijieHarness", displayName: "锐捷 Harness", enabled: true, environment: {},
        config: {
          endpoint: "http://127.0.0.1:49724",
          expectedAccountEmail: "wangyunshang@ruijie.com.cn",
          dshHome,
        },
      });
      const localComputer = {
        command: "C:\\OpenMaus\\cua-driver.exe",
        args: ["mcp", "--direct"],
        env: { OMB_CONTROL_TOKEN: "secret" },
        scope: "local-computer" as const,
      };

      await instance.adapter.sendTurn({
        threadId: "thread-computer-a", text: "查看桌面", cwd: "C:\\work",
        integrations: { localComputer },
      });
      await instance.adapter.sendTurn({
        threadId: "thread-computer-b", text: "查看桌面", cwd: "C:\\work",
        integrations: { localComputer },
      });

      const creates = calls.filter((call) => call.method === "session.create");
      expect(creates).toHaveLength(2);
      expect(creates[0]?.payload.agentPreset).not.toBe(creates[1]?.payload.agentPreset);
    } finally {
      await rm(dshHome, { recursive: true, force: true });
    }
  });

  it("does not reuse a mounted computer MCP name after the driver restarts", async () => {
    const dshHome = await mkdtemp(join(tmpdir(), "openmaus-rjh-test-"));
    try {
      const createInstance = () => RuijieHarnessDriver.create({
        instanceId: "ruijieHarness", displayName: "锐捷 Harness", enabled: true, environment: {},
        config: {
          endpoint: "http://127.0.0.1:49724",
          expectedAccountEmail: "wangyunshang@ruijie.com.cn",
          dshHome,
        },
      });
      const localComputer = {
        command: "C:\\OpenMaus\\cua-driver.exe",
        args: ["mcp", "--direct"],
        env: { OMB_CONTROL_TOKEN: "secret" },
        scope: "local-computer" as const,
      };

      const first = await createInstance();
      await first.adapter.sendTurn({
        threadId: "thread-computer-retry", text: "查看桌面", cwd: "C:\\work",
        integrations: { localComputer },
      });
      const firstPreset = calls.filter((call) => call.method === "session.create").at(-1)!.payload.agentPreset;

      const restarted = await createInstance();
      await restarted.adapter.sendTurn({
        threadId: "thread-computer-retry", text: "重试", cwd: "C:\\work",
        integrations: { localComputer },
      });
      const secondPreset = calls.filter((call) => call.method === "session.create").at(-1)!.payload.agentPreset;

      expect(firstPreset).not.toBe(secondPreset);
      const firstDocument = await readFile(join(dshHome, ".agent-presets", firstPreset, "agent.cordis.yml"), "utf8");
      const secondDocument = await readFile(join(dshHome, ".agent-presets", secondPreset, "agent.cordis.yml"), "utf8");
      const serverName = (document: string) => document.match(/serverName: (\S+)/)?.[1];
      expect(serverName(firstDocument)).toBeTruthy();
      expect(serverName(firstDocument)).not.toBe(serverName(secondDocument));
    } finally {
      await rm(dshHome, { recursive: true, force: true });
    }
  });

  it("uses a fresh computer MCP name when retrying a failed session creation", async () => {
    const dshHome = await mkdtemp(join(tmpdir(), "openmaus-rjh-test-"));
    try {
      const instance = await RuijieHarnessDriver.create({
        instanceId: "ruijieHarness", displayName: "锐捷 Harness", enabled: true, environment: {},
        config: {
          endpoint: "http://127.0.0.1:49724",
          expectedAccountEmail: "wangyunshang@ruijie.com.cn",
          dshHome,
        },
      });
      const turn = {
        threadId: "thread-computer-retry", text: "重试", cwd: "C:\\work",
        integrations: {
          localComputer: {
            command: "C:\\OpenMaus\\cua-driver.exe",
            args: ["mcp", "--direct"],
            env: { OMB_CONTROL_TOKEN: "secret" },
            scope: "local-computer" as const,
          },
        },
      };

      sessionCreateFailuresRemaining = 1;
      await expect(instance.adapter.sendTurn(turn)).rejects.toThrow("preset failed to mount");
      await instance.adapter.sendTurn(turn);

      const presets = calls
        .filter((call) => call.method === "session.create")
        .map((call) => call.payload.agentPreset);
      expect(presets).toHaveLength(2);
      expect(presets[0]).not.toBe(presets[1]);
    } finally {
      await rm(dshHome, { recursive: true, force: true });
    }
  });

  it("treats Stop as an interruption and emits no red runtime error", async () => {
    const instance = await RuijieHarnessDriver.create({
      instanceId: "ruijieHarness", displayName: "锐捷 Harness", enabled: true, environment: {},
      config: { endpoint: "http://127.0.0.1:49724", expectedAccountEmail: "wangyunshang@ruijie.com.cn" },
    });
    const events: RuntimeEvent[] = [];
    instance.adapter.onEvent((event) => events.push(event));
    const started = await instance.adapter.sendTurn({ threadId: "thread-stop", text: "等待" });
    await instance.adapter.interruptTurn("thread-stop", started.turnId);
    await vi.waitFor(() => expect(calls.some((call) => call.method === "session.cancel")).toBe(true));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "turn.completed", ok: false, stopReason: "interrupted" }),
    ]));
    expect(events.some((event) => event.type === "runtime.error")).toBe(false);
  });

  it("disables Harness when its SSO identity does not match OpenMaus", async () => {
    const instance = await RuijieHarnessDriver.create({
      instanceId: "ruijieHarness", displayName: "锐捷 Harness", enabled: true, environment: {},
      config: { endpoint: "http://127.0.0.1:49724", expectedAccountEmail: "someone.else@ruijie.com.cn" },
    });
    expect(await instance.snapshot()).toMatchObject({
      state: "unavailable",
      authenticated: false,
      reason: expect.stringContaining("账号与 OpenMaus 不一致"),
    });
  });
});

describe("Ruijie Harness computer frames", () => {
  it("finds a CUA screenshot attachment inside a nested tool result", () => {
    expect(toolResultImageAttachment({
      message: {
        content: [{
          type: "tool-result",
          content: [{
            type: "image",
            attachment: {
              attachmentId: `sha256:${"a".repeat(64)}`,
              mediaType: "image/png",
            },
          }],
        }],
      },
    })).toEqual({
      attachmentId: `sha256:${"a".repeat(64)}`,
      mime: "image/png",
    });
  });
});
