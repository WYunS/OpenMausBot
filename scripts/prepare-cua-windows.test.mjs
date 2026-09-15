import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import {
  CUA_WINDOWS_VERSION,
  stagedCuaWindowsIsCurrent,
} from "./prepare-cua-windows.mjs";

const fixtures = [];
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("reuses a locally staged Windows driver only when its pinned manifest and bytes match", () => {
  const directory = mkdtempSync(join(tmpdir(), "omb-cua-windows-test-"));
  fixtures.push(directory);
  const binary = Buffer.from("reviewed-driver-fixture");
  const binarySha256 = createHash("sha256").update(binary).digest("hex");
  const cursorTheme = Buffer.from("reviewed-cursor-theme-fixture");
  const cursorThemeSha256 = createHash("sha256").update(cursorTheme).digest("hex");
  const uia = Buffer.from("reviewed-uia-fixture");
  const uiaSha256 = createHash("sha256").update(uia).digest("hex");
  writeFileSync(join(directory, "cua-driver.exe"), binary);
  writeFileSync(join(directory, "cua-cursor-theme.exe"), cursorTheme);
  writeFileSync(join(directory, "cua-driver-uia.exe"), uia);
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({
    version: CUA_WINDOWS_VERSION,
    target: "win32-x64",
    binarySha256,
    cursorThemeSha256,
    uiaSha256,
  }));
  const validateBinary = vi.fn();
  const validateSidecar = vi.fn();

  expect(stagedCuaWindowsIsCurrent(directory, {
    binarySha256, cursorThemeSha256, uiaSha256, validateBinary, validateSidecar,
  })).toBe(true);
  expect(validateBinary).toHaveBeenCalledOnce();
  expect(validateSidecar).toHaveBeenCalledTimes(2);
  writeFileSync(join(directory, "cua-cursor-theme.exe"), "tampered");
  expect(stagedCuaWindowsIsCurrent(directory, {
    binarySha256, cursorThemeSha256, uiaSha256, validateBinary, validateSidecar,
  })).toBe(false);
  writeFileSync(join(directory, "cua-cursor-theme.exe"), cursorTheme);
  writeFileSync(join(directory, "cua-driver.exe"), "tampered");
  expect(stagedCuaWindowsIsCurrent(directory, {
    binarySha256, cursorThemeSha256, uiaSha256, validateBinary, validateSidecar,
  })).toBe(false);
});
