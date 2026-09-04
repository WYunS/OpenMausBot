import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CUA_WINDOWS_VERSION = "0.23.2";
export const CUA_WINDOWS_ASSET = "cua-driver-rs-0.23.2-windows-x86_64-binary.zip";
export const CUA_WINDOWS_ARCHIVE_SHA256 = "27a41831d5dda71082b58154ff87966a9ad8131ce66e8060da2d860558655c13";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertWindowsX64(binary) {
  const bytes = readFileSync(binary);
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error("CUA Windows driver is not a PE executable");
  }
  const pe = bytes.readUInt32LE(0x3c);
  if (
    pe > bytes.length - 6 ||
    !bytes.subarray(pe, pe + 4).equals(Buffer.from([0x50, 0x45, 0, 0])) ||
    bytes.readUInt16LE(pe + 4) !== 0x8664
  ) {
    throw new Error("CUA Windows driver is not an x64 PE executable");
  }
}

function assertVersion(binary) {
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  if (result.status !== 0 || `${result.stdout}\n${result.stderr}`.trim() !== `cua-driver ${CUA_WINDOWS_VERSION}`) {
    throw new Error(`CUA Windows driver must report version ${CUA_WINDOWS_VERSION}`);
  }
}

async function officialArchive() {
  const cacheDirectory = process.env.OMB_CUA_WINDOWS_ARCHIVE_DIR;
  const cached = cacheDirectory ? join(cacheDirectory, CUA_WINDOWS_ASSET) : "";
  if (cached && existsSync(cached)) return readFileSync(cached);

  const url = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_WINDOWS_VERSION}/${CUA_WINDOWS_ASSET}`;
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`could not download ${CUA_WINDOWS_ASSET}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function resolveDriver(scratch) {
  if (process.env.CUA_DRIVER_PATH) return process.env.CUA_DRIVER_PATH;

  const archiveBytes = await officialArchive();
  const actual = sha256(archiveBytes);
  if (actual !== CUA_WINDOWS_ARCHIVE_SHA256) {
    throw new Error(`CUA Windows archive failed SHA-256 verification (received ${actual})`);
  }
  const archive = join(scratch, CUA_WINDOWS_ASSET);
  const extracted = join(scratch, "extracted");
  writeFileSync(archive, archiveBytes, { mode: 0o600 });
  mkdirSync(extracted, { mode: 0o700 });
  const result = spawnSync("tar", ["-xf", archive, "-C", extracted, "cua-driver.exe"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`could not extract ${CUA_WINDOWS_ASSET}: ${result.stderr || result.stdout}`);
  }
  const binary = join(extracted, "cua-driver.exe");
  if (!existsSync(binary)) throw new Error(`${CUA_WINDOWS_ASSET} did not contain cua-driver.exe`);
  return binary;
}

export async function prepareCuaWindows({
  root = join(dirname(fileURLToPath(import.meta.url)), ".."),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (platform !== "win32" || arch !== "x64") {
    throw new Error(`Windows CUA packaging requires win32-x64; received ${platform}-${arch}`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "openmaus-cua-win32-x64-"));
  try {
    const candidate = await resolveDriver(scratch);
    if (!existsSync(candidate)) throw new Error(`CUA_DRIVER_PATH does not exist: ${candidate}`);
    assertWindowsX64(candidate);
    assertVersion(candidate);

    const finalDirectory = join(root, "dist-native", "cua-win32-x64");
    const stagingParent = dirname(finalDirectory);
    mkdirSync(stagingParent, { recursive: true });
    const stagedDirectory = mkdtempSync(join(stagingParent, ".cua-win32-x64-"));
    copyFileSync(candidate, join(stagedDirectory, "cua-driver.exe"));
    writeFileSync(
      join(stagedDirectory, "manifest.json"),
      `${JSON.stringify({ version: CUA_WINDOWS_VERSION, target: "win32-x64", binarySha256: sha256(readFileSync(candidate)) }, null, 2)}\n`,
      { mode: 0o600 },
    );
    rmSync(finalDirectory, { recursive: true, force: true });
    renameSync(stagedDirectory, finalDirectory);
    console.log(`staged CUA Driver ${CUA_WINDOWS_VERSION} for win32-x64`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

await prepareCuaWindows();
