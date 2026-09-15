"use strict";

/**
 * The CUA request helper may invoke macOS TCC UI. Probe first so an already
 * authorized installation never asks again on an ordinary app restart.
 */
function ensureMacOSPermissions(sdk) {
  if (typeof sdk.currentMacOsPermissionStatus === "function") {
    const current = sdk.currentMacOsPermissionStatus();
    if (sdk.hasRequiredMacOSPermissions(current)) return current;
  }
  return sdk.requestMacOSPermissions();
}

/** A packaged app must keep one stable TCC identity: OpenMausBot itself. */
function shouldAttachStandaloneAfterEmbeddedFailure({ isPackaged }) {
  return !isPackaged;
}

module.exports = {
  ensureMacOSPermissions,
  shouldAttachStandaloneAfterEmbeddedFailure,
};
