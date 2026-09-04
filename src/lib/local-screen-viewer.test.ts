import { describe, expect, it, vi } from "vitest";

import {
  beginLocalComputerTakeover,
  clampLocalScreenZoom,
  computerSurfaceSupportsTakeover,
  localScreenFrameWithTimeout,
  localScreenPollInterval,
  localScreenPoint,
  localViewerStream,
  shouldPollLocalScreenFrames,
  startNonOverlappingLocalScreenPoll,
  stepLocalScreenZoom,
} from "./local-screen-viewer";

describe("local screen viewer", () => {
  it("lets a person take over This computer as well as remote desktops", () => {
    expect(computerSurfaceSupportsTakeover("local")).toBe(true);
    expect(computerSurfaceSupportsTakeover("vm")).toBe(true);
    expect(computerSurfaceSupportsTakeover("ready")).toBe(true);
    expect(computerSurfaceSupportsTakeover("off")).toBe(false);
  });

  it("takes the local lease without hiding the app", async () => {
    const order: string[] = [];
    await expect(beginLocalComputerTakeover({
      takeControl: async () => { order.push("take"); return true; },
    })).resolves.toBe(true);
    expect(order).toEqual(["take"]);
  });

  it("keeps zoom inside the supported range", () => {
    expect(clampLocalScreenZoom(12)).toBe(50);
    expect(clampLocalScreenZoom(112.4)).toBe(112);
    expect(clampLocalScreenZoom(999)).toBe(125);
    expect(clampLocalScreenZoom(Number.NaN)).toBe(100);
  });

  it("moves through deliberate zoom stops", () => {
    expect(stepLocalScreenZoom(100, 1)).toBe(125);
    expect(stepLocalScreenZoom(100, -1)).toBe(75);
    expect(stepLocalScreenZoom(125, 1)).toBe(125);
  });

  it("keeps both the panel preview and enlarged viewer live", () => {
    expect(localScreenPollInterval(true, false)).toBe(100);
    expect(localScreenPollInterval(false, true)).toBeLessThanOrEqual(500);
    expect(localScreenPollInterval(false, false)).toBeLessThanOrEqual(500);
  });

  it("stops one-shot captures while the enlarged continuous stream is active", () => {
    expect(shouldPollLocalScreenFrames(false, false)).toBe(true);
    expect(shouldPollLocalScreenFrames(true, false)).toBe(true);
    expect(shouldPollLocalScreenFrames(true, true)).toBe(false);
  });

  it("keeps the enlarged continuous stream when control is handed back", () => {
    const stream = { active: true } as MediaStream;
    expect(localViewerStream(stream)).toBe(stream);
  });

  it("abandons a stuck frame so later captures can continue", async () => {
    vi.useFakeTimers();
    try {
      const result = localScreenFrameWithTimeout(() => new Promise<string | null>(() => {}), 1_500);
      await vi.advanceTimersByTimeAsync(1_500);
      await expect(result).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for each frame before scheduling the next capture", async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const poll = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
      const stop = startNonOverlappingLocalScreenPoll(poll, 100);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(poll).toHaveBeenCalledTimes(1);
      finish();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(99);
      expect(poll).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(poll).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps a click in the viewer to normalized desktop coordinates", () => {
    expect(localScreenPoint(300, 250, { left: 100, top: 50, width: 800, height: 400 })).toEqual({
      xRatio: 0.25,
      yRatio: 0.5,
    });
  });
});
