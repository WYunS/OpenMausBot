// Drive the real BrowserPanel in a disposable Electron profile. No live Bot data.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const url = new URL(process.env.OMB_VERIFY_BROWSER_PREVIEW_URL ?? "");
assert(url.hostname === "127.0.0.1" && url.pathname === "/__browser-preview.html");
assert(!["38799", "5199"].includes(url.port), "Only an isolated preview is allowed");
const home = mkdtempSync(join(tmpdir(), "omb-fullscreen-check-"));
app.setPath("userData", home);
let window;
async function run() {
try {
  await app.whenReady();
  window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await window.loadURL(url.href);
  const poll = async (expression) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const button = `document.querySelector('button[aria-label="全屏"],button[aria-label="Fullscreen"]')`;
  await poll(`Boolean(${button})`);
  await window.webContents.executeJavaScript(`${button}.click()`, true);
  await poll("Boolean(document.fullscreenElement)");
  await window.webContents.executeJavaScript(`${button}.click()`, true);
  await poll("!document.fullscreenElement");
  console.log(JSON.stringify({ ok: true, checks: ["real Electron BrowserPanel enters fullscreen", "same toolbar button exits without Escape"] }));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  window?.destroy();
  await app.whenReady();
  app.quit();
  // Chromium releases some profile files only after process exit; the OS temp
  // folder may remain if locked, never broaden cleanup to another directory.
  try { rmSync(home, { recursive: true, force: true }); } catch { /* bounded temp only */ }
}
}
void run();
