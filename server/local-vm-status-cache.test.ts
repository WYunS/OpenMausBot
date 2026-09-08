import { describe, expect, it } from "vitest";

import { LocalVmStatusCache } from "./local-vm-status-cache.ts";

describe("LocalVmStatusCache", () => {
  it("returns stale status immediately and deduplicates its background refresh", async () => {
    let now = 0;
    let calls = 0;
    let finishRefresh!: (value: { ready: boolean }) => void;
    const cache = new LocalVmStatusCache(
      async () => {
        calls += 1;
        if (calls === 1) return { ready: true };
        return new Promise((resolve) => { finishRefresh = resolve; });
      },
      5_000,
      () => now,
    );
    const target = { key: "shared" };

    expect(await cache.get(target)).toEqual({ ready: true });
    now = 6_000;
    expect(await cache.get(target)).toEqual({ ready: true });
    expect(await cache.get(target)).toEqual({ ready: true });
    expect(calls).toBe(2);

    finishRefresh({ ready: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(await cache.get(target)).toEqual({ ready: false });
  });

  it("deduplicates concurrent initial reads", async () => {
    let calls = 0;
    let finish!: (value: string) => void;
    const cache = new LocalVmStatusCache(async () => {
      calls += 1;
      return new Promise((resolve) => { finish = resolve; });
    });
    const target = { key: "shared" };

    const first = cache.get(target);
    const second = cache.get(target);
    expect(calls).toBe(1);
    finish("ready");
    await expect(Promise.all([first, second])).resolves.toEqual(["ready", "ready"]);
  });
});
