import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SANDBOX_PRESET_MARKER = 'ruijieSandboxPreset';
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

// Never include input values or JSON parser errors: the template contains keys.
export function validateSandboxPreset(value) {
  const fail = () => { throw new Error('Invalid sandbox preset: require schemaVersion 1, managerUrl and requestJson'); };
  if (!record(value) || value.schemaVersion !== 1 ||
      Object.keys(value).some((key) => !['schemaVersion', 'managerUrl', 'requestJson'].includes(key))) fail();
  let url, template;
  try { url = new URL(value.managerUrl); template = JSON.parse(value.requestJson); } catch { fail(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || !record(template)) fail();
  for (const key of ['client_id', 'vnc_key', 'minio_url']) {
    if (typeof template[key] !== 'string' || !template[key].trim()) fail();
  }
  if (template.attach_only !== true || Object.keys(template).some((key) =>
    !['client_id', 'vnc_key', 'minio_url', 'attach_only'].includes(key))) fail();
  return { schemaVersion: 1, managerUrl: url.origin, requestJson: JSON.stringify(template) };
}

export function readSandboxPreset(file) {
  let value;
  try { value = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error('Sandbox preset is missing or unreadable; obtain the private release-inputs/ruijie-sandbox.json handoff'); }
  return validateSandboxPreset(value);
}

export function sandboxPresetDigest(preset) {
  return createHash('sha256').update(JSON.stringify(validateSandboxPreset(preset))).digest('hex');
}

export function writePrivateJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, file);
}

/** Boot-only transaction, before the server or any credential writer starts.
 * Persist a pending marker with the secret first. A crash between writes can
 * finish the public config next launch, without replacing any personal account.
 * A handled marker is permanent, including after an explicit credential clear.
 * Returns the last DURABLY saved credential document even on partial failure. */
export async function installSandboxPreset({ presetPath, configPath, credentials,
  storeAvailable = true, saveCredentials, saveConfig = writePrivateJson }) {
  let current = structuredClone(credentials);
  if (!storeAvailable) return { credentials: current, status: 'unavailable' };
  const marker = current[SANDBOX_PRESET_MARKER];
  if (marker?.state === 'handled') return { credentials: current, status: 'handled' };
  let managerUrl;
  try {
    const preset = readSandboxPreset(presetPath);
    let config;
    try { config = JSON.parse(readFileSync(configPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; config = {}; }
    if (!record(config)) throw new Error('Invalid existing config');
    if (marker?.state !== 'pending') {
      // Even an intentionally blank existing section belongs to the user.
      if (Object.hasOwn(config, 'ruijieSandbox') || Object.hasOwn(current, 'ruijieSandboxRequestJson')) {
        const next = { ...current, [SANDBOX_PRESET_MARKER]: { state: 'handled' } };
        await saveCredentials(next); current = next;
        return { credentials: current, status: 'preserved' };
      }
      const next = { ...current, ruijieSandboxRequestJson: preset.requestJson,
        [SANDBOX_PRESET_MARKER]: { state: 'pending', managerUrl: preset.managerUrl } };
      await saveCredentials(next); current = next;
    }
    if (!Object.hasOwn(config, 'ruijieSandbox')) {
      // Resume the ORIGINAL pending import even if a later installer has a new preset.
      managerUrl = current[SANDBOX_PRESET_MARKER].managerUrl;
      validateSandboxPreset({ schemaVersion: 1, managerUrl, requestJson: current.ruijieSandboxRequestJson });
      await saveConfig(configPath, { ...config, ruijieSandbox: { managerUrl } });
    } else {
      managerUrl = config.ruijieSandbox?.managerUrl;
    }
    const next = { ...current, [SANDBOX_PRESET_MARKER]: { state: 'handled' } };
    await saveCredentials(next); current = next;
    return { credentials: current, status: 'installed', managerUrl };
  } catch {
    // No OS/keychain/parser errors are exposed; they can contain secret input.
    return { credentials: current, status: 'retry', managerUrl };
  }
}
