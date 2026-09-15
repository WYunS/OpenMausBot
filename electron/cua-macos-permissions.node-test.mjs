import assert from "node:assert/strict";
import test from "node:test";

import permissions from "./cua-macos-permissions.cjs";

const { ensureMacOSPermissions, shouldAttachStandaloneAfterEmbeddedFailure } = permissions;

test("an already-authorized Mac startup does not request TCC permissions again", () => {
  let requests = 0;
  const status = ensureMacOSPermissions({
    currentMacOsPermissionStatus: () => ({ accessibility: true, screenRecording: true }),
    requestMacOSPermissions: () => {
      requests += 1;
      return { accessibility: true, screenRecording: true };
    },
    hasRequiredMacOSPermissions: (value) => value.accessibility && value.screenRecording,
  });

  assert.deepEqual(status, { accessibility: true, screenRecording: true });
  assert.equal(requests, 0);
});

test("an incomplete Mac permission state requests once and returns the refreshed state", () => {
  let requests = 0;
  const status = ensureMacOSPermissions({
    currentMacOsPermissionStatus: () => ({ accessibility: true, screenRecording: false }),
    requestMacOSPermissions: () => {
      requests += 1;
      return { accessibility: true, screenRecording: true };
    },
    hasRequiredMacOSPermissions: (value) => value.accessibility && value.screenRecording,
  });

  assert.deepEqual(status, { accessibility: true, screenRecording: true });
  assert.equal(requests, 1);
});

test("older CUA SDKs without a status probe retain the request fallback", () => {
  let requests = 0;
  ensureMacOSPermissions({
    requestMacOSPermissions: () => {
      requests += 1;
      return { accessibility: false, screenRecording: false };
    },
    hasRequiredMacOSPermissions: () => false,
  });
  assert.equal(requests, 1);
});

test("a packaged app never falls back to a second macOS TCC identity", () => {
  assert.equal(shouldAttachStandaloneAfterEmbeddedFailure({ isPackaged: true }), false);
  assert.equal(shouldAttachStandaloneAfterEmbeddedFailure({ isPackaged: false }), true);
});
