// Exercise real Chromium pointer delivery against an isolated fixture.
// Pass its root URL to cover App's sibling panels, or /__bot-settings.html
// for the standalone dialog. The full App is the duplicate-key regression.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const url = new URL(process.argv[2]);
assert.equal(url.hostname, "127.0.0.1");
assert(["/__bot-settings.html", "/"].includes(url.pathname));
assert(!["38799", "5199"].includes(url.port), "Use an isolated fixture only");
const profile = mkdtempSync(join(tmpdir(), "omb-settings-close-"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.commandLine.appendSwitch("disable-background-networking");
let win;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const closeSelector = 'button[aria-label="Close bot settings"], button[aria-label="关闭机器人设置"]';
const fullApp = url.pathname === "/";
const openButton = fullApp
  ? `Array.from(document.querySelectorAll('button')).find(b => /^(打开 .+ 的资料|Open .+ profile)$/.test(b.getAttribute('aria-label') ?? ''))`
  : `Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Open settings')`;

async function main() {
try {
  await app.whenReady();
  win = new BrowserWindow({
    show: false, width: 1440, height: 900,
    titleBarStyle: "hidden", titleBarOverlay: { height: 32 },
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  const evaluate = (code) => win.webContents.executeJavaScript(code);
  await win.loadURL(url.href);
  const until = async (expression) => {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(expression)) return;
      await pause(50);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const preparePage = async () => {
    const [width, height] = win.getContentSize();
    await until(`innerWidth === ${width} && innerHeight === ${height}`);
    await until(`Boolean(${openButton})`);
    if (fullApp) {
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.title === '机器人的电脑' || b.title === "Bot's computer").click()`);
    }
  };
  await preparePage();
  let maxLayers = 0;
  for (let i = 0; i < 30; i++) {
    if (i === 10 || i === 20) {
      win.setSize(i === 10 ? 1024 : 1440, i === 10 ? 720 : 900);
      await win.loadURL(url.href);
      await preparePage();
    }
    await evaluate(`${openButton}.click()`);
    await until(`Boolean(document.querySelector(${JSON.stringify(closeSelector)}))`);
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] nav button')).find(b => /^(Access|访问)$/.test(b.textContent.trim()))?.click()`);
    const hit = await evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(closeSelector)});
      const r = button.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, layers: document.querySelectorAll('[aria-labelledby="bot-settings-title"]').length,
        hit: button.contains(document.elementFromPoint(x, y)), width: r.width, height: r.height };
    })()`);
    maxLayers = Math.max(maxLayers, hit.layers);
    assert.equal(hit.layers, 1, `cycle ${i}: duplicate settings dialogs`);
    assert.equal(hit.hit, true, `cycle ${i}: close button is covered`);
    win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(hit.x), y: Math.round(hit.y) });
    win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x: Math.round(hit.x), y: Math.round(hit.y) });
    await pause(i % 2 ? 100 : 10);
    win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: Math.round(hit.x), y: Math.round(hit.y) });
    await pause(100);
    assert.equal(await evaluate(`document.querySelectorAll('[aria-labelledby="bot-settings-title"]').length`), 0,
      `cycle ${i}: a single physical close did not dismiss settings`);
  }
  console.log(JSON.stringify({ ok: true, fullApp, cycles: 30, reloads: 2, maxLayers, profile }));
  win.destroy();
  app.exit(0);
} catch (error) {
  console.error(error);
  win?.destroy();
  app.exit(1);
}
}
void main();
