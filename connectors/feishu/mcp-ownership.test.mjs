import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isLegacyFeishuEntry } from './mcp-ownership.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tuantuan-mcp-owner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'resources', 'tuantuan-feishu');
  await mkdir(folder, { recursive: true });
  for (const name of ['mcp.mjs', 'tools.mjs']) {
    await copyFile(new URL(`./${name}`, import.meta.url), path.join(folder, name));
  }
  return { root, folder, entry: { name: 'tuantuan-feishu', command: process.execPath,
    args: [path.join(folder, 'mcp.mjs')], envKeys: ['TT_FEISHU_BRIDGE_URL', 'TT_FEISHU_BRIDGE_TOKEN'] } };
}

test('recognizes only the exact shipped bridge and tool definitions in an earlier branded package', async (t) => {
  const { folder, entry } = await fixture(t);
  assert.equal(await isLegacyFeishuEntry(entry), true);
  for (const patch of [
    { name: 'foreign' }, { command: 'node' }, { args: [...entry.args, '--other'] },
    { envKeys: [] }, { envKeys: [...entry.envKeys, 'NODE_OPTIONS'] },
    { envKeys: ['TT_FEISHU_BRIDGE_URL', 'TT_FEISHU_BRIDGE_URL'] },
    { args: [path.join(folder, '..', 'foreign', 'mcp.mjs')] },
  ]) assert.equal(await isLegacyFeishuEntry({ ...entry, ...patch }), false);
  for (const name of ['mcp.mjs', 'tools.mjs']) {
    await writeFile(path.join(folder, name), '// unrelated or modified program');
    assert.equal(await isLegacyFeishuEntry(entry), false);
    await copyFile(new URL(`./${name}`, import.meta.url), path.join(folder, name));
  }
});

test('does not accept a branded path reached through a directory junction', async (t) => {
  const { root, folder, entry } = await fixture(t);
  await mkdir(path.join(root, 'alias'));
  const link = path.join(root, 'alias', 'resources');
  await symlink(path.dirname(folder), link, process.platform === 'win32' ? 'junction' : 'dir');
  entry.args = [path.join(link, 'tuantuan-feishu', 'mcp.mjs')];
  assert.equal(await isLegacyFeishuEntry(entry), false);
});

test('installer relocation receipt recognizes the exact removed previous package and no other path', async (t) => {
  const { root, folder, entry } = await fixture(t);
  const currentRoot = path.join(root, 'new', 'tuantuan');
  const currentScript = path.join(currentRoot, 'resources', 'tuantuan-feishu', 'mcp.mjs');
  await mkdir(path.dirname(currentScript), { recursive: true });
  const previousRoot = path.join(root, 'old', 'tuantuan');
  const stamp = 'dcdd4f5c-fb2d-46ba-9503-5c1d82fc1060\r\n';
  await writeFile(path.join(currentRoot, '.tuantuan-install'), '\ufeff' + stamp + currentRoot, 'utf16le');
  await writeFile(path.join(currentRoot, '.tuantuan-previous-install'), '\ufeff' + stamp + previousRoot, 'utf16le');
  entry.args = [path.join(previousRoot, 'resources', 'tuantuan-feishu', 'mcp.mjs')];
  assert.equal(await isLegacyFeishuEntry(entry, currentScript), true);
  entry.args = [path.join(folder, 'missing.mjs')];
  assert.equal(await isLegacyFeishuEntry(entry, currentScript), false);
  await writeFile(path.join(currentRoot, '.tuantuan-install'), 'unowned');
  entry.args = [path.join(previousRoot, 'resources', 'tuantuan-feishu', 'mcp.mjs')];
  assert.equal(await isLegacyFeishuEntry(entry, currentScript), false);
});
