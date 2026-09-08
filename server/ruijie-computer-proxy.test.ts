import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PROXY = join(SERVER_DIR, "ruijie-computer-proxy.ts");
const TOKEN = "b".repeat(64);

describe("Ruijie noVNC computer proxy", () => {
  let bridge: Server;
  let proxy: ChildProcess;
  const requests: Array<{ path: string; body: any }> = [];
  const results = new Map<number, any>();

  const rpc = (message: unknown) => proxy.stdin!.write(`${JSON.stringify(message)}\n`);
  const waitFor = async (id: number) => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (results.has(id)) return results.get(id);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`no MCP response for ${id}`);
  };

  beforeAll(async () => {
    bridge = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
        requests.push({ path: req.url ?? "", body: JSON.parse(raw || "{}") });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ png: "cG5n", mime: "image/png" }));
      });
    });
    await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
    const port = (bridge.address() as any).port;
    proxy = spawn(process.execPath, ["--experimental-strip-types", PROXY], {
      env: {
        ...process.env,
        OMB_DESKTOP_URL: `http://127.0.0.1:${port}`,
        OMB_DESKTOP_TOKEN: TOKEN,
        OMB_BOT_ID: "bot-a",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let pending = "";
    proxy.stdout!.on("data", (chunk) => {
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id != null) results.set(message.id, message);
      }
    });
    rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await waitFor(1);
  });

  afterAll(() => {
    proxy?.kill();
    bridge?.close();
  });

  it("exposes visual desktop tools", async () => {
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const response = await waitFor(2);
    expect(response.result.tools.map((tool: any) => tool.name)).toEqual([
      "get_desktop_state", "click", "type_text", "press_key", "scroll", "computer_request_help",
    ]);
  });

  it("returns the post-action frame in the same click result", async () => {
    rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "click", arguments: { x: 25, y: 40 } } });
    const response = await waitFor(3);
    expect(requests.at(-1)).toEqual({
      path: "/v1/desktop/bot-a/click",
      body: { x: 25, y: 40, button: "left", double: false },
    });
    expect(response.result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image", data: "cG5n", mimeType: "image/png" }),
      expect.objectContaining({ type: "text", text: expect.stringMatching(/desktop\.png/) }),
    ]));
  });
});
