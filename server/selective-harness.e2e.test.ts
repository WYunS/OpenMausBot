// Real Bot server + real Harness adapter against an offline loopback protocol
// peer. Only the native service/container boundaries are synthetic; no account,
// model, desktop, or user's home is contacted.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freePortBlock } from "./testing/ports.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
let child: ChildProcess;
let home = "", base = "", vmState = "", stderr = "";
const sockets = new Set<Duplex>();
const sessions = new Map<string, { running: boolean; turn: number; events: any[]; preset: string }>();
const prompts: string[] = [], cancellations: string[] = [], answers: any[] = [];
const methods: string[] = [];
let failAnswer = false;
const peer = createServer(async (req, res) => {
  const json = (body: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (req.url === "/__dsh_desktop/ruijie-account") return json({ authentication: "sso", account: { id: "offline-fixture", email: "fixture@example.invalid" }, billing: { currency: "CNY", remaining: 10 } });
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  methods.push(body.method ?? req.url ?? "unknown");
  if (req.url === "/api/respond") {
    if (failAnswer) return json({ error: "fixture response unavailable" }, 503);
    answers.push(body);
    frame({ type: "question/resolved", sessionId: body.result?.value?.sessionId ?? prompts.at(-1), questionRpcId: body.rpcId });
    return json({ accepted: true });
  }
  const payload = body.payload ?? {};
  let value: unknown = {};
  switch (body.method) {
    case "host.describe": value = { version: "2.1.10-fixture" }; break;
    case "llm.models": value = { groups: [{ id: "deepseek-vision", models: [{ id: "deepseek-v4-flash", name: "Fixture" }] }] }; break;
    case "agentPreset.list": value = { presets: [{ id: "standard", trust: "system", isDefault: true }], authorable: true, hasDocument: true }; break;
    case "agentPreset.read": value = { content: "[]\n", trust: "system" }; break;
    case "session.create": {
      const sessionId = `session-${randomUUID()}`;
      sessions.set(sessionId, { running: false, turn: 0, events: [], preset: payload.agentPreset });
      value = { sessionId }; break;
    }
    case "session.prompt": {
      const session = sessions.get(payload.sessionId)!;
      session.running = true; session.turn++;
      prompts.push(payload.sessionId);
      event(payload.sessionId, "turn/start", { turn: session.turn });
      value = { accepted: true }; break;
    }
    case "session.cancel": cancellations.push(payload.sessionId); value = { accepted: true }; break;
    case "session.history": value = { events: sessions.get(payload.sessionId)?.events.map(event => ({ event })) ?? [], hasMore: false }; break;
    case "session.list": value = { items: [...sessions].map(([sessionId, s]) => ({ sessionId, running: s.running })) }; break;
  }
  json({ type: "server-response", rpcId: body.rpcId, result: { ok: true, value } });
});
// Minimal write-only WebSocket peer, sufficient for the native events.mux
// stream. Frames are real websocket transport, not adapter method mocks.
peer.on("upgrade", (req, socket) => {
  const accept = createHash("sha1").update(String(req.headers["sec-websocket-key"]) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => sockets.delete(socket));
  socket.on("data", data => { if ((data[0] & 15) === 8) socket.end(Buffer.from([0x88, 0])); });
});
function frame(payload: unknown, rpcId = randomUUID()) {
  const data = Buffer.from(JSON.stringify({ type: "server-request", rpcId, method: "events.mux", payload }));
  const header = Buffer.alloc(data.length < 126 ? 2 : 4); header[0] = 0x81;
  if (data.length < 126) header[1] = data.length;
  else { header[1] = 126; header.writeUInt16BE(data.length, 2); }
  for (const socket of sockets) socket.write(Buffer.concat([header, data]));
}
function event(sessionId: string, type: string, data: unknown) {
  const session = sessions.get(sessionId)!;
  const entry = { type, data, seq: session.events.length };
  session.events.push(entry); frame({ type: "session/event", sessionId, event: entry });
}
function finish(sessionId: string, aborted = false) {
  const session = sessions.get(sessionId)!; session.running = false;
  event(sessionId, "turn/end", { turn: session.turn, reason: aborted ? { kind: "aborted", reason: { kind: "user" } } : { kind: "completed" } });
}
async function api(method: string, path: string, body?: unknown, status?: number) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await res.json() as any;
  expect(status === undefined ? res.ok : res.status === status, `${method} ${path}: ${res.status} ${JSON.stringify(result)}`).toBe(true);
  return result;
}
async function until<T>(read: () => T | Promise<T>, accept: (v: T) => boolean) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read(); if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Fixture timeout: ${JSON.stringify(value)}\nRPCs: ${JSON.stringify(methods.slice(-25))}\nBots: ${await fetch(base + "/api/bots?messages=8").then(r => r.text())}\n${stderr}`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
const idle = (id: string) => until(() => api("GET", "/api/bots?messages=0"), r => !r.bots.find((b: any) => b.id === id)?.busy);
const messages = (id: string) => api("GET", "/api/bots?messages=100").then(r => r.bots.find((b: any) => b.id === id)?.messages ?? []);
const preset = (sessionId: string) => readFileSync(join(home, ".dsh", ".agent-presets", sessions.get(sessionId)!.preset, "agent.cordis.yml"), "utf8");
async function bot(name: string, computer: "off" | "vm") {
  const result = await api("POST", "/api/bots", { name, modelSelection: { instanceId: "ruijieHarness", model: "deepseek-vision::deepseek-v4-flash" }, requireAvailableModel: true });
  await api("PATCH", `/api/bots/${result.bot.id}`, { computer, approvalMode: "auto", soul: "Reply briefly. This is a configured fixture." });
  return result.bot;
}
beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-selective-harness-"));
  const data = join(home, "data"), ui = join(home, "static");
  mkdirSync(data); mkdirSync(join(ui, "assets"), { recursive: true });
  writeFileSync(join(ui, "index.html"), "<title>Isolated Harness verification</title>");
  writeFileSync(join(ui, "assets", "fixture.css"), "body{}");
  vmState = join(home, "vm.json"); writeFileSync(vmState, "{}");
  await new Promise<void>(resolve => peer.listen(0, "127.0.0.1", resolve));
  const port = await freePortBlock([0, 1]); base = `http://127.0.0.1:${port}`;
  const endpoint = `http://127.0.0.1:${(peer.address() as { port: number }).port}`;
  writeFileSync(join(data, "config.json"), JSON.stringify({ profile: { email: "fixture@example.invalid" }, browser: { enabled: true }, instances: {
    ruijieHarness: { driver: "ruijieHarness", enabled: true, config: { endpoint, dshHome: join(home, ".dsh") } },
  } }));
  child = spawn(process.execPath, ["--import", pathToFileURL(join(root, "server/testing/group-local-vm-hooks.mjs")).href, join(root, "server/index.ts")], {
    cwd: root, windowsHide: true, env: { PATH: dirname(process.execPath), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home, USERPROFILE: home, APPDATA: join(home, "appdata"), LOCALAPPDATA: join(home, "localappdata"),
      TEMP: home, TMP: home, TMPDIR: home, OMB_DATA_DIR: data, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1),
      OMB_STATIC_DIR: ui, OMB_TEST_VM_STATE: vmState,
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.resume(); child.stderr!.on("data", chunk => { stderr += chunk; });
  await until(async () => { if (child.exitCode !== null) throw new Error(stderr); try { return (await fetch(base + "/api/health")).ok; } catch { return false; } }, Boolean);
});
afterAll(async () => {
  if (vmState) writeFileSync(vmState, "{}");
  for (const [id, session] of sessions) if (session.running) finish(id, true);
  await waitForExit(child, { signal: "SIGTERM" });
  for (const socket of sockets) socket.destroy();
  await new Promise<void>(resolve => peer.close(() => resolve()));
  const evidence = join(root, ".omb-scratch/verify-evidence/selective-upgrade"); mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, "server.log"), stderr);
  if (home) await removeTempDir(home);
});

describe("selective upgrade on the real isolated Bot server", () => {
  it("keeps a shared desktop owned beyond the old six-second stall grace until Harness is idle", async () => {
    const first = await bot("First fixture", "vm"), second = await bot("Second fixture", "vm");
    const makeRoom = async (b: any) => (await api("POST", "/api/groups", { name: b.name, memberIds: [b.id], setup: { bulletin: "", defaultResponder: { kind: "member", botId: b.id } } })).group;
    const a = await makeRoom(first), b = await makeRoom(second);
    const start = prompts.length;
    await api("POST", `/api/groups/${a.id}/messages`, { text: "Reply briefly." });
    await until(() => prompts.length, n => n === start + 1);
    const session = prompts.at(-1)!;
    expect(preset(session)).toContain("openmaus-computer-");
    expect(preset(session)).not.toContain("openmaus-browser-");
    writeFileSync(vmState, JSON.stringify({ stall: true }));
    await until(() => cancellations.includes(session), Boolean);
    writeFileSync(vmState, "{}");
    await new Promise(resolve => setTimeout(resolve, 6_600));
    await api("POST", `/api/groups/${b.id}/messages`, { text: "Reply briefly." });
    await until(() => api("GET", "/api/bots?messages=30"), state => JSON.stringify(state.groups.find((g: any) => g.id === b.id)?.messages).includes("another thread is using this computer"));
    expect(prompts.length).toBe(start + 1);
    expect((await api("GET", "/api/bots?messages=0")).bots.find((bot: any) => bot.id === first.id)?.busy).toBe(true);
    finish(session, true);
    await idle(first.id);
    await api("POST", `/api/groups/${b.id}/messages`, { text: "Try again now." });
    await until(() => prompts.length, n => n === start + 2);
    finish(prompts.at(-1)!); await idle(first.id); await idle(second.id);
  }, 35_000);

  it("keeps Off authoritative and round-trips structured questions under Auto with retry", async () => {
    const owner = await bot("Questions fixture", "off");
    const start = prompts.length;
    await api("POST", `/api/bots/${owner.id}/messages`, { text: "打开本机浏览器，然后先问我两道问题。", threadId: owner.threadId });
    await until(() => prompts.length, n => n === start + 1);
    const sessionId = prompts.at(-1)!;
    expect(preset(sessionId)).not.toContain("openmaus-computer-");
    expect(preset(sessionId)).not.toContain("openmaus-browser-");
    expect(preset(sessionId)).toContain("openmaus-agents-");
    const questions = [{ id: "one", question: "Plan?", detail: "Full fixture plan", options: [{ label: "Allow" }] }, { id: "two", question: "Tools?", multiSelect: true, options: [{ label: "A,B" }, { label: "C" }] }];
    const requestId = randomUUID();
    frame({ type: "question/requested", sessionId, questions }, requestId);
    const card = (list: any[]) => list.find(m => m.card?.requestId === requestId)?.card;
    await until(() => messages(owner.id), list => Boolean(card(list)));
    expect(card(await messages(owner.id)).answered).toBeFalsy();
    expect(card(await messages(owner.id)).questionRequest.questions).toEqual(questions);
    const route = `/api/threads/${owner.threadId}/respond`;
    await api("POST", route, { requestId, behavior: "answer", message: "one flat answer" }, 400);
    const body = { requestId, behavior: "answer", answers: [{ id: "one", selected: ["Allow"] }, { id: "two", selected: ["A,B"], custom: "extra" }] };
    const before = answers.length; failAnswer = true;
    await api("POST", route, body, 502);
    expect(card(await messages(owner.id)).answered).toBeFalsy(); failAnswer = false;
    await api("POST", route, body);
    expect(answers.length).toBe(before + 1);
    expect(answers.at(-1).result.value.answer.answers).toEqual(body.answers);
    expect(card(await messages(owner.id)).answeredQuestions).toEqual(body.answers);
    finish(sessionId); await idle(owner.id);
  }, 25_000);

  it("waits for the sidecar to stop before replacing the provider fleet", async () => {
    const owner = await bot("Reload fixture", "off");
    const start = prompts.length;
    await api("POST", `/api/bots/${owner.id}/messages`, { text: "Reply briefly.", threadId: owner.threadId });
    await until(() => prompts.length, n => n === start + 1);
    const sessionId = prompts.at(-1)!;
    let replaced = false;
    const updating = api("PATCH", "/api/config", { profile: { email: "fixture@example.invalid" } }).then(() => { replaced = true; });
    await until(() => cancellations.includes(sessionId), Boolean);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(replaced).toBe(false);
    expect((await api("GET", "/api/bots?messages=0")).bots.find((b: any) => b.id === owner.id)?.busy).toBe(true);
    finish(sessionId, true);
    await updating; await idle(owner.id);
  });
});
