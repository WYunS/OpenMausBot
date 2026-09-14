export function shouldMountLocalComputer({
  requested,
  hostPlatform = process.platform,
  providerSupportsLocal,
}: {
  requested: "cloud" | "local" | "off" | undefined;
  hostPlatform?: NodeJS.Platform;
  providerSupportsLocal: boolean;
}): boolean {
  if (!providerSupportsLocal) return false;
  if (requested === "local") {
    return hostPlatform === "darwin" || hostPlatform === "linux" || hostPlatform === "win32";
  }
  // Preserve the established macOS Auto behavior. Linux and Windows local
  // control can only be selected explicitly per bot.
  return requested === undefined && hostPlatform === "darwin";
}

export type HostComputerIntent = "require" | "forbid" | "unspecified";

/** A Ruijie sandbox is a security boundary, not just a preferred machine.
 * If its bridge is unavailable, surfacing that failure is safer than silently
 * mounting the person's Windows/macOS desktop under the same computer tools. */
export function shouldFallbackCloudToHost({
  cloudBackend,
  hostIntent,
}: {
  cloudBackend: "box" | "vps" | "ruijie-sandbox";
  hostIntent: HostComputerIntent;
}): boolean {
  return cloudBackend !== "ruijie-sandbox" && hostIntent !== "forbid";
}

/** Resolve only wording that clearly distinguishes the physical host from a
 * bot's bound computer. Generic words such as “电脑”, “桌面” and “浏览器” stay
 * unspecified so the bound computer remains the default. */
export function hostComputerIntent(text: string): HostComputerIntent {
  const normalized = text.normalize("NFKC").toLowerCase();
  const host = /(?:本机|本地电脑|本地机器|宿主机|物理机|本台(?:电脑|机器)|这台(?:电脑|机器)|当前(?:这台)?(?:电脑|机器)|我(?:的|这台)(?:电脑|机器)|我的\s*(?:pc|mac)|this computer|my computer|local computer|local machine|host machine|on my (?:pc|mac))/i;
  if (!host.test(normalized)) return "unspecified";

  const forbidden = /(?:不要|别|禁止|不许|无需|不用|不能|不可|绝不)[^。！？.!?\n]{0,12}(?:windows\s*)?(?:本机|本地|宿主机|物理机|本台(?:电脑|机器)|这台(?:电脑|机器)|当前(?:这台)?(?:电脑|机器)|我(?:的|这台)(?:电脑|机器))|(?:windows\s*)?(?:本机|本地电脑|本地机器|宿主机|物理机|本台(?:电脑|机器)|这台(?:电脑|机器)|当前(?:这台)?(?:电脑|机器)|我(?:的|这台)(?:电脑|机器))[^。！？.!?\n]{0,20}(?:不要|别|禁止|不许|无需|不用|不能|不可|绝不)|(?:如果|若)[^。！？.!?\n]{0,20}(?:windows\s*)?(?:本机|本地电脑|本地机器|宿主机|物理机)[^。！？.!?\n]{0,12}(?:停止|停手|退出|中止)|(?:do not|don't|dont|never|without)[^.!?\n]{0,24}(?:this computer|my computer|local computer|local machine|host machine|my (?:pc|mac))|(?:this computer|my computer|local computer|local machine|host machine|my (?:pc|mac))[^.!?\n]{0,24}(?:do not|don't|dont|never|without)|(?:if|when)[^.!?\n]{0,24}(?:this computer|my computer|local computer|local machine|host machine|my (?:pc|mac))[^.!?\n]{0,16}(?:stop|abort|exit)/i;
  if (forbidden.test(normalized)) return "forbid";

  // Merely explaining that the local Bot/app restarted is not an instruction
  // to abandon the bot's selected Cloud computer and mount the host desktop.
  const localAppSubject = /(?:本机|本地|宿主机)\s*(?:bot|应用|客户端|程序|服务|窗口)\b|(?:local|host)\s+(?:bot|app|client|process|service|window)\b/i;
  if (localAppSubject.test(normalized)) return "unspecified";
  return "require";
}
