import { describe, expect, it, vi } from "vitest";

import {
  createRuijieHarnessLocator,
  bundledRuijieHarnessExecutable,
  defaultRuijieBridgePath,
  installedRuijieHarnessCandidates,
  type RuijieHarnessLocatorDependencies,
} from "./ruijie-harness-local.ts";

const WINDOWS_EXECUTABLE = "C:\\Users\\test\\AppData\\Local\\Programs\\Ruijie-Harness\\Ruijie-Harness.exe";

function dependencies(
  overrides: Partial<RuijieHarnessLocatorDependencies> = {},
): RuijieHarnessLocatorDependencies {
  let clock = 0;
  return {
    platform: "win32",
    arch: "x64",
    environment: {
      APPDATA: "C:\\Users\\test\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
    },
    home: "C:\\Users\\test",
    pathExists: async (path) => path === WINDOWS_EXECUTABLE,
    readText: async () => { throw new Error("missing fixture"); },
    sha256: async () => "a".repeat(64),
    registeredExecutable: async () => undefined,
    readBridge: async () => undefined,
    executableForPid: async () => undefined,
    inspectExecutable: async () => ({ running: false, endpoints: [] }),
    probeEndpoint: async () => false,
    launchExecutable: async () => {},
    updateLaunchedAuthentication: () => {},
    stopLaunchedExecutable: async () => {},
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    ...overrides,
  };
}

describe("installed Ruijie Harness discovery", () => {
  it("prefers the compatible bundled runtime when no explicit override is set", async () => {
    const bundled = "C:\\resources\\ruijie-harness\\runtime\\Ruijie-Harness.exe";
    let running = false;
    const launchExecutable = vi.fn(async () => { running = true; });
    const locator = createRuijieHarnessLocator(dependencies({
      environment: {},
      pathExists: async (path) => path === bundled || path === WINDOWS_EXECUTABLE,
      readText: async () => JSON.stringify({
        schemaVersion: 1, version: "2.1.10", target: "win32-x64",
        executable: "runtime/Ruijie-Harness.exe",
        executableSha256: "a".repeat(64),
        bridge: { schemaVersion: 1, capability: "openmaus-server-v1" },
      }),
      inspectExecutable: async (path) => ({
        running: path === bundled && running,
        endpoints: path === bundled && running ? ["http://127.0.0.1:54873"] : [],
      }),
      probeEndpoint: async () => running,
      launchExecutable,
    }));
    locator.updateAuthentication({ accessToken: "access", refreshToken: "refresh" });
    await expect(locator.ensureEndpoint({ bridgePath: "bridge", bundledRoot: "C:\\resources\\ruijie-harness" }))
      .resolves.toBe("http://127.0.0.1:54873");
    expect(launchExecutable).toHaveBeenCalledWith(
      bundled, ["--openmaus-server"], {},
      { accessToken: "access", refreshToken: "refresh" }, expect.any(Function),
    );
  });

  it("requires Bot SSO before starting the bundled sidecar", async () => {
    const bundled = "C:\\resources\\ruijie-harness\\runtime\\Ruijie-Harness.exe";
    const launchExecutable = vi.fn();
    const locator = createRuijieHarnessLocator(dependencies({
      environment: {},
      pathExists: async (path) => path === bundled,
      readText: async () => JSON.stringify({
        schemaVersion: 1, version: "2.1.10", target: "win32-x64",
        executable: "runtime/Ruijie-Harness.exe", executableSha256: "a".repeat(64),
        bridge: { schemaVersion: 1, capability: "openmaus-server-v1" },
      }),
      launchExecutable,
    }));
    await expect(locator.ensureEndpoint({ bridgePath: "bridge", bundledRoot: "C:\\resources\\ruijie-harness" }))
      .rejects.toThrow("请先登录锐捷Bot企业账号");
    expect(launchExecutable).not.toHaveBeenCalled();
  });

  it("fails closed instead of falling back to an installed app when the configured bundle is invalid", async () => {
    const registeredExecutable = vi.fn(async () => WINDOWS_EXECUTABLE);
    const locator = createRuijieHarnessLocator(dependencies({
      readText: async () => JSON.stringify({ schemaVersion: 99 }),
      registeredExecutable,
    }));
    await expect(locator.ensureEndpoint({ bridgePath: "bridge", bundledRoot: "C:\\resources\\ruijie-harness" }))
      .rejects.toThrow("内置锐捷 Harness 缺失、损坏或版本不兼容");
    expect(registeredExecutable).not.toHaveBeenCalled();
  });

  it("rotates the private child authentication channel without exposing tokens in launch environment", async () => {
    let running = false;
    let childUpdate: ((next: { accessToken: string; refreshToken: string } | undefined) => void) | undefined;
    const persisted = vi.fn();
    const updateLaunchedAuthentication = vi.fn();
    const locator = createRuijieHarnessLocator(dependencies({
      inspectExecutable: async () => ({ running, endpoints: running ? ["http://127.0.0.1:54873"] : [] }),
      probeEndpoint: async () => running,
      launchExecutable: async (_path, _args, environment, _authentication, onUpdate) => {
        expect(environment).not.toHaveProperty("accessToken");
        expect(environment).not.toHaveProperty("refreshToken");
        childUpdate = onUpdate;
        running = true;
      },
      updateLaunchedAuthentication,
    }));
    locator.updateAuthentication({ accessToken: "access-1", refreshToken: "refresh-1" }, persisted);
    await locator.ensureEndpoint({ bridgePath: "bridge" });
    childUpdate?.({ accessToken: "access-2", refreshToken: "refresh-2" });
    expect(persisted).toHaveBeenCalledWith({ accessToken: "access-2", refreshToken: "refresh-2" });
    locator.updateAuthentication({ accessToken: "access-3", refreshToken: "refresh-3" });
    expect(updateLaunchedAuthentication).toHaveBeenCalledWith({ accessToken: "access-3", refreshToken: "refresh-3" });
  });

  it("lets an explicit executable override the bundled runtime", async () => {
    let running = false;
    const launchExecutable = vi.fn(async (path) => { running = path === WINDOWS_EXECUTABLE; });
    const locator = createRuijieHarnessLocator(dependencies({
      environment: { OMB_RUIJIE_HARNESS_BUNDLE: "C:\\resources\\ruijie-harness" },
      readText: async () => JSON.stringify({
        schemaVersion: 1, version: "2.1.10", target: "win32-x64",
        executable: "runtime/Ruijie-Harness.exe",
        executableSha256: "a".repeat(64),
        bridge: { schemaVersion: 1, capability: "openmaus-server-v1" },
      }),
      inspectExecutable: async (path) => ({ running, endpoints: running && path === WINDOWS_EXECUTABLE ? ["http://127.0.0.1:54873"] : [] }),
      probeEndpoint: async () => running,
      launchExecutable,
    }));
    await locator.ensureEndpoint({ bridgePath: "bridge", executablePath: WINDOWS_EXECUTABLE });
    expect(launchExecutable).toHaveBeenCalledWith(
      WINDOWS_EXECUTABLE, ["--openmaus-server"], {}, undefined, expect.any(Function),
    );
  });

  it("rejects an escaping or incompatible bundle manifest", async () => {
    const base = dependencies({ pathExists: async () => true, readText: async () => JSON.stringify({
      schemaVersion: 1, version: "2.1.10", target: "win32-x64",
      executable: "../Ruijie-Harness.exe", bridge: { schemaVersion: 1, capability: "openmaus-server-v1" },
      executableSha256: "a".repeat(64),
    }) });
    await expect(bundledRuijieHarnessExecutable("C:\\resources\\bundle", base)).resolves.toBeUndefined();
  });

  it("never attaches to a live separately installed Harness when a bundle is configured", async () => {
    const bundled = "C:\\resources\\ruijie-harness\\runtime\\Ruijie-Harness.exe";
    const launchExecutable = vi.fn();
    const locator = createRuijieHarnessLocator(dependencies({
      environment: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      pathExists: async (path) => path === bundled || path === WINDOWS_EXECUTABLE,
      readText: async () => JSON.stringify({
        schemaVersion: 1, version: "2.1.10", target: "win32-x64",
        executable: "runtime/Ruijie-Harness.exe", executableSha256: "a".repeat(64),
        bridge: { schemaVersion: 1, capability: "openmaus-server-v1" },
      }),
      readBridge: async () => ({ schemaVersion: 1, endpoint: "http://127.0.0.1:54873", pid: 42, generationId: "installed" }),
      executableForPid: async () => WINDOWS_EXECUTABLE,
      inspectExecutable: async (path) => ({
        running: path === bundled && running,
        endpoints: path === bundled && running ? ["http://127.0.0.1:54874"] : [],
      }),
      probeEndpoint: async (endpoint) => endpoint === "http://127.0.0.1:54873" || running,
      launchExecutable,
    }));
    let running = false;
    launchExecutable.mockImplementation(async (path) => { running = path === bundled; });
    locator.updateAuthentication({ accessToken: "access", refreshToken: "refresh" });
    await expect(locator.ensureEndpoint({ bridgePath: "bridge", bundledRoot: "C:\\resources\\ruijie-harness" }))
      .resolves.toBe("http://127.0.0.1:54874");
    expect(launchExecutable).toHaveBeenCalledWith(
      bundled, ["--openmaus-server"], {},
      { accessToken: "access", refreshToken: "refresh" }, expect.any(Function),
    );
  });

  it("does not let a passive status probe suppress an explicit on-demand launch", async () => {
    let running = false;
    const launchExecutable = vi.fn(async () => { running = true; });
    const locator = createRuijieHarnessLocator(dependencies({
      inspectExecutable: async () => ({ running, endpoints: running ? ["http://127.0.0.1:54873"] : [] }),
      probeEndpoint: async () => running,
      launchExecutable,
    }));
    const passive = locator.ensureEndpoint({ bridgePath: "bridge", autoLaunch: false });
    const active = locator.ensureEndpoint({ bridgePath: "bridge", autoLaunch: true });
    await expect(passive).rejects.toThrow("当前未运行");
    await expect(active).resolves.toBe("http://127.0.0.1:54873");
    expect(launchExecutable).toHaveBeenCalledTimes(1);
  });

  it("uses the platform's packaged application locations", () => {
    expect(installedRuijieHarnessCandidates("win32", {
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    }, "C:\\Users\\test")).toContain(WINDOWS_EXECUTABLE);
    expect(installedRuijieHarnessCandidates("darwin", {}, "/Users/test")).toEqual([
      "/Applications/锐捷 Harness.app/Contents/MacOS/锐捷 Harness",
      "/Users/test/Applications/锐捷 Harness.app/Contents/MacOS/锐捷 Harness",
    ]);
    expect(defaultRuijieBridgePath("darwin", {}, "/Users/test"))
      .toBe("/Users/test/Library/Application Support/锐捷 Harness/openmaus-bridge.json");
  });

  it("honours an explicit loopback endpoint without inspecting or launching an install", async () => {
    const inspectExecutable = vi.fn();
    const launchExecutable = vi.fn();
    const locator = createRuijieHarnessLocator(dependencies({ inspectExecutable, launchExecutable }));

    await expect(locator.ensureEndpoint({
      endpoint: "http://127.0.0.1:43123",
      bridgePath: "ignored",
    })).resolves.toBe("http://127.0.0.1:43123");
    expect(inspectExecutable).not.toHaveBeenCalled();
    expect(launchExecutable).not.toHaveBeenCalled();
  });

  it("ignores a development bridge and selects the running packaged executable", async () => {
    const launchExecutable = vi.fn();
    const locator = createRuijieHarnessLocator(dependencies({
      readBridge: async () => ({
        schemaVersion: 1,
        endpoint: "http://127.0.0.1:49863",
        pid: 28168,
        generationId: "development-generation",
      }),
      executableForPid: async (pid) => pid === 28168
        ? "D:\\ChatGPT\\RuijieDSH\\dsh-plugin-desktop\\node_modules\\electron\\dist\\electron.exe"
        : undefined,
      inspectExecutable: async (executable) => ({
        running: executable === WINDOWS_EXECUTABLE,
        endpoints: executable === WINDOWS_EXECUTABLE ? ["http://127.0.0.1:54873"] : [],
      }),
      probeEndpoint: async (endpoint) => endpoint === "http://127.0.0.1:54873",
      launchExecutable,
    }));

    await expect(locator.ensureEndpoint({
      bridgePath: "C:\\Users\\test\\AppData\\Roaming\\锐捷 Harness\\openmaus-bridge.json",
    })).resolves.toBe("http://127.0.0.1:54873");
    expect(launchExecutable).not.toHaveBeenCalled();
  });

  it("ignores a bridge owned by a different packaged copy with the same executable name", async () => {
    const locator = createRuijieHarnessLocator(dependencies({
      readBridge: async () => ({
        schemaVersion: 1,
        endpoint: "http://127.0.0.1:49863",
        pid: 28168,
        generationId: "development-package",
      }),
      executableForPid: async () => "D:\\dev\\Ruijie-Harness.exe",
      inspectExecutable: async () => ({
        running: true,
        endpoints: ["http://127.0.0.1:54873"],
      }),
      probeEndpoint: async (endpoint) => [
        "http://127.0.0.1:49863",
        "http://127.0.0.1:54873",
      ].includes(endpoint),
    }));

    await expect(locator.ensureEndpoint({ bridgePath: "bridge" }))
      .resolves.toBe("http://127.0.0.1:54873");
  });

  it("launches one installed Harness for concurrent callers and waits for readiness", async () => {
    let running = false;
    let inspections = 0;
    const launchExecutable = vi.fn(async () => { running = true; });
    const locator = createRuijieHarnessLocator(dependencies({
      inspectExecutable: async () => {
        inspections += 1;
        return {
          running,
          endpoints: running && inspections >= 3 ? ["http://127.0.0.1:54873"] : [],
        };
      },
      probeEndpoint: async (endpoint) => endpoint === "http://127.0.0.1:54873",
      launchExecutable,
    }));

    const options = {
      bridgePath: "C:\\Users\\test\\AppData\\Roaming\\锐捷 Harness\\openmaus-bridge.json",
      startupTimeoutMs: 5_000,
    };
    await expect(Promise.all([
      locator.ensureEndpoint(options),
      locator.ensureEndpoint(options),
    ])).resolves.toEqual(["http://127.0.0.1:54873", "http://127.0.0.1:54873"]);
    expect(launchExecutable).toHaveBeenCalledTimes(1);
    expect(launchExecutable).toHaveBeenCalledWith(
      WINDOWS_EXECUTABLE, ["--openmaus-server"], {}, undefined, expect.any(Function),
    );
  });

  it("stops the exact child it launched when the Bot disposes the driver", async () => {
    let running = false;
    const stopLaunchedExecutable = vi.fn(async () => { running = false; });
    const locator = createRuijieHarnessLocator(dependencies({
      inspectExecutable: async () => ({ running, endpoints: running ? ["http://127.0.0.1:54873"] : [] }),
      probeEndpoint: async () => running,
      launchExecutable: async () => { running = true; },
      stopLaunchedExecutable,
    }));
    await locator.ensureEndpoint({ bridgePath: "bridge" });
    await locator.dispose();
    expect(stopLaunchedExecutable).toHaveBeenCalledOnce();
  });

  it("launches a development Electron entry with its isolated Harness environment", async () => {
    let running = false;
    const launchExecutable = vi.fn(async () => { running = true; });
    const locator = createRuijieHarnessLocator(dependencies({
      inspectExecutable: async () => ({
        running,
        endpoints: running ? ["http://127.0.0.1:54873"] : [],
      }),
      probeEndpoint: async (endpoint) => endpoint === "http://127.0.0.1:54873",
      launchExecutable,
    }));

    await expect(locator.ensureEndpoint({
      bridgePath: "bridge",
      executableArgs: ["D:\\src\\lib\\main.js", "--openmaus-server"],
      launchEnvironment: {
        DSH_HOME: "D:\\src\\.local-data\\dsh-home",
        RUIJIE_DSH_USER_DATA_DIR: "D:\\src\\.local-data\\electron-user-data",
      },
    })).resolves.toBe("http://127.0.0.1:54873");
    expect(launchExecutable).toHaveBeenCalledWith(
      WINDOWS_EXECUTABLE,
      ["D:\\src\\lib\\main.js", "--openmaus-server"],
      {
        DSH_HOME: "D:\\src\\.local-data\\dsh-home",
        RUIJIE_DSH_USER_DATA_DIR: "D:\\src\\.local-data\\electron-user-data",
      },
      undefined,
      expect.any(Function),
    );
  });

  it("shares only an in-flight lookup and rediscovers the port after Harness restarts", async () => {
    let inspection = 0;
    let currentEndpoint = "http://127.0.0.1:54873";
    const locator = createRuijieHarnessLocator(dependencies({
      inspectExecutable: async () => ({
        running: true,
        endpoints: ["http://127.0.0.1:" + (++inspection === 1 ? "54873" : "54874")],
      }),
      probeEndpoint: async (endpoint) => endpoint === currentEndpoint,
    }));
    const options = { bridgePath: "bridge" };

    await expect(locator.ensureEndpoint(options)).resolves.toBe("http://127.0.0.1:54873");
    currentEndpoint = "http://127.0.0.1:54874";
    await expect(locator.ensureEndpoint(options)).resolves.toBe("http://127.0.0.1:54874");
  });

  it("does not relaunch Harness while cancelling an already-lost session", async () => {
    const launchExecutable = vi.fn();
    const locator = createRuijieHarnessLocator(dependencies({ launchExecutable }));

    await expect(locator.ensureEndpoint({
      bridgePath: "bridge",
      autoLaunch: false,
    })).rejects.toThrow("当前未运行");
    expect(launchExecutable).not.toHaveBeenCalled();
  });

  it("distinguishes a missing install from an installed app that is waiting for login", async () => {
    const missing = createRuijieHarnessLocator(dependencies({
      pathExists: async () => false,
    }));
    await expect(missing.ensureEndpoint({ bridgePath: "bridge", startupTimeoutMs: 500 }))
      .rejects.toThrow("未检测到锐捷 Harness");

    const waiting = createRuijieHarnessLocator(dependencies({
      inspectExecutable: async () => ({ running: true, endpoints: [] }),
    }));
    await expect(waiting.ensureEndpoint({ bridgePath: "bridge", startupTimeoutMs: 500 }))
      .rejects.toThrow("正在启动或等待登录");
  });
});
