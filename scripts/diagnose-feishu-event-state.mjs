// Read-only event diagnostics using the same sanitized environment as the connector.
// No consume, stop, config init, login, token export, or credential copying.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { createCli } from '../connectors/feishu/cli.mjs';

const [executable, configDir] = process.argv.slice(2);
if (!executable || !configDir || !path.isAbsolute(executable) || !path.isAbsolute(configDir)) {
  throw new Error('Usage: node scripts/diagnose-feishu-event-state.mjs ABSOLUTE_CLI ABSOLUTE_CONTEXT');
}
let launch;
const cli = createCli({ executable, configDir, spawnImpl: (exe, args, options) => {
  launch = options;
  return spawn(exe, args, options);
} });
const version = await cli.version({ timeoutMs: 5000 });
if (!version.supported) throw new Error('Pinned lark-cli 1.0.93 required');
const query = async (args) => {
  try {
    const { stdout } = await promisify(execFile)(executable, args, {
      env: launch.env, windowsHide: true, shell: false, timeout: 10000, maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    // Never expose stderr or raw error messages; they may contain provider URLs.
    return { diagnosticError: Number.isInteger(error.code) ? `CLI_EXIT_${error.code}` : 'QUERY_FAILED' };
  }
};
const local = await query(['event', 'status', '--current', '--json']);
const plan = await query(['event', 'consume', 'im.message.receive_v1', '--as=bot', '--dry-run']);
const remote = await query(['api', 'GET', '/open-apis/event/v1/connection', '--as=bot']);
const app = local.apps?.length === 1 ? local.apps[0] : undefined;
const count = remote.ok === true && Number.isSafeInteger(remote.data?.online_instance_cnt)
  ? remote.data.online_instance_cnt : null;
const conflict = app?.running === false && plan.data?.decision?.status === 'ready' && count > 0;
console.log(JSON.stringify({ observedAt: new Date().toISOString(), version: version.version,
  appFingerprint: typeof app?.app_id === 'string' ? createHash('sha256').update(app.app_id).digest('hex').slice(0, 12) : null,
  localRunning: app?.running ?? null, localPid: app?.pid ?? null,
  localConsumers: app?.active_consumers ?? null,
  preflight: plan.data?.decision?.status ?? plan.diagnosticError ?? 'unknown',
  remoteConnections: count,
  verdict: conflict ? 'REMOTE_EVENT_CONNECTION_CONFLICT' : app?.running === true ? 'LOCAL_BUS_RUNNING' : 'INCONCLUSIVE',
  errors: [local, plan, remote].map((value) => value.diagnosticError).filter(Boolean),
}, null, 2));
if (conflict) process.exitCode = 1;
