import { describe, expect, it, vi } from "vitest";
import { adoptRuijieAccountState } from "./ruijie-account-sync";

describe("adoptRuijieAccountState", () => {
  it("keeps a valid SSO session ready when profile persistence fails", async () => {
    const next = {
      status: "ready",
      summary: {
        account: { name: "Workspace owner", email: "owner@example.test" },
      },
    } as RuijieAccountState;
    const setState = vi.fn();
    const refreshRuijieHarness = vi.fn().mockResolvedValue(undefined);
    const refreshInstances = vi.fn().mockResolvedValue(undefined);

    await expect(adoptRuijieAccountState({
      next,
      currentProfile: { name: "", email: "" },
      saveProfile: vi.fn().mockRejectedValue(new Error("HTTP 500")),
      setState,
      refreshRuijieHarness,
      refreshInstances,
      reportSupplementalFailure: vi.fn(),
    })).resolves.toBeUndefined();

    expect(setState).toHaveBeenCalledWith(next);
    expect(refreshRuijieHarness).toHaveBeenCalledOnce();
    expect(refreshInstances).toHaveBeenCalledOnce();
  });
});
