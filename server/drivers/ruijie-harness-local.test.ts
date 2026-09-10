import { describe, expect, it, vi } from "vitest";

import {
  createRuijieHarnessLocator,
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
    environment: {
      APPDATA: "C:\\Users\\test\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
    },
    home: "C:\\Users\\test",
    pathExists: async (path) => path === WINDOWS_EXECUTABLE,
    registeredExecutable: async () => undefined,
    readBridge: async () => undefined,
    executableForPid: async () => undefined,
    inspectExecutable: async () => ({ running: false, endpoints: [] }),
    probeEndpoint: async () => false,
    launchExecutable: async () => {},
    stopLaunchedExecutable: async () => {},
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    ...overrides,
  };
}

describe("installed Ruijie Harness discovery", () => {
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
    expect(launchExecutable).toHaveBeenCalledWith(WINDOWS_EXECUTABLE, ["--openmaus-server"], {});
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
      .rejects.toThrow("未检测到已安装的锐捷 Harness");

    const waiting = createRuijieHarnessLocator(dependencies({
      inspectExecutable: async () => ({ running: true, endpoints: [] }),
    }));
    await expect(waiting.ensureEndpoint({ bridgePath: "bridge", startupTimeoutMs: 500 }))
      .rejects.toThrow("正在启动或等待登录");
  });
});
