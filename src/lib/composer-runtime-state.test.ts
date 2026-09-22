import { describe, expect, it } from "vitest";
import { composerRuntimeState } from "./composer-runtime-state";

describe("composer startup readiness", () => {
  it("keeps unknown capabilities distinct from a confirmed unavailable engine", () => {
    expect(composerRuntimeState(false, "loading", true)).toBe("loading");
    expect(composerRuntimeState(false, "ready", true)).toBe("unavailable");
    expect(composerRuntimeState(false, "error", true)).toBe("error");
  });
  it("waits for desktop capability discovery and retains an already usable engine during refresh failure", () => {
    expect(composerRuntimeState(true, "ready", false)).toBe("loading");
    expect(composerRuntimeState(true, "ready", true)).toBe("ready");
    expect(composerRuntimeState(true, "error", true)).toBe("ready");
  });
});
