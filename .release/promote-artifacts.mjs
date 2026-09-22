// Explicit promotion of an already verified company build; never rebuild it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, appendFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectRelease, digest } from './toolkit/lib/core.mjs';
import { api, matchingSourceTag } from './toolkit/lib/github.mjs';

const repository = 'AI-Applications-Team/OpenMausBot';
const base = `/repos/${repository}`;
const targets = ['windows-x64', 'macos-arm64', 'macos-x64'];

export function validateBuild(run, sourceSha, runId) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/, 'Use the full original build SHA');
  assert.equal(String(run.id), runId, 'Wrong build run');
  assert.equal(run.repository.full_name, repository, 'Wrong build repository');
  assert.equal(run.path, '.github/workflows/package-release.yml', 'Wrong build workflow');
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success', 'Original build did not pass');
  assert.equal(run.head_sha, sourceSha, 'Original workflow source differs');
}

export function validateUploads(uploaded, expected) {
  assert.deepEqual(uploaded.map(a => a.name).sort(), expected.map(a => a.name).sort(), 'Missing, extra or duplicate Release assets');
  for (const asset of expected) {
    const actual = uploaded.find(a => a.name === asset.name);
    assert.equal(actual.state, 'uploaded');
    assert.equal(actual.size, asset.size, `Uploaded size differs: ${asset.name}`);
    assert.equal(actual.digest, `sha256:${asset.sha256}`, `Uploaded digest differs: ${asset.name}`);
  }
}

export async function findRelease(tag, request = api) {
  try { return await request(`${base}/releases/tags/${tag}`); }
  catch (error) { if (error.status !== 404) throw error; }
  // GitHub's by-tag endpoint can hide a draft until publication. Reuse the
  // authenticated release listing instead of creating another draft.
  for (let page = 1; page <= 20; page++) {
    const releases = await request(`${base}/releases?per_page=100&page=${page}`);
    const matches = releases.filter(release => release.tag_name === tag);
    assert(matches.length <= 1, 'Multiple drafts use the requested tag');
    if (matches.length) return matches[0];
    if (releases.length < 100) return undefined;
  }
  throw new Error('Release listing exceeded lookup bound');
}

async function main(phase) {
  assert(['check', 'publish'].includes(phase));
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  const runId = process.env.PROMOTE_RUN_ID;
  const sourceSha = process.env.PROMOTE_SOURCE_SHA;
  const version = process.env.RELEASE_VERSION;
  assert.match(runId || '', /^\d+$/);
  assert.match(version || '', /^\d+\.\d+\.\d+$/);
  validateBuild(await api(`${base}/actions/runs/${runId}`), sourceSha, runId);
  const sourcePackage = JSON.parse(execFileSync('git', ['show', `${sourceSha}:package.json`], { encoding: 'utf8' }));
  assert.equal(sourcePackage.version, version);
  const toolkitSha = execFileSync('git', ['rev-parse', `${sourceSha}:.release/toolkit`], { encoding: 'utf8' }).trim();
  const tag = `v${version}`;
  const uploadOnly = process.env.PROMOTE_UPLOAD_ONLY === 'true';
  assert(await matchingSourceTag(base, tag, sourceSha), `Create ${tag} at the verified source SHA using an authorized maintainer identity before promotion`);
  let release = await findRelease(tag);
  if (uploadOnly) assert(release?.draft, 'An authorized maintainer must prepare the Release draft first');
  if (release) {
    assert(release.draft, 'Existing published Release is never overwritten');
    assert.equal(release.target_commitish, sourceSha, 'Existing draft uses another source');
  }
  if (phase === 'check') return;

  const expected = { sourceSha, version, toolkitSha, targets };
  const collected = await collectRelease('.release-out/downloaded', expected);
  const manifestDir = '.release-out/original-manifest';
  const manifest = JSON.parse(await readFile(path.join(manifestDir, 'BUILD-MANIFEST.json'), 'utf8'));
  for (const key of ['sourceSha', 'version', 'toolkitSha']) assert.equal(manifest[key], expected[key]);
  assert.equal(String(manifest.run), runId);
  const stripDir = ({ dir, ...platform }) => platform;
  const byTarget = (a, b) => a.target.localeCompare(b.target);
  assert.deepEqual([...manifest.platforms].sort(byTarget), collected.manifests.map(stripDir).sort(byTarget), 'Original aggregate manifest differs');
  const sums = (await readFile(path.join(manifestDir, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/).sort();
  assert.deepEqual(sums, collected.assets.map(a => `${a.sha256}  ${a.name}`).sort());
  const expectedNames = [`RuijieBot-${version}-setup.exe`, `RuijieBot-${version}-mac-arm64.dmg`, `RuijieBot-${version}-mac-x64.dmg`];
  assert.deepEqual(collected.assets.map(a => a.name).sort(), expectedNames.sort());
  const assets = [...collected.assets];
  for (const name of ['BUILD-MANIFEST.json', 'SHA256SUMS.txt']) {
    const file = path.join(manifestDir, name);
    assets.push({ name, file, size: (await stat(file)).size, sha256: await digest(file) });
  }
  const body = `锐捷Bot ${version}\n\n本次直接发布已通过自动验证的原安装包，没有重新编译。\n\n### 下载选择\n- Windows 64 位：RuijieBot-${version}-setup.exe\n- Mac M 系列（Apple Silicon）：RuijieBot-${version}-mac-arm64.dmg\n- Mac Intel：RuijieBot-${version}-mac-x64.dmg\n\n### 本版变化\n- 保留 Grok Bot 风格的简洁界面；执行电脑入口位于输入栏，模型仍在 Bot 资料中设置。\n- 吸收聊天展示、草稿保护和失败恢复改进，保留图片搜索展示与文件预览。\n- 内置 Harness 2.1.10 与固定 CLI；Mac 首次分为 arm64、x64 两份原生安装包。\n\n### 验证与签名\n三平台包内依赖、运行时和服务端自动验证通过，Mac 已挂载最终 DMG 验证。Windows 未签名；Mac 为 ad-hoc 临时签名，未做 Apple 公证。真实账号登录、TCC 权限及覆盖安装仍需在测试机器上验收。\n\n源码：${sourceSha}\n原构建：https://github.com/${repository}/actions/runs/${runId}\nSHA256SUMS.txt 和 BUILD-MANIFEST.json 记录原安装包的哈希和构建来源。\n\n原 0.1.85 源码标签保留；本 Release 的 ${tag} 标签指向实际打包提交。企业内测采用手动下载更新，不提供自动更新 feed。\n`;
  if (!release) release = await api(`${base}/releases`, { method: 'POST', body: { tag_name: tag, target_commitish: sourceSha, name: `RuijieBot v${version}`, body, draft: true, prerelease: false } });
  else if (!uploadOnly) await api(`${base}/releases/${release.id}`, { method: 'PATCH', body: { tag_name: tag, target_commitish: sourceSha, body, name: `RuijieBot v${version}`, draft: true, prerelease: false } });
  for (const asset of assets) {
    const existing = release.assets.find(a => a.name === asset.name);
    if (existing) { validateUploads([existing], [asset]); continue; }
    const url = new URL(release.upload_url.replace(/\{.*$/, ''));
    assert.equal(url.hostname, 'uploads.github.com');
    url.searchParams.set('name', asset.name);
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(asset.size) }, body: createReadStream(asset.file), duplex: 'half' });
    assert(response.ok, `Upload failed: ${asset.name}, HTTP ${response.status}; draft retained`);
    validateUploads([await response.json()], [asset]);
  }
  const uploaded = await api(`${base}/releases/${release.id}/assets?per_page=100`);
  validateUploads(uploaded, assets);
  await matchingSourceTag(base, tag, sourceSha);
  if (uploadOnly) {
    console.log(`All five Release asset hashes verified; maintainer can publish draft ${release.id} as ${tag}.`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `All five asset hashes verified for draft ${release.id}. An authorized maintainer must publish ${tag}; no extra personal token is stored in Actions.\n`);
    return;
  }
  const published = await api(`${base}/releases/${release.id}`, { method: 'PATCH', body: { tag_name: tag, target_commitish: sourceSha, draft: false, prerelease: false, make_latest: 'true' } });
  assert.equal(published.tag_name, tag, 'Published release tag differs');
  assert(await matchingSourceTag(base, tag, sourceSha), 'Published tag is missing');
  assert.equal((await api(`${base}/releases/latest`)).id, release.id);
  console.log(`Published verified Release: ${published.html_url}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Published [RuijieBot v${version}](${published.html_url}) from verified run ${runId}. All five asset hashes checked.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv[2]);
