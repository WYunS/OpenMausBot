// Real engine screens with synthetic statuses and a disposable app server.
// No install/auth request can reach a provider or the user's configuration.
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import type { InstanceInfo } from "../src/state/store.tsx";
import { launchVerificationServer } from "./control-omb.ts";

const fixture = await launchVerificationServer();
const instances: InstanceInfo[] = [
  ["claude", "claudeAgent", "Claude", true, "2.1.8"],
  ["codex", "codex", "Codex", true, "0.122.0"],
  ["grok", "grokAgent", "Grok", true, "grok"],
  ["opencode", "opencodeGo", "OpenCode", true, "1.18.25"],
  ["antigravity", "antigravityAgent", "Antigravity", false, "0.1.0"],
  ["kimi", "kimiAgent", "Kimi", false, ""],
  ["droid", "droidAgent", "Droid", false, ""],
  ["cursor", "cursorAgent", "Cursor", false, ""],
  ["hermes", "hermesAgent", "Hermes", false, ""],
  ["qwen", "qwenAgent", "Qwen", false, ""],
  ["pi", "piAgent", "Pi", false, ""],
].map(([id, driver, name, ready, version]) => ({
  instanceId: String(id), driverKind: String(driver), displayName: String(name),
  cliDefault: String(id),
  snapshot: { state: ready || version ? "available" : "unavailable", authenticated: Boolean(ready), version: String(version), ...(!ready && !version ? { reason: "Not installed in this isolated preview." } : {}) },
  models: { default: "fixture", options: [] },
  install: { command: { darwin: "echo 'Isolated preview — no installation'", linux: "echo 'Isolated preview — no installation'", win32: "echo Isolated preview — no installation" } },
}));
instances[0].snapshot.account = { email: "personal@example.test" };
instances[0].claudeAccount = { configDir: "", isDefault: true, signInCommand: "echo 'Preview only'", signInShell: "sh" };
instances[1].authentication = { method: "device-code", signOut: true };
instances[1].snapshot.account = { email: "work@example.test" };
instances[4].install = { managed: { label: "Install Antigravity", downloadBytes: 200_000_000 } };
instances.push({ ...instances[0], instanceId: "claude-local", displayName: "Claude · Local", access: "custom", claudeAccount: undefined, snapshot: { state: "available", authenticated: false } });
let ui: Awaited<ReturnType<typeof createServer>> | undefined;
try {
  ui = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    cacheDir: join(fixture.info.dataDir, "vite-cache"),
    server: { host: "127.0.0.1", port: 0, proxy: { "/api": { target: fixture.info.url } } },
    plugins: [{ name: "isolated-engines", configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        const json = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
        if (path === "/api/instances" && req.method === "GET") return json({ instances });
        if (path === "/__fixture/connect" && req.method === "POST") {
          instances[4].snapshot.authenticated = !instances[4].snapshot.authenticated;
          return json({ ok: true });
        }
        if (path === "/api/cli-candidates") return json({ candidates: ["/preview/bin/claude"] });
        if (path?.startsWith("/api/instances/") || path === "/api/cli-test") {
          return json({ error: "Preview only: no real account or installation is changed." }, 400);
        }
        if (path !== "/__engines.html") return next();
        void server.transformIndexHtml(req.url!, '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenMaus · Engine preview</title></head><body><div id="root"></div><script type="module" src="/scripts/testing/engines-preview.tsx"></script></body></html>')
          .then((html) => { res.setHeader("content-type", "text/html"); res.end(html); }).catch(next);
      });
    } }],
  });
  await ui.listen();
  console.log(JSON.stringify({ ...fixture.info, previewUrl: `${ui.resolvedUrls!.local[0]}__engines.html` }));
  await new Promise<void>((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
} finally {
  await ui?.close();
  await fixture.close();
}
