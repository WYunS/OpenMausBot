import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeishuSetup as FeishuCard } from "./FeishuCard";
import {
  feishuActionAllowed, feishuBotLocked, feishuConnected, feishuErrorMessage, feishuLoginUrl, feishuVisible,
  type FeishuPhase, type FeishuSnapshot, type FeishuState,
} from "./model";
import { createFeishuSession } from "./session";
import { feishuCopy as copy } from "../l10n/feishu";

const state: FeishuState = {
  supported: true, cliPath: "C:\\tools\\feishu.exe", nodePath: "C:\\tools\\node.exe",
  botId: "bot-1", im: "off", toolsEnabled: false, userAuthorized: false, botAuthorized: false,
};
const snapshot = (patch: Partial<FeishuState> = {}): FeishuSnapshot => ({ state: { ...state, ...patch }, busy: null, error: null });

afterEach(() => {
  vi.useRealTimers();
});

describe("native Feishu inventory and guards", () => {
  it("covers every safe controller error code with frontend-owned Chinese copy", () => {
    const source = readFileSync(new URL("../../../connectors/feishu/index.mjs", import.meta.url), "utf8");
    const errors = source.match(/const ERRORS = \{([\s\S]*?)\n\};/)?.[1];
    expect(errors).toBeDefined();
    const codes = [...errors!.matchAll(/^\s+([A-Z_]+):/gm)].map((match) => match[1]);
    expect(codes).toContain("SCOPE_REQUIRED");
    for (const code of codes) expect(feishuErrorMessage(code), code).not.toBe(copy.actionFailed);
  });

  it("matches controller and runtime phase names without using backend text", () => {
    const phases = ["detecting", "downloadingCli", "downloadingNode", "verifyingRuntime", "openingApp", "creatingApp", "checkingApp", "openingAuthorization", "authorizing", "verifyingIdentity", "preparingSession", "starting", "ready", "error"] as const satisfies readonly FeishuPhase[];
    expect(Object.keys(copy.phase).sort()).toEqual([...phases].sort());
    for (const file of ["index.mjs", "runtime.mjs"]) {
      const source = readFileSync(new URL(`../../../connectors/feishu/${file}`, import.meta.url), "utf8");
      const emitted = [...source.matchAll(/(?:phase\(|view\.phase = )'([a-zA-Z]+)'/g)].map((match) => match[1]);
      expect(emitted.length).toBeGreaterThan(0);
      for (const phase of emitted) expect(phases).toContain(phase);
    }
  });

  it("keeps code-only errors recoverable and never counts them as connected", () => {
    expect(feishuConnected({ ...state, im: "ready", toolsEnabled: true, errorCode: "SCOPE_REQUIRED" })).toBeNull();
    expect(feishuVisible("", "connected", { ...state, cliPath: "", errorCode: "DOWNLOAD_FAILED" })).toBe(true);
  });

  it("counts only both capabilities ready, never partial, pending or pairing states", () => {
    expect(feishuConnected(null)).toBeNull();
    expect(feishuConnected({ ...state, error: "inspect failed" })).toBeNull();
    expect(feishuConnected({ ...state, im: "ready" }, copy.readFailed)).toBeNull();
    expect(feishuConnected({ ...state, userAuthorized: true, ownerOpenId: "owner" })).toBe(false);
    for (const im of ["off", "starting", "reconnecting", "error"] as const) {
      expect(feishuConnected({ ...state, im })).toBe(false);
    }
    expect(feishuConnected({ ...state, im: "ready" })).toBe(false);
    expect(feishuConnected({ ...state, im: "ready", pairingCode: "123456" })).toBe(false);
    expect(feishuConnected({ ...state, im: "ready", pairingCode: "123456", toolsEnabled: true })).toBe(false);
    expect(feishuConnected({ ...state, toolsEnabled: true })).toBe(false);
    expect(feishuConnected({ ...state, im: "ready", toolsEnabled: true })).toBe(true);
    expect(feishuConnected({ ...state, im: "ready", toolsEnabled: true, pending: true })).toBe(false);
    expect(feishuConnected({ ...state, im: "ready", toolsEnabled: true, phase: "error" })).toBeNull();
    expect(feishuConnected({ ...state, supported: false, im: "ready" })).toBe(false);
  });

  it("searches all three names independently of Composio and filters honestly", () => {
    for (const search of ["", "飞书", "feishu", " LARK "]) {
      expect(feishuVisible(search, "marketplace", null)).toBe(true);
      expect(feishuVisible(search, "connected", null)).toBe(false);
      expect(feishuVisible(search, "connected", { ...state, im: "ready" })).toBe(true);
    }
    expect(feishuVisible("slack", "marketplace", state)).toBe(false);
  });

  it("retains configured, pairing, reconnecting and unknown cards for recovery without inflating counts", () => {
    for (const recoverable of [state, { ...state, im: "reconnecting" as const },
      { ...state, im: "error" as const }, { ...state, error: "inspect failed" },
      { ...state, im: "ready" as const, pairingCode: "123456" }]) {
      expect(feishuVisible("", "connected", recoverable)).toBe(true);
      expect(feishuConnected(recoverable)).not.toBe(true);
    }
    expect(feishuVisible("", "connected", null, copy.readFailed)).toBe(true);
    expect(feishuVisible("", "connected", { ...state, cliPath: "" })).toBe(false);
    expect(feishuVisible("", "connected", { ...state, supported: false })).toBe(false);
  });

  it("requires a visible selected bot, bot authorization and a paired owner to connect", () => {
    expect(feishuActionAllowed("connect", snapshot(), "bot-1", true)).toBe(false);
    const paired = snapshot({ botAuthorized: true, ownerOpenId: "owner" });
    expect(feishuActionAllowed("connect", paired, "bot-1", true)).toBe(true);
    expect(feishuActionAllowed("connect", paired, "", true)).toBe(false);
    expect(feishuActionAllowed("connect", paired, "bot-1", false)).toBe(false);
    expect(feishuActionAllowed("connect", { ...paired, busy: "pair" }, "bot-1", true)).toBe(false);
    expect(feishuActionAllowed("connect", snapshot({ pending: true }), "bot-1", true)).toBe(false);
    expect(feishuActionAllowed("disconnect", snapshot({ pending: true }), "bot-1", true)).toBe(true);
  });

  it("requires local Node and user authorization for tools but not for IM", () => {
    expect(feishuActionAllowed("enableTools", snapshot(), "bot-1", true)).toBe(false);
    expect(feishuActionAllowed("enableTools", snapshot({ userAuthorized: true, nodePath: "" }), "bot-1", true)).toBe(false);
    expect(feishuActionAllowed("enableTools", snapshot({ userAuthorized: true }), "bot-1", true)).toBe(true);
    expect(feishuActionAllowed("enableTools", snapshot({ userAuthorized: true }), "", true)).toBe(true);
    expect(feishuActionAllowed("connect", snapshot({ botAuthorized: true, ownerOpenId: "owner", nodePath: "" }), "bot-1", true)).toBe(true);
  });

  it("allows pairing and choosing a bot with only personal tools enabled", () => {
    const tools = snapshot({ toolsEnabled: true, botAuthorized: true });
    expect(feishuBotLocked(tools.state)).toBe(false);
    expect(feishuActionAllowed("pair", tools, "bot-1", true)).toBe(true);
    for (const im of ["ready", "starting", "reconnecting"] as const) {
      expect(feishuBotLocked({ ...state, toolsEnabled: true, im })).toBe(true);
      expect(feishuActionAllowed("pair", snapshot({ toolsEnabled: true, botAuthorized: true, im }), "bot-1", true)).toBe(false);
    }
    for (const patch of [{ pairingCode: "123456" }, { pending: true }]) {
      expect(feishuActionAllowed("pair", snapshot({ toolsEnabled: true, botAuthorized: true, ...patch }), "bot-1", true)).toBe(false);
    }
  });

  it("keeps relevant stop controls available during long native operations", () => {
    for (const busy of ["completeLogin", "login", "enableTools"] as const) {
      const waiting = { ...snapshot({ pending: true }), busy };
      expect(feishuActionAllowed("disconnect", waiting, "", true)).toBe(true);
      expect(feishuActionAllowed("disableTools", waiting, "", true)).toBe(true);
      expect(feishuActionAllowed("probe", waiting, "", true)).toBe(false);
    }
    expect(feishuActionAllowed("disableTools", snapshot(), "", true)).toBe(false);
    expect(feishuActionAllowed("disableTools", { ...snapshot({ toolsEnabled: true }), busy: "disconnect" }, "", true)).toBe(false);
    expect(feishuActionAllowed("disconnect", { ...snapshot(), busy: "disconnect" }, "", true)).toBe(false);
  });

  it("allows recovery and stopping when an inspection failed", () => {
    const failed = { ...snapshot(), error: copy.readFailed };
    expect(feishuActionAllowed("probe", failed, "", true)).toBe(true);
    expect(feishuActionAllowed("disconnect", failed, "", true)).toBe(true);
    expect(feishuActionAllowed("pair", failed, "bot-1", true)).toBe(false);
  });

  it("connects without preinstalled components or authorization, but never without a bot", () => {
    const fresh = snapshot({ cliPath: "", nodePath: "", botId: "" });
    for (const action of ["oneClickConnect", "selectBot"] as const) {
      expect(feishuActionAllowed(action, fresh, "bot-1", true)).toBe(true);
      expect(feishuActionAllowed(action, { state: null, busy: null, error: copy.readFailed }, "bot-1", true)).toBe(true);
      expect(feishuActionAllowed(action, fresh, "", true)).toBe(false);
      expect(feishuActionAllowed(action, fresh, "bot-1", false)).toBe(false);
      expect(feishuActionAllowed(action, snapshot({ supported: false }), "bot-1", true)).toBe(false);
      expect(feishuActionAllowed(action, snapshot({ pending: true }), "bot-1", true)).toBe(false);
      expect(feishuActionAllowed(action, { ...fresh, busy: "oneClickConnect" }, "bot-1", true)).toBe(false);
      expect(feishuActionAllowed(action, snapshot({ error: "failed", phase: "error" }), "bot-1", true)).toBe(true);
    }
    expect(feishuActionAllowed("selectBot", snapshot({ im: "ready", toolsEnabled: true }), "bot-2", true)).toBe(true);
    for (const busy of ["oneClickConnect", "selectBot"] as const) {
      expect(feishuActionAllowed("disconnect", { ...snapshot({ pending: true }), busy }, "", true)).toBe(true);
    }
  });

  it("rejects unsafe authorization links", () => {
    for (const url of ["javascript:alert(1)", "file:///secret", "http://example.com", "https://user:pass@example.com", "not a url"]) {
      expect(feishuLoginUrl(url)).toBeNull();
    }
    expect(feishuLoginUrl("https://accounts.feishu.cn/login")).toBe("https://accounts.feishu.cn/login");
  });
});

describe("native Feishu card markup", () => {
  const render = (native: FeishuSnapshot, available = true) => renderToStaticMarkup(createElement(FeishuCard, {
    native: { ...native, available, invoke: vi.fn() },
    bots: [{ id: "bot-1", name: "Visible bot" }, { id: "hidden", name: "Hidden bot", hidden: true }],
    selectedBotId: "bot-1",
  }));

  it("discloses automatic office execution and workspace scope without claiming per-call prompts", () => {
    const html = render(snapshot({ im: "ready", toolsEnabled: true }));
    expect(html).toContain("使用已授权账号自动执行");
    expect(html).toContain("对工作区所有 bot 生效");
    expect(html).toContain("断开连接即停用");
    expect(html).not.toContain("每次办公调用仍需本机确认");
  });

  it.each(["CONFIG_EXISTS", "CONFIG_NOT_EMPTY"])("allows explicit safe recreation for %s", (errorCode) => {
    expect(feishuActionAllowed("recreateApp", snapshot({ errorCode, phase: "error" }), "bot-1", true)).toBe(true);
  });

  it("stays visible without a native bridge and does not add a nested modal", () => {
    const html = render({ state: null, busy: null, error: null }, false);
    expect(html).toContain(copy.title);
    expect(html).toContain(copy.unsupported);
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain(copy.inactive);
  });

  it("shows disclosure and capabilities without manual setup, paths, private links or codes", () => {
    const html = render(snapshot({ pairingCode: "123456", login: { url: "https://private.example/auth", userCode: "ABCD" } }));
    for (const text of [copy.disclosure, copy.disconnectHelp, copy.botLabel, copy.imLabel, copy.toolsLabel]) {
      expect(html).toContain(text);
    }
    for (const text of [state.cliPath, state.nodePath, "cliPath", "nodePath", "CLI", "node.exe", "lark-cli config", "123456", "ABCD", "https://private.example", "配对码", "完成授权", "重新检测", "设置飞书", "启用办公工具"]) {
      expect(html).not.toContain(text);
    }
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<code");
    expect(html).toContain("Visible bot");
    expect(html).not.toContain("Hidden bot");
    expect(html).toMatch(/<label for="[^"]+-bot"/);
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("<input");
    expect(html).not.toContain('role="dialog"');
  });

  it("labels a ready pairing listener as identity unconfirmed rather than connected", () => {
    const html = render(snapshot({ im: "ready", pairingCode: "123456" }));
    expect(html).toContain(copy.verifyingIdentity);
    expect(html).not.toContain(`>${copy.connected}<`);
    expect(html).not.toContain(`${copy.imLabel}: ${copy.im.ready}`);
    expect(html).toContain(copy.partial);
  });

  it.each(["oneClickConnect", "selectBot", "completeLogin", null] as const)("renders cancel during %s and native pending", (busy) => {
    const html = render({ ...snapshot({ pending: true, phase: "authorizing" }), busy });
    const button = html.match(new RegExp(`<button[^>]*>${copy.cancel}</button>`))?.[0];
      expect(button).toBeDefined();
      expect(button).not.toContain(' disabled=""');
    expect(html).toContain(copy.phase.authorizing);
    expect(html).toContain(copy.browserHelp);
    expect(html).toMatch(/<select[^>]* disabled=""/);
    expect(html.match(/<button[^>]*>([^<]+)<\/button>/g)).toHaveLength(2);
  });

  it("offers retry without echoing raw native diagnostics", () => {
    const html = render(snapshot({ error: "inspect failed: C:\\private\\data https://private.example/token" }));
    expect(html).toContain(copy.retry);
    expect(html).not.toContain(copy.inactive);
    expect(html).not.toContain("private");
    expect(html).toContain('role="alert"');
  });

  it("explains pending enterprise approval using the controller code, never its raw error", () => {
    const failed = { ...state, errorCode: "SCOPE_REQUIRED", error: "private diagnostic", phase: "error" as const };
    const html = render({ state: failed, busy: null, error: null });
    expect(html).toContain("飞书权限或企业审批尚未完成，已打开官方页面；完成后重试");
    expect(html).not.toContain("private diagnostic");
    expect(html).not.toContain(`>${copy.connected}<`);
    expect(html).toContain(copy.retry);
  });

  it.each(Object.entries(copy.errors))("renders localized controller error %s without exposing diagnostic fields", (errorCode, message) => {
    const html = render(snapshot({ errorCode, error: "private raw text https://private.example/token", phase: "error",
      cliPath: "C:\\private\\cli.exe", nodePath: "C:\\private\\node.exe", ownerOpenId: "private-owner",
      pairingCode: "private-pair", login: { url: "https://private.example/auth", userCode: "private-code" } }));
    expect(html).toContain(message);
    expect(html).not.toContain("private");
    expect(html).not.toContain(errorCode);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain(`>${copy.connected}<`);
    expect(html).not.toContain(copy.browserHelp);
    expect([...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])).toEqual(
      ["APP_UNAVAILABLE", "CONFIG_EXISTS", "CONFIG_NOT_EMPTY"].includes(errorCode)
        ? [copy.recreate, copy.retry, copy.disconnect] : [copy.retry, copy.disconnect]);
  });

  it.each(["constructor", "__proto__", "toString", "SCOPE_REQUIRED private", "https://private.example/token", undefined])("falls back safely for unknown code %s", (errorCode) => {
    expect(feishuErrorMessage(errorCode)).toBe(copy.actionFailed);
    const html = render(snapshot({ errorCode, error: "private backend error" }));
    expect(html).toContain(copy.actionFailed);
    expect(html).not.toContain("private");
  });

  it("uses a code-only failure instead of a stale ready phase and preserves cancellation", () => {
    const html = render({ ...snapshot({ errorCode: "SCOPE_REQUIRED", phase: "ready", im: "ready", toolsEnabled: true, pending: true }), busy: "oneClickConnect" });
    expect(html).toContain(copy.errors.SCOPE_REQUIRED);
    expect(html).not.toContain(`>${copy.connected}<`);
    expect(html.match(new RegExp(`<button[^>]*>${copy.cancel}</button>`))?.[0]).not.toContain(' disabled=""');
    expect(html.match(new RegExp(`<button[^>]*>${copy.retry}</button>`))?.[0]).toContain(' disabled=""');
  });

  it("does not show stale recovery instructions after a bridge read failure", () => {
    const html = render({ ...snapshot({ errorCode: "SCOPE_REQUIRED" }), error: copy.readFailed });
    expect(html).toContain(copy.readFailed);
    expect(html).not.toContain(copy.errors.SCOPE_REQUIRED);
  });

  it("only exposes the initial connect button and connected disconnect button", () => {
    const fresh = render(snapshot({ cliPath: "", nodePath: "" }));
    expect([...fresh.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])).toEqual([copy.connect]);
    const ready = render(snapshot({ im: "ready", toolsEnabled: true, phase: "ready" }));
    expect([...ready.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])).toEqual([copy.disconnect]);
    expect(ready).not.toMatch(/<select[^>]* disabled=""/);
  });

  it.each([{ im: "ready" as const }, { toolsEnabled: true }])("keeps partial capability status visible: %j", (patch) => {
    const html = render(snapshot(patch));
    expect(html).toContain(copy.partial);
    expect(html).toContain(patch.im ? copy.im.ready : copy.toolsOn);
    expect(html).toContain(copy.connect);
    expect(html).toContain(copy.disconnect);
    expect(html).not.toContain(`>${copy.connected}<`);
  });

  it.each(Object.entries(copy.phase).filter(([phase]) => !["ready", "error"].includes(phase)))("announces phase %s", (phase, text) => {
    const html = render({ ...snapshot({ pending: true, phase: phase as FeishuState["phase"] }), busy: "oneClickConnect" });
    expect(html).toContain(`>${text}</p>`);
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
  });

  it("does not report ready from phase alone", () => {
    const html = render(snapshot({ phase: "ready" }));
    expect(html).not.toContain(`>${copy.connected}<`);
    expect(html).toContain(copy.connect);
  });

  it("uses shrinkable full-width selection and stacks capabilities on narrow screens", () => {
    const html = render(snapshot());
    expect(html).toMatch(/<select[^>]*class="[^"]*w-full min-w-0 max-w-full/);
    expect(html).toMatch(/<dl class="[^"]*grid min-w-0 gap-2[^"]*sm:grid-cols-2/);
    expect(html).toContain("flex flex-wrap gap-2");
    expect(html).not.toMatch(/(?:min-w|w)-\[\d+px\]/);
  });
});

describe("mounted native Feishu session", () => {
  it("shows fresh progress immediately on retry and polls setup within 400ms", async () => {
    vi.useFakeTimers();
    let finish!: (value: FeishuState) => void;
    const publish = vi.fn();
    const read = vi.fn().mockResolvedValueOnce({ ...state, errorCode: "MCP_CONFLICT", phase: "error", im: "error" })
      .mockResolvedValue({ ...state, pending: true, phase: "creatingApp" });
    const session = createFeishuSession({ state: read, invoke: () => new Promise((resolve) => { finish = resolve; }) }, publish);
    await Promise.resolve();
    const pending = session.invoke("oneClickConnect");
    expect(publish.mock.lastCall?.[0]).toMatchObject({ busy: "oneClickConnect", state: {
      phase: "detecting", pending: true, errorCode: undefined, im: "off",
    } });
    await vi.advanceTimersByTimeAsync(400);
    expect(publish.mock.lastCall?.[0].state.phase).toBe("creatingApp");
    finish(state);
    await pending;
    session.dispose();
  });

  it("publishes interim phases without clearing action busy, and discards an interim read after completion", async () => {
    vi.useFakeTimers();
    let resolveAction!: (value: FeishuState) => void;
    let resolvePoll!: (value: FeishuState) => void;
    const publish = vi.fn();
    const read = vi.fn().mockResolvedValueOnce(state)
      .mockResolvedValueOnce({ ...state, pending: true, phase: "downloadingCli" })
      .mockResolvedValueOnce({ ...state, pending: true, phase: "authorizing" })
      .mockImplementationOnce(() => new Promise<FeishuState>((resolve) => { resolvePoll = resolve; }));
    const invoke = vi.fn(() => new Promise<FeishuState>((resolve) => { resolveAction = resolve; }));
    const session = createFeishuSession({ state: read, invoke }, publish);
    await Promise.resolve();
    const connecting = session.invoke("oneClickConnect", { botId: "bot-1" });
    for (const phase of ["downloadingCli", "authorizing"]) {
      await vi.advanceTimersByTimeAsync(400);
      expect(publish.mock.lastCall?.[0]).toMatchObject({ busy: "oneClickConnect", state: { phase }, error: null });
      await session.invoke("selectBot", { botId: "bot-2" });
      expect(invoke).toHaveBeenCalledTimes(1);
    }
    await vi.advanceTimersByTimeAsync(400);
    const ready = { ...state, im: "ready" as const, toolsEnabled: true, pending: false, phase: "ready" as const };
    resolveAction(ready);
    await connecting;
    const calls = publish.mock.calls.length;
    resolvePoll({ ...state, pending: true, phase: "authorizing" });
    await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(calls);
    expect(publish.mock.lastCall?.[0]).toEqual({ state: ready, busy: null, error: null });
    session.dispose();
  });

  it.each([false, true])("cancellation discards stale progress and late connection result (failure: %s)", async (fail) => {
    vi.useFakeTimers();
    let resolveAction!: (value: FeishuState) => void;
    let rejectAction!: (error: Error) => void;
    let resolvePoll!: (value: FeishuState) => void;
    let resolveStop!: (value: FeishuState) => void;
    const publish = vi.fn();
    const read = vi.fn().mockResolvedValueOnce(state)
      .mockImplementationOnce(() => new Promise<FeishuState>((resolve) => { resolvePoll = resolve; }))
      .mockResolvedValue(state);
    const invoke = vi.fn()
      .mockImplementationOnce(() => new Promise<FeishuState>((resolve, reject) => { resolveAction = resolve; rejectAction = reject; }))
      .mockImplementationOnce(() => new Promise<FeishuState>((resolve) => { resolveStop = resolve; }));
    const session = createFeishuSession({ state: read, invoke }, publish);
    await Promise.resolve();
    const connecting = session.invoke("oneClickConnect", { botId: "bot-1" });
    await vi.advanceTimersByTimeAsync(2000);
    const stopping = session.invoke("disconnect");
    const calls = publish.mock.calls.length;
    resolvePoll({ ...state, pending: true, phase: "authorizing" });
    if (fail) rejectAction(new Error("private failure"));
    else resolveAction({ ...state, im: "ready", toolsEnabled: true, phase: "ready" });
    await connecting;
    await vi.advanceTimersByTimeAsync(2000);
    expect(publish).toHaveBeenCalledTimes(calls);
    expect(publish.mock.lastCall?.[0].busy).toBe("disconnect");
    expect(read).toHaveBeenCalledTimes(2);
    resolveStop(state);
    await stopping;
    await vi.advanceTimersByTimeAsync(2000);
    expect(publish.mock.lastCall?.[0]).toEqual({ state, busy: null, error: null });
    session.dispose();
  });

  it("keeps polling a native pending operation after invoke returns", async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const authorizing = { ...state, pending: true, phase: "authorizing" as const };
    const session = createFeishuSession({ state: vi.fn().mockResolvedValue(authorizing), invoke: vi.fn().mockResolvedValue({ ...state, pending: true, phase: "detecting" }) }, publish);
    await session.invoke("oneClickConnect", { botId: "bot-1" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(publish.mock.lastCall?.[0]).toEqual({ state: authorizing, busy: null, error: null });
    session.dispose();
  });

  it.each(["disconnect", "disableTools"] as const)("%s interrupts completeLogin and ignores late success or failure", async (stop) => {
    vi.useFakeTimers();
    for (const fail of [false, true]) {
      let resolveLogin!: (value: FeishuState) => void;
      let rejectLogin!: (error: Error) => void;
      let resolveStop!: (value: FeishuState) => void;
      const publish = vi.fn();
      const stopped = { ...state, login: undefined, pending: false };
      const invoke = vi.fn()
        .mockImplementationOnce(() => new Promise<FeishuState>((resolve, reject) => { resolveLogin = resolve; rejectLogin = reject; }))
        .mockImplementationOnce(() => new Promise<FeishuState>((resolve) => { resolveStop = resolve; }));
      const read = vi.fn().mockResolvedValue(stopped);
      const session = createFeishuSession({ state: read, invoke }, publish);
      await Promise.resolve();
      const login = session.invoke("completeLogin");
      const stopping = session.invoke(stop);
      expect(invoke).toHaveBeenCalledTimes(2);
      await session.invoke(stop);
      expect(invoke).toHaveBeenCalledTimes(2);
      const calls = publish.mock.calls.length;
      if (fail) rejectLogin(new Error("cancelled"));
      else resolveLogin({ ...state, userAuthorized: true, pending: true });
      await login;
      expect(publish).toHaveBeenCalledTimes(calls);
      expect(publish.mock.lastCall?.[0].busy).toBe(stop);
      resolveStop(stopped);
      await stopping;
      expect(publish.mock.lastCall?.[0]).toEqual({ state: stopped, busy: null, error: null });
      await vi.advanceTimersByTimeAsync(2000);
      expect(read).toHaveBeenCalledTimes(2);
      session.dispose();
    }
  });

  it("ignores a login result arriving after cancellation and a newer poll", async () => {
    vi.useFakeTimers();
    let resolveLogin!: (value: FeishuState) => void;
    const publish = vi.fn();
    const invoke = vi.fn()
      .mockImplementationOnce(() => new Promise<FeishuState>((resolve) => { resolveLogin = resolve; }))
      .mockResolvedValue(state);
    const session = createFeishuSession({ state: vi.fn().mockResolvedValue(state), invoke }, publish);
    await Promise.resolve();
    const login = session.invoke("completeLogin");
    await session.invoke("disconnect");
    await vi.advanceTimersByTimeAsync(2000);
    const calls = publish.mock.calls.length;
    resolveLogin({ ...state, userAuthorized: true, pending: true });
    await login;
    expect(publish).toHaveBeenCalledTimes(calls);
    expect(publish.mock.lastCall?.[0]).toEqual({ state, busy: null, error: null });
    session.dispose();
  });

  it("polls every two seconds without overlapping and stops on disposal", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue(state);
    const publish = vi.fn();
    const session = createFeishuSession({ state: read, invoke: vi.fn() }, publish);
    await vi.advanceTimersByTimeAsync(4000);
    expect(read).toHaveBeenCalledTimes(3);
    session.dispose();
    await vi.advanceTimersByTimeAsync(4000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("ignores a pre-action poll that finishes after the action", async () => {
    vi.useFakeTimers();
    let resolvePoll!: (value: FeishuState) => void;
    const publish = vi.fn();
    const ready = { ...state, im: "ready" as const };
    const invoke = vi.fn().mockResolvedValue(ready);
    const session = createFeishuSession({ state: () => new Promise((resolve) => { resolvePoll = resolve; }), invoke }, publish);
    await session.invoke("connect", { botId: "bot-1" });
    resolvePoll(state);
    await Promise.resolve();
    expect(publish.mock.lastCall?.[0]).toEqual({ state: ready, busy: null, error: null });
    expect(invoke).toHaveBeenCalledWith("connect", { botId: "bot-1" });
    session.dispose();
  });

  it("blocks duplicate actions and suppresses all late results after unmount", async () => {
    vi.useFakeTimers();
    let resolveAction!: (value: FeishuState) => void;
    const invoke = vi.fn(() => new Promise<FeishuState>((resolve) => { resolveAction = resolve; }));
    const publish = vi.fn();
    const read = vi.fn().mockResolvedValue(state);
    const session = createFeishuSession({ state: read, invoke }, publish);
    await Promise.resolve();
    const action = session.invoke("chooseCli");
    await session.invoke("chooseNode");
    await vi.advanceTimersByTimeAsync(4000);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(3);
    session.dispose();
    const calls = publish.mock.calls.length;
    resolveAction(state);
    await action;
    await vi.advanceTimersByTimeAsync(4000);
    expect(publish).toHaveBeenCalledTimes(calls);
  });

  it("reports unknown on failed reads and retains action errors until another action", async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const read = vi.fn().mockRejectedValueOnce(new Error("private diagnostic")).mockResolvedValue(state);
    const invoke = vi.fn().mockRejectedValueOnce(new Error("private diagnostic")).mockResolvedValue(state);
    const session = createFeishuSession({ state: read, invoke }, publish);
    await Promise.resolve();
    expect(publish.mock.lastCall?.[0].error).toBe(copy.readFailed);
    await session.invoke("probe");
    await vi.advanceTimersByTimeAsync(2000);
    expect(publish.mock.lastCall?.[0].error).toBe(copy.actionFailed);
    await session.invoke("probe");
    expect(publish.mock.lastCall?.[0].error).toBeNull();
    session.dispose();
  });
});
