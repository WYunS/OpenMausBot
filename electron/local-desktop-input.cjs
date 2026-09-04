const { execFile, spawn } = require("node:child_process");

const IGNORED_APPS = new Set([
  "clicktodo.exe",
  "cua-driver.exe",
  "shellexperiencehost.exe",
  "textinputhost.exe",
]);

function normalizedPoint(input) {
  const x = Number(input?.xRatio);
  const y = Number(input?.yRatio);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

function selectUnderlyingWindow(windows, point, hostPid) {
  if (!Array.isArray(windows) || !point) return null;
  return [...windows]
    .filter((window) => {
      const bounds = window?.bounds;
      const app = String(window?.app_name ?? "").toLowerCase();
      return window?.is_on_screen === true &&
        window?.minimized !== true &&
        Number(window?.pid) !== Number(hostPid) &&
        !IGNORED_APPS.has(app) &&
        Number(bounds?.width) > 0 &&
        Number(bounds?.height) > 0 &&
        point.x >= Number(bounds.x) &&
        point.y >= Number(bounds.y) &&
        point.x < Number(bounds.x) + Number(bounds.width) &&
        point.y < Number(bounds.y) + Number(bounds.height);
    })
    .sort((a, b) => Number(b.z_index ?? 0) - Number(a.z_index ?? 0))[0] ?? null;
}

function selectElementAtPoint(elements, point) {
  if (!Array.isArray(elements) || !point) return null;
  return [...elements]
    .filter((element) => {
      const frame = element?.frame;
      return element?.enabled !== false &&
        typeof element?.element_token === "string" &&
        Number(frame?.w) > 0 &&
        Number(frame?.h) > 0 &&
        point.x >= Number(frame.x) &&
        point.y >= Number(frame.y) &&
        point.x < Number(frame.x) + Number(frame.w) &&
        point.y < Number(frame.y) + Number(frame.h);
    })
    .sort((a, b) => {
      const depth = Number(b.depth ?? 0) - Number(a.depth ?? 0);
      if (depth !== 0) return depth;
      return Number(a.frame.w) * Number(a.frame.h) - Number(b.frame.w) * Number(b.frame.h);
    })[0] ?? null;
}

function run(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, timeout: 5_000, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(String(stdout ?? ""));
    });
  });
}

function parseOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
}

function createLocalDesktopInputController({ binary, hostPid, socketPath, spawnProcess = spawn, runProcess = run }) {
  let daemon = null;
  let ready = null;
  let display = null;
  let target = null;
  let lastPoint = null;

  const command = async (tool, payload) => parseOutput(await runProcess(
    binary,
    ["call", tool, JSON.stringify(payload), "--socket", socketPath],
  ));

  // Input tools may return a plain status token such as `foreground_only`.
  // Their process exit status is the contract; only query tools need JSON.
  const action = async (tool, payload) => {
    await runProcess(binary, ["call", tool, JSON.stringify(payload), "--socket", socketPath]);
    return true;
  };

  const backgroundFirst = async (tool, payload) => {
    try {
      return await action(tool, { ...payload, delivery_mode: "background" });
    } catch {
      // Human takeover is explicit. Chromium/canvas targets intentionally
      // reject background delivery; a brief foreground delivery is safe here
      // because OpenMausBot remains topmost and capture-excluded.
      return action(tool, { ...payload, delivery_mode: "foreground" });
    }
  };

  const ensureStarted = async () => {
    if (ready) return ready;
    ready = (async () => {
      const child = spawnProcess(
        binary,
        ["serve", "--socket", socketPath, "--permission-mode", "standard", "--no-overlay"],
        { windowsHide: true, stdio: "ignore" },
      );
      daemon = child;
      child.once?.("exit", () => {
        if (daemon !== child) return;
        daemon = null;
        ready = null;
        display = null;
        target = null;
        lastPoint = null;
      });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          await runProcess(binary, ["status", "--socket", socketPath]);
          return true;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      throw new Error("The local desktop input driver did not become ready");
    })().catch((error) => {
      ready = null;
      throw error;
    });
    return ready;
  };

  const locateTarget = async (input) => {
    const ratio = normalizedPoint(input);
    if (!ratio) throw new Error("The desktop position is invalid");
    display ??= await command("get_screen_size", {});
    const point = {
      x: Math.round(ratio.x * Number(display.width)),
      y: Math.round(ratio.y * Number(display.height)),
    };
    const listed = await command("list_windows", { on_screen_only: true });
    const window = selectUnderlyingWindow(listed.windows ?? listed._legacy_windows, point, hostPid);
    if (!window) throw new Error("No controllable window is visible at that point");
    target = window;
    lastPoint = {
      x: point.x - Number(window.bounds?.x ?? window.x ?? 0),
      y: point.y - Number(window.bounds?.y ?? window.y ?? 0),
    };
    return { window, point: lastPoint };
  };

  return Object.freeze({
    async input(input) {
      await ensureStarted();
      const kind = String(input?.kind ?? "");
      if (kind === "click") {
        const located = await locateTarget(input);
        // Explorer's desktop ListView silently drops background pixel
        // messages. Its UI Automation elements are reliable and still keep
        // OpenMausBot in front, so resolve the icon under the click first.
        if (String(located.window.app_name ?? "").toLowerCase() === "explorer.exe" && located.window.title === "Program Manager") {
          const state = await command("get_window_state", {
            pid: Number(located.window.pid),
            window_id: Number(located.window.window_id),
          });
          const element = selectElementAtPoint(state.elements, located.point);
          if (element) {
            await backgroundFirst("click", {
              pid: Number(located.window.pid),
              window_id: Number(located.window.window_id),
              element_token: element.element_token,
              button: input?.button === "right" ? "right" : "left",
              count: input?.double === true ? 2 : 1,
            });
            return true;
          }
        }
        await backgroundFirst("click", {
          pid: Number(located.window.pid),
          window_id: Number(located.window.window_id),
          x: located.point.x,
          y: located.point.y,
          button: input?.button === "right" ? "right" : "left",
          count: input?.double === true ? 2 : 1,
        });
        return true;
      }
      if (!target) throw new Error("Click a field in the desktop view first");
      const base = {
        pid: Number(target.pid),
        window_id: Number(target.window_id),
      };
      if (kind === "text") {
        const text = String(input?.text ?? "");
        if (!text || text.length > 256) throw new Error("The typed text is invalid");
        await backgroundFirst("type_text", { ...base, ...lastPoint, text });
        return true;
      }
      if (kind === "key") {
        const key = String(input?.key ?? "").toLowerCase();
        if (!/^(enter|return|tab|escape|backspace|delete|arrow(up|down|left|right))$/.test(key)) {
          throw new Error("That key is not supported in the desktop view");
        }
        await backgroundFirst("press_key", { ...base, key: key === "enter" ? "return" : key });
        return true;
      }
      if (kind === "scroll") {
        await backgroundFirst("scroll", {
          ...base,
          ...lastPoint,
          direction: Number(input?.deltaY) < 0 ? "up" : "down",
          amount: 3,
          by: "line",
        });
        return true;
      }
      throw new Error("Unsupported desktop input");
    },
    async stop() {
      target = null;
      lastPoint = null;
      display = null;
      if (!ready) return;
      try { await runProcess(binary, ["stop", "--socket", socketPath]); } catch {}
      daemon?.kill?.();
      daemon = null;
      ready = null;
    },
  });
}

module.exports = { createLocalDesktopInputController, normalizedPoint, selectElementAtPoint, selectUnderlyingWindow };
