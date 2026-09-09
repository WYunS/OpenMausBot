import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bridgeKeys = ['TT_FEISHU_BRIDGE_TOKEN', 'TT_FEISHU_BRIDGE_URL'];
const canonical = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const stamp = 'dcdd4f5c-fb2d-46ba-9503-5c1d82fc1060\r\n';

async function relocated(script, currentScript) {
  try {
    if (!path.isAbsolute(currentScript) || path.basename(path.dirname(currentScript)) !== 'tuantuan-feishu' ||
        path.basename(path.dirname(path.dirname(currentScript))) !== 'resources') return false;
    const root = path.dirname(path.dirname(path.dirname(currentScript)));
    if (path.basename(root).toLowerCase() !== 'tuantuan') return false;
    const receipt = async (name) => {
      const file = path.join(root, name);
      const stat = await lstat(file);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 ||
          canonical(await realpath(file)) !== canonical(file)) throw new Error('UNOWNED_RECEIPT');
      const bytes = await readFile(file);
      if (bytes[0] !== 255 || bytes[1] !== 254) throw new Error('INVALID_RECEIPT');
      return bytes.subarray(2).toString('utf16le');
    };
    if (canonical(await receipt('.tuantuan-install')) !== canonical(stamp + root)) return false;
    const previous = await receipt('.tuantuan-previous-install');
    if (!previous.startsWith(stamp)) return false;
    const old = previous.slice(stamp.length);
    if (!path.isAbsolute(old) || old !== path.resolve(old) || old.startsWith('\\\\') ||
        path.basename(old).toLowerCase() !== 'tuantuan') return false;
    return canonical(script) === canonical(path.join(old, 'resources', 'tuantuan-feishu', 'mcp.mjs'));
  } catch { return false; }
}

// Read-only legacy recognition. Never import or execute code from the old package.
export async function isLegacyFeishuEntry(entry, currentScript = fileURLToPath(new URL('./mcp.mjs', import.meta.url))) {
  if (entry?.name !== 'tuantuan-feishu' || typeof entry.command !== 'string' ||
      !path.isAbsolute(entry.command) || !['node', 'node.exe'].includes(path.basename(entry.command).toLowerCase()) ||
      !Array.isArray(entry.args) || entry.args.length !== 1) return false;
  const script = entry.args[0];
  const keys = entry.envKeys;
  if (typeof script !== 'string' || script.length > 4096 || !path.isAbsolute(script) ||
      script !== path.resolve(script) || script.startsWith('\\\\') ||
      !Array.isArray(keys) || keys.length !== 2 || [...keys].sort().some((key, index) => key !== bridgeKeys[index]) ||
      path.basename(script) !== 'mcp.mjs' || path.basename(path.dirname(script)) !== 'tuantuan-feishu' ||
      path.basename(path.dirname(path.dirname(script))) !== 'resources') return false;
  try {
    for (const name of ['mcp.mjs', 'tools.mjs']) {
      const file = path.join(path.dirname(script), name);
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > 256 * 1024 ||
          canonical(await realpath(file)) !== canonical(file)) return false;
      const [oldBytes, shippedBytes] = await Promise.all([readFile(file), readFile(new URL(`./${name}`, import.meta.url))]);
      if (!oldBytes.equals(shippedBytes)) return false;
    }
    return true;
  } catch (error) {
    // Only an absent old package uses the installer's verified relocation record.
    return error.code === 'ENOENT' && await relocated(script, currentScript);
  }
}
