export type ComposerRuntimeState = "loading" | "ready" | "error" | "unavailable";

export function composerRuntimeState(hasEngine: boolean, loadState: "loading" | "ready" | "error" | undefined, desktopReady: boolean): ComposerRuntimeState {
  if (!hasEngine && loadState === "error") return "error";
  if (!hasEngine && loadState === "ready") return "unavailable";
  if (!hasEngine || !desktopReady) return "loading";
  return "ready";
}

export const composerRuntimeNotice = (status: ComposerRuntimeState) => status === "loading"
  ? "正在准备执行环境，可先输入消息"
  : status === "error" ? "执行环境加载失败，正在重试"
    : status === "unavailable" ? "执行环境不可用，请检查 Bot 资料中的配置" : "";
