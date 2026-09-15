import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const helper = resolve("scripts/windows-node-proxy.ps1");

test("the Windows launcher bypasses its configured Ruijie manager host", () => {
  const directory = mkdtempSync(join(tmpdir(), "omb-proxy-bypass-"));
  const preset = join(directory, "bootstrap.json");
  writeFileSync(preset, JSON.stringify({ managerUrl: "http://172.24.37.150:12581" }));

  const command = [
    `. '${helper.replaceAll("'", "''")}'`,
    `$env:NO_PROXY='127.0.0.1,localhost'`,
    `Add-NodeProxyBypassFromSandboxPreset -PresetPath '${preset.replaceAll("'", "''")}'`,
    `[Console]::Out.Write($env:NO_PROXY)`,
  ].join("; ");
  const result = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8" });

  assert.equal(result, "172.24.37.150,127.0.0.1,localhost");
});

test("the local Windows installer registers a login-start shortcut", () => {
  const source = readFileSync(resolve("scripts/install-local-windows-shortcut.ps1"), "utf8");
  assert.match(source, /SpecialFolder\]::Startup/);
  assert.match(source, /\$startupShortcut/);
});
