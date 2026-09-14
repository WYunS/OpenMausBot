import { describe, expect, it, vi } from "vitest";

import { claimRendererRoot } from "./renderer-root";

describe("renderer root ownership", () => {
  it("evicts a leaked root even when its HMR dispose callback never ran", () => {
    const container = {} as HTMLElement;
    const first = { unmount: vi.fn() };
    const second = { unmount: vi.fn() };

    const oldGeneration = claimRendererRoot(container, () => first);
    const currentGeneration = claimRendererRoot(container, () => second);

    expect(first.unmount).toHaveBeenCalledOnce();
    expect(second.unmount).not.toHaveBeenCalled();

    // A late cleanup from the old module must not tear down the new App.
    oldGeneration.dispose();
    expect(second.unmount).not.toHaveBeenCalled();

    currentGeneration.dispose();
    expect(second.unmount).toHaveBeenCalledOnce();
  });
});
