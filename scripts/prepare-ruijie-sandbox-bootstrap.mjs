import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSandboxPreset, sandboxPresetDigest, writePrivateJson } from '../electron/ruijie-sandbox-bootstrap.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const sandboxInputPath = (directory = root) => process.env.RUIJIE_SANDBOX_PRESET_FILE || path.join(directory, 'release-inputs', 'ruijie-sandbox.json');
export const sandboxStagedPath = (directory = root) => path.join(directory, 'dist-native', 'ruijie-sandbox', 'bootstrap.json');

export function prepareSandboxBootstrap(directory = root) {
  const preset = readSandboxPreset(sandboxInputPath(directory));
  writePrivateJson(sandboxStagedPath(directory), preset);
  return sandboxPresetDigest(preset);
}

export function stagedSandboxDigest(directory = root) {
  const file = sandboxStagedPath(directory);
  return existsSync(file) ? sandboxPresetDigest(readSandboxPreset(file)) : undefined;
}

export function verifySandboxBootstrap(directory = root) {
  const digest = sandboxPresetDigest(readSandboxPreset(sandboxInputPath(directory)));
  if (stagedSandboxDigest(directory) !== digest) {
    throw new Error('Sandbox build input changed or was not staged; run pnpm build:sandbox');
  }
  return digest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { prepareSandboxBootstrap(); console.log('Sandbox preset staged (no credentials printed).'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
