export interface LocalVmBootstrapBridge {
  inspect(target: LocalVmBootstrapTarget): Promise<LocalVmBootstrapInspection>;
  start(input: { target: LocalVmBootstrapTarget; confirmed: boolean; prepareOnly?: boolean }): Promise<LocalVmBootstrapState>;
}

export type LocalVmBootstrapOutcome =
  | { kind: "ready"; state: LocalVmBootstrapState }
  | { kind: "cancelled" }
  | { kind: "reboot-required"; state: LocalVmBootstrapState };

/** Shared mode has one account-wide desktop, while per-bot mode owns a
 * separate target. Keep that distinction at the renderer boundary so the
 * native bootstrap and the server lifecycle endpoint always address the same
 * VM. */
export function localVmTarget(
  mode: "shared" | "per-bot",
  botId: string,
): LocalVmBootstrapTarget {
  return mode === "per-bot" ? { botId } : {};
}

export function localVmLifecyclePath(
  mode: "shared" | "per-bot",
  botId: string,
  action: "run" | "remove",
): string {
  return mode === "per-bot"
    ? `/api/bots/${encodeURIComponent(botId)}/local-computer/${action}`
    : `/api/local-computer/${action}`;
}

/** The Electron bootstrap can repair both shared and per-bot Local VMs. The
 * server-only fallback can create only a per-bot container from a known image. */
export function localVmSetupAvailable(
  status: { mode: "shared" | "per-bot"; image?: boolean; create_supported?: boolean },
  hasDesktopBootstrap: boolean,
): boolean {
  return hasDesktopBootstrap || (
    status.mode === "per-bot" && Boolean(status.image && status.create_supported)
  );
}

export function localVmSelectionStartsBootstrap(
  currentComputer: string | null | undefined,
  hasDesktopBootstrap: boolean,
): boolean {
  return currentComputer !== "vm" && hasDesktopBootstrap;
}

export function localVmLaunchAction(status: {
  container: "running" | "stopped" | "missing";
  imageMatches: boolean;
  managed: boolean;
  network: "loopback" | "unsafe" | "unknown";
  security: "hardened" | "unsafe" | "unknown";
  persistence: "durable" | "unsafe" | "unknown";
}): "vm-create" | "vm-recreate" {
  const incompatible = status.container !== "missing" && (
    !status.imageMatches || !status.managed || status.network === "unsafe" ||
    status.security === "unsafe" || status.persistence === "unsafe"
  );
  return incompatible ? "vm-recreate" : "vm-create";
}

/** One user intent may need two checks: a stopped installed runtime can be
 * resumed silently, then reveal that its image/VM is actually absent. The
 * second consent gate still happens before any download or VM creation. */
export async function ensureLocalVmReady(
  bridge: LocalVmBootstrapBridge,
  target: LocalVmBootstrapTarget,
  confirmSetup: () => boolean,
  options: { prepareOnly?: boolean } = {},
): Promise<LocalVmBootstrapOutcome> {
  const inspection = await bridge.inspect(target);
  let confirmed = false;
  if (inspection.needsConfirmation) {
    if (!confirmSetup()) return { kind: "cancelled" };
    confirmed = true;
  }

  let state = await bridge.start({ target, confirmed, ...options });
  if (state.status === "confirmation-required") {
    if (!confirmSetup()) return { kind: "cancelled" };
    state = await bridge.start({ target, confirmed: true, ...options });
  }
  if (state.status === "reboot-required") return { kind: "reboot-required", state };
  if (state.status !== "ready") throw new Error(state.message);
  return { kind: "ready", state };
}
