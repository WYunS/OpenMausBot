// Windows host-computer MCP bridge. It keeps the CUA protocol transparent,
// but observes raw screenshots before Harness projects them for a text-only
// model and enforces the product's background-only presentation contract.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { augmentedPath } from "./env-path.ts";
import { createLineSplitter } from "./mcp-bridge.ts";

type Frame = { png: string; mime: "image/png" | "image/jpeg" | "image/webp" };
type Timer = (callback: () => void, delayMs: number) => unknown;

const MUTATING_TOOLS = new Set([
  "click", "double_click", "right_click", "drag", "invoke", "press_key", "hotkey", "scroll", "set_value", "type_text",
  "launch_app", "close_window", "maximize_window", "minimize_window", "restore_window",
]);
const BACKGROUND_DELIVERY_TOOLS = new Set([
  "click", "double_click", "right_click", "drag", "type_text", "press_key", "hotkey", "scroll", "browser_dialog",
]);
const IMAGE_TYPES = new Set<Frame["mime"]>(["image/png", "image/jpeg", "image/webp"]);

function rawImage(value: unknown): Frame | null {
  const seen = new Set<object>();
  const visit = (node: unknown, depth: number): Frame | null => {
    if (!node || typeof node !== "object" || depth > 10 || seen.has(node)) return null;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (record.type === "image" && typeof record.data === "string" && IMAGE_TYPES.has(record.mimeType as Frame["mime"])) {
      return { png: record.data, mime: record.mimeType as Frame["mime"] };
    }
    for (const child of Array.isArray(node) ? node : Object.values(record)) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return visit(value, 0);
}

function launchedTarget(value: unknown): { pid: number; window_id: number } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, any>;
  const windows = record.windows ?? record.structuredContent?.windows ?? record.result?.windows;
  if (!Array.isArray(windows)) return null;
  for (const window of windows) {
    const pid = Number(window?.pid);
    const windowId = Number(window?.window_id);
    if (Number.isSafeInteger(pid) && Number.isSafeInteger(windowId)) return { pid, window_id: windowId };
  }
  return null;
}

export function createLocalComputerProxyInterceptor(options: {
  toDriver: (line: string) => void;
  toClient: (line: string) => void;
  publishFrame: (frame: Frame) => Promise<void>;
  prepareWindow?: (target: { pid: number; window_id: number }) => Promise<void>;
  schedule?: Timer;
}) {
  const pending = new Map<string | number, { name: string; args: Record<string, unknown> }>();
  const listRequests = new Set<string | number>();
  const synthetic = new Set<string>();
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  let observation = 0;
  let observationGeneration = 0;
  let observationInFlight: string | null = null;
  let observationWanted = false;
  let lastTarget: { pid: number; window_id: number } | null = null;

  const rememberTarget = (args: Record<string, unknown>) => {
    const pid = Number(args.pid);
    const windowId = Number(args.window_id);
    if (Number.isSafeInteger(pid) && Number.isSafeInteger(windowId)) lastTarget = { pid, window_id: windowId };
  };
  const requestObservation = (generation: number) => {
    if (!lastTarget || generation !== observationGeneration) return;
    if (observationInFlight) {
      observationWanted = true;
      return;
    }
    const send = () => {
      if (!lastTarget || generation !== observationGeneration || observationInFlight) return;
      const id = `omb-screen-${process.pid}-${++observation}`;
      synthetic.add(id);
      observationInFlight = id;
      options.toDriver(JSON.stringify({
        jsonrpc: "2.0", id, method: "tools/call",
        params: {
          name: "get_window_state",
          // Synthetic observations exist only to refresh the picture. Keep
          // the UIA walk tiny so several paint-boundary frames cannot slow
          // down the agent's semantic snapshot.
          arguments: { ...lastTarget, max_depth: 1, max_elements: 10 },
        },
      }));
    };
    if (options.prepareWindow) return options.prepareWindow(lastTarget).then(send, send);
    send();
  };

  return {
    fromClient(line: string) {
      let message: any;
      try { message = JSON.parse(line); } catch { options.toDriver(line); return; }
      if (message?.method === "tools/list" && (typeof message.id === "string" || typeof message.id === "number")) {
        listRequests.add(message.id);
      }
      if (message?.method !== "tools/call") { options.toDriver(line); return; }
      // Real work outranks preview refreshes. Any not-yet-dispatched frame
      // from the previous action is stale as soon as the model chooses its
      // next step; keep at most the one already in flight.
      observationGeneration += 1;
      observationWanted = false;
      const id = message.id;
      const name = String(message.params?.name ?? "");
      const args = message.params?.arguments && typeof message.params.arguments === "object"
        ? { ...message.params.arguments }
        : {};
      if (name === "bring_to_front") {
        options.toClient(JSON.stringify({
          jsonrpc: "2.0", id: id ?? null,
          result: {
            isError: true,
            content: [{ type: "text", text: "OpenMausBot keeps the controlled window in the background so the demonstration stays visible in the app." }],
          },
        }));
        return;
      }
      if (BACKGROUND_DELIVERY_TOOLS.has(name)) args.delivery_mode = "background";
      rememberTarget(args);
      const forward = () => {
        if (typeof id === "string" || typeof id === "number") pending.set(id, { name, args });
        options.toDriver(JSON.stringify({ ...message, params: { ...message.params, arguments: args } }));
      };
      if (name === "get_window_state" && lastTarget && options.prepareWindow) {
        return options.prepareWindow(lastTarget).then(forward, forward);
      }
      forward();
    },

    fromDriver(line: string) {
      let message: any;
      try { message = JSON.parse(line); } catch { options.toClient(line); return; }
      const id = message?.id;
      if (synthetic.has(id)) {
        synthetic.delete(id);
        if (observationInFlight === id) observationInFlight = null;
        const image = rawImage(message?.result);
        if (image) void options.publishFrame(image);
        if (observationWanted) {
          observationWanted = false;
          requestObservation(observationGeneration);
        }
        return;
      }
      if (listRequests.delete(id) && Array.isArray(message?.result?.tools)) {
        message.result.tools = message.result.tools.filter((tool: any) => tool?.name !== "bring_to_front");
        line = JSON.stringify(message);
      }
      const call = pending.get(id);
      if (call) pending.delete(id);
      const opened = call?.name === "launch_app" ? launchedTarget(message?.result) : null;
      if (opened) lastTarget = opened;
      const image = rawImage(message?.result);
      if (image) void options.publishFrame(image);
      options.toClient(line);
      if (call && MUTATING_TOOLS.has(call.name) && lastTarget) {
        // Capture the immediate response plus the two common browser paint
        // boundaries. Newer frames replace older ones in the panel.
        const generation = ++observationGeneration;
        observationWanted = false;
        const start = () => {
          for (const delay of [40, 200, 500, 900, 1_500]) {
            schedule(() => {
              if (generation === observationGeneration) void requestObservation(generation);
            }, delay);
          }
        };
        if (opened && options.prepareWindow) void options.prepareWindow(opened).then(start, start);
        else start();
      }
    },
  };
}

function createBackgroundWindowRestorer(): {
  restore: (target: { window_id: number }) => Promise<void>;
  close: () => void;
} {
  const script = [
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OmbBackgroundWindow { [DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); }'",
    "[Console]::Out.WriteLine('ready')",
    "while (($line = [Console]::In.ReadLine()) -ne $null) {",
    "  try { $h = [IntPtr]([long]$line); if ([OmbBackgroundWindow]::IsIconic($h)) { [void][OmbBackgroundWindow]::ShowWindowAsync($h, 4) }; [Console]::Out.WriteLine('ok') }",
    "  catch { [Console]::Out.WriteLine('error') }",
    "}",
  ].join("; ");
  const helper = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
  helper.stdin.on("error", () => undefined);
  const pending: Array<() => void> = [];
  readlineLines(helper.stdout, (line) => {
    if (line === "ready") return;
    pending.shift()?.();
  });
  const finish = () => { while (pending.length) pending.shift()?.(); };
  helper.on("error", finish);
  helper.on("close", finish);
  return {
    restore(target) {
      if (!Number.isSafeInteger(target.window_id) || target.window_id <= 0 || helper.exitCode !== null) return Promise.resolve();
      return new Promise<void>((resolve) => {
        pending.push(resolve);
        helper.stdin.write(`${target.window_id}\n`);
      });
    },
    close() { helper.stdin.end(); helper.kill(); finish(); },
  };
}

function readlineLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  const splitter = createLineSplitter(onLine);
  stream.on("data", (chunk: Buffer) => splitter.push(chunk));
  stream.on("end", () => splitter.flush());
}

async function postFrame(frame: Frame): Promise<void> {
  const url = process.env.OMB_CONTROL_URL;
  const token = process.env.OMB_CONTROL_TOKEN;
  if (!url || !token) return;
  await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "frame", ...frame }),
    signal: AbortSignal.timeout(4_000),
  }).then(() => undefined, () => undefined);
}

export function runLocalComputerProxy(): void {
  const command = process.env.OMB_CUA_COMMAND;
  if (!command) throw new Error("OMB_CUA_COMMAND is required");
  let args: string[] = [];
  try {
    const parsed = JSON.parse(process.env.OMB_CUA_ARGS ?? "[]");
    if (!Array.isArray(parsed) || !parsed.every((arg) => typeof arg === "string")) throw new Error();
    args = parsed;
  } catch {
    throw new Error("OMB_CUA_ARGS must be a JSON string array");
  }
  const child = spawn(command, args, {
    shell: false,
    windowsHide: true,
    env: { ...process.env, PATH: augmentedPath() },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => undefined);
  child.stderr.pipe(process.stderr);
  const restorer = process.platform === "win32" ? createBackgroundWindowRestorer() : null;
  const proxy = createLocalComputerProxyInterceptor({
    toDriver: (line) => child.stdin.write(line + "\n"),
    toClient: (line) => process.stdout.write(line + "\n"),
    publishFrame: postFrame,
    prepareWindow: restorer ? (target) => restorer.restore(target) : undefined,
  });
  const inbound = createLineSplitter(proxy.fromClient);
  const outbound = createLineSplitter(proxy.fromDriver);
  process.stdin.on("data", (chunk: Buffer) => inbound.push(chunk));
  process.stdin.on("end", () => { inbound.flush(); child.stdin.end(); });
  child.stdout.on("data", (chunk: Buffer) => outbound.push(chunk));
  child.stdout.on("end", () => outbound.flush());
  child.on("error", (error) => {
    process.stderr.write(`could not start Cua Driver: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on("close", (code) => { restorer?.close(); process.exitCode = process.exitCode ?? code ?? 1; });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { restorer?.close(); child.kill(signal); });
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  runLocalComputerProxy();
}
