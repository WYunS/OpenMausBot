import { execFile, spawn } from "node:child_process";
import { access, readFile, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { promisify } from "node:util";

const BRIDGE_FILENAME = "openmaus-bridge.json";
const PRODUCT_NAME = "锐捷 Harness";
const WINDOWS_EXECUTABLE_NAME = "Ruijie-Harness.exe";
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

export interface RuijieHarnessBridgeRecord {
  schemaVersion: 1;
  endpoint: string;
  pid: number;
  generationId: string;
}

export interface RuijieHarnessEndpointOptions {
  endpoint?: string;
  bridgePath: string;
  executablePath?: string;
  startupTimeoutMs?: number;
  autoLaunch?: boolean;
}

interface ExecutableInspection {
  running: boolean;
  endpoints: string[];
}

export interface RuijieHarnessLocatorDependencies {
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
  home: string;
  pathExists(path: string): Promise<boolean>;
  registeredExecutable(): Promise<string | undefined>;
  readBridge(path: string): Promise<RuijieHarnessBridgeRecord | undefined>;
  executableForPid(pid: number): Promise<string | undefined>;
  inspectExecutable(path: string): Promise<ExecutableInspection>;
  probeEndpoint(endpoint: string): Promise<boolean>;
  launchExecutable(path: string): Promise<void>;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

export function defaultRuijieBridgePath(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    const appData = environment.APPDATA ?? win32.join(home, "AppData", "Roaming");
    return win32.join(appData, PRODUCT_NAME, BRIDGE_FILENAME);
  }
  const appData = platform === "darwin"
    ? posix.join(home, "Library", "Application Support")
    : environment.XDG_CONFIG_HOME ?? posix.join(home, ".config");
  return posix.join(appData, PRODUCT_NAME, BRIDGE_FILENAME);
}

export function installedRuijieHarnessCandidates(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string[] {
  if (platform === "win32") {
    return [
      environment.LOCALAPPDATA && win32.join(
        environment.LOCALAPPDATA,
        "Programs",
        "Ruijie-Harness",
        WINDOWS_EXECUTABLE_NAME,
      ),
      environment.ProgramFiles && win32.join(
        environment.ProgramFiles,
        "Ruijie-Harness",
        WINDOWS_EXECUTABLE_NAME,
      ),
      environment["ProgramFiles(x86)"] && win32.join(
        environment["ProgramFiles(x86)"],
        "Ruijie-Harness",
        WINDOWS_EXECUTABLE_NAME,
      ),
    ].filter((value): value is string => Boolean(value));
  }
  if (platform === "darwin") {
    return [
      "/Applications/" + PRODUCT_NAME + ".app/Contents/MacOS/" + PRODUCT_NAME,
      posix.join(home, "Applications", PRODUCT_NAME + ".app", "Contents", "MacOS", PRODUCT_NAME),
    ];
  }
  return [
    posix.join(home, ".local", "bin", "ruijie-harness"),
    "/usr/local/bin/ruijie-harness",
    "/usr/bin/ruijie-harness",
  ];
}

function validLoopbackEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function sameExecutable(left: string | undefined, right: string, platform: NodeJS.Platform): boolean {
  if (!left) return false;
  if (platform === "win32") return win32.normalize(left).toLowerCase() === win32.normalize(right).toLowerCase();
  return posix.normalize(left) === posix.normalize(right);
}

async function findInstalledExecutable(
  options: RuijieHarnessEndpointOptions,
  dependencies: RuijieHarnessLocatorDependencies,
): Promise<string | undefined> {
  const configured = options.executablePath?.trim()
    || dependencies.environment.RUIJIE_HARNESS_EXECUTABLE?.trim();
  if (configured) return await dependencies.pathExists(configured) ? configured : undefined;

  for (const candidate of installedRuijieHarnessCandidates(
    dependencies.platform,
    dependencies.environment,
    dependencies.home,
  )) {
    if (await dependencies.pathExists(candidate)) return candidate;
  }
  const registered = await dependencies.registeredExecutable();
  return registered && await dependencies.pathExists(registered) ? registered : undefined;
}

async function usableEndpointForExecutable(
  executable: string,
  bridgePath: string,
  dependencies: RuijieHarnessLocatorDependencies,
): Promise<{ endpoint?: string; running: boolean }> {
  const bridge = await dependencies.readBridge(bridgePath);
  if (bridge) {
    const ownerExecutable = await dependencies.executableForPid(bridge.pid);
    if (sameExecutable(ownerExecutable, executable, dependencies.platform)
      && await dependencies.probeEndpoint(bridge.endpoint)) {
      return { endpoint: bridge.endpoint, running: true };
    }
  }

  const inspection = await dependencies.inspectExecutable(executable);
  for (const candidate of inspection.endpoints) {
    const endpoint = validLoopbackEndpoint(candidate);
    if (endpoint && await dependencies.probeEndpoint(endpoint)) {
      return { endpoint, running: true };
    }
  }
  return { running: inspection.running };
}

export function createRuijieHarnessLocator(
  dependencies: RuijieHarnessLocatorDependencies = realDependencies(),
): { ensureEndpoint(options: RuijieHarnessEndpointOptions): Promise<string> } {
  let pending: Promise<string> | undefined;
  let lastEndpoint: string | undefined;

  const resolve = async (options: RuijieHarnessEndpointOptions): Promise<string> => {
    const explicit = validLoopbackEndpoint(options.endpoint);
    if (explicit) return explicit;

    const executable = await findInstalledExecutable(options, dependencies);
    if (!executable) {
      throw new Error("未检测到已安装的锐捷 Harness，请先安装正式版锐捷 Harness");
    }

    let state = await usableEndpointForExecutable(executable, options.bridgePath, dependencies);
    if (state.endpoint) return state.endpoint;
    if (options.autoLaunch === false) {
      throw new Error("锐捷 Harness 当前未运行");
    }
    if (!state.running) {
      try {
        await dependencies.launchExecutable(executable);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error("锐捷 Harness 启动失败：" + detail);
      }
    }

    const deadline = dependencies.now() + (options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);
    while (dependencies.now() < deadline) {
      await dependencies.sleep(POLL_INTERVAL_MS);
      state = await usableEndpointForExecutable(executable, options.bridgePath, dependencies);
      if (state.endpoint) return state.endpoint;
    }
    throw new Error("锐捷 Harness 正在启动或等待登录，请在自动打开的窗口中完成登录后重试");
  };

  return {
    ensureEndpoint(options) {
      const explicit = validLoopbackEndpoint(options.endpoint);
      if (explicit) return Promise.resolve(explicit);
      if (pending) return pending;
      const current = (async () => {
        if (lastEndpoint && await dependencies.probeEndpoint(lastEndpoint)) return lastEndpoint;
        lastEndpoint = undefined;
        const endpoint = await resolve(options);
        lastEndpoint = endpoint;
        return endpoint;
      })();
      const tracked = current.finally(() => {
        if (pending === tracked) pending = undefined;
      });
      pending = tracked;
      return tracked;
    },
  };
}

const execFileAsync = promisify(execFile);

async function windowsRegisteredExecutable(): Promise<string | undefined> {
  const script = [
    "$roots=@(",
    "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
    "$item=Get-ItemProperty -Path $roots -ErrorAction SilentlyContinue |",
    "Where-Object { $_.DisplayName -like '锐捷 Harness*' } | Select-Object -First 1",
    "if($null -ne $item){",
    "  if($item.DisplayIcon){ $item.DisplayIcon -replace ',[0-9]+$','' -replace '^\"|\"$','' }",
    "  elseif($item.InstallLocation){ Join-Path $item.InstallLocation '" + WINDOWS_EXECUTABLE_NAME + "' }",
    "}",
  ].join("\n");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 5_000 },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function executableForPid(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === "win32") {
      const script = "(Get-CimInstance Win32_Process -Filter 'ProcessId = " + pid + "').ExecutablePath";
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 5_000 },
      );
      return stdout.trim() || undefined;
    }
    if (process.platform === "linux") return await readlink("/proc/" + pid + "/exe").catch(() => undefined);
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "comm="], { timeout: 5_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function inspectWindowsExecutable(path: string): Promise<ExecutableInspection> {
  const script = [
    "$target=$env:RUIJIE_HARNESS_TARGET",
    "$processes=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |",
    "Where-Object { $_.ExecutablePath -and [String]::Equals($_.ExecutablePath,$target,[StringComparison]::OrdinalIgnoreCase) })",
    "$ids=@($processes | ForEach-Object { $_.ProcessId })",
    "$ports=@()",
    "if($ids.Count -gt 0){ $ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |",
    "Where-Object { $ids -contains $_.OwningProcess } | Select-Object -ExpandProperty LocalPort -Unique) }",
    "[pscustomobject]@{running=($ids.Count -gt 0);ports=@($ports)} | ConvertTo-Json -Compress",
  ].join("\n");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        timeout: 8_000,
        env: { ...process.env, RUIJIE_HARNESS_TARGET: path },
      },
    );
    const value = JSON.parse(stdout.trim()) as { running?: unknown; ports?: unknown };
    const ports = Array.isArray(value.ports) ? value.ports : value.ports === undefined ? [] : [value.ports];
    return {
      running: value.running === true,
      endpoints: ports
        .filter((port): port is number => Number.isInteger(port) && port > 0 && port <= 65_535)
        .map((port) => "http://127.0.0.1:" + port),
    };
  } catch {
    return { running: false, endpoints: [] };
  }
}

async function inspectPosixExecutable(path: string): Promise<ExecutableInspection> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", path], { timeout: 5_000 });
    const pids = stdout.split(/\s+/u).filter((value) => /^[1-9][0-9]*$/u.test(value));
    if (pids.length === 0) return { running: false, endpoints: [] };
    try {
      const ports = new Set<number>();
      const { stdout: sockets } = await execFileAsync(
        "lsof",
        ["-nP", "-a", "-p", pids.join(","), "-iTCP", "-sTCP:LISTEN", "-Fn"],
        { timeout: 5_000 },
      );
      for (const line of sockets.split(/\r?\n/u)) {
        const match = /^n(?:127\.0\.0\.1|localhost|\*|\[::1\]):([0-9]+)$/u.exec(line);
        if (match) ports.add(Number(match[1]));
      }
      return { running: true, endpoints: [...ports].map((port) => "http://127.0.0.1:" + port) };
    } catch {
      return { running: true, endpoints: [] };
    }
  } catch {
    return { running: false, endpoints: [] };
  }
}

function realDependencies(): RuijieHarnessLocatorDependencies {
  return {
    platform: process.platform,
    environment: process.env,
    home: homedir(),
    pathExists: async (path) => access(path).then(() => true, () => false),
    registeredExecutable: process.platform === "win32" ? windowsRegisteredExecutable : async () => undefined,
    readBridge: async (path) => {
      try {
        const value = JSON.parse(await readFile(path, "utf8")) as Partial<RuijieHarnessBridgeRecord>;
        const endpoint = validLoopbackEndpoint(value.endpoint);
        if (
          value.schemaVersion !== 1
          || !Number.isSafeInteger(value.pid)
          || typeof value.generationId !== "string"
          || !value.generationId
          || !endpoint
        ) return undefined;
        return { ...value, endpoint } as RuijieHarnessBridgeRecord;
      } catch {
        return undefined;
      }
    },
    executableForPid,
    inspectExecutable: process.platform === "win32" ? inspectWindowsExecutable : inspectPosixExecutable,
    probeEndpoint: async (endpoint) => {
      try {
        const rpcId = "openmaus-probe-" + process.pid;
        const response = await fetch(endpoint + "/api/host.describe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "client-request", rpcId, method: "host.describe", payload: {} }),
          signal: AbortSignal.timeout(1_500),
        });
        if (!response.ok) return false;
        const value = await response.json() as { rpcId?: unknown; result?: { ok?: unknown } };
        return value.rpcId === rpcId && value.result?.ok === true;
      } catch {
        return false;
      }
    },
    launchExecutable: async (path) => {
      const child = spawn(path, [], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", resolve);
      });
      child.unref();
    },
    now: () => Date.now(),
    sleep: async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
}

export const ruijieHarnessLocator = createRuijieHarnessLocator();
