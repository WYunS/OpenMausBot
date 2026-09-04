export const LOCAL_SCREEN_ZOOM_STEPS = [50, 75, 100, 125] as const;

export function clampLocalScreenZoom(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(125, Math.max(50, Math.round(value)));
}

export function stepLocalScreenZoom(value: number, direction: -1 | 1): number {
  const current = clampLocalScreenZoom(value);
  const candidates = direction > 0
    ? LOCAL_SCREEN_ZOOM_STEPS.filter((step) => step > current)
    : [...LOCAL_SCREEN_ZOOM_STEPS].reverse().filter((step) => step < current);
  return candidates[0] ?? current;
}

export function localScreenPollInterval(expanded: boolean, busy: boolean): number {
  if (expanded) return 100;
  // The compact panel is still a live monitor. A 30-second idle cadence made
  // ordinary desktop changes look frozen until opening the enlarged viewer.
  void busy;
  return 400;
}

export function shouldPollLocalScreenFrames(viewerOpen: boolean, hasLiveStream: boolean): boolean {
  return !viewerOpen || !hasLiveStream;
}

/** The enlarged viewer is a continuous desktop monitor, not an agent
 * screenshot viewer. Handing control back changes who may send input; it must
 * not replace the active stream with the agent's last captured frame. */
export function localViewerStream(stream: MediaStream | null): MediaStream | null {
  return stream;
}

export async function localScreenFrameWithTimeout(
  capture: () => Promise<string | null>,
  timeoutMs = 2_000,
): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      capture(),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function startNonOverlappingLocalScreenPoll(
  poll: () => Promise<unknown>,
  intervalMs: number,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    try {
      await poll();
    } catch {
      // A later frame can recover; polling must not die on one capture error.
    } finally {
      if (!stopped) timer = setTimeout(() => void run(), intervalMs);
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

export function localScreenPoint(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
): { xRatio: number; yRatio: number } | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  return {
    xRatio: Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width)),
    yRatio: Math.min(1, Math.max(0, (clientY - bounds.top) / bounds.height)),
  };
}

export function computerSurfaceSupportsTakeover(phase: string): boolean {
  return phase === "ready" || phase === "vm" || phase === "local";
}

export async function beginLocalComputerTakeover(input: {
  takeControl: () => Promise<boolean>;
}): Promise<boolean> {
  return input.takeControl();
}
