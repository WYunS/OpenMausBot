import { describe, expect, it } from "vitest";

import { DEFAULT_CLOUD_BACKEND, RUIJIE_SANDBOX_ENABLED } from "./product-features.ts";

describe("Ruijie product defaults", () => {
  it("enables the persistent Ruijie sandbox as the default cloud backend", () => {
    expect(RUIJIE_SANDBOX_ENABLED).toBe(true);
    expect(DEFAULT_CLOUD_BACKEND).toBe("ruijie-sandbox");
  });
});
