import { describe, expect, it, vi } from "vitest";

import { ComputerTurnQueue } from "./computer-turn-queue.ts";

describe("ComputerTurnQueue", () => {
  it("runs one turn per desktop in FIFO order", async () => {
    const queue = new ComputerTurnQueue();
    const first = await queue.acquire("shared-vm", "turn-a");
    let secondSettled = false;
    const secondPromise = queue.acquire("shared-vm", "turn-b").then((lease) => {
      secondSettled = true;
      return lease;
    });

    await Promise.resolve();
    expect(secondSettled).toBe(false);
    first!.release();

    const second = await secondPromise;
    expect(second).not.toBeNull();
    second!.release();
  });

  it("allows different desktops to run concurrently", async () => {
    const queue = new ComputerTurnQueue();
    const [local, vmA, vmB] = await Promise.all([
      queue.acquire("host", "local-turn"),
      queue.acquire("vm:bot-a", "vm-a-turn"),
      queue.acquire("vm:bot-b", "vm-b-turn"),
    ]);

    expect(local).not.toBeNull();
    expect(vmA).not.toBeNull();
    expect(vmB).not.toBeNull();
    local!.release();
    vmA!.release();
    vmB!.release();
  });

  it("withdraws a stopped turn while it is waiting", async () => {
    vi.useFakeTimers();
    try {
      const queue = new ComputerTurnQueue(10);
      const first = await queue.acquire("host", "turn-a");
      let current = true;
      const waiting = queue.acquire("host", "turn-b", () => current);

      current = false;
      await vi.advanceTimersByTimeAsync(10);
      await expect(waiting).resolves.toBeNull();

      first!.release();
      await expect(queue.acquire("host", "turn-c")).resolves.not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
