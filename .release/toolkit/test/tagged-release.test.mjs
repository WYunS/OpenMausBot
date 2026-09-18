import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolkit = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t, scenario = 'matching', packageVersion = '0.1.84') {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'release-tag-fixture-')));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert(path.basename(root).startsWith('release-tag-fixture-'));
    await rm(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  for (const dir of ['bin', 'lib']) await cp(path.join(toolkit, dir), path.join(root, '.release/toolkit', dir), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: packageVersion }));
  await writeFile(path.join(root, '.release/config.json'), JSON.stringify({ schemaVersion: 1, name: 'Fixture',
    node: '24.20.0', packageManager: 'pnpm', versionFiles: ['package.json'], adapter: '.release/adapter.mjs',
    targets: ['windows-x64'], signing: 'testing', allowPrerelease: true }));
  await writeFile(path.join(root, '.release/adapter.mjs'), `
    import assert from 'node:assert/strict';
    import { readFile, writeFile } from 'node:fs/promises';
    export async function preflight() { return {blockers: [], notes: []}; }
    export async function prepareFiles(ctx) { return [{path: 'build/fixture.json', content: JSON.stringify({sourceSha: ctx.sourceSha, version: ctx.version})}]; }
    export async function build(ctx) {
      const metadata = JSON.parse(await readFile('build/fixture.json', 'utf8'));
      assert.equal(metadata.sourceSha, ctx.sourceSha);
      assert.equal(metadata.version, ctx.version);
      await writeFile('Fixture-0.1.84.zip', 'offline fixture; no installer or compiler is executed');
    }
    export async function assets() { return [{path: 'Fixture-0.1.84.zip'}]; }
  `);
  await writeFile(path.join(root, 'mock-api.mjs'), `
    import { appendFileSync } from 'node:fs';
    globalThis.fetch = async (url, options = {}) => {
      const route = new URL(url).pathname;
      appendFileSync('requests.jsonl', JSON.stringify({route, method: options.method ?? 'GET'}) + '\\n');
      if ((options.method ?? 'GET') !== 'GET') throw new Error('Tagged prepare must not mutate GitHub objects');
      const scenario = process.env.FIXTURE_SCENARIO;
      const sha = process.env.FIXTURE_SHA;
      if (route.includes('/git/ref/tags/')) {
        if (scenario === 'network') return Response.json({message: 'unavailable'}, {status: 503});
        if (scenario === 'missing') return Response.json({message: 'not found'}, {status: 404});
        const object = scenario === 'annotated' ? {type:'tag',sha:'b'.repeat(40)}
          : {type:'commit',sha:scenario === 'mismatch' ? 'c'.repeat(40) : sha};
        return Response.json({object});
      }
      if (route.includes('/git/tags/')) return Response.json({object:{type:'commit',sha}});
      if (route.includes('/releases/tags/')) return Response.json({message:'release'}, {status:scenario === 'released' ? 200 : 404});
      throw new Error('Unexpected API request: ' + route);
    };
  `);
  git('init', '--quiet'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  const run = (phase, extra = {}) => spawnSync(process.execPath,
    ['--import', pathToFileURL(path.join(root, 'mock-api.mjs')).href, path.join(root, '.release/toolkit/bin/release.mjs'), phase], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15_000,
      env: { ...process.env, GH_TOKEN: 'offline-fixture', GITHUB_REPOSITORY: 'fixture/repo',
        GITHUB_OUTPUT: path.join(root, 'outputs'), GITHUB_STEP_SUMMARY: '',
        RELEASE_CONFIG: '.release/config.json', RELEASE_VERSION: '0.1.84', RELEASE_MODE: 'artifacts',
        RELEASE_PLATFORMS: 'all', RELEASE_TARGET: 'windows-x64', RELEASE_SOURCE_TAGGED: '',
        FIXTURE_SCENARIO: scenario, FIXTURE_SHA: sha, ...extra },
    });
  return { root, sha, git, run };
}

for (const scenario of ['matching', 'annotated']) test(`builds existing ${scenario} source tag without changing its commit`, async t => {
  const f = await fixture(t, scenario);
  const prepared = f.run('prepare');
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  const outputs = await readFile(path.join(f.root, 'outputs'), 'utf8');
  assert(outputs.includes(`sha=${f.sha}\n`));
  assert(outputs.includes('source_tagged=true\n'));
  const built = f.run('build', { RELEASE_SOURCE_TAGGED: 'true' });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.equal(f.git('rev-parse', 'HEAD'), f.sha);
  const manifest = JSON.parse(await readFile(path.join(f.root, '.release-out/candidate/windows-x64.json'), 'utf8'));
  assert.equal(manifest.sourceSha, f.sha);
  assert.equal(manifest.version, '0.1.84');
  assert((await readFile(path.join(f.root, 'requests.jsonl'), 'utf8')).trim().split('\n')
    .every(line => JSON.parse(line).method === 'GET'));
});

for (const [scenario, packageVersion, error] of [
  ['mismatch', '0.1.84', /points to another commit/],
  ['matching', '0.1.73', /Tagged source version differs/],
  ['released', '0.1.84', /Version already exists/],
  ['network', '0.1.84', /503/],
]) test(`rejects unsafe tagged prepare: ${scenario}/${packageVersion}`, async t => {
  const f = await fixture(t, scenario, packageVersion);
  const result = f.run('prepare');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, error);
  assert.equal(f.git('rev-parse', 'HEAD'), f.sha);
});
