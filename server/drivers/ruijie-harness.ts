/**
 * Adapter for the private, Bot-owned Ruijie Harness Host (or an explicit
 * development endpoint). Installing/opening the standalone app is not needed.
 *
 * The desktop owns OAuth, quota, plugins, tools, and machine routing. This
 * driver starts the pinned sidecar and only speaks its loopback
 * API, so credentials never cross into OpenMausBot and both products use the
 * same authenticated account.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
  DriverCreateInput,
  EffortLevel,
  ModelCatalog,
  ProviderDriver,
  ProviderInstance,
  RequestOutcome,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
  TurnId,
} from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { computerProxyEnv } from "../container-computer.ts";
import { mutatingComputerTool } from "../computer-tools.ts";
import { SPAWNED_PROXIES } from "../proxy-paths.ts";
import { withoutHarnessWebSearch } from "./ruijie-harness-preset.ts";
import { parseHarnessQuestions, validateQuestionAnswers, legacyQuestionAnswer, questionChoices, type AskQuestion } from "../../shared/ask-question.ts";
import { harnessDenial, harnessDenialMessage, type HarnessDenial } from "../../shared/harness-failure.ts";
import {
  defaultRuijieBridgePath,
  ruijieHarnessLocator,
  RuijieHarnessDormantError,
} from "./ruijie-harness-local.ts";

export { defaultRuijieBridgePath } from "./ruijie-harness-local.ts";

const DRIVER_KIND = "ruijieHarness";
const DEFAULT_MODEL = "deepseek-vision::deepseek-v4-flash";
const VISIBLE_MODEL_PROVIDERS = new Set(["deepseek-vision", "anthropic", "openai"]);
const HARNESS_EFFORT_ORDER = ["off", "low", "medium", "high", "xhigh", "max"] as const;
type HarnessEffort = (typeof HARNESS_EFFORT_ORDER)[number];
const DEFAULT_PROVIDER_EFFORTS: Readonly<Record<string, readonly HarnessEffort[]>> = {
  "deepseek-vision": ["off", "low", "high", "max"],
  anthropic: [],
  openai: HARNESS_EFFORT_ORDER,
};
const DEFAULT_MODELS: ModelCatalog = {
  default: DEFAULT_MODEL,
  options: [
    { id: DEFAULT_MODEL, label: "DeepSeek-V4-Flash", provider: "deepseek-vision" },
    { id: "deepseek-vision::deepseek-v4-pro", label: "DeepSeek-V4-Pro", provider: "deepseek-vision" },
    { id: "anthropic::claude-fable-5", label: "Claude Fable 5", provider: "anthropic" },
    { id: "anthropic::claude-opus-5", label: "Claude Opus 5", provider: "anthropic" },
    { id: "anthropic::claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
    { id: "openai::gpt-6-astra", label: "gpt-6-astra", provider: "openai" },
    { id: "openai::gpt-5.6-sol", label: "gpt-5.6-sol 旗舰模型", provider: "openai" },
    { id: "openai::gpt-5.6-terra", label: "gpt-5.6-terra 均衡模型", provider: "openai" },
    { id: "openai::gpt-5.6-luna", label: "gpt-5.6-luna 经济模型", provider: "openai" },
    { id: "openai::gpt-5.5", label: "gpt-5.5", provider: "openai" },
  ],
};

export interface RuijieHarnessConfig {
  endpoint?: string;
  bridgePath?: string;
  expectedAccountEmail?: string;
  /** Optional override for a custom-installed packaged Harness executable. */
  executablePath?: string;
  /** Optional override for non-standard Harness homes. Ordinary installs use ~/.dsh. */
  dshHome?: string;
}

interface PendingTurn {
  turnId: TurnId;
  sessionId: string;
  endpoint: string;
  dispatchDone: Promise<void>;
  dispatched: boolean;
  terminalSeen?: boolean;
  cancelAccepted?: boolean;
  cancelledProviderTurn?: number;
  stopping?: Promise<void>;
  abort: AbortController;
  providerTurn?: number;
  providerTurnFloor: number;
  interrupted: boolean;
  settled: boolean;
  requiresComputerAction: boolean;
  requiresComputerMutation: boolean;
  computerToolSucceeded: boolean;
  computerRetryCount: number;
  toolNames: Map<string, string>;
  usageByStep: Map<number, { input: number; output: number; cachedInput?: number }>;
}

const COMPUTER_ACTION_REQUEST = /^(?:(?:请|麻烦|你)?(?:帮我|给我|去)?|我(?:想让|要)你)?\s*(?:打开|启动|访问|浏览|搜索|搜一下|查找|找一下|点击|双击|右击|输入|填写|键入|按下|滚动|拖动|下载|上传|保存|安装|运行|执行|关闭|切换|截图|查看(?:桌面|屏幕|窗口|应用))|^(?:(?:please|can you|could you|would you|go ahead and)\s+)?(?:open|launch|visit|browse|search|click|type|fill|press|scroll|drag|download|upload|save|install|run|execute|close|switch|take (?:a )?screenshot)\b/i;

export function computerActionRequested(text: string): boolean {
  return COMPUTER_ACTION_REQUEST.test(text);
}

const COMPUTER_MUTATION_REQUEST = /(?:打开|启动|访问|浏览|搜索|搜一下|查找|找一下|点击|双击|右击|输入|填写|键入|按下|滚动|拖动|下载|上传|保存|安装|运行|执行|关闭|切换)|\b(?:open|launch|visit|browse|search|click|type|fill|press|scroll|drag|download|upload|save|install|run|execute|close|switch)\b/i;

export function computerMutationRequested(text: string): boolean {
  return COMPUTER_MUTATION_REQUEST.test(text);
}

function harnessToolResultSucceeded(data: Record<string, unknown> | undefined): boolean {
  if (!data || data.error !== undefined || data.isError === true) return false;
  const message = data.message;
  if (!message || typeof message !== "object") return true;
  const result = message as Record<string, unknown>;
  if (result.isError === true) return false;
  return !(
    Array.isArray(result.content) &&
    result.content.some((item) => (
      item !== null &&
      typeof item === "object" &&
      (item as Record<string, unknown>).isError === true
    ))
  );
}

function mountedComputerTool(name: string | undefined): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase();
  return normalized.includes("openmaus_") ||
    /(?:^|__)(?:start_session|click|double_click|right_click|drag|scroll|type_text|press_key|hotkey|move_cursor|get_window_state|get_desktop_state|get_accessibility_tree|list_windows|list_apps|launch_app|bring_to_front|check_permissions|get_screen_size|zoom|screenshot|computer_exec|computer_batch|open_url|browser_(?:state|snapshot|click|fill))$/.test(normalized);
}

const COMPUTER_RETRY_PROMPT =
  "You have not used the selected computer yet. The selected computer is the work surface; this Harness chat is only the control surface. Use the mounted OpenMaus computer tools now, starting with get_desktop_state, perform the requested action, inspect the resulting screen, and only then report the result. Do not claim completion without a successful computer tool result.";

interface PendingRequest {
  kind: "approval" | "question";
  responding?: boolean;
  endpoint: string;
  rpcId: string;
  sessionId: string;
  approvalId?: string;
  questions?: AskQuestion[];
}

interface HarnessSession {
  id: string;
  integrationKey: string;
}

type DriverEvent = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Omit<Event, "eventId" | "provider" | "providerInstanceId" | "createdAt">
    : never
  : never;

function decodeConfig(raw: unknown): RuijieHarnessConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    endpoint: typeof value.endpoint === "string" && value.endpoint.trim() ? value.endpoint.trim() : undefined,
    bridgePath: typeof value.bridgePath === "string" && value.bridgePath.trim() ? value.bridgePath.trim() : undefined,
    expectedAccountEmail: typeof value.expectedAccountEmail === "string" && value.expectedAccountEmail.trim()
      ? value.expectedAccountEmail.trim().toLowerCase()
      : undefined,
    executablePath: typeof value.executablePath === "string" && value.executablePath.trim()
      ? value.executablePath.trim()
      : undefined,
    dshHome: typeof value.dshHome === "string" && value.dshHome.trim() ? value.dshHome.trim() : undefined,
  };
}

export function toolResultImageAttachment(value: unknown): {
  attachmentId: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
} | null {
  const seen = new Set<object>();
  const visit = (node: unknown, depth: number): ReturnType<typeof toolResultImageAttachment> => {
    if (depth > 8 || !node || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);
    const record = node as Record<string, unknown>;
    const attachment = record.attachment as Record<string, unknown> | undefined;
    if (record.type === "image" && attachment && typeof attachment.attachmentId === "string") {
      const mime = attachment.mediaType;
      if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") {
        return { attachmentId: attachment.attachmentId, mime };
      }
    }
    for (const child of Array.isArray(node) ? node : Object.values(record)) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return visit(value, 0);
}

async function resolveEndpoint(config: RuijieHarnessConfig, autoLaunch = true): Promise<string> {
  const bridgePath = config.bridgePath ?? process.env.RUIJIE_HARNESS_BRIDGE ?? defaultRuijieBridgePath();
  return await ruijieHarnessLocator.ensureEndpoint({
    endpoint: config.endpoint ?? process.env.RUIJIE_HARNESS_ENDPOINT,
    bridgePath,
    executablePath: config.executablePath ?? process.env.RUIJIE_HARNESS_EXECUTABLE,
    bundledRoot: process.env.OMB_RUIJIE_HARNESS_BUNDLE,
    executableArgs: parseLaunchArguments(process.env.RUIJIE_HARNESS_ARGUMENTS),
    launchEnvironment: {
      ...(process.env.RUIJIE_HARNESS_HOME ? { DSH_HOME: process.env.RUIJIE_HARNESS_HOME } : {}),
      ...(process.env.RUIJIE_HARNESS_USER_DATA_DIR
        ? { RUIJIE_DSH_USER_DATA_DIR: process.env.RUIJIE_HARNESS_USER_DATA_DIR }
        : {}),
      ...(process.env.RUIJIE_HARNESS_BRIDGE_DIR
        ? { RUIJIE_DSH_BRIDGE_DIR: process.env.RUIJIE_HARNESS_BRIDGE_DIR }
        : {}),
    },
    autoLaunch,
  });
}

export function parseLaunchArguments(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

async function resolveDshHome(config: RuijieHarnessConfig): Promise<string> {
  const configured = config.dshHome ?? process.env.RUIJIE_HARNESS_HOME ?? process.env.DSH_HOME;
  if (configured) return configured;
  return join(homedir(), ".dsh");
}

type StdioIntegration = { command: string; args: string[]; env: Record<string, string> };
type NamedStdioIntegration = { name: "agents" | "computer" | "composio" | "browser"; integration: StdioIntegration };

function computerIntegration(turn: SendTurnInput): StdioIntegration | undefined {
  if (turn.integrations?.localComputer) {
    const { command, args, env } = turn.integrations.localComputer;
    return { command, args, env };
  }
  if (turn.integrations?.computer) {
    return {
      command: process.execPath,
      args: [SPAWNED_PROXIES.computer],
      env: { ELECTRON_RUN_AS_NODE: "1", ...computerProxyEnv(turn.integrations.computer) } as Record<string, string>,
    };
  }
  return undefined;
}

function stdioIntegrations(turn: SendTurnInput, computer: StdioIntegration | undefined): NamedStdioIntegration[] {
  return [
    ...(turn.integrations?.agents
      ? [{ name: "agents" as const, integration: turn.integrations.agents }]
      : []),
    ...(computer ? [{ name: "computer" as const, integration: computer }] : []),
    ...(turn.integrations?.composio
      ? [{ name: "composio" as const, integration: turn.integrations.composio }]
      : []),
    ...(turn.integrations?.browser
      ? [{ name: "browser" as const, integration: turn.integrations.browser }]
      : []),
  ];
}

function stableIntegrationKey(integrations: NamedStdioIntegration[]): string {
  if (integrations.length === 0) return "none";
  const normalized = integrations.map(({ name, integration }) => ({
    name,
    ...integration,
    env: Object.fromEntries(Object.entries(integration.env).sort(([a], [b]) => a.localeCompare(b))),
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 20);
}

function sessionIntegrationKey(integrationKey: string, threadId: string, mountAttempt: string): string {
  return createHash("sha256")
    .update(`${integrationKey}\0${threadId}\0${mountAttempt}`)
    .digest("hex")
    .slice(0, 20);
}

function mcpServerName(name: NamedStdioIntegration["name"], key: string): string {
  return `omb_${createHash("sha256").update(`${name}\0${key}`).digest("hex").slice(0, 24)}`;
}

function mcpPresetContent(base: string, integrations: NamedStdioIntegration[], key: string): string {
  const browser = integrations.find((entry) => entry.name === "browser")?.integration;
  if (browser) base = withoutHarnessWebSearch(base);
  const suffix = base.endsWith("\n") ? "" : "\n";
  const entries = integrations.map(({ name, integration }) =>
    `- id: openmaus-${name}-${key}\n` +
    `  name: '@deepseek-ai/dsh-mcp-client'\n` +
    `  config:\n` +
    `    serverName: ${mcpServerName(name, key)}\n` +
    `    transport: stdio\n` +
    `    command: ${JSON.stringify(integration.command)}\n` +
    `    args: ${JSON.stringify(integration.args)}\n` +
    `    env: ${JSON.stringify(integration.env)}\n` +
    // Agent tools define setup/profile persistence and team coordination, and
    // computer control is part of the requested work, so either missing bridge
    // must stop the turn. Connected apps and the browser are optional: their
    // transient outage must not prevent an otherwise ordinary conversation.
    `    failOnStartupError: ${name === "agents" || name === "computer" ? "true" : "false"}\n`
  ).join("");
  const aliases = browser ? `- id: openmaus-browser-tools-${key}\n` +
    `  name: ${JSON.stringify(SPAWNED_PROXIES.harnessBrowserTools)}\n` +
    `  config:\n` +
    `    url: ${JSON.stringify(browser.env.OMB_HARNESS_URL ?? "")}\n` +
    `    token: ${JSON.stringify(browser.env.OMB_BROWSER_TOKEN ?? "")}\n` : "";
  return `${base}${suffix}\n# Managed by OpenMausBot. This is user configuration, not Harness source.\n${entries}${aliases}`;
}

async function ensureIntegrationPreset(
  endpoint: string,
  config: RuijieHarnessConfig,
  integrations: NamedStdioIntegration[],
  key: string,
): Promise<string> {
  const kind = integrations.length === 1 ? integrations[0]!.name : "integrations";
  const presetId = `openmaus-${kind}-${key}`;
  const home = await resolveDshHome(config);
  const directory = join(home, ".agent-presets", presetId);
  const target = join(directory, "agent.cordis.yml");
  const base = await rpc<{ content: string }>(endpoint, "agentPreset.read", { agentPreset: "standard" });
  if (typeof base.content !== "string" || !base.content.trim()) throw new Error("锐捷 Harness 的 standard 预设不可读取");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, mcpPresetContent(base.content, integrations, key), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
  return presetId;
}

async function rpc<T>(endpoint: string, method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const rpcId = newId();
  const response = await fetch(`${endpoint}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
    signal: signal === undefined ? AbortSignal.timeout(15_000) : AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new Error(`锐捷 Harness 连接失败（HTTP ${response.status}）`);
  const envelope = await response.json() as {
    rpcId?: unknown;
    result?: { ok?: unknown; value?: unknown; error?: { message?: unknown } };
  };
  if (envelope.rpcId !== rpcId) throw new Error("锐捷 Harness 返回了不匹配的请求标识");
  if (envelope.result?.ok !== true) {
    const message = envelope.result?.error?.message;
    throw new Error(typeof message === "string" ? message : `锐捷 Harness 调用 ${method} 失败`);
  }
  return envelope.result.value as T;
}

async function respond(endpoint: string, rpcId: string, value: unknown, cancelled = false): Promise<boolean> {
  const response = await fetch(`${endpoint}/api/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "client-response", rpcId, result: cancelled
      ? { ok: false, error: { code: "cancelled", message: "User cancelled the question", details: {} } }
      : { ok: true, value } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return false;
  const receipt = await response.json() as { accepted?: unknown };
  return receipt.accepted === true;
}

async function ssoSummary(endpoint: string): Promise<NonNullable<import("../contracts.ts").ProviderSnapshot["sso"]>> {
  const response = await fetch(`${endpoint}/__dsh_desktop/ruijie-account`, {
    headers: { "x-ruijie-dsh-client": "account-card" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`锐捷 Harness SSO 状态读取失败（HTTP ${response.status}）`);
  const value = await response.json() as any;
  if (
    value?.authentication !== "sso"
    || typeof value?.account?.id !== "string"
    || value?.billing?.currency !== "CNY"
    || typeof value?.billing?.remaining !== "number"
  ) {
    throw new Error("锐捷 Harness 返回了无效的 SSO 账号状态");
  }
  return value;
}

async function matchingSsoSummary(endpoint: string, expectedAccountEmail: string | undefined) {
  if (!expectedAccountEmail) throw new Error("请先登录 OpenMaus 企业账号");
  const sso = await ssoSummary(endpoint);
  const harnessEmail = sso.account.email?.trim().toLowerCase();
  if (!harnessEmail || harnessEmail !== expectedAccountEmail.trim().toLowerCase()) {
    throw new Error(`Harness 登录账号与 OpenMaus 不一致，请在 Harness 中切换为 ${expectedAccountEmail}`);
  }
  return sso;
}

function decodeModel(id: string | undefined): { provider: string; model: string } {
  const [provider, ...model] = (id ?? DEFAULT_MODEL).split("::");
  if (!provider || model.length === 0 || !model.join("::")) return { provider: "gpt", model: "gpt-5.6-luna" };
  return { provider, model: model.join("::") };
}

function textOfAssistantMessage(data: unknown): string {
  const content = (data as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    }
    return [];
  }).join("");
}

function reasonOfTurnEnd(data: unknown): { ok: boolean; stopReason: string; message?: string; failure?: HarnessDenial } {
  const reason = (data as { reason?: { kind?: unknown; error?: { message?: unknown } } } | undefined)?.reason;
  const kind = typeof reason?.kind === "string" ? reason.kind : "completed";
  if (kind === "completed" || kind === "max-tokens") return { ok: true, stopReason: kind };
  if (kind === "interrupted" || kind === "aborted") return { ok: false, stopReason: "interrupted" };
  const failure = kind === "error" ? harnessDenial(reason?.error) : undefined;
  if (failure) return { ok: false, stopReason: `harness_${failure.kind}_denied`, message: harnessDenialMessage(failure), failure };
  const message = typeof reason?.error?.message === "string" ? reason.error.message : `锐捷 Harness 任务结束：${kind}`;
  return { ok: false, stopReason: kind, message };
}

function usageOf(value: unknown): { input: number; output: number; cachedInput?: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const count = (field: string) => {
    const candidate = usage[field];
    return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : undefined;
  };
  const uncached = count("inputTokens");
  const output = count("outputTokens");
  const cacheRead = count("cacheReadTokens");
  const cacheWrite = count("cacheWriteTokens");
  if (uncached === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) return undefined;
  return {
    input: (uncached ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0),
    output: output ?? 0,
    ...(cacheRead === undefined ? {} : { cachedInput: cacheRead }),
  };
}

function projectedUsageOf(value: unknown): { input: number; output: number; cachedInput?: number } | null {
  const tokenUsage = (value as {
    projections?: { values?: { tokenUsage?: unknown } };
  } | undefined)?.projections?.values?.tokenUsage;
  if (!tokenUsage || typeof tokenUsage !== "object") return null;
  const usage = tokenUsage as Record<string, unknown>;
  const count = (field: string) => {
    const candidate = usage[field];
    return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
      ? Math.trunc(candidate)
      : undefined;
  };
  const uncached = count("uncachedInputTokens");
  const output = count("outputTokens");
  const cacheRead = count("cacheReadTokens");
  const cacheWrite = count("cacheWriteTokens");
  if (uncached === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) return null;
  return {
    input: uncached + cacheRead + cacheWrite,
    output,
    cachedInput: cacheRead,
  };
}

function totalUsage(pending: PendingTurn): { input: number; output: number; cachedInput?: number } | undefined {
  if (pending.usageByStep.size === 0) return undefined;
  let input = 0;
  let output = 0;
  let cachedInput = 0;
  let reportsCachedInput = false;
  for (const usage of pending.usageByStep.values()) {
    input += usage.input;
    output += usage.output;
    if (usage.cachedInput !== undefined) {
      cachedInput += usage.cachedInput;
      reportsCachedInput = true;
    }
  }
  return { input, output, ...(reportsCachedInput ? { cachedInput } : {}) };
}

function toModelCatalog(value: unknown, current: ModelCatalog): ModelCatalog {
  const groups = (value as { groups?: unknown } | undefined)?.groups;
  if (!Array.isArray(groups)) return current;
  const options: ModelCatalog["options"] = [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const provider = (group as { id?: unknown }).id;
    const models = (group as { models?: unknown }).models;
    if (typeof provider !== "string" || !VISIBLE_MODEL_PROVIDERS.has(provider) || !Array.isArray(models)) continue;
    for (const model of models) {
      if (!model || typeof model !== "object") continue;
      const id = (model as { id?: unknown }).id;
      const name = (model as { name?: unknown }).name;
      if (typeof id !== "string") continue;
      options.push({ id: `${provider}::${id}`, label: typeof name === "string" ? name : id, provider });
    }
  }
  if (options.length === 0) return current;
  const preferred = options.find((option) => option.id === current.default)?.id
    ?? options.find((option) => option.id === DEFAULT_MODEL)?.id
    ?? options[0]!.id;
  return { default: preferred, options };
}

function toModelEfforts(value: unknown): Map<string, readonly HarnessEffort[]> {
  const result = new Map<string, readonly HarnessEffort[]>();
  const groups = (value as { groups?: unknown } | undefined)?.groups;
  if (!Array.isArray(groups)) return result;
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const provider = (group as { id?: unknown }).id;
    const models = (group as { models?: unknown }).models;
    if (typeof provider !== "string" || !VISIBLE_MODEL_PROVIDERS.has(provider) || !Array.isArray(models)) continue;
    for (const model of models) {
      if (!model || typeof model !== "object") continue;
      const id = (model as { id?: unknown }).id;
      if (typeof id !== "string") continue;
      const efforts = (model as { reasoning?: { efforts?: unknown } }).reasoning?.efforts;
      const supported = Array.isArray(efforts)
        ? efforts.flatMap((entry) => {
            const effort = (entry as { id?: unknown } | undefined)?.id;
            return typeof effort === "string" && (HARNESS_EFFORT_ORDER as readonly string[]).includes(effort)
              ? [effort as HarnessEffort]
              : [];
          })
        : DEFAULT_PROVIDER_EFFORTS[provider] ?? [];
      result.set(`${provider}::${id}`, supported);
    }
  }
  return result;
}

/** Bind the Bot's stable effort scale to the selected Harness model's legal levels. */
export function compatibleHarnessEffort(
  effort: EffortLevel | undefined,
  supported: readonly HarnessEffort[],
): HarnessEffort | undefined {
  if (!effort || supported.length === 0) return undefined;
  const requested: HarnessEffort = effort === "none" ? "off" : effort;
  if (supported.includes(requested)) return requested;
  if (requested === "off") return undefined;
  const requestedIndex = HARNESS_EFFORT_ORDER.indexOf(requested);
  return [...supported].sort((left, right) => {
    const leftIndex = HARNESS_EFFORT_ORDER.indexOf(left);
    const rightIndex = HARNESS_EFFORT_ORDER.indexOf(right);
    return Math.abs(leftIndex - requestedIndex) - Math.abs(rightIndex - requestedIndex)
      || rightIndex - leftIndex;
  })[0];
}

async function pumpEvents(
  endpoint: string,
  signal: AbortSignal,
  onEnvelope: (envelope: { rpcId?: unknown; payload?: unknown }) => void,
  onOpen: () => void,
): Promise<void> {
  const url = new URL("/api/events.mux", endpoint);
  url.protocol = "ws:";
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    let opened = false;
    const close = () => {
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close();
    };
    const abort = () => close();
    signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("open", () => {
      opened = true;
      onOpen();
    }, { once: true });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try { onEnvelope(JSON.parse(event.data) as { rpcId?: unknown; payload?: unknown }); } catch { /* ignore malformed frame */ }
    });
    socket.addEventListener("error", () => {
      if (!signal.aborted) reject(new Error("锐捷 Harness 事件连接失败"));
    }, { once: true });
    socket.addEventListener("close", () => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) resolve();
      else if (opened) reject(new Error("锐捷 Harness 事件连接已断开"));
      else reject(new Error("无法连接锐捷 Harness 事件流"));
    }, { once: true });
    if (signal.aborted) close();
  });
}

export const RuijieHarnessDriver: ProviderDriver<RuijieHarnessConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "锐捷 Harness", supportsMultipleInstances: false, access: "subscription" },
  models: DEFAULT_MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<RuijieHarnessConfig>): Promise<ProviderInstance> {
    let catalog: ModelCatalog = { ...DEFAULT_MODELS, options: [...DEFAULT_MODELS.options] };
    let modelEfforts = new Map(DEFAULT_MODELS.options.map((option) => [
      option.id,
      DEFAULT_PROVIDER_EFFORTS[option.provider ?? ""] ?? [],
    ]));
    const listeners = new Set<RuntimeEventListener>();
    const sessions = new Map<string, HarnessSession>();
    const active = new Map<string, PendingTurn>();
    const starting = new Map<string, AbortController>();
    const requests = new Map<string, PendingRequest>();
    const emit = (event: DriverEvent) => {
      const full = {
        ...event,
        eventId: newEventId(),
        provider: DRIVER_KIND,
        providerInstanceId: input.instanceId,
        createdAt: new Date().toISOString(),
      } as RuntimeEvent;
      for (const listener of listeners) listener(full);
    };

    const updateModelCatalog = async (endpoint: string) => {
      const result = await rpc<unknown>(endpoint, "llm.models", {});
      const next = toModelCatalog(result, catalog);
      const nextEfforts = toModelEfforts(result);
      catalog.default = next.default;
      catalog.options.splice(0, catalog.options.length, ...next.options);
      modelEfforts = nextEfforts;
    };

    const refreshModels = async () => {
      // Refresh is an explicit user action (opening/refreshing the Harness
      // rail), unlike passive fleet snapshots during Bot startup. It may
      // therefore start the installed headless Host on demand.
      const endpoint = await resolveEndpoint(input.config, true);
      await matchingSsoSummary(endpoint, input.config.expectedAccountEmail);
      await updateModelCatalog(endpoint);
    };

    const settle = (threadId: string, pending: PendingTurn, ok: boolean, stopReason: string, message?: string, failure?: HarnessDenial) => {
      if (pending.settled) return;
      pending.settled = true;
      pending.abort.abort();
      if (active.get(threadId) === pending) active.delete(threadId);
      for (const [id, request] of requests) if (request.sessionId === pending.sessionId) requests.delete(id);
      if (message && !pending.interrupted) emit({ type: "runtime.error", threadId, turnId: pending.turnId, message, ...(failure ? { failure } : {}) });
      const usage = totalUsage(pending);
      emit({ type: "turn.completed", threadId, turnId: pending.turnId, ok, stopReason, ...(usage ? { usage } : {}) });
    };

    const handleFrame = (threadId: string, pending: PendingTurn, endpoint: string, envelope: { rpcId?: unknown; payload?: unknown }) => {
      if (pending.settled || active.get(threadId) !== pending) return;
      const frame = envelope.payload as Record<string, unknown> | undefined;
      if (!frame || frame.sessionId !== pending.sessionId) return;
      if (frame.type === "question/resolved" || frame.type === "approval/resolved") {
        const request = frame.type === "question/resolved"
          ? requests.get(String(frame.questionRpcId))
          : [...requests.values()].find(item => item.sessionId === pending.sessionId && item.approvalId === frame.approvalId);
        if (request) {
          requests.delete(request.rpcId);
          emit({ type: "request.resolved", threadId, turnId: pending.turnId, requestId: request.rpcId,
            behavior: request.kind === "question" ? "answer" : frame.outcome === "rejected" ? "deny" : "allow", source: "system" });
        }
        return;
      }
      if (frame.type === "approval/requested" && typeof envelope.rpcId === "string") {
        const requestId = envelope.rpcId;
        requests.set(requestId, {
          kind: "approval", endpoint, rpcId: requestId, sessionId: pending.sessionId,
          approvalId: typeof frame.approvalId === "string" ? frame.approvalId : undefined,
        });
        emit({
          type: "request.opened", threadId, turnId: pending.turnId, requestId,
          requestType: "permission", tool: typeof frame.toolName === "string" ? frame.toolName : "Harness tool",
          summary: typeof frame.reason === "string" ? frame.reason : "锐捷 Harness 请求执行此操作",
        });
        return;
      }
      if (frame.type === "question/requested" && typeof envelope.rpcId === "string") {
        const requestId = envelope.rpcId;
        const questions = parseHarnessQuestions(frame.questions);
        if (!questions) {
          emit({ type: "runtime.error", threadId, turnId: pending.turnId, message: "Harness 的问题格式无效或超出支持范围，已取消这次提问，请让它拆分后重试。" });
          void respond(endpoint, requestId, undefined, true).catch(() => {});
          return;
        }
        requests.set(requestId, { kind: "question", endpoint, rpcId: requestId, sessionId: pending.sessionId, questions });
        const first = questions[0];
        emit({
          type: "request.opened", threadId, turnId: pending.turnId, requestId,
          requestType: "question", tool: "question",
          summary: typeof first?.question === "string" ? first.question : "锐捷 Harness 需要你的回答",
          choices: questionChoices(questions),
          questions,
        });
        return;
      }
      if (frame.type !== "session/event") return;
      const event = frame.event as { type?: unknown; data?: unknown } | undefined;
      if (!event || typeof event.type !== "string") return;
      const data = event.data as Record<string, unknown> | undefined;
      const providerTurn = typeof data?.turn === "number" ? data.turn : undefined;
      if (providerTurn !== undefined && providerTurn <= pending.providerTurnFloor) return;
      if (pending.dispatched && pending.providerTurn === undefined && providerTurn !== undefined) pending.providerTurn = providerTurn;
      if (pending.providerTurn !== undefined && providerTurn !== undefined && providerTurn !== pending.providerTurn) return;
      if (event.type === "assistant/chunk") {
        const chunk = data?.chunk as Record<string, unknown> | undefined;
        if (
          chunk?.type === "text-delta" &&
          typeof chunk.text === "string" &&
          (!pending.requiresComputerAction || pending.computerToolSucceeded)
        ) {
          emit({ type: "content.delta", threadId, turnId: pending.turnId, streamKind: "assistant_text", delta: chunk.text });
        }
        if (chunk?.type === "usage") {
          const usage = usageOf(chunk.usage);
          if (usage) pending.usageByStep.set(typeof data?.step === "number" ? data.step : 0, usage);
        }
      } else if (event.type === "assistant/message") {
        const text = textOfAssistantMessage(data);
        if (text && (!pending.requiresComputerAction || pending.computerToolSucceeded)) {
          emit({ type: "item.completed", threadId, turnId: pending.turnId, itemType: "assistant_text", text });
        }
        const usage = usageOf(data?.usage);
        if (usage) pending.usageByStep.set(typeof data?.step === "number" ? data.step : 0, usage);
      } else if (event.type === "tool/call") {
        const itemId = typeof data?.callId === "string" ? data.callId : newId();
        const toolName = typeof data?.name === "string" ? data.name : "Harness tool";
        pending.toolNames.set(itemId, toolName);
        emit({ type: "item.started", threadId, turnId: pending.turnId, itemId, itemType: "tool", title: toolName });
      } else if (event.type === "tool/result") {
        const message = data?.message as { toolCallId?: unknown; source?: { callId?: unknown } } | undefined;
        const itemId = typeof message?.toolCallId === "string"
          ? message.toolCallId
          : typeof message?.source?.callId === "string"
            ? message.source.callId
            : typeof data?.callId === "string"
              ? data.callId
              : undefined;
        const toolName = itemId ? pending.toolNames.get(itemId) : undefined;
        if (itemId) pending.toolNames.delete(itemId);
        const toolSucceeded = harnessToolResultSucceeded(data);
        if (
          toolSucceeded &&
          mountedComputerTool(toolName) &&
          (!pending.requiresComputerMutation || mutatingComputerTool(toolName))
        ) pending.computerToolSucceeded = true;
        emit({ type: "item.completed", threadId, turnId: pending.turnId, itemId, itemType: "tool", ok: toolSucceeded });
        const image = /(?:^|__)get_(?:window|desktop)_state$/.test(toolName ?? "")
          ? toolResultImageAttachment(data)
          : null;
        if (image) {
          void rpc<{ attachment?: { mediaType?: unknown }; data?: unknown }>(endpoint, "session.attachment", {
            sessionId: pending.sessionId,
            attachmentId: image.attachmentId,
          }).then((loaded) => {
            if (pending.settled || active.get(threadId) !== pending) return;
            if (typeof loaded.data !== "string" || !loaded.data) return;
            const mime = loaded.attachment?.mediaType;
            emit({
              type: "screen.frame",
              threadId,
              turnId: pending.turnId,
              png: loaded.data,
              mime: mime === "image/jpeg" || mime === "image/webp" ? mime : "image/png",
            });
          }).catch(() => undefined);
        }
      } else if (event.type === "turn/end") {
        if (pending.interrupted) {
          if (pending.providerTurn !== undefined && providerTurn === pending.providerTurn) pending.terminalSeen = true;
          if (pending.terminalSeen && !pending.stopping) void adapter.interruptTurn(threadId, pending.turnId).catch(() => {});
          return;
        }
        const result = reasonOfTurnEnd(data);
        if (
          result.ok &&
          pending.requiresComputerAction &&
          !pending.computerToolSucceeded &&
          !pending.interrupted
        ) {
          if (pending.computerRetryCount === 0) {
            pending.computerRetryCount += 1;
            pending.providerTurnFloor = pending.providerTurn ?? pending.providerTurnFloor;
            pending.providerTurn = undefined;
            pending.terminalSeen = false;
            pending.toolNames.clear();
            const retry = rpc(endpoint, "session.prompt", {
              sessionId: pending.sessionId,
              mode: "queue",
              content: [{ type: "text", text: COMPUTER_RETRY_PROMPT }],
              clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }, pending.abort.signal).catch((cause: unknown) => {
              if (pending.settled) return;
              if (!pending.interrupted) emit({ type: "runtime.error", threadId, turnId: pending.turnId, message: cause instanceof Error ? cause.message : String(cause) });
              // Receipt loss is ambiguous here too; never release the computer
              // while a queued retry might still start.
              void adapter.interruptTurn(threadId, pending.turnId).catch(() => {});
            });
            pending.dispatchDone = Promise.all([pending.dispatchDone, retry]).then(() => {});
            return;
          }
          settle(
            threadId,
            pending,
            false,
            "computer_not_used",
            "锐捷 Harness 未在所选电脑上执行操作，已阻止它把纯文字回复当成完成。请重试，或切换模型后再试。",
          );
          return;
        }
        settle(threadId, pending, pending.interrupted ? false : result.ok, pending.interrupted ? "interrupted" : result.stopReason, result.message, result.failure);
      }
    };

    const adapter: ProviderInstance["adapter"] = {
      provider: DRIVER_KIND,
      capabilities: {
        sessionModelSwitch: "in-session",
        images: true,
        nativeImageInput: true,
        effortLevels: ["none", "low", "medium", "high", "xhigh", "max"],
        queueing: false,
        agentsMcp: true,
        computerMcp: true,
        localComputerMcp: true,
        composioMcp: true,
        browserMcp: true,
      },
      async sendTurn(turn: SendTurnInput) {
        if (active.has(turn.threadId) || starting.has(turn.threadId)) throw new Error("锐捷 Harness 正在处理或停止这个会话");
        const startup = new AbortController();
        starting.set(turn.threadId, startup);
        let dispatchFinished!: () => void;
        let pendingTurn: PendingTurn | undefined;
        const dispatchDone = new Promise<void>(resolve => { dispatchFinished = resolve; });
        try {
        const endpoint = await resolveEndpoint(input.config);
        await matchingSsoSummary(endpoint, input.config.expectedAccountEmail);
        startup.signal.throwIfAborted();
        const computer = computerIntegration(turn);
        const integrations = stdioIntegrations(turn, computer);
        const integrationKey = stableIntegrationKey(integrations);
        let session = sessions.get(turn.threadId);
        if (session && session.integrationKey !== integrationKey) session = undefined;
        let sessionId = session?.id;
        if (!sessionId && integrationKey === "none" && typeof turn.resumeCursor === "string" && turn.resumeCursor.startsWith("session-")) {
          sessionId = turn.resumeCursor;
        }
        const freshSession = !sessionId;
        if (!sessionId) {
          if (integrations.length === 0) {
            const created = await rpc<{ sessionId: string }>(endpoint, "session.create", { cwd: turn.cwd });
            sessionId = created.sessionId;
          } else {
            // Podman and the Cua socket may still be warming when Harness
            // performs its initial MCP handshake. A failed mount can retain
            // its namespace, so retry once with a fresh preset/server name.
            // No prompt has been sent yet, therefore this cannot duplicate
            // user work or model usage.
            let lastError: unknown;
            for (let attempt = 0; attempt < 2 && !sessionId; attempt += 1) {
              const agentPreset = await ensureIntegrationPreset(
                endpoint,
                input.config,
                integrations,
                sessionIntegrationKey(integrationKey, turn.threadId, newId()),
              );
              try {
                const created = await rpc<{ sessionId: string }>(endpoint, "session.create", {
                  cwd: turn.cwd,
                  agentPreset,
                });
                sessionId = created.sessionId;
              } catch (error) {
                lastError = error;
              }
            }
            if (!sessionId) throw lastError;
          }
        }
        sessions.set(turn.threadId, { id: sessionId, integrationKey });
        const selected = decodeModel(turn.model);
        const selectedId = `${selected.provider}::${selected.model}`;
        const reasoningEffort = compatibleHarnessEffort(
          turn.effort,
          modelEfforts.get(selectedId) ?? DEFAULT_PROVIDER_EFFORTS[selected.provider] ?? [],
        );
        await rpc(endpoint, "session.selectModel", {
          sessionId, provider: selected.provider, model: selected.model,
          ...(reasoningEffort ? { reasoningEffort } : {}),
        });
        startup.signal.throwIfAborted();

        // Only a newer turn can confirm this invocation. Private Bot sessions
        // have one writer, but a resumed session still contains old terminals.
        const baseline = freshSession ? undefined : await rpc<{ events?: Array<{ event?: { data?: { turn?: number } } }> }>(endpoint, "session.history", { sessionId, maxMessages: 1 });
        const providerTurnFloor = Math.max(-1, ...(baseline?.events ?? []).map(entry => typeof entry.event?.data?.turn === "number" ? entry.event.data.turn : -1));
        startup.signal.throwIfAborted();

        const pending: PendingTurn = {
          turnId: newId(),
          sessionId,
          endpoint,
          dispatchDone,
          dispatched: false,
          providerTurnFloor,
          abort: new AbortController(),
          interrupted: false,
          settled: false,
          requiresComputerAction: Boolean(computer) && computerActionRequested(turn.text),
          requiresComputerMutation: Boolean(computer) && computerMutationRequested(turn.text),
          computerToolSucceeded: false,
          computerRetryCount: 0,
          toolNames: new Map(),
          usageByStep: new Map(),
        };
        pendingTurn = pending;
        active.set(turn.threadId, pending);
        let opened!: () => void;
        const ready = new Promise<void>((resolve) => { opened = resolve; });
        void pumpEvents(endpoint, pending.abort.signal, (envelope) => handleFrame(turn.threadId, pending, endpoint, envelope), opened)
          .catch((cause: unknown) => {
            if (!pending.interrupted && !pending.abort.signal.aborted) {
              emit({ type: "runtime.error", threadId: turn.threadId, turnId: pending.turnId, message: cause instanceof Error ? cause.message : String(cause) });
              void adapter.interruptTurn(turn.threadId, pending.turnId).catch(() => {});
            }
          });
        await Promise.race([
          ready,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("连接锐捷 Harness 事件流超时")), 10_000)),
        ]);
        if (pending.interrupted) return { turnId: pending.turnId };
        emit({ type: "session.started", threadId: turn.threadId, turnId: pending.turnId, sessionId, model: turn.model ?? catalog.default });
        emit({ type: "turn.started", threadId: turn.threadId, turnId: pending.turnId });
        // Browser capability rotation requires a new scoped preset/session.
        // Keep that security boundary, but don't send a bare “continue” into
        // an empty conversation. The server's bounded recovery text includes
        // this turn and prior visible history; never replay it in a reused session.
        const turnText = freshSession && turn.resumeCursor && turn.recoveryText ? turn.recoveryText : turn.text;
        const prompt = turn.system ? `${turn.system}\n\n${turnText}` : turnText;
        const content = [
          { type: "text" as const, text: prompt },
          ...await Promise.all((turn.images ?? []).map(async (image) => ({
            type: "image" as const,
            mediaType: image.mime,
            data: (await readFile(image.path)).toString("base64"),
          }))),
        ];
        if (pending.interrupted) return { turnId: pending.turnId };
        pending.dispatched = true;
        await rpc(endpoint, "session.prompt", {
          sessionId, mode: "queue", content,
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }, pending.abort.signal);
        return { turnId: pending.turnId };
        } catch (cause) {
          if (pendingTurn?.dispatched) {
            // A lost admission receipt does not prove the prompt wasn't run.
            // Keep the turn attributed and cancel/confirm, never replay it.
            emit({ type: "runtime.error", threadId: turn.threadId, turnId: pendingTurn.turnId, message: cause instanceof Error ? cause.message : String(cause) });
            void adapter.interruptTurn(turn.threadId, pendingTurn.turnId).catch(() => {});
            return { turnId: pendingTurn.turnId };
          }
          if (pendingTurn) settle(turn.threadId, pendingTurn, false, "request_error", cause instanceof Error ? cause.message : String(cause));
          throw cause;
        } finally {
          dispatchFinished();
          if (starting.get(turn.threadId) === startup) starting.delete(turn.threadId);
        }
      },
      async interruptTurn(threadId, turnId) {
        const pending = active.get(threadId);
        if (turnId && pending?.turnId !== turnId) return;
        starting.get(threadId)?.abort();
        if (!pending || (turnId && pending.turnId !== turnId)) return;
        pending.interrupted = true;
        if (pending.stopping) return pending.stopping;
        const stopping = (async () => {
          // Do not race cancel ahead of an in-flight prompt admission. Once
          // interrupted, sendTurn's guards prevent any later prompt submission.
          await pending.dispatchDone;
          if (pending.settled) return;
          if (!pending.dispatched) { settle(threadId, pending, false, "interrupted"); return; }
          const deadline = AbortSignal.timeout(30_000);
          while (!deadline.aborted && !pending.settled) {
            try {
              if (!pending.cancelAccepted || pending.cancelledProviderTurn !== pending.providerTurn) {
                const cancelTurn = pending.providerTurn;
                const receipt = await rpc<{ accepted?: boolean }>(pending.endpoint, "session.cancel", { sessionId: pending.sessionId }, deadline);
                pending.cancelAccepted = receipt.accepted === true;
                pending.cancelledProviderTurn = cancelTurn;
              }
              if (!pending.terminalSeen) {
                const history = await rpc<{ events?: Array<{ event?: { type?: string; data?: { turn?: number } } }> }>(pending.endpoint, "session.history", { sessionId: pending.sessionId, maxMessages: 20 }, deadline);
                const nextTurn = history.events?.map(entry => entry.event?.data?.turn).find(turn => typeof turn === "number" && turn > pending.providerTurnFloor);
                if (pending.providerTurn === undefined && nextTurn !== undefined) pending.providerTurn = nextTurn;
                pending.terminalSeen = pending.providerTurn !== undefined && history.events?.some(({ event }) => event?.type === "turn/end" && event.data?.turn === pending.providerTurn) === true;
              }
              if (pending.terminalSeen) {
                const state = await rpc<{ items?: Array<{ sessionId: string; running: boolean }> }>(pending.endpoint, "session.list", {}, deadline);
                if (state.items?.some(item => item.sessionId === pending.sessionId && item.running === false)) {
                  settle(threadId, pending, false, "interrupted");
                  return;
                }
              }
            } catch { /* A missing snapshot is not proof of idle. Keep ownership. */ }
            await new Promise(resolve => setTimeout(resolve, 250));
          }
          if (!pending.settled) throw new Error("锐捷 Harness 停止尚未确认，电脑仍被占用。请稍后再次点击停止，勿重复执行任务。");
        })();
        pending.stopping = stopping;
        try { await stopping; }
        finally { if (pending.stopping === stopping) pending.stopping = undefined; }
      },
      hasActiveTurn: threadId => active.has(threadId) || starting.has(threadId),
      async respondToRequest(threadId, requestId, decision): Promise<RequestOutcome> {
        const request = requests.get(requestId);
        if (!request || sessions.get(threadId)?.id !== request.sessionId) return "unavailable";
        if (request.responding) throw new Error("这份答案正在发送，请稍候");
        let value: unknown;
        if (request.kind === "approval") {
          if (!request.approvalId) return "unavailable";
          value = { sessionId: request.sessionId, approvalId: request.approvalId, outcome: decision.behavior === "allow" ? "allowed-once" : "rejected" };
        } else {
          if (decision.behavior !== "answer" && !decision.cancelQuestion) throw new Error("请回答问题，不要将业务选项作为权限授权");
          const answers = decision.cancelQuestion ? [] : decision.answers === undefined
            ? legacyQuestionAnswer(request.questions ?? [], decision.message)
            : validateQuestionAnswers(request.questions ?? [], decision.answers);
          if (!answers) throw new Error("问题答案不完整或与题目不匹配，请在问题卡中重新回答");
          value = {
            sessionId: request.sessionId,
            answer: { answers },
          };
        }
        request.responding = true;
        let accepted: boolean;
        try { accepted = await respond(request.endpoint, request.rpcId, value, request.kind === "question" && decision.cancelQuestion === true); }
        finally { request.responding = false; }
        if (!accepted && request.kind === "question" && requests.has(requestId)) throw new Error("答案暂未送达，请重试");
        if (!accepted) return "unavailable";
        const stillPending = requests.has(requestId);
        requests.delete(requestId);
        if (stillPending) emit({ type: "request.resolved", threadId, turnId: active.get(threadId)?.turnId, requestId, behavior: decision.behavior, source: "user" });
        return request.kind === "question" ? "answered" : decision.behavior === "allow" ? "allowed-once" : "rejected";
      },
      hasSession: (threadId) => sessions.has(threadId),
      async stopAll() {
        await Promise.all([...new Set([...starting.keys(), ...active.keys()])].map((threadId) => adapter.interruptTurn(threadId)));
      },
      onEvent(listener) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    };

    return {
      instanceId: input.instanceId,
      driverKind: DRIVER_KIND,
      displayName: input.displayName,
      enabled: input.enabled,
      get models() { return catalog; },
      refreshModels,
      async readSessionUsage(sessionId: string) {
        const endpoint = await resolveEndpoint(input.config, false);
        await matchingSsoSummary(endpoint, input.config.expectedAccountEmail);
        const history = await rpc<unknown>(endpoint, "session.history", { sessionId, maxMessages: 1 });
        return projectedUsageOf(history);
      },
      adapter,
      async snapshot() {
        if (!input.enabled) return { state: "unavailable", reason: "disabled" };
        try {
          const endpoint = await resolveEndpoint(input.config, false);
          await rpc(endpoint, "host.describe", {});
          const sso = await matchingSsoSummary(endpoint, input.config.expectedAccountEmail);
          await updateModelCatalog(endpoint);
          return { state: "available", authenticated: true, version: "Ruijie Harness", billing: "subscription", sso };
        } catch (cause) {
          if (cause instanceof RuijieHarnessDormantError) {
            // Installation is present. A passive status check must neither
            // start the GUI nor hide the catalog. Authentication is checked
            // against the Host when an explicit refresh/turn starts it.
            return { state: "available", version: "Ruijie Harness", billing: "subscription" };
          }
          return { state: "unavailable", authenticated: false, reason: cause instanceof Error ? cause.message : String(cause) };
        }
      },
      async dispose() {
        await adapter.stopAll();
        await ruijieHarnessLocator.dispose();
        listeners.clear();
      },
    };
  },
};
