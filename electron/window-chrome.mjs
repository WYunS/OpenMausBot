/**
 * Keep custom inset chrome only where the platform owns a stable inset model.
 * Windows' titleBarOverlay sits on top of renderer content, so every new page
 * must otherwise remember to reserve its width. Native Windows/Linux chrome
 * keeps caption controls outside the app layout and cannot cover actions.
 */
export function windowChromeOptions(platform) {
  if (platform === "darwin") {
    return { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 16 } };
  }
  return {};
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
