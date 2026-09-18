import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { HARNESS_RELEASE } from '../shared/ruijie-harness-release.ts';
export const HARNESS_VERSION = HARNESS_RELEASE.version;
export const HARNESS_BUNDLE_SCHEMA = HARNESS_RELEASE.schemaVersion;
export const HARNESS_BRIDGE_CAPABILITY = HARNESS_RELEASE.capability;
const root = fileURLToPath(new URL('../', import.meta.url));

function sourceVariable(target) {
  return `RUIJIE_HARNESS_BUNDLE_SOURCE_${target.replaceAll('-', '_').toUpperCase()}`;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function payloadPaths(executable, target) {
  const resources = target.startsWith('darwin-')
    ? path.posix.join(path.posix.dirname(executable), '../Resources')
    : 'runtime/resources';
  return ['app.asar', 'app.asar.unpacked/package.json', 'app.asar.unpacked/lib/main.js']
    .map(file => path.posix.join(resources, file));
}

// Includes dependencies, assets and native libraries, not just Electron's exe.
// Signing must happen BEFORE staging; the copied sidecar is immutable afterwards.
async function runtimeDigest(directory) {
  const hash = createHash('sha256');
  async function visit(relative) {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const item = path.posix.join(relative, name);
      const file = path.join(directory, item);
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) {
        const link = await readlink(file);
        const resolved = path.resolve(path.dirname(file), link);
        const inside = path.relative(directory, resolved);
        assert(!path.isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${path.sep}`), 'Harness symlink escapes runtime');
        hash.update(JSON.stringify([item, 'link', link.replaceAll('\\', '/')]) + '\n');
      } else if (stat.isDirectory()) await visit(item);
      else {
        assert(stat.isFile(), 'Unsupported Harness runtime entry');
        hash.update(JSON.stringify([item, await sha256(file)]) + '\n');
      }
    }
  }
  await visit('runtime');
  return hash.digest('hex');
}

async function inspectPayload(directory, executable, target) {
  const paths = payloadPaths(executable, target);
  const payload = {};
  for (const file of paths) {
    const stat = await lstat(path.join(directory, file));
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Harness payload must be a regular file');
    payload[file] = await sha256(path.join(directory, file));
  }
  const pkg = JSON.parse(await readFile(path.join(directory, paths[1]), 'utf8'));
  assert.equal(pkg.name, 'dsh-plugin-desktop', 'Wrong Harness application');
  assert.equal(pkg.version, HARNESS_VERSION, 'Wrong actual Harness runtime version');
  assert.equal(pkg.ruijieHarnessBuildCommit, HARNESS_RELEASE.commit, 'Wrong actual Harness source commit');
  assert.equal(pkg.main, 'lib/main.js', 'Unexpected Harness entrypoint');
  return payload;
}

export async function verifyRuijieHarnessBundle(directory, target) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, HARNESS_BUNDLE_SCHEMA, 'Unsupported Harness bundle manifest');
  assert.equal(manifest.version, HARNESS_VERSION, 'Wrong Harness bundle version');
  assert.equal(manifest.target, target, 'Wrong Harness bundle target');
  assert.equal(manifest.buildCommit, HARNESS_RELEASE.commit, 'Wrong Harness source commit');
  assert.deepEqual(manifest.bridge, { schemaVersion: 1, capability: HARNESS_BRIDGE_CAPABILITY });
  assert.equal(typeof manifest.executable, 'string');
  assert(!path.isAbsolute(manifest.executable) && !manifest.executable.split(/[\\/]/u).includes('..'), 'Harness executable must stay inside its bundle');
  const executable = path.resolve(directory, manifest.executable);
  const details = await lstat(executable);
  assert(details.isFile() && !details.isSymbolicLink(), 'Harness executable must be a regular file');
  assert.equal(await sha256(executable), manifest.executableSha256, 'Harness executable digest mismatch');
  assert.deepEqual(await inspectPayload(directory, manifest.executable, target), manifest.payload, 'Harness payload digest mismatch');
  assert.equal(await runtimeDigest(directory), manifest.runtimeSha256, 'Harness runtime digest mismatch');
  return manifest;
}

export async function prepareRuijieHarness({ target, source, directory = root, buildCommit = process.env.RUIJIE_HARNESS_BUILD_COMMIT } = {}) {
  assert(['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(target), `Unsupported Harness target: ${target}`);
  assert(source, `Set ${sourceVariable(target)} to the reviewed Harness ${HARNESS_VERSION} unpacked runtime`);
  if (buildCommit !== undefined) assert.equal(buildCommit, HARNESS_RELEASE.commit, 'Wrong requested Harness source commit');
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
      : path.posix.join('runtime', 'Ruijie-Harness.exe');
    const executablePath = path.resolve(stage, executable);
    const manifest = {
      schemaVersion: HARNESS_BUNDLE_SCHEMA,
      version: HARNESS_VERSION,
      target,
      executable,
      executableSha256: await sha256(executablePath),
      payload: await inspectPayload(stage, executable, target),
      runtimeSha256: await runtimeDigest(stage),
      bridge: { schemaVersion: 1, capability: HARNESS_BRIDGE_CAPABILITY },
      buildCommit: HARNESS_RELEASE.commit,
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
    const output = path.join(root, 'dist-native/ruijie-harness', target);
    const result = process.env[variable]
      ? await prepareRuijieHarness({ target, source: process.env[variable] })
      : { output, manifest: await verifyRuijieHarnessBundle(output, target) };
    console.log(`Staged Harness ${HARNESS_VERSION} ${target} at ${result.output}`);
  }
}
