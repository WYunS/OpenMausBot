import { feishuCopy } from "../l10n/feishu";

export type FeishuPhase = "detecting" | "downloadingCli" | "downloadingNode" | "verifyingRuntime"
  | "openingApp" | "creatingApp" | "checkingApp" | "openingAuthorization" | "authorizing"
  | "verifyingIdentity" | "preparingSession" | "starting" | "ready" | "error";

export interface FeishuState {
  supported: boolean;
  cliPath: string;
  nodePath: string;
  version?: string;
  botId: string;
  ownerOpenId?: string;
  im: "off" | "starting" | "ready" | "reconnecting" | "error";
  toolsEnabled: boolean;
  userAuthorized: boolean;
  botAuthorized: boolean;
  error?: string;
  errorCode?: string;
  pairingCode?: string;
  login?: { url: string; userCode?: string };
  pending?: boolean;
  phase?: FeishuPhase;
  recoveryPending?: boolean;
  reconnect?: boolean;
}

export type FeishuAction =
  | "oneClickConnect" | "selectBot" | "recreateApp"
  | "chooseCli" | "chooseNode" | "probe" | "login" | "completeLogin"
  | "pair" | "connect" | "disconnect" | "enableTools" | "disableTools";

export interface FeishuBridge {
  state(): Promise<FeishuState>;
  invoke(action: FeishuAction, input?: { botId?: string }): Promise<FeishuState>;
}

export interface FeishuSnapshot {
  state: FeishuState | null;
  busy: FeishuAction | null;
  error: string | null;
}

export type FeishuBot = { id: string; name: string; hidden?: boolean };

export function feishuErrorMessage(errorCode?: string): string {
  return errorCode && Object.hasOwn(feishuCopy.errors, errorCode)
    ? feishuCopy.errors[errorCode as keyof typeof feishuCopy.errors] : feishuCopy.actionFailed;
}

export function feishuConnected(state: FeishuState | null, error?: string | null): boolean | null {
  if (!state || error || state.error || state.errorCode || state.phase === "error") return null;
  if (!state.supported) return false;
  return state.im === "ready" && !state.pairingCode && state.toolsEnabled && !state.pending;
}

export function feishuVisible(search: string, tab: "marketplace" | "connected", state: FeishuState | null, error?: string | null) {
  const recoverable = state?.supported !== false && Boolean(error || state && (
    state.error || state.errorCode || state.cliPath || state.toolsEnabled || state.im !== "off"
    || state.ownerOpenId || state.pairingCode || state.login || state.pending || state.phase
  ));
  return feishuCopy.search.includes(search.trim().toLowerCase())
    && (tab === "marketplace" || recoverable);
}

export function feishuBotLocked(state: FeishuState | null) {
  return Boolean(state && (state.pairingCode || state.pending
    || ["starting", "ready", "reconnecting"].includes(state.im)));
}

export function feishuActionInterrupts(action: FeishuAction, busy: FeishuAction | null) {
  return (action === "disconnect" && busy !== "disconnect")
    || (action === "disableTools" && busy !== "disconnect" && busy !== "disableTools");
}

export function feishuActionAllowed(
  action: FeishuAction, snapshot: FeishuSnapshot, botId: string, available: boolean,
) {
  const { state, busy } = snapshot;
  if (!available || state?.supported === false) return false;
  if (busy && !feishuActionInterrupts(action, busy)) return false;
  if (action === "disconnect") return true;
  if (action === "disableTools") return Boolean(state?.toolsEnabled || state?.pending
    || busy === "enableTools" || busy === "login" || busy === "completeLogin");
  if (state?.pending) return false;
  if (action === "recreateApp") return Boolean(botId && (
    ["APP_UNAVAILABLE", "CONFIG_EXISTS", "CONFIG_NOT_EMPTY"].includes(state?.errorCode ?? "") || state?.recoveryPending
  ));
  if (action === "oneClickConnect" || action === "selectBot") return Boolean(botId);
  if (action === "probe" || action === "chooseCli" || action === "chooseNode") return true;
  if (!state) return false;
  if (!state.cliPath) return false;
  if (action === "login") return true;
  if (action === "completeLogin") return Boolean(state.login);
  if (snapshot.error || state.error) return false;
  if (action === "enableTools") return Boolean(state.nodePath && state.userAuthorized && !state.toolsEnabled);
  if (!botId) return false;
  if (action === "pair") return state.botAuthorized && !feishuBotLocked(state);
  return Boolean(state.botAuthorized && state.ownerOpenId && !state.pairingCode && state.im !== "ready"
    && state.im !== "starting" && state.im !== "reconnecting");
}

export function feishuLoginUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}
