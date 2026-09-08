import { randomUUID } from "node:crypto";

import type { AppConfig } from "./config.ts";

const REQUEST_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

type FetchLike = typeof fetch;

export interface RuijieSandboxTask {
  taskId: string;
  status: string;
  ready: boolean;
  vncProxy: string | null;
  openclawProxy: string | null;
  hermesProxy: string | null;
}

export interface RuijieSandboxStatus extends RuijieSandboxTask {
  configured: boolean;
  problem: string | null;
}

interface SandboxRequestTemplate extends Record<string, unknown> {
  client_id: string;
  vnc_key: string;
  minio_url: string;
}

const heartbeatTimers = new Map<string, NodeJS.Timeout>();

function cleanBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function requestTemplate(cfg: AppConfig): SandboxRequestTemplate | null {
  const raw = cfg.ruijieSandbox?.requestJson?.trim();
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const template = value as Record<string, unknown>;
    for (const key of ["client_id", "vnc_key", "minio_url"] as const) {
      if (typeof template[key] !== "string" || !template[key].trim()) return null;
    }
    return template as SandboxRequestTemplate;
  } catch {
    return null;
  }
}

export function ruijieSandboxConfigured(cfg: AppConfig): boolean {
  return Boolean(cleanBaseUrl(cfg.ruijieSandbox?.managerUrl) && requestTemplate(cfg));
}

export function ruijieSandboxConfigProblem(cfg: AppConfig): string | null {
  if (!cleanBaseUrl(cfg.ruijieSandbox?.managerUrl)) return "Add the sandbox manager URL in App Settings → Connections";
  if (!requestTemplate(cfg)) return "Add a valid sandbox request JSON template in App Settings → Connections";
  return null;
}

function taskFromBody(body: any, fallbackTaskId: string): RuijieSandboxTask {
  const status = typeof body?.status === "string" ? body.status : "unknown";
  return {
    taskId: typeof body?.task_id === "string" && body.task_id ? body.task_id : fallbackTaskId,
    status,
    ready: status === "finished" && typeof body?.vnc_proxy === "string" && Boolean(body.vnc_proxy),
    vncProxy: typeof body?.vnc_proxy === "string" && body.vnc_proxy ? body.vnc_proxy : null,
    openclawProxy: typeof body?.openclaw_proxy === "string" && body.openclaw_proxy ? body.openclaw_proxy : null,
    hermesProxy: typeof body?.hermes_proxy === "string" && body.hermes_proxy ? body.hermes_proxy : null,
  };
}

async function managerJson(
  cfg: AppConfig,
  path: string,
  init: RequestInit = {},
  fetchImpl: FetchLike = fetch,
): Promise<{ status: number; body: any }> {
  const baseUrl = cleanBaseUrl(cfg.ruijieSandbox?.managerUrl);
  if (!baseUrl) throw new Error("the Ruijie sandbox manager URL is not configured");
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      signal,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    if (timedOut) {
      throw new Error(`Could not reach the Ruijie sandbox manager at ${baseUrl} within ${REQUEST_TIMEOUT_MS / 1000} seconds. Check the Ruijie network/VPN and whether the manager service is running.`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach the Ruijie sandbox manager at ${baseUrl}: ${detail}`);
  }
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

function responseError(operation: string, response: { status: number; body: any }): Error {
  const validationDetail = Array.isArray(response.body?.detail)
    ? response.body.detail
        .map((item: any) => {
          const field = Array.isArray(item?.loc) ? item.loc.join(".") : "request";
          const message = typeof item?.msg === "string" ? item.msg : "is invalid";
          return `${field}: ${message}`;
        })
        .join("; ")
    : null;
  const detail = typeof response.body?.detail === "string"
    ? response.body.detail
    : validationDetail
      ? validationDetail
      : typeof response.body?.error === "string"
        ? response.body.error
        : `HTTP ${response.status}`;
  return new Error(`sandbox ${operation} failed: ${detail}`);
}

export async function ruijieSandboxStatus(
  cfg: AppConfig,
  fetchImpl: FetchLike = fetch,
): Promise<RuijieSandboxStatus> {
  const problem = ruijieSandboxConfigProblem(cfg);
  const template = requestTemplate(cfg);
  if (problem || !template) {
    return {
      configured: false,
      taskId: "",
      status: "unconfigured",
      ready: false,
      vncProxy: null,
      openclawProxy: null,
      hermesProxy: null,
      problem,
    };
  }
  try {
    const response = await managerJson(cfg, `/task/${encodeURIComponent(template.client_id)}`, {}, fetchImpl);
    if (response.status === 404) {
      return { configured: true, ...taskFromBody({}, template.client_id), status: "missing", problem: null };
    }
    if (response.status < 200 || response.status >= 300) throw responseError("status", response);
    return { configured: true, ...taskFromBody(response.body, template.client_id), problem: null };
  } catch (error) {
    return {
      configured: true,
      taskId: template.client_id,
      status: "unreachable",
      ready: false,
      vncProxy: null,
      openclawProxy: null,
      hermesProxy: null,
      problem: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function provisionRuijieSandbox(
  cfg: AppConfig,
  fetchImpl: FetchLike = fetch,
): Promise<RuijieSandboxStatus> {
  const problem = ruijieSandboxConfigProblem(cfg);
  const template = requestTemplate(cfg);
  if (problem || !template) throw Object.assign(new Error(problem ?? "sandbox is not configured"), { status: 409 });
  // The captured production request represents an unset optional password as
  // null, while the manager's current FastAPI schema accepts only a string or
  // an omitted field. Omission preserves the provider default and keeps the
  // rest of the supplied request opaque.
  const submission: Record<string, unknown> = { ...template };
  if (submission.xiaobing_pswd === null) delete submission.xiaobing_pswd;
  const response = await managerJson(cfg, "/submit", {
    method: "POST",
    body: JSON.stringify(submission),
  }, fetchImpl);
  if (response.status < 200 || response.status >= 300) throw responseError("creation", response);
  startRuijieSandboxHeartbeat(cfg, fetchImpl);
  return { configured: true, ...taskFromBody(response.body, template.client_id), problem: null };
}

/** Reuse a live pooled desktop or submit one and wait until its VNC endpoint
 * is ready. This is the turn-start path; it keeps model startup behind the
 * provider queue instead of handing the agent tools that cannot connect yet. */
export async function readyRuijieSandboxForTurn(
  cfg: AppConfig,
  fetchImpl: FetchLike = fetch,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<RuijieSandboxStatus> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 120_000);
  const pollMs = Math.max(50, options.pollMs ?? 2_000);
  let status = await ruijieSandboxStatus(cfg, fetchImpl);
  if (!status.configured) throw new Error(status.problem ?? "the Ruijie sandbox is not configured");
  if (status.status === "unreachable") throw new Error(status.problem ?? "the Ruijie sandbox manager is unreachable");
  if (status.ready) return status;
  if (["missing", "released", "stopped", "failed", "error", "cancelled", "canceled", "unknown"].includes(status.status)) {
    status = await provisionRuijieSandbox(cfg, fetchImpl);
    if (status.ready) return status;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    status = await ruijieSandboxStatus(cfg, fetchImpl);
    if (status.ready) return status;
    if (status.status === "unreachable") throw new Error(status.problem ?? "the Ruijie sandbox manager is unreachable");
    if (["failed", "error", "cancelled", "canceled"].includes(status.status)) {
      throw new Error(status.problem ?? `the Ruijie sandbox entered ${status.status}`);
    }
  }
  throw new Error(`the Ruijie sandbox did not become ready within ${Math.round(timeoutMs / 1_000)} seconds (last state: ${status.status})`);
}

function viewerUrl(rawUrl: string, password: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("the sandbox returned an unsupported VNC URL");
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (!fragment.has("autoconnect")) fragment.set("autoconnect", "true");
  if (!fragment.has("resize")) fragment.set("resize", "scale");
  if (!fragment.has("password")) fragment.set("password", password);
  url.hash = fragment.toString();
  return url.toString();
}

export async function joinRuijieSandbox(
  cfg: AppConfig,
  fetchImpl: FetchLike = fetch,
): Promise<{ joinUrl: string; state: string }> {
  const template = requestTemplate(cfg);
  if (!template) throw Object.assign(new Error(ruijieSandboxConfigProblem(cfg) ?? "sandbox is not configured"), { status: 409 });
  const status = await ruijieSandboxStatus(cfg, fetchImpl);
  if (!status.ready || !status.vncProxy) {
    throw Object.assign(new Error(status.problem ?? `sandbox is ${status.status}`), { status: 409 });
  }
  startRuijieSandboxHeartbeat(cfg, fetchImpl);
  return { joinUrl: viewerUrl(status.vncProxy, template.vnc_key), state: status.status };
}

export async function heartbeatRuijieSandbox(cfg: AppConfig, fetchImpl: FetchLike = fetch): Promise<void> {
  const template = requestTemplate(cfg);
  if (!template) return;
  const response = await managerJson(cfg, "/heartbeat", {
    method: "POST",
    body: JSON.stringify({ client_id: template.client_id }),
  }, fetchImpl);
  if (response.status < 200 || response.status >= 300) throw responseError("heartbeat", response);
}

export function startRuijieSandboxHeartbeat(cfg: AppConfig, fetchImpl: FetchLike = fetch): void {
  const template = requestTemplate(cfg);
  if (!template || heartbeatTimers.has(template.client_id)) return;
  const timer = setInterval(() => void heartbeatRuijieSandbox(cfg, fetchImpl).catch(() => {}), HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  heartbeatTimers.set(template.client_id, timer);
}

export function stopRuijieSandboxHeartbeat(clientId?: string): void {
  if (clientId) {
    const timer = heartbeatTimers.get(clientId);
    if (timer) clearInterval(timer);
    heartbeatTimers.delete(clientId);
    return;
  }
  for (const timer of heartbeatTimers.values()) clearInterval(timer);
  heartbeatTimers.clear();
}

export async function releaseRuijieSandbox(
  cfg: AppConfig,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true }> {
  const template = requestTemplate(cfg);
  if (!template) throw Object.assign(new Error(ruijieSandboxConfigProblem(cfg) ?? "sandbox is not configured"), { status: 409 });
  const response = await managerJson(cfg, "/release", {
    method: "POST",
    body: JSON.stringify({ client_id: template.client_id }),
  }, fetchImpl);
  if (response.status < 200 || response.status >= 300) throw responseError("release", response);
  stopRuijieSandboxHeartbeat(template.client_id);
  return { ok: true };
}

/** Development defaults are intentionally non-secret. The request body stays
 * in the OS-encrypted credential store (or OMB_RUIJIE_SANDBOX_REQUEST_JSON). */
export function newRuijieSandboxClientId(): string {
  return `openmausbot-${randomUUID()}`;
}
