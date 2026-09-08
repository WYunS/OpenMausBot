import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IMAGE, IMAGE_LAYER_VERSION, CUA_DRIVER_VERSION, localVmImageArchiveName } from "../server/container-computer.ts";
import { validateReleaseManifest } from "./local-vm-release-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const requested = process.argv.filter((value) => value.startsWith("--arch=")).map((value) => value.slice(7));
const arches = requested.length ? requested : ["x64", "arm64"];

for (const arch of arches) {
  if (!new Set(["x64", "arm64"]).has(arch)) throw new Error(`Unsupported package architecture: ${arch}`);
  const directory = path.join(root, "vm-image", "dist", arch);
  const archive = path.join(directory, localVmImageArchiveName(arch));
  const details = await stat(archive);
  if (!details.isFile() || details.size < 1024 * 1024) throw new Error(`Local VM archive is missing or too small: ${archive}`);
  const expected = (await readFile(`${archive}.sha256`, "utf8")).trim().split(/\s+/)[0];
  const actual = await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(archive);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
  if (actual !== expected) throw new Error(`Local VM archive checksum mismatch: ${archive}`);
  const platformArch = arch === "x64" ? "amd64" : "arm64";
  const manifest = JSON.parse(await readFile(path.join(directory, `manifest-linux-${platformArch}.json`), "utf8"));
  validateReleaseManifest(manifest, directory);
  if (manifest.appVersion !== packageJson.version) {
    throw new Error(`Local VM manifest was built for app ${manifest.appVersion}, not ${packageJson.version}: ${directory}`);
  }
  if (manifest.image !== IMAGE || manifest.cuaDriverVersion !== CUA_DRIVER_VERSION || manifest.imageLayerVersion !== IMAGE_LAYER_VERSION || manifest.sha256 !== actual) {
    throw new Error(`Local VM manifest does not match runtime constants: ${directory}`);
  }
  console.log(`Verified ${arch} Local VM bundle: ${path.basename(archive)} (${actual})`);
}
