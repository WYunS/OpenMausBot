import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch as hostArch } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const constants = await import(pathToFileURL(path.join(root, "server", "container-computer.ts")));
const runtimeArg = process.argv.find((value) => value.startsWith("--runtime="));
const platformArg = process.argv.find((value) => value.startsWith("--platform="));
const runtime = runtimeArg?.split("=", 2)[1] || process.env.OMB_CUA_RUNTIME || "docker";
const platform = platformArg?.split("=", 2)[1] || `linux/${hostArch() === "arm64" ? "arm64" : "amd64"}`;
if (!new Set(["docker", "podman"]).has(runtime)) throw new Error(`Unsupported runtime: ${runtime}`);
if (!new Set(["linux/amd64", "linux/arm64"]).has(platform)) throw new Error(`Unsupported platform: ${platform}`);

const platformArch = platform.split("/")[1];
const packageArch = platformArch === "amd64" ? "x64" : "arm64";
const outputDirectory = path.join(root, "vm-image", "dist", packageArch);
const archive = path.join(outputDirectory, constants.localVmImageArchiveName(platformArch === "amd64" ? "x64" : "arm64"));
await mkdir(outputDirectory, { recursive: true });

function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(file);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

const vendorDirectory = path.join(root, "vm-image", "vendor");
const feishuPackage = path.join(vendorDirectory, `feishu-${platformArch}.deb`);
const feilianPackage = path.join(vendorDirectory, `feilian-${platformArch}.deb`);
const vendorPresence = [existsSync(feishuPackage), existsSync(feilianPackage)];
if (vendorPresence[0] !== vendorPresence[1]) {
  throw new Error(`Both Feishu and Feilian ${platformArch} packages are required; one is missing from vm-image/vendor`);
}
if (process.env.OPENMAUSBOT_REQUIRE_ENTERPRISE_APPS === "1" && !vendorPresence[0]) {
  throw new Error(`Enterprise apps are required but vm-image/vendor has no reviewed ${platformArch} packages`);
}
const enterpriseArgs = vendorPresence[0] ? [
  "--build-arg", "REQUIRE_ENTERPRISE_APPS=1",
  "--build-arg", `FEISHU_DEB_SHA256=${await fileSha256(feishuPackage)}`,
  "--build-arg", `FEILIAN_DEB_SHA256=${await fileSha256(feilianPackage)}`,
] : [];
const mirrorArgs = [
  process.env.OPENMAUSBOT_APT_DEBIAN_MIRROR ? ["--build-arg", `APT_DEBIAN_MIRROR=${process.env.OPENMAUSBOT_APT_DEBIAN_MIRROR}`] : [],
  process.env.OPENMAUSBOT_APT_SECURITY_MIRROR ? ["--build-arg", `APT_SECURITY_MIRROR=${process.env.OPENMAUSBOT_APT_SECURITY_MIRROR}`] : [],
  process.env.OPENMAUSBOT_CUA_WHEEL_AMD64_URL ? ["--build-arg", `CUA_WHEEL_AMD64_URL=${process.env.OPENMAUSBOT_CUA_WHEEL_AMD64_URL}`] : [],
  process.env.OPENMAUSBOT_CUA_WHEEL_ARM64_URL ? ["--build-arg", `CUA_WHEEL_ARM64_URL=${process.env.OPENMAUSBOT_CUA_WHEEL_ARM64_URL}`] : [],
  enterpriseArgs,
].flat();

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function pullPinnedBase() {
  const candidates = process.env.OPENMAUSBOT_BASE_IMAGE
    ? [process.env.OPENMAUSBOT_BASE_IMAGE]
    : [constants.BASE_IMAGE, ...constants.BASE_IMAGE_MIRRORS];
  let lastError;
  for (const candidate of candidates) {
    try {
      await run(runtime, ["pull", "--platform", platform, candidate]);
      return candidate;
    } catch (error) {
      lastError = error;
      console.warn(`Could not pull pinned base from ${candidate}; trying the next configured source.`);
    }
  }
  throw lastError;
}

const baseImage = await pullPinnedBase();

if (runtime === "docker") {
  await run("docker", [
    "buildx", "build", "--platform", platform, "-t", constants.IMAGE,
    "--build-arg", `BASE_IMAGE=${baseImage}`,
    ...mirrorArgs,
    "--output", `type=oci,dest=${archive}`,
    "-f", path.join(root, "vm-image", "Containerfile"),
    path.join(root, "vm-image"),
  ]);
} else {
  await run("podman", [
    "build", "--platform", platform, "--pull=missing",
    "--build-arg", `BASE_IMAGE=${baseImage}`,
    ...mirrorArgs,
    "-t", constants.IMAGE,
    "-f", path.join(root, "vm-image", "Containerfile"),
    path.join(root, "vm-image"),
  ]);
  await run("podman", ["save", "--format", "oci-archive", "-o", archive, constants.IMAGE]);
}

const sha256 = await fileSha256(archive);
await writeFile(`${archive}.sha256`, `${sha256}  ${path.basename(archive)}\n`);
await writeFile(path.join(outputDirectory, `manifest-linux-${platformArch}.json`), JSON.stringify({
  schemaVersion: 1,
  appVersion: packageJson.version,
  image: constants.IMAGE,
  baseImage: constants.BASE_IMAGE,
  cuaDriverVersion: constants.CUA_DRIVER_VERSION,
  imageLayerVersion: constants.IMAGE_LAYER_VERSION,
  platform,
  archive: path.basename(archive),
  sha256,
  enterpriseApps: vendorPresence[0] ? ["feishu", "feilian"] : [],
}, null, 2) + "\n");

console.log(`Built ${platform} OCI archive: ${archive}`);
console.log(`SHA-256: ${sha256}`);
