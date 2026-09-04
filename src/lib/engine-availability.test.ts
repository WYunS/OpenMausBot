import { describe, expect, it } from "vitest";
import { engineSelectable, engineSelectableNow, mergeRuijieHarnessSnapshot, prioritizeEngines } from "./engine-availability";

describe("user-controlled engine availability", () => {
  it("defaults Ruijie Harness and Codex on while allowing every adapter to be enabled", () => {
    expect(engineSelectable("ruijieHarness")).toBe(true);
    expect(engineSelectable("codex")).toBe(true);
    expect(engineSelectable("claudeAgent")).toBe(false);
    expect(engineSelectable("antigravityAgent")).toBe(false);
    expect(engineSelectable("claudeAgent", true)).toBe(true);
  });

  it("greys out Harness until the installed app reports the same signed-in account", () => {
    expect(engineSelectableNow({ driverKind: "ruijieHarness", snapshot: { state: "unavailable" } })).toBe(false);
    expect(engineSelectableNow({ driverKind: "ruijieHarness", snapshot: { state: "available" } })).toBe(true);
    expect(engineSelectableNow({ driverKind: "codex", snapshot: { state: "available" } })).toBe(true);
    expect(engineSelectableNow({ driverKind: "claudeAgent", enabled: false, snapshot: { state: "available" } })).toBe(false);
    expect(engineSelectableNow({ driverKind: "claudeAgent", enabled: true, snapshot: { state: "available" } })).toBe(true);
  });

  it("places Ruijie Harness first and Codex second without dropping adapters", () => {
    const input = [{ driverKind: "claudeAgent" }, { driverKind: "codex" }, { driverKind: "ruijieHarness" }];
    expect(prioritizeEngines(input).map((item) => item.driverKind)).toEqual([
      "ruijieHarness", "codex", "claudeAgent",
    ]);
    expect(input.map((item) => item.driverKind)).toEqual(["claudeAgent", "codex", "ruijieHarness"]);
  });

  it("updates only Harness from the fast enterprise-account probe", () => {
    const instances = [
      { instanceId: "ruijieHarness", driverKind: "ruijieHarness", snapshot: { state: "unavailable", reason: "请先登录" } },
      { instanceId: "codex", driverKind: "codex", snapshot: { state: "available" } },
    ];
    const snapshot = { state: "available", authenticated: true };
    const merged = mergeRuijieHarnessSnapshot(instances, snapshot);

    expect(merged[0]).toEqual({ ...instances[0], snapshot });
    expect(merged[1]).toBe(instances[1]);
    expect(instances[0].snapshot.state).toBe("unavailable");
  });
});
