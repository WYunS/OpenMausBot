"use strict";

// Host-side Local VM bootstrap.  This is deliberately a deep module: the
// renderer asks for an outcome and observes progress; it never assembles or
// executes host shell commands.  Container/image/workspace ownership remains
// in server/container-computer.ts.
const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const TERMINAL_STAGES = new Set(["ready", "error", "cancelled", "reboot-required"]);
const TARGET_ID = /^[\w-]{1,160}$/;

function publicState(state) {
  return {
    status: state.status,
    stage: state.stage,
    message: state.message,
    progress: state.progress,
    target: state.target,
    needsConfirmation: state.needsConfirmation,
    rebootRequired: state.rebootRequired,
    updatedAt: state.updatedAt,
  };
}

function targetPath(target = {}) {
  if (target.botId !== undefined) {
    if (typeof target.botId !== "string" || !TARGET_ID.test(target.botId)) {
      throw new Error("Invalid Local VM bot target");
    }
    return `/api/bots/${encodeURIComponent(target.botId)}/local-computer`;
  }
  return "/api/local-computer";
}

function defaultCommandExists(command, platform, env = process.env) {
  const pathValue = env.PATH ?? env.Path ?? "";
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const directory of pathValue.split(platform === "win32" ? ";" : ":")) {
    if (!directory) continue;
    for (const extension of extensions) {
      if (existsSync(join(directory, command + extension))) return true;
    }
  }
  if (platform === "win32" && command === "podman") {
    return existsSync(join(env.ProgramFiles ?? "C:\\Program Files", "RedHat", "Podman", "podman.exe"));
  }
  if (platform === "darwin") {
    return [join("/opt/homebrew/bin", command), join("/usr/local/bin", command)].some(existsSync);
  }
  return false;
}

function podmanCommand(platform, env = process.env) {
  const installed = join(env.ProgramFiles ?? "C:\\Program Files", "RedHat", "Podman", "podman.exe");
  if (platform === "win32" && existsSync(installed)) return installed;
  if (platform === "darwin") {
    for (const candidate of ["/opt/homebrew/bin/podman", "/usr/local/bin/podman"]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return "podman";
}

function brewCommand() {
  for (const candidate of ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]) {
    if (existsSync(candidate)) return candidate;
  }
  return "brew";
}

function defaultRunCommand(command, args, { signal, timeoutMs = 20 * 60_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(Object.assign(new Error((stderr || stdout || `${command} exited with code ${code}`).trim()), {
        code,
        stdout,
        stderr,
      }));
    });
  });
}

function readCheckpoint(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCheckpoint(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function normalizeStatus(raw) {
  return {
    runtime: typeof raw?.runtime === "string" ? raw.runtime : null,
    daemonUp: raw?.daemonUp === true,
    image: raw?.image === true,
    container: ["running", "stopped", "missing"].includes(raw?.container) ? raw.container : "missing",
    ready: raw?.ready === true,
    raw,
  };
}

function requiresWindowsRestart(error) {
  const detail = `${error?.message ?? ""}\n${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
  return /reboot|restart|重新启动|重启|0x80370102|virtual machine platform|wsl.*(?:install|update)/i.test(detail);
}

function createLocalVmBootstrap(options) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const request = options.request;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const commandExists = options.commandExists ?? ((command) => defaultCommandExists(command, platform, options.env));
  const emit = options.emit ?? (() => {});
  const checkpointFile = options.checkpointFile ?? join(options.userDataPath, "local-vm-bootstrap.json");
  let controller = null;
  let active = null;
  let state = {
    status: "idle",
    stage: "idle",
    message: "Local VM setup has not started.",
    progress: 0,
    target: null,
    needsConfirmation: false,
    rebootRequired: false,
    updatedAt: new Date().toISOString(),
  };

  const saved = readCheckpoint(checkpointFile);
  if (saved?.status === "running" || saved?.status === "reboot-required") {
    state = {
      ...state,
      ...saved,
      status: saved.status === "running" ? "interrupted" : saved.status,
      message: saved.status === "running"
        ? "Setup was interrupted. Click Local VM to resume safely."
        : saved.message,
    };
  }

  function update(patch) {
    state = { ...state, ...patch, updatedAt: new Date().toISOString() };
    writeCheckpoint(checkpointFile, state);
    emit(publicState(state));
    return publicState(state);
  }

  async function inspect(target = {}) {
    const path = targetPath(target);
    const status = normalizeStatus(await request(path, "GET"));
    // An installed runtime is resumed without an installation prompt.  A new
    // image or a first VM is material setup and therefore asks first.
    const needsConfirmation = !status.runtime || (status.daemonUp && (!status.image || status.container === "missing"));
    return {
      platform,
      arch,
      supported: platform === "win32" || platform === "darwin",
      needsConfirmation,
      reason: !status.runtime
        ? "runtime-missing"
        : !status.daemonUp
          ? "runtime-stopped"
          : !status.image
            ? "image-missing"
            : status.container === "missing"
              ? "vm-missing"
              : "existing-vm",
      status: status.raw,
      bootstrap: publicState(state),
    };
  }

  async function installPodman(signal) {
    update({ stage: "runtime-install", message: "Installing Podman…", progress: 15 });
    if (platform === "win32") {
      if (!commandExists("winget")) {
        throw new Error("Windows Package Manager (winget) is required for one-click Podman installation.");
      }
      const result = await runCommand("winget", [
        "install", "--exact", "--id", "RedHat.Podman", "--source", "winget",
        "--accept-package-agreements", "--accept-source-agreements", "--silent",
      ], { signal, timeoutMs: 30 * 60_000, env: options.env });
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      if (/restart|reboot|重新启动|重启/i.test(output)) {
        update({
          status: "reboot-required",
          stage: "reboot-required",
          message: "Podman was installed. Restart Windows, then click Local VM to continue.",
          progress: 30,
          rebootRequired: true,
        });
        return false;
      }
      return true;
    }
    if (platform === "darwin") {
      if (!commandExists("brew")) {
        throw new Error("Homebrew is required for one-click Podman installation on macOS.");
      }
      await runCommand(brewCommand(), ["install", "podman"], { signal, timeoutMs: 30 * 60_000, env: options.env });
      return true;
    }
    throw new Error("One-click Local VM setup currently supports Windows and macOS.");
  }

  async function ensurePodmanMachine(signal) {
    const podman = podmanCommand(platform, options.env);
    update({ stage: "runtime-init", message: "Initializing the Podman virtual machine…", progress: 35 });
    let machines = [];
    try {
      const listed = await runCommand(podman, ["machine", "list", "--format", "json"], {
        signal,
        timeoutMs: 60_000,
        env: options.env,
      });
      machines = JSON.parse(listed.stdout || "[]");
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      machines = [];
    }
    if (!Array.isArray(machines) || machines.length === 0) {
      try {
        await runCommand(podman, ["machine", "init"], {
          signal,
          timeoutMs: 20 * 60_000,
          env: options.env,
        });
      } catch (error) {
        if (platform !== "win32" || !requiresWindowsRestart(error)) throw error;
        update({
          status: "reboot-required",
          stage: "reboot-required",
          message: "Windows virtualization was enabled. Restart Windows, then click Local VM to continue.",
          progress: 40,
          rebootRequired: true,
        });
        return false;
      }
    }
    update({ stage: "runtime-start", message: "Starting Podman…", progress: 45 });
    try {
      await runCommand(podman, ["machine", "start"], {
        signal,
        timeoutMs: 10 * 60_000,
        env: options.env,
      });
    } catch (error) {
      if (/already running|currently running/i.test(`${error?.message ?? ""}\n${error?.stderr ?? ""}`)) return true;
      if (platform === "win32" && requiresWindowsRestart(error)) {
        update({
          status: "reboot-required",
          stage: "reboot-required",
          message: "Windows must restart before Podman can start. Setup will resume afterward.",
          progress: 45,
          rebootRequired: true,
        });
        return false;
      }
      throw error;
    }
    return true;
  }

  async function ensureDockerDaemon(signal) {
    update({ stage: "runtime-start", message: "Starting Docker…", progress: 45 });
    if (platform === "win32") {
      const executable = join(
        options.env?.ProgramFiles ?? process.env.ProgramFiles ?? "C:\\Program Files",
        "Docker", "Docker", "Docker Desktop.exe",
      );
      if (!existsSync(executable)) throw new Error("Docker is installed but Docker Desktop could not be found.");
      await runCommand("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        "& { param($program) Start-Process -FilePath $program -WindowStyle Hidden }",
        executable,
      ], { signal, timeoutMs: 30_000, env: options.env });
      return;
    }
    if (platform === "darwin") {
      await runCommand("open", ["-a", "Docker"], { signal, timeoutMs: 30_000, env: options.env });
      return;
    }
    throw new Error("The installed Docker daemon must be started manually on this platform.");
  }

  async function waitForDaemon(path, signal) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      if (signal.aborted) throw signal.reason ?? new Error("Local VM setup was cancelled");
      const status = normalizeStatus(await request(path, "GET", signal));
      if (status.runtime && status.daemonUp) return status;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 2_000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("Local VM setup was cancelled"));
        }, { once: true });
      });
    }
    throw new Error("Podman did not become ready within 90 seconds.");
  }

  async function execute(target, confirmed, prepareOnly) {
    const path = targetPath(target);
    const first = await inspect(target);
    if (!first.supported && !first.status.runtime) {
      throw new Error("One-click Local VM setup currently supports Windows and macOS.");
    }
    if (first.needsConfirmation && confirmed !== true) {
      return update({
        status: "confirmation-required",
        stage: "confirmation",
        message: "Local VM needs a one-time runtime/image setup.",
        progress: 0,
        target,
        needsConfirmation: true,
        rebootRequired: false,
      });
    }

    controller = new AbortController();
    const { signal } = controller;
    update({
      status: "running",
      stage: "preflight",
      message: "Checking the existing Local VM…",
      progress: 5,
      target,
      needsConfirmation: false,
      rebootRequired: false,
    });

    let current = normalizeStatus(await request(path, "GET", signal));
    if (!current.runtime) {
      const installed = await installPodman(signal);
      if (!installed) return publicState(state);
      current = normalizeStatus(await request(path, "GET", signal));
    }
    if (!current.daemonUp) {
      if (current.runtime === "podman" || !current.runtime) {
        if (!(await ensurePodmanMachine(signal))) return publicState(state);
      } else if (current.runtime === "docker") {
        await ensureDockerDaemon(signal);
      } else {
        throw new Error(`${current.runtime} is installed but its daemon is stopped. Start it, then click Local VM again.`);
      }
      current = await waitForDaemon(path, signal);
    }
    // A stopped, already-installed runtime is started without bothering the
    // user. Only after it is queryable can we safely distinguish an existing
    // VM (fast path) from material setup that needs consent.
    if ((!current.image || (!prepareOnly && current.container === "missing")) && confirmed !== true) {
      return update({
        status: "confirmation-required",
        stage: "confirmation",
        message: "Local VM needs a one-time image download or VM creation.",
        progress: 45,
        target,
        needsConfirmation: true,
      });
    }
    if (!current.image) {
      update({ stage: "image", message: "Importing or downloading the Local VM image…", progress: 60 });
      // The image is shared by every per-bot VM, so its lifecycle endpoint is
      // intentionally global even when the final container is bot-scoped.
      current = normalizeStatus(await request("/api/local-computer/pull", "POST", signal));
    }
    if (prepareOnly) {
      return update({
        status: "ready",
        stage: "ready",
        message: "Local VM runtime and image are ready.",
        progress: 100,
        target,
        needsConfirmation: false,
        rebootRequired: false,
      });
    }
    update({ stage: "vm-start", message: current.container === "missing" ? "Creating the Local VM…" : "Starting the existing Local VM…", progress: 85 });
    const result = await request(`${path}/run`, "POST", signal);
    return update({
      status: "ready",
      stage: "ready",
      message: "Local VM is ready.",
      progress: 100,
      target,
      needsConfirmation: false,
      rebootRequired: false,
      result,
    });
  }

  function start(input = {}) {
    if (active) return active;
    const target = input.target ?? {};
    active = execute(target, input.confirmed === true, input.prepareOnly === true)
      .catch((error) => {
        if (controller?.signal.aborted || error?.name === "AbortError") {
          return update({ status: "cancelled", stage: "cancelled", message: "Local VM setup was cancelled." });
        }
        update({ status: "error", stage: "error", message: error instanceof Error ? error.message : String(error) });
        throw error;
      })
      .finally(() => {
        controller = null;
        active = null;
      });
    return active;
  }

  function cancel() {
    if (!controller) return false;
    controller.abort(new Error("Local VM setup was cancelled"));
    return true;
  }

  return {
    inspect,
    start,
    cancel,
    state: () => publicState(state),
  };
}

module.exports = {
  TERMINAL_STAGES,
  createLocalVmBootstrap,
  defaultCommandExists,
  defaultRunCommand,
  targetPath,
};
