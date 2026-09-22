import { afterEach, expect, it, vi } from "vitest";
import localOriginModule from "./local-origin.cjs";

// The updater channels answer only the local UI (electron/local-origin.cjs).
localOriginModule.setLocalOrigin("http://127.0.0.1:8799");
const localEvent = { senderFrame: { url: "http://127.0.0.1:8799/" } };

const { updater, handlers, releaseMetadata, openExternal } = vi.hoisted(() => ({
  updater: { on: vi.fn(), downloadUpdate: vi.fn() },
  handlers: new Map(),
  releaseMetadata: { value: null },
  openExternal: vi.fn(async () => {}),
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal(),
  existsSync: (file) => file.endsWith("enterprise-release.json") && releaseMetadata.value !== null,
  readFileSync: () => JSON.stringify(releaseMetadata.value),
}));

vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: () => "/unused-updater-test-log" },
  clipboard: { writeText: vi.fn() },
  shell: { openExternal },
  ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
}));
vi.mock("node:module", () => ({
  createRequire: () => () => ({ autoUpdater: updater }),
}));

const { attachUpdaterWindow, registerUpdaterIpc, startUpdater } = await import("./updater.mjs");

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  releaseMetadata.value = null;
  updater.on.mockClear();
  openExternal.mockClear();
});

it.each(["AI-Applications-Team/OpenMausBot", "WYunS/OpenMausBot"])("uses a manual update path for %s without polling or downloading", async (repository) => {
  vi.useFakeTimers();
  releaseMetadata.value = {
    distribution: "enterprise-internal-test",
    repository,
  };
  registerUpdaterIpc();
  startUpdater();
  expect(vi.getTimerCount()).toBe(0);
  expect(updater.on).not.toHaveBeenCalled();
  await handlers.get("update:check")(localEvent);
  expect(handlers.get("update:get-state")(localEvent)).toMatchObject({ status: "manual", installMode: "manual" });
  expect(openExternal).not.toHaveBeenCalled();
  await handlers.get("update:download")(localEvent);
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(`https://github.com/${repository}/releases`);
});

it("rejects unapproved release destinations without falling back to automatic updates", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    releaseMetadata.value = { distribution: "enterprise-internal-test", repository: "unapproved/project" };
    registerUpdaterIpc();
    startUpdater();
    expect(handlers.get("update:get-state")(localEvent)).toMatchObject({ status: "error" });
    await handlers.get("update:download")(localEvent);
    expect(openExternal).not.toHaveBeenCalled();
    expect(updater.on).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally { log.mockRestore(); }
});

it("reports failure to open the release page and permits another attempt", async () => {
  vi.useFakeTimers();
  releaseMetadata.value = { distribution: "enterprise-internal-test", repository: "AI-Applications-Team/OpenMausBot" };
  registerUpdaterIpc();
  startUpdater();
  openExternal.mockRejectedValueOnce(new Error("browser unavailable"));
  await handlers.get("update:download")(localEvent);
  expect(handlers.get("update:get-state")(localEvent)).toMatchObject({ status: "error", installMode: "manual" });
  await handlers.get("update:check")(localEvent);
  expect(handlers.get("update:get-state")(localEvent)).toMatchObject({ status: "manual" });
  await handlers.get("update:download")(localEvent);
  expect(openExternal).toHaveBeenCalledTimes(2);
});

it("sends updater progress to a reopened window without restarting the updater", async () => {
  vi.useFakeTimers();
  const first = { webContents: { send: vi.fn() } };
  const reopened = { webContents: { send: vi.fn() } };
  attachUpdaterWindow(first);
  registerUpdaterIpc();
  startUpdater();
  const listenerCount = updater.on.mock.calls.length;
  const timerCount = vi.getTimerCount();

  first.webContents.send.mockImplementation(() => { throw new Error("window destroyed"); });
  first.webContents.send.mockClear();
  attachUpdaterWindow(reopened);
  const emit = (name, payload) => {
    for (const [event, listener] of updater.on.mock.calls) {
      if (event === name) listener(payload);
    }
  };
  updater.downloadUpdate.mockImplementation(async () => {
    emit("download-progress", { percent: 50 });
    emit("update-downloaded", { version: "2.0.0" });
    return ["/unused-staged-update.zip"];
  });

  await handlers.get("update:download")(localEvent);

  expect(first.webContents.send).not.toHaveBeenCalled();
  expect(reopened.webContents.send.mock.calls.map(([, state]) => state.status))
    .toEqual(["downloading", "downloading", ...(process.platform === "darwin" ? ["preparing"] : []), "downloaded"]);
  expect(handlers.get("update:get-state")(localEvent)).toMatchObject({ status: "downloaded", version: "2.0.0" });
  expect(updater.on.mock.calls).toHaveLength(listenerCount);
  expect(vi.getTimerCount()).toBe(timerCount);
});
