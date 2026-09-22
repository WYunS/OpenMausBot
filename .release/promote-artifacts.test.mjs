import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBuild, validateUploads, findRelease } from './promote-artifacts.mjs';

test('promotion rejects a failed build, other repository, workflow or source', () => {
  const sha = 'a'.repeat(40);
  const run = { id: 123, repository: { full_name: 'AI-Applications-Team/OpenMausBot' }, path: '.github/workflows/package-release.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_sha: sha };
  validateBuild(run, sha, '123');
  for (const patch of [{ conclusion: 'failure' }, { status: 'in_progress' }, { repository: { full_name: 'other/repo' } }, { path: 'other.yml' }, { head_sha: 'b'.repeat(40) }, { id: 124 }]) {
    assert.throws(() => validateBuild({ ...run, ...patch }, sha, '123'));
  }
});

test('promotion resumes a draft hidden by the by-tag endpoint and does not treat permission failure as absence', async () => {
  const draft = { id: 42, tag_name: 'v0.1.85', draft: true };
  const calls = [];
  const found = await findRelease('v0.1.85', async route => {
    calls.push(route);
    if (route.includes('/tags/')) throw Object.assign(new Error('Not Found'), { status: 404 });
    return [{ id: 41, tag_name: 'v0.1.84' }, draft];
  });
  assert.equal(found, draft);
  assert.equal(calls.length, 2);
  await assert.rejects(findRelease('v0.1.85', async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); }), /Forbidden/);
});

test('publication rejects missing, duplicate, extra, incomplete or altered uploads', () => {
  const expected = [{ name: 'installer.exe', size: 123, sha256: 'a'.repeat(64) }];
  const uploaded = [{ name: 'installer.exe', size: 123, digest: 'sha256:'+'a'.repeat(64), state: 'uploaded' }];
  validateUploads(uploaded, expected);
  for (const invalid of [[], [...uploaded,...uploaded], [...uploaded,{ ...uploaded[0], name: 'extra.exe' }], [{...uploaded[0],size:124}], [{...uploaded[0],digest:'sha256:wrong'}], [{...uploaded[0],state:'starter'}]]) {
    assert.throws(() => validateUploads(invalid, expected));
  }
});
