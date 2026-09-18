// Real React/store + isolated server. Question deliveries here are captured
// fixture receipts; native Harness payload acceptance is covered by driver tests.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { mountPreview, type MountedPreview } from "./testing/preview-fixture.ts";
import { agentBrowser, sessionEnv } from "./testing/control-omb-ui.ts";

assert.equal(process.argv[2], "--browser-bundle", "Pass the explicit reviewed browser bundle path");
const bundle = resolve(process.argv[3]!);
const manifest = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8"));
const binary = join(bundle, manifest.engine.executable);
const chrome = join(bundle, manifest.chrome.executable);
const evidence = resolve(".omb-scratch/verify-evidence/selective-upgrade");
await mkdir(evidence, { recursive: true });
const fixture = await launchVerificationServer();
let ui: MountedPreview | undefined;
const env = sessionEnv({ home: fixture.info.dataDir, session: `omb-selective-${new URL(fixture.info.url).port}`, chrome });
const browser = (args: string[]) => agentBrowser(binary, env, args, 60_000);
const clickButton = async (name: string) => {
  const snapshot = await browser(["snapshot"]);
  const refs = snapshot.refs as Record<string, { role: string; name: string }>;
  const matches = Object.entries(refs).filter(([, value]) => value.role === "button" && value.name === name);
  assert.equal(matches.length, 1, `Expected exactly one ${name} button`);
  await browser(["click", `@${matches[0][0]}`]);
};
const received: unknown[] = [];
let failNext = true;
try {
  await runControlOmb(["new-bot", "--name", "Upgrade Fixture", "--url", fixture.info.url]);
  ui = await mountPreview(fixture, { entry: "/src/testing/selective-upgrade.tsx", route: "/__selective.html", title: "Isolated selective upgrade",
    extraRoutes: [{ path: /^\/api\/threads\/[\w-]+\/respond$/, method: "POST", async handler(req, res) {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.requestId, "fixture-questions");
      res.setHeader("content-type", "application/json");
      if (failNext) { failNext = false; res.writeHead(502).end(JSON.stringify({ error: "Fixture temporary delivery failure" })); return; }
      received.push(body);
      res.end(JSON.stringify({ ok: true, outcome: "answered" }));
    } }],
  });
  console.log(JSON.stringify({ phase: "preview-ready", url: fixture.info.url, preview: ui.previewUrl, log: fixture.info.logPath }));
  // Cold Vite dependency optimization may outlast Chrome's navigation timer;
  // the following DOM wait, not navigation receipt alone, proves readiness.
  await browser(["open", ui.previewUrl]).catch(error => console.log(String(error)));
  await browser(["wait", "--fn", "document.body.textContent.includes('Choose the plan')"]);
  await browser(["wait", "--fn", "document.body.textContent.includes('Full plan detail must remain visible.')"]);
  await browser(["screenshot", join(evidence, "questions-before.png")]);
  await browser(["click", "button[aria-label=\"Preview Bot's screen\"]"]);
  await browser(["wait", "--fn", "!!document.querySelector('[role=dialog]')"]);
  await browser(["press", "Escape"]);
  await browser(["wait", "--fn", "!document.querySelector('[role=dialog]')"]);
  await browser(["click", "[role=radio]"]);
  await browser(["wait", "--fn", "document.body.textContent.includes('Choose tools')"]);
  await browser(["click", "[role=checkbox]:nth-child(1)"]);
  await browser(["click", "[role=checkbox]:nth-child(3)"]);
  await browser(["fill", "input[placeholder='Type your own answer']", "Extra context"]);
  await browser(["screenshot", join(evidence, "questions-multiple.png")]);
  await clickButton("Submit answers");
  await browser(["wait", "--fn", "document.body.textContent.includes('Fixture temporary delivery failure')"]);
  await clickButton("Submit answers");
  await browser(["wait", "--fn", "document.body.textContent.includes('The user answered') || !Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Submit answers')"]);
  assert.equal(received.length, 1);
  assert.deepEqual((received[0] as any).answers, [{ id: "plan", selected: ["Allow"] }, { id: "tools", selected: ["A,B"], custom: "Extra context" }]);
  assert.equal((received[0] as any).behavior, "answer");
  await browser(["screenshot", join(evidence, "questions.png")]);
  await clickButton("Reset question fixture");
  await clickButton("Cancel question");
  await browser(["wait", "--fn", "document.body.textContent.includes('Question cancelled')"]);
  assert.equal((received[1] as any).cancelQuestion, true);
  const consoleOutput = await browser(["console"]);
  const errors = ((consoleOutput.messages ?? []) as Array<{ type: string; text: string }>).filter(entry => entry.type === "error");
  assert(errors.every(entry => entry.text.includes("502")), `Unexpected browser error: ${JSON.stringify(errors)}`);
  const report = { passed: true, assertions: ["screen click opens viewer", "Escape closes viewer", "full plan visible", "multi-question selected/custom answers", "Allow is not permission", "delivery failure recovers", "question cancellation", "no unexpected browser console errors"], received, consoleErrors: errors, fixtureLog: fixture.info.logPath };
  await writeFile(join(evidence, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  console.log(JSON.stringify({ phase: "failed", error: String(error), console: await browser(["console"]).catch(() => null), snapshot: await browser(["snapshot"]).catch(() => null) }));
  throw error;
} finally {
  await browser(["close"]).catch(() => {});
  await ui?.close();
  await fixture.close();
}
