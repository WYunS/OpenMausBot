/** Product defaults for fleet rows that predate the user-controlled switch. */
const DEFAULT_ENABLED_DRIVERS = new Set(["ruijieHarness"]);

export function engineSelectable(driverKind: string, enabled = DEFAULT_ENABLED_DRIVERS.has(driverKind)): boolean {
  return enabled;
}

export function engineSelectableNow(instance: { driverKind: string; enabled?: boolean; snapshot: { state: string } }): boolean {
  if (!engineSelectable(instance.driverKind, instance.enabled)) return false;
  return instance.driverKind !== "ruijieHarness" || instance.snapshot.state === "available";
}

export function prioritizeEngines<T extends { driverKind: string }>(instances: readonly T[]): T[] {
  return [...instances].sort((left, right) => {
    const rank = (driverKind: string) => driverKind === "ruijieHarness" ? 0 : driverKind === "codex" ? 1 : 2;
    return rank(left.driverKind) - rank(right.driverKind);
  });
}

/** Replace only the account-gated Harness health without waiting for every
 * optional CLI in the fleet to be probed. */
export function mergeRuijieHarnessSnapshot<T extends { driverKind: string; snapshot: unknown }>(
  instances: readonly T[],
  snapshot: T["snapshot"],
): T[] {
  return instances.map((instance) => instance.driverKind === "ruijieHarness"
    ? { ...instance, snapshot }
    : instance);
}
