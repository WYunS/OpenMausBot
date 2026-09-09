import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  launch: vi.fn(), createServer: vi.fn(), close: vi.fn(),
  listen: vi.fn(), closeUi: vi.fn(), signals: new Map(),
}));
vi.mock("./control-omb.ts", () => ({ launchVerificationServer: fixture.launch }));
vi.mock("vite", () => ({ createServer: fixture.createServer }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  fixture.signals.clear();
  const once = process.once;
  vi.spyOn(process, "once").mockImplementation(function (event, listener) {
    if (event === "SIGINT" || event === "SIGTERM") {
      fixture.signals.set(event, listener);
      return this;
    }
    return once.call(this, event, listener);
  });
  vi.spyOn(process, "removeListener");
  vi.spyOn(console, "log").mockImplementation(() => {});
  fixture.launch.mockResolvedValue({
    info: { dataDir: "/fixture-only", url: "http://127.0.0.1:1" }, close: fixture.close,
  });
  fixture.createServer.mockResolvedValue({
    listen: fixture.listen, close: fixture.closeUi,
    resolvedUrls: { local: ["http://127.0.0.1:2/"] },
  });
});
afterEach(() => vi.restoreAllMocks());

function expectSignalsRemoved() {
  for (const [event, handler] of fixture.signals) {
    expect(process.removeListener).toHaveBeenCalledWith(event, handler);
  }
}

it("registers cancellation before launch and removes handlers if startup aborts", async () => {
  fixture.launch.mockImplementation(async (env, signal) => {
    expect(env).toBe(process.env);
    expect([...fixture.signals.keys()]).toEqual(["SIGINT", "SIGTERM"]);
    fixture.signals.get("SIGINT")();
    expect(signal.aborted).toBe(true);
    throw new Error("verification launch cancelled");
  });
  await expect(import("./verify-engines-ui.ts")).rejects.toThrow("verification launch cancelled");
  expect(fixture.createServer).not.toHaveBeenCalled();
  expectSignalsRemoved();
});

it("closes the isolated fixture when UI creation fails", async () => {
  fixture.createServer.mockRejectedValue(new Error("UI startup failed"));
  await expect(import("./verify-engines-ui.ts")).rejects.toThrow("UI startup failed");
  expect(fixture.close).toHaveBeenCalledOnce();
  expectSignalsRemoved();
});

it("uses the same cancellation signal after startup", async () => {
  const run = import("./verify-engines-ui.ts");
  await vi.waitFor(() => expect(fixture.listen).toHaveBeenCalledOnce());
  fixture.signals.get("SIGTERM")();
  await run;
  expect(fixture.launch.mock.calls[0][1].aborted).toBe(true);
  expect(fixture.closeUi).toHaveBeenCalledOnce();
  expect(fixture.close).toHaveBeenCalledOnce();
  expectSignalsRemoved();
});

it("does not miss cancellation during UI startup or skip fixture cleanup if UI close fails", async () => {
  fixture.listen.mockImplementation(async () => fixture.signals.get("SIGINT")());
  fixture.closeUi.mockRejectedValue(new Error("UI close failed"));
  await expect(import("./verify-engines-ui.ts")).rejects.toThrow("UI close failed");
  expect(fixture.close).toHaveBeenCalledOnce();
  expectSignalsRemoved();
});
