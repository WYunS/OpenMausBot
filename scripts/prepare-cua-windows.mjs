import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CUA_WINDOWS_VERSION = "0.28.1";
export const CUA_WINDOWS_ASSET = "cua-driver-rs-0.28.1-windows-x86_64.zip";
export const CUA_WINDOWS_ARCHIVE_SHA256 = "0f864381d3bcf29e7caf20d4b93bdf8476faf4e1ba986ce03890162beba5c3ee";
export const CUA_WINDOWS_BINARY_SHA256 = "87d6353a6c808e860cbae4289613b38b06420732c5b84caa81e1ed7c2e9e312c";
export const CUA_WINDOWS_CURSOR_THEME_SHA256 = "5167bc631c9900571df004995b53dd368fb34a44dff6555b26d98ed090bd913a";
export const CUA_WINDOWS_UIA_SHA256 = "75faa80ea5b34d7ecdd2cfe751afc3e546520289e00d7361814d57e0d2c9e684";

const CUA_WINDOWS_FILES = {
  "cua-driver.exe": CUA_WINDOWS_BINARY_SHA256,
  "cua-cursor-theme.exe": CUA_WINDOWS_CURSOR_THEME_SHA256,
  "cua-driver-uia.exe": CUA_WINDOWS_UIA_SHA256,
};

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

export function stagedCuaWindowsIsCurrent(finalDirectory, {
  binarySha256 = CUA_WINDOWS_BINARY_SHA256,
  cursorThemeSha256 = CUA_WINDOWS_CURSOR_THEME_SHA256,
  uiaSha256 = CUA_WINDOWS_UIA_SHA256,
  validateBinary = (binary) => { assertWindowsX64(binary); assertVersion(binary); },
  validateSidecar = assertWindowsX64,
} = {}) {
  try {
    const binary = join(finalDirectory, "cua-driver.exe");
    const cursorTheme = join(finalDirectory, "cua-cursor-theme.exe");
    const uia = join(finalDirectory, "cua-driver-uia.exe");
    const manifest = JSON.parse(readFileSync(join(finalDirectory, "manifest.json"), "utf8"));
    if (
      manifest.version !== CUA_WINDOWS_VERSION ||
      manifest.target !== "win32-x64" ||
      manifest.binarySha256 !== binarySha256 ||
      manifest.cursorThemeSha256 !== cursorThemeSha256 ||
      manifest.uiaSha256 !== uiaSha256 ||
      sha256(readFileSync(binary)) !== binarySha256 ||
      sha256(readFileSync(cursorTheme)) !== cursorThemeSha256 ||
      sha256(readFileSync(uia)) !== uiaSha256
    ) return false;
    validateBinary(binary);
    validateSidecar(cursorTheme);
    validateSidecar(uia);
    return true;
  } catch {
    return false;
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

async function resolveRuntime(scratch) {
  if (process.env.CUA_DRIVER_PATH) {
    const directory = dirname(process.env.CUA_DRIVER_PATH);
    return {
      "cua-driver.exe": process.env.CUA_DRIVER_PATH,
      "cua-cursor-theme.exe": process.env.CUA_CURSOR_THEME_PATH || join(directory, "cua-cursor-theme.exe"),
      "cua-driver-uia.exe": process.env.CUA_DRIVER_UIA_PATH || join(directory, "cua-driver-uia.exe"),
    };
  }

  const archiveBytes = await officialArchive();
  const actual = sha256(archiveBytes);
  if (actual !== CUA_WINDOWS_ARCHIVE_SHA256) {
    throw new Error(`CUA Windows archive failed SHA-256 verification (received ${actual})`);
  }
  const archive = join(scratch, CUA_WINDOWS_ASSET);
  const extracted = join(scratch, "extracted");
  writeFileSync(archive, archiveBytes, { mode: 0o600 });
  mkdirSync(extracted, { mode: 0o700 });
  const result = spawnSync("tar", ["-xf", archive, "-C", extracted, "--strip-components=1"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`could not extract ${CUA_WINDOWS_ASSET}: ${result.stderr || result.stdout}`);
  }
  return Object.fromEntries(Object.keys(CUA_WINDOWS_FILES).map((name) => [name, join(extracted, name)]));
}

export async function prepareCuaWindows({
  root = join(dirname(fileURLToPath(import.meta.url)), ".."),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (platform !== "win32" || arch !== "x64") {
    throw new Error(`Windows CUA packaging requires win32-x64; received ${platform}-${arch}`);
  }
  const finalDirectory = join(root, "dist-native", "cua-win32-x64");
  if (stagedCuaWindowsIsCurrent(finalDirectory)) {
    console.log(`CUA Driver ${CUA_WINDOWS_VERSION} already staged for win32-x64`);
    return;
  }
  const scratch = mkdtempSync(join(tmpdir(), "openmaus-cua-win32-x64-"));
  try {
    const candidates = await resolveRuntime(scratch);
    for (const [name, expectedSha256] of Object.entries(CUA_WINDOWS_FILES)) {
      const candidate = candidates[name];
      if (!existsSync(candidate)) throw new Error(`CUA Windows runtime file does not exist: ${candidate}`);
      assertWindowsX64(candidate);
      const actualSha256 = sha256(readFileSync(candidate));
      if (actualSha256 !== expectedSha256) {
        throw new Error(`CUA Windows ${name} failed SHA-256 verification (received ${actualSha256})`);
      }
    }
    assertVersion(candidates["cua-driver.exe"]);

    const finalBinary = join(finalDirectory, "cua-driver.exe");
    // A running development app can legitimately have this executable open.
    // Windows then refuses to remove its parent directory even when the
    // already-staged binary is byte-for-byte identical to the reviewed asset.
    // Reuse that exact binary instead of making local packaging require the
    // developer to stop every active computer-use session first.
    if (stagedCuaWindowsIsCurrent(finalDirectory)) {
      assertWindowsX64(finalBinary);
      assertVersion(finalBinary);
      console.log(`CUA Driver ${CUA_WINDOWS_VERSION} already staged for win32-x64`);
      return;
    }
    const stagingParent = dirname(finalDirectory);
    mkdirSync(stagingParent, { recursive: true });
    const stagedDirectory = mkdtempSync(join(stagingParent, ".cua-win32-x64-"));
    for (const [name, candidate] of Object.entries(candidates)) {
      copyFileSync(candidate, join(stagedDirectory, name));
    }
    writeFileSync(
      join(stagedDirectory, "manifest.json"),
      `${JSON.stringify({
        version: CUA_WINDOWS_VERSION,
        target: "win32-x64",
        binarySha256: CUA_WINDOWS_BINARY_SHA256,
        cursorThemeSha256: CUA_WINDOWS_CURSOR_THEME_SHA256,
        uiaSha256: CUA_WINDOWS_UIA_SHA256,
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    rmSync(finalDirectory, { recursive: true, force: true });
    renameSync(stagedDirectory, finalDirectory);
    console.log(`staged CUA Driver ${CUA_WINDOWS_VERSION} for win32-x64`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) await prepareCuaWindows();
