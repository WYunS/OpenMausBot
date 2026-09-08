/**
 * Keep custom inset chrome only where the platform owns a stable inset model.
 * Windows' titleBarOverlay sits on top of renderer content, so every new page
 * must otherwise remember to reserve its width. Native Windows/Linux chrome
 * keeps caption controls outside the app layout and cannot cover actions.
 */
export function windowChromeOptions(platform, skin = "midnight") {
  if (platform === "darwin") {
    return { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 16 } };
  }
  if (platform === "win32") {
    return { titleBarStyle: "hidden", titleBarOverlay: nativeTitleBarOverlayForSkin(skin) };
  }
  return {};
}

const LIGHT_SKINS = new Set(["atelier", "lagoon", "linen"]);

/** Keep the native Windows caption in the same light/dark family as the app. */
export function nativeThemeSourceForSkin(skin) {
  return LIGHT_SKINS.has(skin) ? "light" : "dark";
}

/** Windows draws only the caption buttons; transparency keeps their strip continuous with the app. */
export function nativeTitleBarOverlayForSkin(skin) {
  return {
    color: "#00000000",
    symbolColor: LIGHT_SKINS.has(skin) ? "#1a1a18" : "#fcfcfc",
    height: 32,
  };
}

/** Suppress native caption text, including page-driven title updates. */
export function hideNativeWindowTitle(win) {
  const clearTitle = () => {
    if (!win.isDestroyed()) win.setTitle("");
  };
  clearTitle();
  win.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    clearTitle();
  });
}

export function desktopWindowWebPreferences(preload) {
  return {
    contextIsolation: true,
    // Human takeover foregrounds the controlled window. Keep the capture
    // renderer painting while OpenMausBot remains visible above that window.
    backgroundThrottling: false,
    preload,
  };
}
