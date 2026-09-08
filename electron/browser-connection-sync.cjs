"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Packaged builds transport the browser master token over Electron's
 * private utility-process port. Remove any descriptor left by an older build
 * before the child starts so it cannot become a same-user shell bypass. */
function removeBrowserConnectionDescriptor({ userData, fileSystem = fs }) {
  const descriptorPath = path.join(userData, "browser-connection.json");
  try {
    fileSystem.unlinkSync(descriptorPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function browserConnectionDescriptorMatches({ userData, connection, fileSystem = fs }) {
  if (!connection) return false;
  try {
    const current = JSON.parse(fileSystem.readFileSync(path.join(userData, "browser-connection.json"), "utf8"));
    return current?.version === connection.version
      && current?.url === connection.url
      && current?.token === connection.token
      && current?.pid === connection.pid;
  } catch {
    return false;
  }
}

function postBrowserConnection(proc, connection) {
  proc.postMessage({ type: "openmausbot:browser-connection", connection: connection ?? null });
}

module.exports = {
  browserConnectionDescriptorMatches,
  postBrowserConnection,
  removeBrowserConnectionDescriptor,
};
