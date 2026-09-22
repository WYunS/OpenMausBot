import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("desktop typography", () => {
  it("keeps a semantic size together with text colour in the real class merger", () => {
    expect(cn("text-ui-body", "text-ink")).toBe("text-ui-body text-ink");
    expect(cn("text-ui-caption", "text-ui-base", "text-ink-secondary")).toBe("text-ui-base text-ink-secondary");
  });
});
