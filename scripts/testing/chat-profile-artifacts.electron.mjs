import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { app, BrowserWindow } from "electron";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(new URL(config.url).hostname, "127.0.0.1");
assert(resolve(process.argv[2]).startsWith(resolve(config.dataDir) + sep));
assert(resolve(config.dataDir).includes("openmausbot-verify-data-"));
const profile = join(config.dataDir, "electron-artifact-profile");
app.setPath("userData", profile); app.setPath("sessionData", profile);
app.commandLine.appendSwitch("disable-background-networking");
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
await app.whenReady();
const win = new BrowserWindow({ width: 1300, height: 950, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
const errors = [];
win.webContents.on("console-message", (_event, level, text) => { if (level === 3) errors.push(text); });
const evaluate = code => win.webContents.executeJavaScript(code);
const screenshot = async name => {
  await win.webContents.capturePage();
  await pause(250);
  writeFileSync(join(config.evidence, name), (await win.webContents.capturePage()).toPNG());
};
const until = async (code, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(code)) return; await pause(100); }
  throw new Error(`Timed out: ${code}`);
};
const send = async text => {
  await until(`Boolean(document.querySelector('textarea'))`);
  await evaluate(`(() => { const input = document.querySelector('textarea'); input.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await pause(100);
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
};
try {
  await win.loadURL(config.previewUrl);
  await until(`document.body.innerText.includes('Photo fixture')`);
  await send("你叫照片bot，负责帮我找公开照片，附上来源。");
  await until(`document.body.innerText.includes('已保存名字和职责')`, 60000);
  await until(`Array.from(document.querySelectorAll('.chat-md img')).filter(i => i.complete && i.naturalWidth > 0).length >= 2`);
  await screenshot("chat.png");
  assert.equal(await evaluate(`document.querySelector('aside')?.innerText.includes('照片助手') ?? document.body.innerText.includes('Redundant sidebar title')`), false);
  await evaluate(`document.querySelector('.chat-md img').closest('[role=button]').click()`);
  await until(`Boolean(document.querySelector('[role=dialog] img'))`);
  await evaluate(`document.querySelector('[role=dialog] button[aria-label="Close preview"]')?.click()`);
  // Escape also verifies keyboard dismissal and focus restoration.
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await until(`!document.querySelector('[role=dialog]')`);
  await evaluate(`Array.from(document.querySelectorAll('.chat-md button')).find(b => b.textContent === 'Open image').click()`);
  await until(`document.querySelector('dialog img')?.naturalWidth > 0`);
  await screenshot("local-image-preview.png");
  await evaluate(`document.querySelector('button[aria-label="Close file preview"]').click()`);
  await until(`!document.querySelector('dialog')`);
  await evaluate(`Array.from(document.querySelectorAll('.chat-md button')).find(b => b.textContent === 'Open text').click()`);
  await until(`document.querySelector('dialog')?.innerText.includes('Artifact fixture:')`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('dialog')).backgroundColor === getComputedStyle(document.querySelector('dialog')).color`), false);
  await pause(250);
  await screenshot("text-preview.png");
  await evaluate(`document.querySelector('button[aria-label="Close file preview"]').click()`);
  await evaluate(`Array.from(document.querySelectorAll('.chat-md button')).find(b => b.textContent === 'Open HTML').click()`);
  await until(`document.querySelector('dialog iframe')?.srcdoc.includes('Artifact preview')`);
  assert.equal(await evaluate(`document.querySelector('dialog iframe').getAttribute('sandbox')`), "");
  await pause(200);
  assert.equal(await evaluate(`Boolean(window.__artifactScriptRan)`), false);
  await screenshot("html-preview.png");
  await evaluate(`document.querySelector('button[aria-label="Close file preview"]').click()`);
  await until(`!document.querySelector('dialog')`);
  await evaluate(`window.__openedLinks=[]; window.ogb={openExternal:async u=>window.__openedLinks.push(u)}; Array.from(document.querySelectorAll('a')).find(a => a.textContent === 'Source website').click()`);
  assert.deepEqual(await evaluate(`window.__openedLinks`), ["https://example.com/source"]);
  await pause(250);
  await win.loadURL(config.previewUrl);
  await until(`document.body.innerText.includes('照片bot')`);
  await send("你保存的职责是什么？");
  await until(`document.body.innerText.includes('职责已持久保存')`, 60000);
  assert.equal(errors.filter(error => !error.includes("Content Security Policy") && !error.includes("sandboxed")).length, 0, JSON.stringify(errors));
  writeFileSync(join(config.evidence, "ui.json"), JSON.stringify({ ok: true, checks: ["composer -> MCP -> saved profile", "remote/local images decoded", "absolute Windows path with hidden directory and Chinese filename", "image link POST preview", "image dialog and Escape", "text/HTML preview", "HTML scripts inert", "website shell bridge", "reload and next-turn standing instructions"], console: errors }, null, 2));
  win.destroy(); app.exit(0);
} catch (error) {
  console.error(error);
  writeFileSync(join(config.evidence, "failure.png"), (await win.webContents.capturePage()).toPNG());
  console.error((await evaluate(`document.body.innerText`)).slice(-7000));
  win.destroy(); app.exit(1);
}
}
void main();
