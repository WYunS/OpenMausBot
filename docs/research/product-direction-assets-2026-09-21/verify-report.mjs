import { chromium } from 'file:///D:/ChatGPT/CodexData/runtimes/cua_node/df473e5367fa2b42/bin/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const report = path.join(path.dirname(here), 'ruijie-bot-product-direction-2026-09-21.html');
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1050 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const responses = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) responses.push(request.url()); });
    await page.goto(pathToFileURL(report).href);
    await page.screenshot({ path: path.join(here, `report-${viewport.width}-top.png`) });
    await page.locator('.architecture').scrollIntoViewIfNeeded();
    await page.locator('.architecture').screenshot({ path: path.join(here, `architecture-${viewport.width}.png`) });
    const before = await page.evaluate(() => ({
      sections: document.querySelectorAll('article section').length,
      hasRawMermaid: document.querySelector('code.language-mermaid') !== null,
      overflow: document.documentElement.scrollWidth > innerWidth,
      unresolvedAnchors: [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => !document.getElementById(h.slice(1))),
      emptyTableCells: [...document.querySelectorAll('article th, article td')].filter(c => !c.textContent.trim()).length,
      journeys: [...document.querySelectorAll('article h3')].filter(h => /^J[1-6]/.test(h.textContent)).length,
    }));
    await page.locator('article a[href="#evidence-runtime"]').first().click();
    const evidenceOpens = await page.locator('#evidence-runtime').evaluate(e => e.open);
    const item = { viewport, ...before, evidenceOpens, errors, externalRequests: responses };
    results.push(item);
    if (item.overflow || item.hasRawMermaid || item.sections !== 10 || item.journeys !== 6 || item.unresolvedAnchors.length || errors.length || responses.length || !evidenceOpens) throw new Error(JSON.stringify(item));
    await page.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(here, 'render-verification.json'), JSON.stringify(results, null, 2) + '\n');
}
console.log(JSON.stringify(results));
