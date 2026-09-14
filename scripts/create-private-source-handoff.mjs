import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSandboxPreset, sandboxPresetDigest, writePrivateJson } from '../electron/ruijie-sandbox-bootstrap.mjs';
import { sandboxInputPath } from './prepare-ruijie-sandbox-bootstrap.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (command, args) => execFileSync(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
let temporary;
let stage = 'validate committed source and private input';
try {
  // Archive only a known commit; never scoop up debug dumps, personal profiles,
  // caches or untracked files. The one private addition is explicitly validated.
  run('git', ['diff', '--quiet', 'HEAD']);
  const commit = run('git', ['rev-parse', 'HEAD']).trim();
  const preset = readSandboxPreset(sandboxInputPath(root));
  const output = path.join(root, 'release', 'private', `RuijieBot-source-${commit.slice(0, 12)}.tar.gz`);
  if (existsSync(output)) throw new Error('Private source handoff already exists; preserve it or choose a new commit');
  temporary = mkdtempSync(path.join(tmpdir(), 'ruijie-private-source-'));
  const staging = path.join(temporary, 'source');
  mkdirSync(staging);
  const archive = path.join(temporary, 'source.tar');
  stage = 'archive committed source';
  run('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD']);
  stage = 'extract source archive';
  run('tar', ['-xf', archive, '-C', staging]);
  stage = 'add private connection input';
  writePrivateJson(path.join(staging, 'release-inputs', 'ruijie-sandbox.json'), preset);
  writePrivateJson(path.join(staging, 'release-inputs', 'handoff.json'), {
    sourceCommit: commit, sandboxPresetSha256: sandboxPresetDigest(preset),
    warning: 'CONFIDENTIAL: shared sandbox access. Do not upload this archive or release-inputs to public GitHub.',
  });
  mkdirSync(path.dirname(output), { recursive: true });
  stage = 'compress private handoff';
  run('tar', ['-czf', output, '-C', staging, '.']);
  console.log(`Private source handoff created: ${output}`);
  console.log('Contains shared sandbox credentials. Deliver only to authorized packagers; never publish.');
} catch (error) {
  console.error(`Private handoff failed during ${stage} (${error.code ?? error.status ?? 'invalid input'}).`);
  process.exitCode = 1;
} finally {
  // Only this process-owned mkdtemp directory; never the repository/user home.
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
