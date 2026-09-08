import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import bootstrapModule from "./local-vm-bootstrap.cjs";

const { createLocalVmBootstrap, targetPath } = bootstrapModule;

function fixture(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "omb-vm-bootstrap-"));
  const calls = [];
  const events = [];
  let status = {
    runtime: "podman",
    daemonUp: true,
    image: true,
    container: "stopped",
    ready: false,
  };
  const request = async (path, method) => {
    calls.push([method, path]);
    if (method === "POST" && path.endsWith("/run")) {
      status = { ...status, container: "running", ready: true };
    }
    if (method === "POST" && path === "/api/local-computer/pull") {
      status = { ...status, image: true };
    }
    return { ...status };
  };
  const commandCalls = [];
  const bootstrap = createLocalVmBootstrap({
    platform: "win32",
    arch: "x64",
    userDataPath: directory,
    checkpointFile: join(directory, "state.json"),
    request,
    emit: (event) => events.push(event),
    commandExists: () => true,
    runCommand: async (command, args) => {
      commandCalls.push([command, args]);
      return { stdout: args.includes("list") ? "[]" : "", stderr: "", code: 0 };
    },
    ...overrides,
  });
  return {
    bootstrap,
    calls,
    commandCalls,
    events,
    getStatus: () => status,
    setStatus: (next) => { status = { ...status, ...next }; },
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("existing Local VM skips confirmation and starts in place", async () => {
  const f = fixture();
  try {
    const inspection = await f.bootstrap.inspect({ botId: "bot-1" });
    assert.equal(inspection.needsConfirmation, false);
    await f.bootstrap.start({ target: { botId: "bot-1" }, confirmed: false });
    assert.deepEqual(f.calls, [
      ["GET", "/api/bots/bot-1/local-computer"],
      ["GET", "/api/bots/bot-1/local-computer"],
      ["GET", "/api/bots/bot-1/local-computer"],
      ["POST", "/api/bots/bot-1/local-computer/run"],
    ]);
    assert.equal(f.commandCalls.length, 0);
    assert.equal(f.bootstrap.state().status, "ready");
  } finally {
    f.cleanup();
  }
});

test("missing runtime asks before making any mutation", async () => {
  const f = fixture();
  f.setStatus({ runtime: null, daemonUp: false, image: false, container: "missing" });
  try {
    const inspection = await f.bootstrap.inspect({});
    assert.equal(inspection.needsConfirmation, true);
    const result = await f.bootstrap.start({ target: {}, confirmed: false });
    assert.equal(result.status, "confirmation-required");
    assert.equal(f.calls.every(([method]) => method === "GET"), true);
    assert.equal(f.commandCalls.length, 0);
  } finally {
    f.cleanup();
  }
});

test("an installed stopped Podman resumes first, then starts an existing VM", async () => {
  const f = fixture({
    runCommand: async (_command, args) => {
      if (args.includes("start")) f.setStatus({ daemonUp: true });
      return { stdout: args.includes("list") ? JSON.stringify([{ Running: false }]) : "", stderr: "", code: 0 };
    },
  });
  f.setStatus({ daemonUp: false });
  try {
    assert.equal((await f.bootstrap.inspect({})).needsConfirmation, false);
    await f.bootstrap.start({ target: {}, confirmed: false });
    assert.equal(f.calls.some(([method, path]) => method === "POST" && path === "/api/local-computer/run"), true);
    assert.equal(f.calls.some(([method, path]) => method === "POST" && path === "/api/local-computer/pull"), false);
  } finally {
    f.cleanup();
  }
});

test("an existing named Podman machine is started by its real name instead of the missing default", async () => {
  const machineCommands = [];
  const f = fixture({
    runCommand: async (_command, args) => {
      machineCommands.push(args);
      if (args.includes("list")) {
        return {
          stdout: JSON.stringify([{ Name: "openmausbot-machine-v1", Default: false, Running: false }]),
          stderr: "",
          code: 0,
        };
      }
      if (args[0] === "machine" && args[1] === "start") {
        if (args[2] !== "openmausbot-machine-v1") {
          throw new Error("podman-machine-default: VM does not exist");
        }
        f.setStatus({ daemonUp: true });
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  f.setStatus({ daemonUp: false });
  try {
    await f.bootstrap.start({ target: {}, confirmed: false });
    assert.equal(f.bootstrap.state().status, "ready");
    assert.equal(machineCommands.some((args) =>
      args[0] === "machine" && args[1] === "start" && args[2] === "openmausbot-machine-v1"
    ), true);
  } finally {
    f.cleanup();
  }
});

test("confirmed first setup reports ordered progress and uses the shared image endpoint", async () => {
  const f = fixture({
    runCommand: async (_command, args) => {
      if (args[0] === "install") f.setStatus({ runtime: "podman" });
      if (args.includes("start")) f.setStatus({ daemonUp: true });
      return { stdout: args.includes("list") ? "[]" : "", stderr: "", code: 0 };
    },
  });
  f.setStatus({ runtime: null, daemonUp: false, image: false, container: "missing" });
  try {
    await f.bootstrap.start({ target: { botId: "new-bot" }, confirmed: true });
    const stages = f.events.map((event) => event.stage);
    for (const stage of ["preflight", "runtime-install", "runtime-init", "runtime-start", "image", "vm-start", "ready"]) {
      assert.notEqual(stages.indexOf(stage), -1, `missing ${stage}`);
    }
    assert.equal(f.calls.some(([method, path]) => method === "POST" && path === "/api/local-computer/pull"), true);
    assert.equal(f.calls.some(([method, path]) => method === "POST" && path === "/api/bots/new-bot/local-computer/run"), true);
  } finally {
    f.cleanup();
  }
});

test("Windows virtualization restart is checkpointed instead of reported as a generic failure", async () => {
  const f = fixture({
    runCommand: async (_command, args) => {
      if (args[0] === "install") f.setStatus({ runtime: "podman" });
      if (args.includes("list")) return { stdout: "[]", stderr: "", code: 0 };
      if (args.includes("init")) throw new Error("Virtual Machine Platform requires a restart");
      return { stdout: "", stderr: "", code: 0 };
    },
  });
  f.setStatus({ runtime: null, daemonUp: false, image: false, container: "missing" });
  try {
    const result = await f.bootstrap.start({ target: {}, confirmed: true });
    assert.equal(result.status, "reboot-required");
    assert.equal(result.rebootRequired, true);
    assert.equal(f.calls.some(([method]) => method === "POST"), false);
  } finally {
    f.cleanup();
  }
});

test("target paths reject IDs that could escape the API boundary", () => {
  assert.equal(targetPath({ botId: "safe-bot_1" }), "/api/bots/safe-bot_1/local-computer");
  assert.throws(() => targetPath({ botId: "../config" }), /Invalid Local VM bot target/);
});
