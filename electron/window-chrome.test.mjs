import { describe, expect, it } from "vitest";

import { desktopWindowWebPreferences, windowChromeOptions } from "./window-chrome.mjs";

describe("window chrome", () => {
  it("uses inset traffic lights on macOS", () => {
    expect(windowChromeOptions("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
    });
  });

  it("keeps Windows controls in the native title bar, outside app content", () => {
    expect(windowChromeOptions("win32")).toEqual({});
  });

  it("keeps Linux window chrome native", () => {
    expect(windowChromeOptions("linux")).toEqual({});
  });

  it("keeps the desktop video renderer active when input foregrounds another window", () => {
    expect(desktopWindowWebPreferences("C:/app/preload.cjs")).toEqual({
      contextIsolation: true,
      backgroundThrottling: false,
      preload: "C:/app/preload.cjs",
    });
  });
});
