import { describe, expect, it } from "vitest";

import { computerControlScope } from "./computer-control-scope.ts";

describe("computer control resource scope", () => {
  it("shares one hold across every bot bound to the Ruijie sandbox", () => {
    expect(computerControlScope({ id: "a", computer: "cloud", cloudBackend: "ruijie-sandbox" })).toBe("provider:ruijie-sandbox");
    expect(computerControlScope({ id: "b", computer: "cloud", cloudBackend: "ruijie-sandbox" })).toBe("provider:ruijie-sandbox");
    expect(computerControlScope({ id: "legacy", computer: "cloud" })).toBe("provider:ruijie-sandbox");
  });

  it("keeps every other computer scoped to its bot", () => {
    expect(computerControlScope({ id: "a", computer: "cloud", cloudBackend: "vps" })).toBe("bot:a");
    expect(computerControlScope({ id: "b", computer: "vm" })).toBe("bot:b");
  });
});
