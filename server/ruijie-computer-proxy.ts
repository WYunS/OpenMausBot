// MCP computer tools for a Ruijie sandbox whose only control plane is noVNC.
// Electron owns the credential-bearing viewer and exposes a turn-scoped,
// loopback-only action API. This child receives only that opaque bearer.
import { CONTROL_REFUSAL, createControlClient } from "./control-client.ts";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const host = String(process.env.OMB_DESKTOP_URL ?? "").replace(/\/$/, "");
const token = String(process.env.OMB_DESKTOP_TOKEN ?? "");
const botId = String(process.env.OMB_BOT_ID ?? "");
const control = createControlClient();
const CONTROL_POLL_MS = Math.max(Number(process.env.OMB_CONTROL_POLL_MS) || 1_500, 25);
const CONTROL_WAIT_MS = Math.max(Number(process.env.OMB_CONTROL_WAIT_MS) || 600_000, 100);
const FRAME_DIRECTORY = join(tmpdir(), `openmausbot-ruijie-frame-${process.pid}`);

const TOOLS = [
  {
    // Harness recognizes this conventional computer-tool name and promotes
    // the returned MCP image into its vision pipeline. A generic `screenshot`
    // result is treated as an opaque tool attachment by text-only routes.
    name: "get_desktop_state",
    description: "Capture the current Ruijie sandbox desktop. Use the returned image coordinates for click and scroll.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "click",
    description: "Click the Ruijie sandbox desktop and return the resulting screen.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" }, y: { type: "number" },
        button: { type: "string", enum: ["left", "right"] },
        double: { type: "boolean" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "type_text",
    description: "Type text into the focused control and return the resulting screen.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "press_key",
    description: "Press a key or chord such as Enter, Tab, ctrl+l, ctrl+c, or alt+F4 and return the screen.",
    inputSchema: { type: "object", properties: { keys: { type: "string" } }, required: ["keys"] },
  },
  {
    name: "scroll",
    description: "Scroll up or down and return the resulting screen.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        clicks: { type: "number", description: "1-20, default 3" },
        x: { type: "number" }, y: { type: "number" },
      },
      required: ["direction"],
    },
  },
  {
    name: "computer_request_help",
    description: "Ask the person to take over for sign-in, CAPTCHA, or another protected step and wait until they hand control back.",
    inputSchema: { type: "object", properties: { reason: { type: "string" } } },
  },
] as const;

function send(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function text(id: unknown, value: string, isError = false): void {
  send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) } });
}

function observed(id: unknown, note: string, frame: any): void {
  if (!frame || typeof frame.png !== "string" || !frame.png) {
    text(id, `${note}; no desktop frame was returned`, true);
    return;
  }
  const dimensions = Number.isFinite(frame.width) && Number.isFinite(frame.height)
    ? ` (${frame.width}×${frame.height})`
    : "";
  const mime = frame.mime === "image/jpeg" ? "image/jpeg" : "image/png";
  const framePath = join(FRAME_DIRECTORY, mime === "image/jpeg" ? "desktop.jpg" : "desktop.png");
  try {
    mkdirSync(FRAME_DIRECTORY, { recursive: true, mode: 0o700 });
    writeFileSync(framePath, Buffer.from(frame.png, "base64"), { mode: 0o600 });
  } catch (error) {
    text(id, `${note}; the desktop frame could not be staged for vision: ${error instanceof Error ? error.message : String(error)}`, true);
    return;
  }
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [
        { type: "text", text: `${note}${dimensions}. The current frame is also available at ${framePath}; inspect that image directly if inline vision is unavailable.` },
        { type: "image", data: frame.png, mimeType: mime },
      ],
    },
  });
}

async function desktop(operation: string, body: Record<string, unknown> = {}): Promise<any> {
  if (!host || !/^[0-9a-f]{64}$/.test(token) || !/^[A-Za-z0-9_-]{1,120}$/.test(botId)) {
    throw new Error("the Ruijie desktop bridge is not configured for this turn");
  }
  const response = await fetch(`${host}/v1/desktop/${encodeURIComponent(botId)}/${operation}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const result: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `desktop bridge HTTP ${response.status}`);
  return result;
}

async function requestHelp(id: unknown, reason: string): Promise<void> {
  if (!control.configured) return text(id, "nobody can be paged for this computer right now", true);
  const initial = await control.state(true);
  const requestId = initial.held ? null : await control.requestHelp(reason);
  if (!initial.held && requestId === null) return text(id, "The person could not be paged right now.", true);
  let sawHold = initial.held;
  const deadline = Date.now() + CONTROL_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CONTROL_POLL_MS));
    const state = await control.state(true);
    if (state.held) sawHold = true;
    if (!state.held && !state.helpOpen) {
      return text(id, sawHold
        ? "The person handed control back. Take a fresh screenshot before continuing."
        : "The person dismissed the request without taking control. Carry on carefully.");
    }
  }
  if (requestId) await control.expireHelp(requestId);
  text(id, "Nobody took control within the wait window.", true);
}

async function call(id: unknown, name: string, args: any): Promise<void> {
  if (name === "computer_request_help") return requestHelp(id, String(args?.reason ?? ""));
  if ((await control.state(true)).held) return text(id, CONTROL_REFUSAL, true);
  if (name === "get_desktop_state") return observed(id, "screen captured", await desktop("screenshot"));
  if (name === "click") {
    const x = Math.round(Number(args?.x));
    const y = Math.round(Number(args?.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return text(id, "click needs numeric x and y", true);
    return observed(id, `${args?.double ? "double-clicked" : "clicked"} ${x},${y}`, await desktop("click", {
      x, y, button: args?.button === "right" ? "right" : "left", double: args?.double === true,
    }));
  }
  if (name === "type_text") {
    const value = String(args?.text ?? "");
    if (!value) return text(id, "nothing to type", true);
    return observed(id, `typed ${value.length} characters`, await desktop("type", { text: value }));
  }
  if (name === "press_key") {
    const keys = String(args?.keys ?? "").trim();
    if (!keys) return text(id, "press_key needs keys", true);
    return observed(id, `pressed ${keys}`, await desktop("press", { keys }));
  }
  if (name === "scroll") {
    const direction = args?.direction === "up" ? "up" : "down";
    const clicks = Math.min(Math.max(Math.round(Number(args?.clicks) || 3), 1), 20);
    return observed(id, `scrolled ${direction} ${clicks}`, await desktop("scroll", {
      direction, clicks, x: args?.x, y: args?.y,
    }));
  }
  text(id, `unknown tool ${name}`, true);
}

async function handle(message: any): Promise<void> {
  if (message.method === "initialize") {
    return send({
      jsonrpc: "2.0", id: message.id,
      result: { protocolVersion: message.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "openmausbot-ruijie-computer", version: "1" } },
    });
  }
  if (message.method === "tools/list") return send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
  if (message.method === "tools/call") {
    try {
      await call(message.id, String(message.params?.name ?? ""), message.params?.arguments ?? {});
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      text(message.id, `computer tool failed: ${detail}`, true);
    }
    return;
  }
  if (!String(message.method ?? "").startsWith("notifications/") && message.id != null) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } });
  }
}

let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += chunk;
  let newline;
  while ((newline = pending.indexOf("\n")) !== -1) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    if (!line.trim()) continue;
    try { void handle(JSON.parse(line)); } catch {}
  }
});
process.stdin.on("end", () => { process.exitCode = 0; });
process.once("exit", () => {
  try { rmSync(FRAME_DIRECTORY, { recursive: true, force: true }); } catch {}
});
