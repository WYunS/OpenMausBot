// End-to-end: real composer, scripted provider, injected MCP and isolated store.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
const evidence = resolve(".omb-scratch/verify-evidence/chat-profile-artifacts");
mkdirSync(evidence, { recursive: true });
let ui: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  const api = fixtureApi(fixture.info.url);
  await api("PATCH", "/api/config", { language: "en" });
  await runControlOmb(["new-bot", "--name", "Photo fixture", "--url", fixture.info.url]);
  const bot = (await api("GET", "/api/bots")).bots.find((b: any) => b.name === "Photo fixture");
  assert(bot);
  const workspace = join(fixture.info.dataDir, "artifact-workspace");
  mkdirSync(workspace);
  copyFileSync("electron/resources/app-icon.png", join(workspace, "sample.png"));
  writeFileSync(join(workspace, "report.txt"), "Artifact fixture: this file opened inside the bot.");
  writeFileSync(join(workspace, "report.html"), '<h1>Artifact preview</h1><p>Generated HTML renders here.</p><script>parent.__artifactScriptRan=true</script>');
  await api("PATCH", `/api/bots/${bot.id}`, { cwd: workspace, title: "Redundant sidebar title", computer: "off" });
  ui = await mountPreview(fixture, { entry: "/src/main.tsx", route: "/__artifact.html", title: "Isolated artifact verification",
    extraRoutes: [{ path: "/__fixture/image.png", handler(_req, res) {
      res.setHeader("content-type", "image/png"); res.end(readFileSync(join(workspace, "sample.png")));
    } }],
  });
  const webImage = new URL("/__fixture/image.png", ui.previewUrl).href;
  const reply = `已保存名字和职责。\n\n![Remote sample](${webImage})\n\n![Local sample](sample.png)\n\n[Open text](report.txt) · [Open HTML](report.html) · [Source website](https://example.com/source)`;
  const plan = { [bot.id]: { turns: [
    { expectSystemIncludes: ["update_profile", "save those requested identity fields immediately"],
      steps: [{ tool: "update_profile", arguments: { name: "照片bot", title: "照片助手", description: "帮助寻找公开照片", soul: "负责寻找公开照片并附上来源。", reason: "用户明确指定名字和职责" } }], reply },
    { expectSystemIncludes: ["负责寻找公开照片并附上来源。"], reply: "职责已持久保存，继续帮你找公开照片。" },
  ] } };
  writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify(plan));
  const config = { ...fixture.info, previewUrl: new URL("/", ui.previewUrl).href, botId: bot.id, evidence };
  const configPath = join(fixture.info.dataDir, "artifact-ui.json");
  writeFileSync(configPath, JSON.stringify(config));
  console.log(JSON.stringify(config));
  const electron = createRequire(import.meta.url)("electron") as string;
  const electronEnv = { ...process.env };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  delete electronEnv.NODE_OPTIONS;
  const child = spawn(electron, ["scripts/testing/chat-profile-artifacts.electron.mjs", configPath], {
    stdio: "inherit", windowsHide: true, env: electronEnv,
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, "Chromium workflow failed");
  const final = (await api("GET", "/api/bots")).bots.find((b: any) => b.id === bot.id);
  assert.equal(final.name, "照片bot");
  assert.equal(final.description, "帮助寻找公开照片");
  assert.equal(readFileSync(join(fixture.info.dataDir, "bots", bot.id, "SOUL.md"), "utf8"), "负责寻找公开照片并附上来源。");
  assert(!final.messages.some((m: any) => m.card?.profileRequest));
  const history = await api("GET", `/api/bots/${bot.id}/history`);
  writeFileSync(join(evidence, "workflow.json"), JSON.stringify({ ok: true, fixture: fixture.info, bot: { name: final.name, title: final.title, description: final.description }, history, messages: final.messages }, null, 2));
  copyFileSync(join(fixture.info.dataDir, "room-plan.json.evidence.jsonl"), join(evidence, "mcp-evidence.jsonl"));
  console.log(JSON.stringify({ ok: true, evidence, log: fixture.info.logPath }));
} finally { await ui?.close(); await fixture.close(); }
