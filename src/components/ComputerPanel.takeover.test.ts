import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("live desktop takeover boundary", () => {
  it("opens the viewer read-only and waits for a real viewer input before taking control", () => {
    const source = readFileSync(new URL("./ComputerPanel.tsx", import.meta.url), "utf8");
    const openDesktop = source.slice(source.indexOf("const openDesktop = async"), source.indexOf("const disconnectRuijie"));

    expect(openDesktop).not.toContain('transitionControl("take")');
    expect(source).toContain("desktopViewer?.onUserInput");
  });
});
