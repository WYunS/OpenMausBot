"use strict";

const DESKTOP_MUTATION_HEADER = "X-OpenMausBot-Desktop-Owner";

/** Add the per-launch owner capability to main-process requests. Chromium's
 * webRequest hook cannot see Node fetch, so both paths use this one header
 * contract rather than relying on where a request happened to originate. */
function desktopServerHeaders(headers, { packaged, token }) {
  const next = { ...headers };
  if (!packaged) return next;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("invalid desktop mutation capability");
  }
  next[DESKTOP_MUTATION_HEADER] = token;
  return next;
}

function isDesktopMutationTarget(rawUrl, { serverPort, developmentUrl }) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return false;
  }
  if (
    target.protocol === "http:" &&
    target.hostname === "127.0.0.1" &&
    Number(target.port || 80) === serverPort
  ) return true;

  if (!developmentUrl || (target.pathname !== "/api" && !target.pathname.startsWith("/api/"))) {
    return false;
  }
  try {
    const development = new URL(developmentUrl);
    return development.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(development.hostname) &&
      target.origin === development.origin;
  } catch {
    return false;
  }
}

module.exports = { DESKTOP_MUTATION_HEADER, desktopServerHeaders, isDesktopMutationTarget };
