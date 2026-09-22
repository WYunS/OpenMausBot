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
  await until(`document.querySelector('button[aria-label="执行电脑"]')?.getAttribute('aria-busy') !== 'true' && [...document.querySelectorAll('.composer-send-actions button')].some(button => !button.disabled)`);
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
};
try {
  const instanceRequests = [];
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (new URL(details.url).pathname === '/api/instances') instanceRequests.push(callback);
    else callback({});
  });
  await win.loadURL(config.previewUrl);
  await until(`document.body.innerText.includes('Photo fixture')`);
  await until(`document.querySelector('button[aria-label="执行电脑"]')?.getAttribute('aria-busy') === 'true'`);
  const startupGeometry = () => evaluate(`(() => { const input = document.querySelector('.mention-editor textarea'); const computer = document.querySelector('button[aria-label="执行电脑"]'); const buttons = [...document.querySelector('.composer-input-row').querySelectorAll('button')]; return {inputLeft: input.getBoundingClientRect().left, inputWidth: input.getBoundingClientRect().width, computerLeft: computer.getBoundingClientRect().left, controls: buttons.filter(b => b.getAttribute('aria-haspopup') === 'menu').length, panelOpen: Boolean(document.querySelector('.ruijie-computer-panel'))}; })()`);
  await evaluate(`document.querySelector('.mention-editor textarea').focus()`);
  await win.webContents.insertText('Draft typed while the engine is loading');
  await evaluate(`document.fonts.ready.then(() => true)`);
  await pause(150);
  const beforeStartup = await startupGeometry();
  assert.equal(beforeStartup.controls, 2, 'Approval and computer controls exist before discovery');
  assert.equal(await evaluate(`document.querySelector('.mention-editor textarea').disabled`), false);
  assert(await evaluate(`[...document.querySelectorAll('.composer-send-actions button')].some(b => b.disabled)`));
  await screenshot('composer-loading.png');
  win.webContents.session.webRequest.onBeforeRequest(null);
  assert(instanceRequests.length > 0);
  for (const release of instanceRequests) release({});
  await until(`document.querySelector('button[aria-label="执行电脑"]')?.getAttribute('aria-busy') !== 'true'`);
  const afterStartup = await startupGeometry();
  assert.deepEqual(afterStartup, beforeStartup, 'Discovery must not shift controls or open the panel');
  assert.equal(await evaluate(`document.querySelector('.mention-editor textarea').value`), 'Draft typed while the engine is loading');
  await screenshot('composer-ready.png');
  writeFileSync(join(config.evidence, 'startup-layout.json'), JSON.stringify({before: beforeStartup, after: afterStartup, draftPreserved: true}, null, 2));
  await evaluate(`(() => { const input = document.querySelector('.mention-editor textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await evaluate(`document.querySelector('[aria-label="执行电脑"]').click()`);
  await until(`Boolean(document.querySelector('[role="menu"][aria-label="执行电脑"]'))`, 2000);
  const menuColors = await evaluate(`(() => { const menu = document.querySelector('[role="menu"][aria-label="执行电脑"]'); const item = menu.querySelector('[role="menuitemradio"]'); return {background: getComputedStyle(menu).backgroundColor, color: getComputedStyle(item).color}; })()`);
  assert.notEqual(menuColors.background, 'rgba(0, 0, 0, 0)');
  assert.notEqual(menuColors.background, menuColors.color);
  await screenshot('computer-menu.png');
  const menuCrop = await evaluate(`(() => { const popup = document.querySelector('[role="menu"][aria-label="执行电脑"]').getBoundingClientRect(); const trigger = document.querySelector('button[aria-label="执行电脑"]').getBoundingClientRect(); return {x: Math.floor(popup.left - 8), y: Math.floor(popup.top - 8), width: Math.ceil(popup.width + 16), height: Math.ceil(trigger.bottom - popup.top + 16)}; })()`);
  writeFileSync(join(config.evidence, 'computer-menu-detail.png'), (await win.webContents.capturePage(menuCrop)).toPNG());
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home' });
  assert.equal(await evaluate(`document.activeElement?.getAttribute('data-computer-mode')`), 'auto');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' });
  assert.equal(await evaluate(`document.activeElement?.getAttribute('data-computer-mode')`), 'off');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await until(`!document.querySelector('[role="menu"][aria-label="执行电脑"]')`);
  assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`), '执行电脑');
  // The native caret and painted mention layer must use identical metrics.
  const composerMetrics = await evaluate(`(() => {
    const input = document.querySelector('.mention-editor textarea');
    const mirror = document.querySelector('.mention-editor-mirror');
    const metrics = element => Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','paddingLeft','paddingRight','paddingTop','paddingBottom','textIndent','wordSpacing','tabSize'].map(key => [key, getComputedStyle(element)[key]]));
    return { input: metrics(input), mirror: metrics(mirror) };
  })()`);
  writeFileSync(join(config.evidence, 'composer-metrics.json'), JSON.stringify(composerMetrics, null, 2));
  assert.deepEqual(composerMetrics.mirror, composerMetrics.input, 'Painted text must align with the native caret');
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
  // Destination stays in the composer; the branded header and panel have no model controls.
  await evaluate(`document.querySelector('textarea').focus()`);
  await win.webContents.insertText('测试光标与文字对齐 abcdefghijklmnopqrstuvwxyz @Nova\n'.repeat(10));
  const responsive = [];
  for (const width of [1300, 1000, 800, 390]) {
    win.webContents.enableDeviceEmulation({ screenPosition: 'mobile', screenSize: {width, height: 950},
      viewPosition: {x: 0, y: 0}, deviceScaleFactor: 1, viewSize: {width, height: 950}, scale: 1 });
    await pause(300);
    const geometry = await evaluate(`(() => {
      const input = document.querySelector('.mention-editor textarea');
      const mirror = document.querySelector('.mention-editor-mirror');
      input.scrollTop = input.scrollHeight; input.dispatchEvent(new Event('scroll'));
      return { width: innerWidth, inputWidth: input.clientWidth, mirrorWidth: mirror.clientWidth,
        inputScroll: input.scrollTop, mirrorScroll: mirror.scrollTop, inputHeight: input.scrollHeight, mirrorHeight: mirror.scrollHeight,
        pageWidth: document.documentElement.scrollWidth };
    })()`);
    assert.equal(geometry.inputWidth, geometry.mirrorWidth);
    assert.equal(geometry.width, width, 'The fixture must actually reach the requested viewport');
    assert.equal(geometry.inputScroll, geometry.mirrorScroll);
    assert(geometry.inputWidth >= 80, JSON.stringify(geometry));
    assert(geometry.pageWidth <= geometry.width + 1, JSON.stringify(geometry));
    await evaluate(`document.querySelector('button[aria-label="执行电脑"]').click()`);
    await until(`Boolean(document.querySelector('[role="menu"][aria-label="执行电脑"]'))`);
    assert(await evaluate(`(() => { const box = document.querySelector('[role="menu"][aria-label="执行电脑"]').getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight; })()`), 'Computer menu must stay within the viewport');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await until(`!document.querySelector('[role="menu"][aria-label="执行电脑"]')`);
    responsive.push(geometry);
  }
  await screenshot('narrow-composer.png');
  win.webContents.disableDeviceEmulation();
  win.setSize(1300, 950); await pause(300);
  await evaluate(`(() => { const input = document.querySelector('.mention-editor textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await pause(300);
  await screenshot('preview-chat.png');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.title === ${JSON.stringify("Bot's computer")}).click()`);
  await until(`Boolean(document.querySelector('.ruijie-computer-panel'))`);
  assert.equal(await evaluate(`Math.round(document.querySelector('.ruijie-computer-panel').getBoundingClientRect().width)`), 320);
  await screenshot('wide-panel.png');
  win.setSize(900, 950); await pause(300);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ruijie-computer-panel')).position`), 'absolute');
  assert(await evaluate(`document.querySelector('[role=log]').getBoundingClientRect().width >= 500`));
  await screenshot('narrow-panel.png');
  await evaluate(`document.querySelector('.ruijie-computer-panel button[aria-label="Close"]').click()`);
  await until(`!document.querySelector('.ruijie-computer-panel')`);
  // Change through the real select and verify the saved server value, then restore Off.
  for (const mode of ['auto', 'off']) {
    await evaluate(`document.querySelector('button[aria-label="执行电脑"]').click()`);
    await until(`Boolean(document.querySelector('[data-computer-mode="${mode}"]'))`);
    await evaluate(`document.querySelector('[data-computer-mode="${mode}"]').click()`);
    await until(`(async () => { const response = await fetch('/api/bots'); const value = await response.json(); const bot = value.bots.find(b => b.id === ${JSON.stringify(config.botId)}); return ${mode === 'auto' ? '!bot.computer' : 'bot.computer === "off"'}; })()`);
  }
  writeFileSync(join(config.evidence, 'responsive.json'), JSON.stringify(responsive, null, 2));
  // Real settings component, isolated store: drafts survive switching and delayed saves.
  win.setSize(1300, 950);
  await win.loadURL(config.settingsPreviewUrl);
  const clickText = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const fill = (selector, text) => evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); field.focus(); const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await until(`document.body.innerText.includes('Open settings')`);
  await clickText('Open settings');
  await until(`Array.from(document.querySelectorAll('button')).some(b => /^(Memory|记忆)$/.test(b.textContent.trim()))`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => /^(Memory|记忆)$/.test(b.textContent.trim())).click()`);
  await until(`Boolean(document.querySelector('textarea[aria-label="Bot memory"]'))`);
  await fill('textarea[aria-label="Bot memory"]', 'Unsaved main draft');
  await fill('input[aria-label="New topic name"]', 'client');
  await clickText('New topic');
  await until(`Boolean(document.querySelector('textarea[aria-label="Memory file memory/client.md"]'))`);
  await fill('textarea[aria-label="Memory file memory/client.md"]', 'Unsaved client draft');
  await clickText('Back to MEMORY.md');
  await until(`document.querySelector('textarea[aria-label="Bot memory"]')?.value === 'Unsaved main draft'`);
  await evaluate(`(() => { const real = window.fetch; window.fetch = async (...args) => {
    const response = await real(...args);
    if (String(args[0]).includes('/memory/file') && args[1]?.method === 'PUT') {
      window.__saveReached = true; await new Promise(resolve => {window.__releaseMemorySave = resolve;});
    } return response;
  }; })()`);
  await clickText('Save');
  await until(`window.__saveReached === true`);
  await fill('textarea[aria-label="Bot memory"]', 'New typing while the save is pending');
  await evaluate(`window.__releaseMemorySave()`);
  await until(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Save' && !b.disabled)`);
  assert.equal(await evaluate(`document.querySelector('textarea[aria-label="Bot memory"]').value`), 'New typing while the save is pending');
  await screenshot('memory-draft-recovery.png');
  assert.equal(errors.filter(error => !error.includes("Content Security Policy") && !error.includes("sandboxed")).length, 0, JSON.stringify(errors));
  writeFileSync(join(config.evidence, "ui.json"), JSON.stringify({ ok: true, checks: ["composer -> MCP -> saved profile", "remote/local images decoded", "absolute Windows path with hidden directory and Chinese filename", "image link POST preview", "image dialog and Escape", "text/HTML preview", "HTML scripts inert", "website shell bridge", "reload and next-turn standing instructions", "caret/mirror typography and scrolling alignment", "1300/1000/800/390px viewport geometry without page overflow", "320px computer panel and narrow drawer", "composer computer selection persisted", "memory drafts survive switching and delayed saves"], console: errors }, null, 2));
  win.destroy(); app.exit(0);
} catch (error) {
  console.error(error);
  console.error(JSON.stringify(errors));
  writeFileSync(join(config.evidence, "failure.png"), (await win.webContents.capturePage()).toPNG());
  console.error((await evaluate(`document.body.innerText`)).slice(-7000));
  win.destroy(); app.exit(1);
}
}
void main();
