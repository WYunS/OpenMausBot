// URL boundary for the in-app desktop viewer. Cloud viewers must use HTTPS;
// the one HTTP exception is the passworded noVNC server bound to loopback by
// OpenMausBot's Local VM.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const DESKTOP_VIEWER_USER_AGENT = "OpenMausBot-Desktop-Viewer/1.0";

function isPrivateIpv4(hostname) {
  const octets = String(hostname).split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function desktopViewerUrl(rawUrl) {
  if (Object.prototype.toString.call(rawUrl) !== "[object String]" || !rawUrl.trim()) {
    throw new Error("A desktop viewer address is required");
  }
  if (rawUrl.length > 16_384) throw new Error("The desktop viewer address is too long");

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("The desktop viewer address is invalid");
  }

  const trustedHttp = url.protocol === "http:" && (LOOPBACK_HOSTS.has(url.hostname) || isPrivateIpv4(url.hostname));
  if (url.protocol !== "https:" && !trustedHttp) {
    throw new Error("The desktop viewer must use HTTPS, loopback, or a private-network address");
  }
  if (url.username || url.password) {
    throw new Error("Desktop viewer credentials must not use URL user info");
  }
  return url;
}

function sameDesktopViewerOrigin(rawUrl, origin) {
  try {
    return desktopViewerUrl(rawUrl).origin === origin;
  } catch {
    return false;
  }
}

module.exports = { DESKTOP_VIEWER_USER_AGENT, desktopViewerUrl, isPrivateIpv4, sameDesktopViewerOrigin };
