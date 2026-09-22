import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { browserAvailable, type FeatureFlagConfig } from "@/lib/feature-flags";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "ruijie-computer-panel-width" ? fixture.savedWidth : "browser" });
  return { config: {} as FeatureFlagConfig, streamlined: false, savedWidth: null as string | null };
});
// The browser-install controls belong to the full product, not the compact
// Ruijie computer preview. Exercise both brands explicitly.
vi.mock("@/lib/brand", () => ({ brand: () => ({ name: fixture.streamlined ? "锐捷Bot" : "OpenMausBot" }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({
    state: { config: { box: { configured: false }, ...fixture.config }, instances: [], computerControl: {}, screens: {}, routines: [], routineRuns: [] },
    dispatch: vi.fn(),
    flushBotPatches: vi.fn(),
  }),
}));
import { ComputerPanel } from "./ComputerPanel";

afterAll(() => vi.unstubAllGlobals());
const bot = { id: "browser-fixture", name: "Browser fixture", modelSelection: { instanceId: "fixture" } } as Bot;
const render = (config: FeatureFlagConfig, browser?: boolean) => {
  fixture.config = config;
  return renderToStaticMarkup(createElement(ComputerPanel, { bot: { ...bot, browser } }));
};

describe("Browser panel installation access", () => {
  const missing = { kind: "unavailable", installable: true } as const;

  it("shows the real install panel before the engine is available", () => {
    const config = { features: { browser: true }, browserEngine: missing };
    expect(render(config)).toContain("Install the browser engine");
    expect(browserAvailable(config)).toBe(false);
  });

  it("retains the global and per-bot opt-in gates", () => {
    expect(render({ browserEngine: missing })).not.toContain("Install the browser engine");
    expect(render({ features: { browser: true }, browserEngine: missing }, false)).not.toContain("Install the browser engine");
  });

  it("does not offer an install on unsupported hosts and still shows a ready engine", () => {
    expect(render({ features: { browser: true }, browserEngine: { kind: "unavailable", installable: false } })).not.toContain("Browser engine not installed");
    // A ready browser waits for the owner check before opening a live stream.
    expect(render({ features: { browser: true }, browserEngine: { kind: "engine" } })).toContain("Loading browser…");
  });

  it("keeps Chrome setup failure and progress visible even when the binary exists", () => {
    const failed = render({ features: { browser: true }, browserEngine: { kind: "engine", installError: "Chrome download failed" } });
    expect(failed).toContain("Chrome download failed");
    expect(failed).toContain("Retry browser installation");
    expect(failed).not.toContain("has its own browser");
    const installing = render({ features: { browser: true }, browserEngine: { kind: "engine", installing: true } });
    expect(installing).toContain("Installing…");
    expect(installing).toContain('disabled=""');
    expect(installing).not.toContain("has its own browser");
  });
});

describe("Ruijie compact computer panel", () => {
  it("keeps the simple 320px panel, bounded width, resize, close and routine actions", () => {
    fixture.streamlined = true;
    try {
      const html = render({});
      expect(html).toContain('style="width:320px;max-width:');
      expect(html).toContain('aria-label="Resize panel"');
      expect(html).toContain('aria-label="Close"');
      expect(html).toContain('aria-label="添加例行任务"');
      expect(html).toContain('role="status"');
      expect(html).toContain("aspect-video");
      expect(html).not.toContain("border-dashed");
      fixture.savedWidth = "420";
      expect(render({})).toContain('style="width:420px;max-width:');
      fixture.savedWidth = "240";
      expect(render({})).toContain('style="width:320px;max-width:');
    } finally {
      fixture.streamlined = false;
      fixture.savedWidth = null;
    }
  });
});
