import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { removeStagingDirectory } from './prepare-cloudflared.mjs';

test('cloudflared cleanup waits for a transient Windows executable lock', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'cloudflared-lock-test-'));
  const binary = path.join(fixture, 'cloudflared.exe');
  await writeFile(binary, 'fixture');
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$f=[IO.File]::Open($env:TEST_LOCK_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { [Console]::WriteLine("locked"); Start-Sleep -Milliseconds 1500 } finally { $f.Dispose() }'],
    { windowsHide: true, env: { ...process.env, TEST_LOCK_FILE: binary }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(holder, 'exit');
  t.after(async () => { await exited; await rm(fixture, { recursive: true, force: true }); });
  const [ready] = await once(holder.stdout, 'data');
  assert.match(ready.toString(), /locked/);
  await removeStagingDirectory(fixture);
  await assert.rejects(access(fixture), { code: 'ENOENT' });
});
