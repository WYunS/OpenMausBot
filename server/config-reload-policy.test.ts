import { describe, expect, it } from "vitest";

import { providerReloadRequired } from "./config-reload-policy.ts";

describe("provider config reload policy", () => {
  it("reloads providers when the enterprise profile changes because Harness captures its email", () => {
    expect(providerReloadRequired({ profile: { name: "王允尚", email: "wangyunshang@ruijie.com.cn" } })).toBe(true);
  });

  it("does not reload providers for presentation-only settings", () => {
    expect(providerReloadRequired({ language: "zh", features: { browser: true } })).toBe(false);
  });
});
