import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { version, inside, regular, stageFiles, collectRelease, validateConfig, preparedFiles, selectTargets, runnerForTarget } from '../lib/core.mjs';

test('macos selection builds both native CPUs and Intel never runs on Apple Silicon', () => {
  const targets = ['windows-x64','linux-x64','macos-arm64','macos-x64'];
  assert.deepEqual(selectTargets(targets,'macos'),['macos-arm64','macos-x64']);
  assert.deepEqual(selectTargets(targets,'macos-x64'),['macos-x64']);
  assert.equal(runnerForTarget('macos-x64'),'macos-15-intel');
  assert.equal(runnerForTarget('macos-arm64'),'macos-15');
  assert.throws(()=>selectTargets(targets,'macos-universal'));
});

test('rejects shell payloads and ambiguous versions before running a project', () => {
  assert.equal(version('v2.1.6'), '2.1.6');
  assert.equal(version('1.2.3-rc.1'), '1.2.3-rc.1');
  for (const input of ['1.2', '1.2.3;whoami', '$(whoami)', '01.2.3', '1.2.3\nfoo']) assert.throws(() => version(input));
});
test('requires explicit architecture and signing support', () => {
  const config = { schemaVersion: 1, name: 'Demo', node: '24.12.0', packageManager: 'yarn', versionFiles: ['package.json'], adapter: '.release/adapter.mjs', targets: ['macos-universal'], signing: 'testing' };
  validateConfig(config);
  assert.throws(() => validateConfig({ ...config, targets: ['macos-arm64-renamed-universal'] }));
  assert.throws(() => validateConfig({ ...config, signing: 'developer-id' }));
});

test('prepared metadata cannot escape, alias or override version files', () => {
  const root = process.cwd();
  const entry = {path:'build/release.json', content:'{}'};
  assert.deepEqual(preparedFiles(root, [entry], ['package.json']), [entry]);
  for (const file of ['../outside', 'build/../package.json', 'package.json', 'PACKAGE.json']) {
    assert.throws(() => preparedFiles(root, [{...entry,path:file}], ['package.json']));
  }
  assert.throws(() => preparedFiles(root, [entry,entry], []));
});

test('only explicitly marked standard update feeds may omit the version', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'release-kit-')); t.after(() => rm(dir, {recursive:true,force:true}));
  const metadata = {version:'1.2.3',target:'windows-x64'};
  for (const name of ['latest.yml','unrelated.yml']) await writeFile(path.join(dir,name),'version: 1.2.3');
  await stageFiles(dir,path.join(dir,'accepted'),[{path:'latest.yml',kind:'update-feed'}],metadata);
  await assert.rejects(() => stageFiles(dir,path.join(dir,'rejected'),[{path:'latest.yml'}],metadata));
  await assert.rejects(() => stageFiles(dir,path.join(dir,'rejected'),[{path:'unrelated.yml',kind:'update-feed'}],metadata));
});
test('rejects traversal and symlinked assets', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'release-kit-')); t.after(() => rm(dir, {recursive:true,force:true}));
  assert.throws(() => inside(dir, '../secret'));
  assert.throws(() => inside(dir, '/secret'));
  assert.throws(() => inside(dir, 'x\\..\\secret'));
  await writeFile(path.join(dir, 'source'), 'data');
  if (process.platform !== 'win32') {
    await symlink(path.join(dir, 'source'), path.join(dir, 'link'));
    await assert.rejects(() => regular(dir, 'link'));
  }
});
test('assembly rejects altered bytes, missing platforms, mixed sources and duplicate assets', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'release-kit-')); t.after(() => rm(dir, {recursive:true,force:true}));
  await writeFile(path.join(dir, 'Demo-1.2.3.exe'), 'real-candidate-fixture');
  const download = path.join(dir, 'downloads'); await mkdir(download);
  const metadata = { version: '1.2.3', sourceSha: 'a'.repeat(40), toolkitSha: 'b'.repeat(40), target: 'windows-x64', automatedVerification: 'passed' };
  await stageFiles(dir, path.join(download, 'win'), [{path:'Demo-1.2.3.exe'}], metadata);
  const expected = { ...metadata, targets:['windows-x64'] };
  assert.equal((await collectRelease(download, expected)).assets.length, 1);
  await assert.rejects(() => collectRelease(download, {...expected, targets:['windows-x64','linux-x64']}));
  await assert.rejects(() => collectRelease(download, {...expected, sourceSha:'c'.repeat(40)}));
  await writeFile(path.join(download, 'win', 'Demo-1.2.3.exe'), 'tampered');
  await assert.rejects(() => collectRelease(download, expected));
});

test('single downloaded artifact at root is collected, but duplicates still fail', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'release-flat-')); t.after(() => rm(dir, {recursive:true,force:true}));
  await writeFile(path.join(dir, 'Demo-1.2.3.exe'), 'candidate');
  const download = path.join(dir, 'downloads');
  const metadata = {version:'1.2.3',sourceSha:'a'.repeat(40),toolkitSha:'b'.repeat(40),target:'windows-x64',automatedVerification:'passed'};
  await stageFiles(dir, download, [{path:'Demo-1.2.3.exe'}], metadata);
  const expected = {...metadata,targets:['windows-x64']};
  assert.equal((await collectRelease(download, expected)).assets.length, 1);
  await stageFiles(dir, path.join(download,'duplicate'), [{path:'Demo-1.2.3.exe'}], metadata);
  await assert.rejects(() => collectRelease(download, expected), /Missing or duplicate/);
});

test('arm64 and Intel releases are independent required platforms', async t => {
  const config = {schemaVersion:1,name:'Demo',node:'24.20.0',packageManager:'pnpm',versionFiles:['package.json'],adapter:'.release/adapter.mjs',targets:['macos-arm64','macos-x64'],signing:'testing'};
  validateConfig(config);
  const dir = await mkdtemp(path.join(tmpdir(), 'release-mac-')); t.after(() => rm(dir, {recursive:true,force:true}));
  const metadata = {version:'1.2.3',sourceSha:'a'.repeat(40),toolkitSha:'b'.repeat(40),automatedVerification:'passed'};
  const download = path.join(dir,'download');
  for (const arch of ['arm64','x64']) {
    const name = `Demo-1.2.3-mac-${arch}.dmg`;
    await writeFile(path.join(dir,name),arch);
    await stageFiles(dir,path.join(download,arch),[{path:name}],{...metadata,target:`macos-${arch}`});
  }
  assert.equal((await collectRelease(download,{...metadata,targets:config.targets})).assets.length,2);
});
