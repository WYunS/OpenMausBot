/**
 * Small stale-while-revalidate cache for Local VM status shown by the UI.
 *
 * A Windows Podman status read crosses into its WSL machine several times.
 * Returning the last verified ready snapshot keeps opening the Computer panel
 * instant, while one deduplicated background refresh notices external
 * container changes for the next poll. Stale unavailable snapshots refresh
 * synchronously so a transient runtime outage does not remain visible.
 */
export class LocalVmStatusCache<TTarget extends { key: string }, TStatus> {
  readonly #values = new Map<string, { checkedAt: number; status: TStatus }>();
  readonly #inflight = new Map<string, Promise<TStatus>>();
  readonly #generations = new Map<string, number>();
  readonly loader: (target: TTarget) => Promise<TStatus>;
  readonly staleAfterMs: number;
  readonly now: () => number;
  readonly canServeStale: (status: TStatus) => boolean;

  constructor(
    loader: (target: TTarget) => Promise<TStatus>,
    staleAfterMs = 5_000,
    now: () => number = Date.now,
    canServeStale: (status: TStatus) => boolean = () => true,
  ) {
    this.loader = loader;
    this.staleAfterMs = staleAfterMs;
    this.now = now;
    this.canServeStale = canServeStale;
  }

  async get(target: TTarget): Promise<TStatus> {
    const cached = this.#values.get(target.key);
    if (!cached) return this.#refresh(target);
    if (this.now() - cached.checkedAt > this.staleAfterMs) {
      if (!this.canServeStale(cached.status)) return this.#refresh(target);
      void this.#refresh(target).catch(() => {
        // Keep the last known snapshot. The next poll retries, while a
        // transient Podman failure does not blank an already-open viewer.
      });
    }
    return cached.status;
  }

  remember(target: TTarget, status: TStatus): void {
    this.#values.set(target.key, { checkedAt: this.now(), status });
  }

  invalidate(target: TTarget): void {
    this.#values.delete(target.key);
    this.#generations.set(target.key, (this.#generations.get(target.key) ?? 0) + 1);
  }

  #refresh(target: TTarget): Promise<TStatus> {
    const existing = this.#inflight.get(target.key);
    if (existing) return existing;
    const generation = this.#generations.get(target.key) ?? 0;
    const pending = this.loader(target).then((status) => {
      if ((this.#generations.get(target.key) ?? 0) === generation) this.remember(target, status);
      return status;
    }).finally(() => {
      if (this.#inflight.get(target.key) === pending) this.#inflight.delete(target.key);
    });
    this.#inflight.set(target.key, pending);
    return pending;
  }
}
