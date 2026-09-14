// Maintainer-only export. The recipient builds from this private input, never
// from the maintainer's OS-bound credentials.bin or personal account sessions.
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readSecureCredentials } from '../electron/secure-credentials.mjs';
import { validateSandboxPreset } from '../electron/ruijie-sandbox-bootstrap.mjs';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const profile = args.includes('--profile') && option('--profile');
const configFile = args.includes('--config') && option('--config');
const output = args.includes('--output') && option('--output');
if (!profile || !configFile || !output || ![profile, configFile, output].every(path.isAbsolute)) {
  console.error('Require absolute --profile, --config and --output paths. Output must not already exist.');
  app.exit(1);
} else {
  app.setPath('userData', profile);
  void (async () => {
  await app.whenReady();
  try {
    const file = path.join(profile, 'credentials.bin');
    const saved = await readSecureCredentials({ exists: () => existsSync(file),
      isAvailable: () => safeStorage.isAsyncEncryptionAvailable(), readFile: () => readFileSync(file),
      decrypt: (bytes) => safeStorage.decryptStringAsync(bytes), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });
    if (saved.status !== 'ok') throw new Error('Cannot read source credential store');
    const config = JSON.parse(readFileSync(configFile, 'utf8'));
    const original = JSON.parse(saved.credentials.ruijieSandboxRequestJson);
    // Provisioning templates can also carry model/gateway/storage credentials.
    // Recipients only need to attach to this desktop, never recreate its apps.
    const preset = validateSandboxPreset({ schemaVersion: 1, managerUrl: config.ruijieSandbox?.managerUrl,
      requestJson: JSON.stringify({ client_id: original.client_id, vnc_key: original.vnc_key,
        minio_url: original.minio_url, attach_only: true }) });
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(preset, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log('Exported sandbox-only private build input. No SSO, Feishu or other account credentials exported.');
    app.exit(0);
  } catch {
    console.error('Sandbox export failed: check source profile/config and choose a new output file. No credentials printed.');
    app.exit(1);
  }
  })();
}
