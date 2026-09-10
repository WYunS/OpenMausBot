// Real React image-error/recovery lifecycle in a disposable browser context.
// No production API, user profile, credentials, or account mutation.
import { createServer } from "vite";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT
  ? pathToFileURL(process.env.OMB_VERIFY_PLAYWRIGHT).href : "playwright");
let transientRequests = 0;
const officialCatalog = process.env.OMB_VERIFY_CATALOG_URL
  ? await (await fetch(process.env.OMB_VERIFY_CATALOG_URL, { signal: AbortSignal.timeout(5_000) })).json() : null;
const ui = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "connector-icon-fixture", configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === "/__official-catalog" && officialCatalog) {
        res.setHeader("content-type", "application/json"); res.end(JSON.stringify(officialCatalog)); return;
      }
      if (["/__broken.svg", "/__working.svg", "/__transient.svg"].includes(req.url)) {
        res.setHeader("cache-control", "no-store");
        if (req.url === "/__broken.svg" || (req.url === "/__transient.svg" && ++transientRequests === 1)) {
          res.writeHead(404); res.end(); return;
        }
        res.setHeader("content-type", "image/svg+xml");
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><circle cx="22" cy="22" r="20" fill="blue"/></svg>'); return;
      }
      if (!req.url?.startsWith("/__icons.html")) return next();
      void server.transformIndexHtml(req.url, '<html><head><style>body{background:#121212;color:white;font:14px system-ui;padding:20px}img{width:44px;height:44px;object-fit:contain}main>div{display:flex;align-items:center;gap:12px;min-height:65px}</style></head><body><div id="root"></div><script type="module" src="/scripts/testing/connector-icons-preview.tsx"></script></body></html>')
        .then((html) => { res.setHeader("content-type", "text/html"); res.end(html); }).catch(next);
    });
  } }],
});
let browser;
try {
  await ui.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.OMB_VERIFY_CHROME ? { executablePath: process.env.OMB_VERIFY_CHROME } : {}) });
  const page = await browser.newPage();
  await page.goto(`${ui.resolvedUrls.local[0]}__icons.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-testid="icon"]')?.textContent === "G");
  await page.getByRole("button", { name: "New official URL" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="icon"] img')?.naturalWidth > 0, null, { timeout: 4000 });
  await page.getByRole("button", { name: "Transient URL" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="icon"]')?.textContent === "G");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="icon"] img')?.naturalWidth > 0, null, { timeout: 4000 });
  assert.equal(transientRequests, 2);
  console.log("Real React icon recovery: new official URL and explicit retry both decode successfully ✓");
  if (officialCatalog) {
    assert.equal(officialCatalog.cards.length, 24);
    await page.goto(`${ui.resolvedUrls.local[0]}__icons.html?official=1`, { waitUntil: "domcontentloaded" });
    const verify = () => page.waitForFunction(() => {
      const cards = [...document.querySelectorAll('[data-official]')];
      return cards.length === 24 && cards.every((card) => {
        const img = card.querySelector('img');
        return img?.naturalWidth > 0 && img.currentSrc.startsWith('https://logos.composio.dev/api/');
      });
    }, null, { timeout: 20_000 });
    await verify();
    await page.reload({ waitUntil: "domcontentloaded" });
    await verify();
    console.log("Live official images: all 24 decoded in Chromium before and after refresh ✓");
  }
} finally { await browser?.close(); await ui.close(); }
