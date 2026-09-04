const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

function createCuaConnectionStore({
  getUserData,
  fileSystem = fs,
  temporaryId = randomUUID,
  processId = process.pid,
  // The same atomic, private-mode write serves every Electron-owned
  // descriptor the harness reads (cua-connection.json, browser-connection.json).
  fileName = "cua-connection.json",
}) {
  let connection = null;

  return Object.freeze({
    get() {
      return connection;
    },

    persist(next) {
      const userData = getUserData();
      fileSystem.mkdirSync(userData, { recursive: true });
      const descriptorPath = path.join(userData, fileName);
      const temporaryPath = `${descriptorPath}.${processId}.${temporaryId()}.tmp`;
      let handle;

      try {
        try {
          fileSystem.chmodSync(userData, 0o700);
        } catch {
          // Windows does not expose meaningful POSIX directory modes.
        }
        handle = fileSystem.openSync(temporaryPath, "wx", 0o600);
        fileSystem.writeFileSync(handle, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        fileSystem.fsyncSync(handle);
        fileSystem.closeSync(handle);
        handle = undefined;
        fileSystem.renameSync(temporaryPath, descriptorPath);
        try {
          fileSystem.chmodSync(descriptorPath, 0o600);
        } catch {
          // Windows does not expose meaningful POSIX file modes.
        }
      } catch (error) {
        if (handle !== undefined) {
          try {
            fileSystem.closeSync(handle);
          } catch {}
        }
        try {
          fileSystem.unlinkSync(temporaryPath);
        } catch {
          // The temporary file may not have been created or may already be renamed.
        }
        throw error;
      }

      connection = next;
      return connection;
    },
  });
}

function shouldInvalidateCuaConnectionOnStop(platform, connection) {
  // Windows direct mode has no Electron-owned daemon to stop. Its descriptor
  // is a durable recipe for launching a fresh MCP process, so an old/duplicate
  // desktop process must not revoke it when that desktop exits.
  return Boolean(connection) && !(platform === "win32" && connection.mode === "windows-direct");
}

module.exports = { createCuaConnectionStore, shouldInvalidateCuaConnectionOnStop };
