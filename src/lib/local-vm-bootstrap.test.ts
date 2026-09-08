import { describe, expect, it, vi } from "vitest";
import {
  ensureLocalVmReady,
  localVmLaunchAction,
  localVmLifecyclePath,
  localVmSelectionStartsBootstrap,
  localVmSetupAvailable,
  localVmTarget,
  type LocalVmBootstrapBridge,
} from "./local-vm-bootstrap";

const state = (status: LocalVmBootstrapState["status"]): LocalVmBootstrapState => ({
  status,
  stage: status === "ready" ? "ready" : "confirmation",
  message: status,
  progress: status === "ready" ? 100 : 0,
  target: {},
  needsConfirmation: status === "confirmation-required",
  rebootRequired: false,
  updatedAt: new Date(0).toISOString(),
});

function bridge(needsConfirmation: boolean, results: LocalVmBootstrapState[]): LocalVmBootstrapBridge {
  return {
    inspect: vi.fn(async (): Promise<LocalVmBootstrapInspection> => ({
      platform: "win32" as const,
      arch: "x64",
      supported: true,
      needsConfirmation,
      reason: needsConfirmation ? "runtime-missing" as const : "existing-vm" as const,
      status: {},
      bootstrap: state("idle"),
    })),
    start: vi.fn(async () => results.shift() ?? state("ready")),
  };
}

describe("ensureLocalVmReady", () => {
  it("starts an existing VM without prompting", async () => {
    const native = bridge(false, [state("ready")]);
    const confirm = vi.fn(() => true);
    await expect(ensureLocalVmReady(native, { botId: "b" }, confirm)).resolves.toMatchObject({ kind: "ready" });
    expect(confirm).not.toHaveBeenCalled();
    expect(native.start).toHaveBeenCalledWith({ target: { botId: "b" }, confirmed: false });
  });

  it("does nothing when first-time setup is declined", async () => {
    const native = bridge(true, [state("ready")]);
    await expect(ensureLocalVmReady(native, {}, () => false)).resolves.toEqual({ kind: "cancelled" });
    expect(native.start).not.toHaveBeenCalled();
  });

  it("asks after silently waking a runtime that reveals missing setup", async () => {
    const native = bridge(false, [state("confirmation-required"), state("ready")]);
    const confirm = vi.fn(() => true);
    await expect(ensureLocalVmReady(native, {}, confirm)).resolves.toMatchObject({ kind: "ready" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(native.start).toHaveBeenNthCalledWith(2, { target: {}, confirmed: true });
  });
});

describe("Local VM target routing", () => {
  it("routes shared mode through the account-wide VM endpoints", () => {
    expect(localVmTarget("shared", "plum")).toEqual({});
    expect(localVmLifecyclePath("shared", "plum", "run")).toBe("/api/local-computer/run");
  });

  it("routes per-bot mode through the bot-owned VM endpoints", () => {
    expect(localVmTarget("per-bot", "plum")).toEqual({ botId: "plum" });
    expect(localVmLifecyclePath("per-bot", "plum / unsafe", "remove"))
      .toBe("/api/bots/plum%20%2F%20unsafe/local-computer/remove");
  });
});

describe("localVmLaunchAction", () => {
  const safe = {
    imageMatches: true,
    managed: true,
    network: "loopback" as const,
    security: "hardened" as const,
    persistence: "durable" as const,
  };

  it("starts a stopped compatible VM without replacing it", () => {
    expect(localVmLaunchAction({ ...safe, container: "stopped" })).toBe("vm-create");
  });

  it("replaces only an existing incompatible VM", () => {
    expect(localVmLaunchAction({ ...safe, container: "stopped", imageMatches: false })).toBe("vm-recreate");
    expect(localVmLaunchAction({ ...safe, container: "missing", imageMatches: false })).toBe("vm-create");
  });
});

describe("localVmSetupAvailable", () => {
  it("offers one-click recovery for a shared VM when the desktop bootstrap is available", () => {
    expect(localVmSetupAvailable({
      mode: "shared",
      image: false,
      create_supported: false,
    }, true)).toBe(true);
  });

  it("keeps the server-only fallback limited to creatable per-bot VMs", () => {
    expect(localVmSetupAvailable({ mode: "per-bot", image: true, create_supported: true }, false)).toBe(true);
    expect(localVmSetupAvailable({ mode: "shared", image: true, create_supported: true }, false)).toBe(false);
  });
});

describe("localVmSelectionStartsBootstrap", () => {
  it("starts the desktop bootstrap on the first Local VM selection only", () => {
    expect(localVmSelectionStartsBootstrap(undefined, true)).toBe(true);
    expect(localVmSelectionStartsBootstrap("local", true)).toBe(true);
    expect(localVmSelectionStartsBootstrap("vm", true)).toBe(false);
    expect(localVmSelectionStartsBootstrap(undefined, false)).toBe(false);
  });
});
