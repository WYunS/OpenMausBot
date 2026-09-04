const DIRECT_RETRY_NETWORK_ERRORS = /\b(?:ERR_TIMED_OUT|ERR_CONNECTION_CLOSED|ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_TIMED_OUT|ERR_ADDRESS_UNREACHABLE)\b/u;

/** Preserve the normal system route and retry once without it only after a
 * transport failure. This mirrors the shipped Harness login behavior. */
export async function loadAuthorizationWithDirectFallback(loader, authorizeUrl) {
  try {
    await loader.loadURL(authorizeUrl);
    return "system";
  } catch (cause) {
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    if (!DIRECT_RETRY_NETWORK_ERRORS.test(detail)) throw cause;
    await loader.useDirectProxy();
    await loader.loadURL(authorizeUrl);
    return "direct";
  }
}

/** Keep authentication focused while fitting smaller Windows and macOS work
 * areas before the first display is maximized. */
export function authorizationWindowSize(workArea) {
  const fit = (available, preferred, minimum) => Math.min(
    preferred,
    Math.max(Math.min(minimum, available), available - 48),
  );
  return {
    width: fit(workArea.width, 920, 480),
    height: fit(workArea.height, 720, 420),
  };
}

/** A modal child cannot slip behind the main app while the browser redirects
 * through multiple enterprise login pages. Kept here so the window ownership
 * policy is testable without booting Electron. */
export function authorizationWindowOptions(parent, workArea) {
  return {
    parent,
    modal: true,
    ...authorizationWindowSize(workArea),
  };
}

export function isRuijieEnterpriseSsoNavigation(navigationUrl) {
  try {
    const navigation = new URL(navigationUrl);
    return navigation.protocol === "https:" && navigation.hostname === "sid.ruijie.com.cn";
  } catch {
    return false;
  }
}

export function authorizationRecoveryForNavigation(
  authorizeUrl,
  enterpriseSsoVisited,
  navigationUrl,
  alreadyRecovered,
) {
  if (alreadyRecovered) return undefined;
  try {
    const authorize = new URL(authorizeUrl);
    const navigation = new URL(navigationUrl);
    const trustedLanding = navigation.origin === authorize.origin
      || (enterpriseSsoVisited && navigation.protocol === "https:");
    if (!trustedLanding) return undefined;
    const isUserHome = navigation.pathname === "/user" || navigation.pathname === "/user/";
    const isDashboard = navigation.pathname === "/dashboard" || navigation.pathname.startsWith("/dashboard/");
    return isUserHome || isDashboard ? authorizeUrl : undefined;
  } catch {
    return undefined;
  }
}

/** The GPTAuth fallback is deliberately one-shot: recover the known lost
 * return target without creating a dashboard/authorize navigation loop. */
export class RuijieAuthorizationRecovery {
  #enterpriseSsoVisited = false;
  #recovered = false;

  constructor(authorizeUrl) {
    this.authorizeUrl = authorizeUrl;
  }

  observe(navigationUrl) {
    this.#enterpriseSsoVisited = this.#enterpriseSsoVisited
      || isRuijieEnterpriseSsoNavigation(navigationUrl);
    const recovery = authorizationRecoveryForNavigation(
      this.authorizeUrl,
      this.#enterpriseSsoVisited,
      navigationUrl,
      this.#recovered,
    );
    if (recovery) this.#recovered = true;
    return recovery;
  }
}
