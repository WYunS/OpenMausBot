import { describe, expect, it, vi } from "vitest";

import {
  desktopWindowWebPreferences,
  hideNativeWindowTitle,
  nativeTitleBarOverlayForSkin,
  nativeThemeSourceForSkin,
  windowChromeOptions,
} from "./window-chrome.mjs";

describe("window chrome", () => {
  it("uses inset traffic lights on macOS", () => {
    expect(windowChromeOptions("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
    });
  });

  it("keeps Windows controls in the native title bar, outside app content", () => {
    expect(windowChromeOptions("win32")).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: "#fcfcfc",
        height: 32,
      },
    });
  });

  it("keeps Linux window chrome native", () => {
    expect(windowChromeOptions("linux")).toEqual({});
  });

  it("matches native chrome to light and dark app skins", () => {
    expect(nativeThemeSourceForSkin("midnight")).toBe("dark");
    expect(nativeThemeSourceForSkin("graphite")).toBe("dark");
    expect(nativeThemeSourceForSkin("atelier")).toBe("light");
    expect(nativeThemeSourceForSkin("linen")).toBe("light");
    expect(nativeTitleBarOverlayForSkin("midnight").symbolColor).toBe("#fcfcfc");
    expect(nativeTitleBarOverlayForSkin("atelier").symbolColor).toBe("#1a1a18");
    expect(nativeTitleBarOverlayForSkin("atelier").color).toBe("#00000000");
  });

  it("keeps the desktop video renderer active when input foregrounds another window", () => {
    expect(desktopWindowWebPreferences("C:/app/preload.cjs")).toEqual({
      contextIsolation: true,
      backgroundThrottling: false,
      preload: "C:/app/preload.cjs",
    });
  });

  it("keeps native title text empty when a page tries to replace it", () => {
    let pageTitleUpdated;
    const titles = [];
    const win = {
      isDestroyed: () => false,
      setTitle: (title) => titles.push(title),
      webContents: {
        on: (eventName, listener) => {
          if (eventName === "page-title-updated") pageTitleUpdated = listener;
        },
      },
    };

    hideNativeWindowTitle(win);
    const event = { preventDefault: vi.fn() };
    pageTitleUpdated(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(titles).toEqual(["", ""]);
  });
});
