import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const launcher = new URL("../scripts/start-local-windows.ps1", import.meta.url);
const windowlessLauncher = new URL("../scripts/start-local-windows.vbs", import.meta.url);
const nativeLauncher = new URL("../scripts/OpenMausBot.DevLauncher.cs", import.meta.url);
const shortcutInstaller = new URL("../scripts/install-local-windows-shortcut.ps1", import.meta.url);
const mainProcess = new URL("./main.mjs", import.meta.url);

test("the desktop wrapper starts PowerShell without flashing a console", async () => {
  const source = await readFile(windowlessLauncher, "utf8");
  assert.match(source, /start-local-windows\.ps1/);
  assert.match(source, /shell\.Run command, 0, False/);
});

test("development services start from absolute paths in this checkout", async () => {
  const source = await readFile(launcher, "utf8");
  assert.match(source, /Join-Path \$repoRoot 'server\\index\.ts'/);
  assert.match(source, /Join-Path \$repoRoot 'node_modules\\vite\\bin\\vite\.js'/);
  assert.match(source, /\$developmentServerPort\s*=\s*38799/);
  assert.match(source, /Stop-LocalDevelopmentService \$developmentServerPort/);
  assert.match(source, /Stop-LocalDevelopmentService 5199/);
  assert.match(source, /\$env:OMB_CONTROL_PLANE_URL\s*=\s*'https:\/\/accounts\.openmausbot\.com'/);
  assert.match(source, /\[char\]0x9510/);
  assert.match(source, /\[char\]0x6377/);
  assert.match(source, /\$env:OMB_USER_DATA\s*=\s*Join-Path \$env:APPDATA \$ruijieAppName/);
  assert.match(source, /\$env:OMB_DATA_DIR\s*=\s*Join-Path \$env:USERPROFILE '\.openmausbot'/);
  assert.match(source, /\$env:OMB_PORT\s*=\s*\[string\]\$developmentServerPort/);
  assert.match(source, /\$env:OMB_LOCAL_VM_PROFILE\s*=\s*'development'/);
  assert.match(source, /\$env:OMB_DESKTOP_PARENT\s*=\s*\$null/);
  assert.doesNotMatch(source, /\$env:OMB_USER_DATA\s*=.*'锐捷Bot'/);
});

test("a second desktop launch reaches Electron so it can restore the existing window", async () => {
  const source = await readFile(launcher, "utf8");
  assert.doesNotMatch(source, /if \(\$alreadyRunning\) \{ exit 0 \}/);
  assert.match(
    source,
    /if \(\$alreadyRunning\) \{[\s\S]*Start-DesktopApp[\s\S]*return[\s\S]*\}/,
  );
  assert.match(source, /Start-DesktopApp/);
});

test("concurrent shortcut launches are serialized before checking for an existing window", async () => {
  const source = await readFile(launcher, "utf8");
  assert.match(source, /Threading\.Mutex/);
  assert.match(source, /WaitOne/);
  assert.match(source, /Invoke-Launcher[\s\S]*ReleaseMutex/);
});

test("a cold shortcut launch starts Electron directly and verifies that it stays alive", async () => {
  const source = await readFile(launcher, "utf8");
  assert.match(source, /node_modules\\electron\\dist\\electron\.exe/);
  assert.match(source, /Start-Process[\s\S]*-PassThru/);
  assert.match(source, /HasExited/);
  assert.doesNotMatch(source, /Start-LocalService 'dev:desktop' 'desktop'/);
});

test("the shortcut is never rewritten while it is launching", async () => {
  const source = await readFile(launcher, "utf8");
  assert.doesNotMatch(source, /set-windows-shortcut-app-id\.ps1/);
});

test("the development shortcut uses a branded native launcher", async () => {
  const [nativeSource, installerSource, mainSource] = await Promise.all([
    readFile(nativeLauncher, "utf8"),
    readFile(shortcutInstaller, "utf8"),
    readFile(mainProcess, "utf8"),
  ]);
  assert.match(nativeSource, /start-local-windows\.ps1/);
  assert.match(nativeSource, /CreateNoWindow\s*=\s*true/);
  assert.match(installerSource, /target:winexe/);
  assert.match(installerSource, /win32icon:/);
  assert.match(installerSource, /OpenMausBot\.DevLauncher\.exe/);
  assert.match(installerSource, /node_modules\\electron\\dist\\electron\.exe/);
  assert.match(installerSource, /rcedit\.exe/);
  assert.match(installerSource, /--set-icon/);
  assert.match(installerSource, /StartMenu/);
  const installerAppId = installerSource.match(/\$localDevelopmentAppId\s*=\s*'([^']+)'/)?.[1];
  const mainAppId = mainSource.match(/app\.isPackaged\s*\?\s*"com\.openmausbot\.app"\s*:\s*"([^"]+)"/)?.[1];
  assert.equal(installerAppId, "com.openmausbot.app.localdev.source");
  assert.equal(mainAppId, installerAppId);
  assert.match(mainSource, /app\.isPackaged\) app\.setPath\("userData", path\.join\(app\.getPath\("appData"\), "锐捷Bot Installed"\)\)/);
  assert.match(mainSource, /OMB_LOCAL_VM_PROFILE:\s*"installed"/);
  assert.match(mainSource, /server-data/);
  assert.match(mainSource, /title:\s*"锐捷Bot"/);
  assert.match(mainSource, /nativeTheme\.themeSource\s*=\s*nativeThemeSourceForSkin\(skin\)/);
  assert.match(installerSource, /set-windows-shortcut-app-id\.ps1/);
});
