export interface ComputerTurnLease {
  release(): void;
}

interface Waiter {
  ownerId: string;
  valid: () => boolean;
  resolve: (lease: ComputerTurnLease | null) => void;
  timer: ReturnType<typeof setInterval>;
}

interface Lane {
  ownerId: string | null;
  waiters: Waiter[];
}

/** Serializes turns that point at the same visible desktop while allowing
 * different desktop identities to run independently. Waiting is FIFO. A
 * caller supplies its own liveness predicate so Stop can withdraw queued
 * setup without learning anything about this module's implementation. */
export class ComputerTurnQueue {
  private readonly lanes = new Map<string, Lane>();
  private readonly cancellationPollMs: number;

  constructor(cancellationPollMs = 100) {
    if (!Number.isFinite(cancellationPollMs) || cancellationPollMs <= 0) {
      throw new Error("Computer turn queue cancellation interval must be positive");
    }
    this.cancellationPollMs = cancellationPollMs;
  }

  acquire(targetKey: string, ownerId: string, valid: () => boolean = () => true): Promise<ComputerTurnLease | null> {
    if (!targetKey) throw new Error("Computer turn queue target is required");
    if (!ownerId) throw new Error("Computer turn queue owner is required");
    if (!valid()) return Promise.resolve(null);

    let lane = this.lanes.get(targetKey);
    if (!lane) {
      lane = { ownerId: null, waiters: [] };
      this.lanes.set(targetKey, lane);
    }
    if (lane.ownerId === null) {
      lane.ownerId = ownerId;
      return Promise.resolve(this.lease(targetKey, ownerId));
    }

    return new Promise((resolve) => {
      const waiter: Waiter = {
        ownerId,
        valid,
        resolve,
        timer: setInterval(() => {
          if (valid()) return;
          this.cancelWaiter(targetKey, waiter);
        }, this.cancellationPollMs),
      };
      waiter.timer.unref?.();
      lane!.waiters.push(waiter);
    });
  }

  private lease(targetKey: string, ownerId: string): ComputerTurnLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const lane = this.lanes.get(targetKey);
        if (!lane || lane.ownerId !== ownerId) return;
        lane.ownerId = null;
        this.promote(targetKey, lane);
      },
    };
  }

  private cancelWaiter(targetKey: string, waiter: Waiter): void {
    const lane = this.lanes.get(targetKey);
    if (!lane) return;
    const index = lane.waiters.indexOf(waiter);
    if (index < 0) return;
    lane.waiters.splice(index, 1);
    clearInterval(waiter.timer);
    waiter.resolve(null);
    if (lane.ownerId === null) this.promote(targetKey, lane);
  }

  private promote(targetKey: string, lane: Lane): void {
    while (lane.ownerId === null) {
      const waiter = lane.waiters.shift();
      if (!waiter) {
        this.lanes.delete(targetKey);
        return;
      }
      clearInterval(waiter.timer);
      if (!waiter.valid()) {
        waiter.resolve(null);
        continue;
      }
      lane.ownerId = waiter.ownerId;
      waiter.resolve(this.lease(targetKey, waiter.ownerId));
    }
  }
}
