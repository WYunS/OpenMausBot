import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("renderer entrypoint HMR lifecycle", () => {
  it("unmounts the React root before Vite evaluates the entrypoint again", () => {
    const source = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");

    expect(source).toContain("claimRendererRoot(");
    expect(source).toContain("import.meta.hot.dispose");
    expect(source).toContain("disposeRoot()");
  });
});
