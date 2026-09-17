import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HARNESS_VERSION = '2.1.9';
export const HARNESS_BUNDLE_SCHEMA = 1;
export const HARNESS_BRIDGE_CAPABILITY = 'openmaus-server-v1';
const root = fileURLToPath(new URL('../', import.meta.url));

function sourceVariable(target) {
  return `RUIJIE_HARNESS_BUNDLE_SOURCE_${target.replaceAll('-', '_').toUpperCase()}`;
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function verifyRuijieHarnessBundle(directory, target) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, HARNESS_BUNDLE_SCHEMA, 'Unsupported Harness bundle manifest');
  assert.equal(manifest.version, HARNESS_VERSION, 'Wrong Harness bundle version');
  assert.equal(manifest.target, target, 'Wrong Harness bundle target');
  assert.deepEqual(manifest.bridge, { schemaVersion: 1, capability: HARNESS_BRIDGE_CAPABILITY });
  assert.equal(typeof manifest.executable, 'string');
  assert(!path.isAbsolute(manifest.executable) && !manifest.executable.split(/[\\/]/u).includes('..'), 'Harness executable must stay inside its bundle');
  const executable = path.resolve(directory, manifest.executable);
  const details = await lstat(executable);
  assert(details.isFile() && !details.isSymbolicLink(), 'Harness executable must be a regular file');
  assert.equal(await sha256(executable), manifest.executableSha256, 'Harness executable digest mismatch');
  return manifest;
}

export async function prepareRuijieHarness({ target, source, directory = root, buildCommit = process.env.RUIJIE_HARNESS_BUILD_COMMIT } = {}) {
  assert(['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(target), `Unsupported Harness target: ${target}`);
  assert(source, `Set ${sourceVariable(target)} to the reviewed Harness ${HARNESS_VERSION} unpacked runtime`);
  const sourcePath = path.resolve(source);
  const sourceDetails = await lstat(sourcePath);
  assert(sourceDetails.isDirectory() && !sourceDetails.isSymbolicLink(), 'Harness source must be a real unpacked directory');
  const output = path.join(directory, 'dist-native', 'ruijie-harness', target);
  const parent = path.dirname(output);
  const stage = path.join(parent, `.stage-${target}-${process.pid}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(path.join(stage, 'runtime'), { recursive: true });
  try {
    if (target.startsWith('darwin-')) {
      assert(sourcePath.endsWith('.app'), 'macOS Harness source must be the unpacked .app directory');
      await cp(sourcePath, path.join(stage, 'runtime', path.basename(sourcePath)), { recursive: true, verbatimSymlinks: true });
    } else {
      await cp(sourcePath, path.join(stage, 'runtime'), { recursive: true, verbatimSymlinks: true });
    }
    const executable = target.startsWith('darwin-')
      ? path.posix.join('runtime', path.basename(sourcePath), 'Contents', 'MacOS', '锐捷 Harness')
      : path.win32.join('runtime', 'Ruijie-Harness.exe');
    const executablePath = path.resolve(stage, executable);
    const manifest = {
      schemaVersion: HARNESS_BUNDLE_SCHEMA,
      version: HARNESS_VERSION,
      target,
      executable,
      executableSha256: await sha256(executablePath),
      bridge: { schemaVersion: 1, capability: HARNESS_BRIDGE_CAPABILITY },
      ...(buildCommit ? { buildCommit } : {}),
    };
    await writeFile(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await verifyRuijieHarnessBundle(stage, target);
    await rm(output, { recursive: true, force: true });
    await rename(stage, output);
    return { output, manifest };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const requested = process.argv[2] === '--mac'
    ? ['darwin-arm64', 'darwin-x64']
    : process.argv[2] === '--target' ? [process.argv[3]] : [];
  assert(requested.length > 0 && requested.every(Boolean), 'Use --mac or --target PLATFORM-ARCH');
  for (const target of requested) {
    const variable = sourceVariable(target);
    const result = await prepareRuijieHarness({ target, source: process.env[variable] });
    console.log(`Staged Harness ${HARNESS_VERSION} ${target} at ${result.output}`);
  }
}
