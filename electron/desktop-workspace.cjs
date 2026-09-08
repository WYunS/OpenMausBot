const { DESKTOP_VIEWER_USER_AGENT, desktopViewerUrl, sameDesktopViewerOrigin } = require("./desktop-viewer.cjs");

const MAX_WORKSPACE_VIEWS = 2;
const CONTEXT_ID = /^[A-Za-z0-9:_-]{1,120}$/;

function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Local VM viewers are stricter than the existing cloud viewer: their noVNC
 * endpoint must remain on this host. The view_only flag lives in noVNC's hash
 * parameters alongside its short-lived password, so preserve every other
 * field and change only that capability bit.
 */
function desktopWorkspaceUrl(rawUrl, interactive = false, allowPrivateNetwork = false) {
  const url = desktopViewerUrl(rawUrl);
  if (!allowPrivateNetwork && !isLoopbackHostname(url.hostname)) {
    throw new Error("Local VM desktops must use a loopback address");
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  fragment.set("view_only", interactive ? "false" : "true");
  url.hash = fragment.toString();
  return url;
}

function desktopWorkspaceIdentity(url) {
  // Ports distinguish per-bot loopback viewers. Query/hash fields can contain
  // credentials, so neither those fields nor a derivative of them is kept.
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function desktopWorkspaceContextId(value) {
  if (Object.prototype.toString.call(value) !== "[object String]" || !CONTEXT_ID.test(value)) {
    throw new Error("The desktop workspace context is invalid");
  }
  return value;
}

function normalizeDesktopWorkspaceBounds(rawBounds, contentSize) {
  if (Object.prototype.toString.call(rawBounds) !== "[object Object]") {
    throw new Error("Desktop workspace bounds are invalid");
  }
  if (!Array.isArray(contentSize) || contentSize.length !== 2) {
    throw new Error("The desktop workspace owner size is unavailable");
  }
  const values = [rawBounds.x, rawBounds.y, rawBounds.width, rawBounds.height];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Desktop workspace bounds are invalid");
  }

  const ownerWidth = Math.max(1, Math.floor(contentSize[0]));
  const ownerHeight = Math.max(1, Math.floor(contentSize[1]));
  let x = Math.round(rawBounds.x);
  let y = Math.round(rawBounds.y);
  let width = Math.round(rawBounds.width);
  let height = Math.round(rawBounds.height);
  if (width < 1 || height < 1) throw new Error("Desktop workspace bounds are empty");

  x = Math.max(0, Math.min(x, ownerWidth - 1));
  y = Math.max(0, Math.min(y, ownerHeight - 1));
  width = Math.max(1, Math.min(width, ownerWidth - x));
  height = Math.max(1, Math.min(height, ownerHeight - y));
  return { x, y, width, height };
}

function desktopInputPoint(value, limit, label) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 0 || number >= limit) {
    throw new Error(`${label} is outside the desktop frame`);
  }
  return number;
}

function desktopKeyEvent(value) {
  const raw = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_+ -]{1,80}$/.test(raw)) throw new Error("Desktop key is invalid");
  const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) throw new Error("Desktop key is invalid");
  const aliases = new Map([
    ["return", "Enter"],
    ["esc", "Escape"],
    ["space", "Space"],
    ["pgup", "PageUp"],
    ["pgdn", "PageDown"],
  ]);
  const modifiers = parts.map((part) => {
    const normalized = part.toLowerCase();
    if (normalized === "ctrl" || normalized === "control") return "control";
    if (normalized === "alt") return "alt";
    if (normalized === "shift") return "shift";
    if (["cmd", "command", "meta", "super"].includes(normalized)) return "meta";
    throw new Error("Desktop key modifier is invalid");
  });
  return { keyCode: aliases.get(key.toLowerCase()) ?? key, modifiers };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createDesktopWorkspaceManager({ owner, createView, notify, partitionPrefix }) {
  if (!owner || owner.isDestroyed?.()) throw new Error("The OpenMausBot window is unavailable");
  if (createView?.constructor !== Function) throw new Error("The desktop workspace viewer is unavailable");
  const emit = notify?.constructor === Function ? notify : () => {};
  const entries = new Map();
  let partitionCounter = 0;
  let interactiveOperation = Promise.resolve();

  const serializeInteractiveChange = (operation) => {
    const pending = interactiveOperation.catch(() => {}).then(operation);
    // A failed reload must fail its caller without poisoning later demotions.
    interactiveOperation = pending.catch(() => {});
    return pending;
  };

  const stateFor = (entry, status, code) => {
    const state = {
      contextId: entry.contextId,
      open: status !== "closed",
      status,
      interactive: entry.interactive,
    };
    if (code) state.code = code;
    return state;
  };

  const removeEntry = (entry, status = "closed", code) => {
    if (entries.get(entry.contextId) !== entry) {
      return entry.terminalState ?? stateFor(entry, status, code);
    }
    entries.delete(entry.contextId);
    try {
      entry.view.setVisible(false);
    } catch {}
    try {
      owner.contentView.removeChildView(entry.view);
    } catch {}
    try {
      if (!entry.view.webContents.isDestroyed()) {
        entry.view.webContents.close({ waitForBeforeUnload: false });
      }
    } catch {}
    const terminalState = stateFor(entry, status, code);
    entry.terminalState = terminalState;
    emit(terminalState);
    return terminalState;
  };

  const secureView = (entry, viewerOrigin) => {
    const contents = entry.view.webContents;
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    contents.setWindowOpenHandler(() => ({ action: "deny" }));

    const keepOnOrigin = (event, target) => {
      if (sameDesktopViewerOrigin(target, viewerOrigin)) return;
      event.preventDefault();
    };
    contents.on("will-navigate", keepOnOrigin);
    contents.on("will-redirect", keepOnOrigin);
    contents.on("did-fail-load", (_event, code, _description, _failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3 || entries.get(entry.contextId) !== entry) return;
      removeEntry(entry, "error", "load-failed");
    });
    contents.on("render-process-gone", () => {
      if (entries.get(entry.contextId) === entry) removeEntry(entry, "error", "renderer-gone");
    });
  };

  const loadMode = async (entry, interactive) => {
    try {
      const current = entry.view.webContents.getURL();
      const next = desktopWorkspaceUrl(current, interactive, entry.remotePreview);
      entry.interactive = interactive;
      emit(stateFor(entry, "opening"));
      await entry.view.webContents.loadURL(next.toString());
    } catch {
      // A failed demotion must never leave an old interactive noVNC document
      // receiving input. Remove the native view entirely and fail closed.
      removeEntry(entry, "error", "load-failed");
      throw new Error("The Local VM desktop did not load");
    }
    if (entries.get(entry.contextId) === entry) emit(stateFor(entry, "ready"));
  };

  return {
    async ensureOpen(input) {
      if (Object.prototype.toString.call(input) !== "[object Object]") {
        throw new Error("Desktop workspace input is invalid");
      }
      const contextId = desktopWorkspaceContextId(input.contextId);
      const existing = entries.get(contextId);
      if (existing) {
        const requested = desktopWorkspaceUrl(input.url, false, existing.remotePreview);
        if (existing.identity === desktopWorkspaceIdentity(requested)) {
          return stateFor(existing, "ready");
        }
        removeEntry(existing);
      }
      if (contextId.startsWith("ruijie-preview:")) {
        // The provider pool exposes one active VNC desktop at a time. A task
        // may start after the user viewed another bot's card, so replace that
        // stale hidden preview instead of rejecting the task's first frame.
        for (const entry of [...entries.values()]) {
          if (entry.remotePreview) removeEntry(entry);
        }
      }
      return this.open(input);
    },

    async open(input) {
      if (Object.prototype.toString.call(input) !== "[object Object]") {
        throw new Error("Desktop workspace input is invalid");
      }
      const contextId = desktopWorkspaceContextId(input.contextId);
      if (entries.has(contextId)) throw new Error("That desktop workspace slot is already open");
      const remotePreview = contextId.startsWith("ruijie-preview:");
      const localEntries = [...entries.values()].filter((entry) => !entry.remotePreview).length;
      const remoteEntries = [...entries.values()].filter((entry) => entry.remotePreview).length;
      if ((!remotePreview && localEntries >= MAX_WORKSPACE_VIEWS) || (remotePreview && remoteEntries >= 1)) {
        throw new Error("Only two Local VM desktops can be open together");
      }

      // Ruijie's proxy does not reliably survive a second noVNC page load
      // that flips view_only. Its native view is never shown in the preview
      // card and renderer IPC exposes no action method, so connect this hidden
      // page input-capable from the start; the loopback capability and the
      // server's Take Control lease remain the actual input gates.
      const url = desktopWorkspaceUrl(input.url, remotePreview, remotePreview);
      const identity = desktopWorkspaceIdentity(url);
      if ([...entries.values()].some((entry) => entry.identity === identity)) {
        throw new Error("That Local VM desktop is already open");
      }
      const bounds = normalizeDesktopWorkspaceBounds(input.bounds, owner.getContentSize());
      const partition = `${partitionPrefix}-${++partitionCounter}`;
      const view = createView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          backgroundThrottling: false,
          offscreen: remotePreview,
          // No persist: prefix: each pane receives a private in-memory session.
          partition,
        },
      });
      const entry = { contextId, view, identity, interactive: remotePreview, remotePreview };
      entries.set(contextId, entry);
      secureView(entry, url.origin);
      view.webContents.setUserAgent(DESKTOP_VIEWER_USER_AGENT);
      view.setBounds(bounds);
      // The renderer explicitly lays the view out after the DOM rectangle is
      // stable. Keeping it hidden here also prevents a native view from
      // flashing above a modal during setup.
      // Ruijie previews use Chromium's offscreen renderer, so they continue
      // painting while the native view stays hidden behind the preview image.
      view.setVisible(false);
      owner.contentView.addChildView(view);
      emit(stateFor(entry, "opening"));
      try {
        await view.webContents.loadURL(url.toString());
      } catch {
        removeEntry(entry, "error", "load-failed");
        throw new Error("The Local VM desktop did not load");
      }
      if (entries.get(contextId) === entry) {
        const readyState = stateFor(entry, "ready");
        emit(readyState);
        return readyState;
      }
      return entry.terminalState ?? stateFor(entry, "closed");
    },

    layout(items) {
      if (!Array.isArray(items) || items.length > MAX_WORKSPACE_VIEWS) {
        throw new Error("Desktop workspace layout is invalid");
      }
      const seen = new Set();
      for (const item of items) {
        if (Object.prototype.toString.call(item) !== "[object Object]") {
          throw new Error("Desktop workspace layout is invalid");
        }
        const contextId = desktopWorkspaceContextId(item.contextId);
        if (seen.has(contextId)) throw new Error("Desktop workspace layout contains a duplicate slot");
        seen.add(contextId);
        const entry = entries.get(contextId);
        if (!entry) throw new Error("That desktop workspace slot is not open");
        const bounds = normalizeDesktopWorkspaceBounds(item.bounds, owner.getContentSize());
        entry.view.setBounds(bounds);
        entry.view.setVisible(item.visible === true);
      }
      return true;
    },

    async capture(rawContextId) {
      const contextId = desktopWorkspaceContextId(rawContextId);
      const entry = entries.get(contextId);
      if (!entry) throw new Error("That desktop workspace slot is not open");
      let image = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        image = await entry.view.webContents.capturePage();
        if (image && !image.isEmpty?.()) break;
        if (attempt < 19) await wait(500);
      }
      if (!image || image.isEmpty?.()) throw new Error("The desktop preview has no frame yet");
      const size = image.getSize();
      const normalized = size.width > 960 ? image.resize({ width: 960 }) : image;
      const frameSize = normalized.getSize();
      entry.lastFrameSize = frameSize;
      return {
        png: normalized.toPNG().toString("base64"),
        mime: "image/png",
      };
    },

    async setAgentInput(rawContextId) {
      const contextId = desktopWorkspaceContextId(rawContextId);
      const entry = entries.get(contextId);
      if (!entry || !entry.remotePreview) throw new Error("That remote desktop is not open");
      if (!entry.interactive) await loadMode(entry, true);
      return true;
    },

    async act(rawContextId, action, input = {}) {
      const contextId = desktopWorkspaceContextId(rawContextId);
      const entry = entries.get(contextId);
      if (!entry || !entry.remotePreview) throw new Error("That remote desktop is not open");
      const contents = entry.view.webContents;
      const bounds = entry.view.getBounds();
      const frameSize = entry.lastFrameSize ?? { width: bounds.width, height: bounds.height };
      const scalePoint = (value, axis) => {
        const frameLimit = axis === "x" ? frameSize.width : frameSize.height;
        const viewLimit = axis === "x" ? bounds.width : bounds.height;
        return Math.min(viewLimit - 1, Math.round(desktopInputPoint(value, frameLimit, axis) * viewLimit / frameLimit));
      };
      if (action === "click") {
        const x = scalePoint(input.x, "x");
        const y = scalePoint(input.y, "y");
        const button = input.button === "right" ? "right" : "left";
        const count = input.double === true ? 2 : 1;
        contents.sendInputEvent({ type: "mouseMove", x, y });
        for (let index = 1; index <= count; index += 1) {
          contents.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: index });
          contents.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: index });
        }
      } else if (action === "type") {
        const text = String(input.text ?? "");
        if (!text || text.length > 20_000) throw new Error("Desktop text is empty or too long");
        for (const character of text) contents.sendInputEvent({ type: "char", keyCode: character });
      } else if (action === "key") {
        const { keyCode, modifiers } = desktopKeyEvent(input.key);
        contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
        contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      } else if (action === "scroll") {
        const x = input.x == null ? Math.floor(bounds.width / 2) : scalePoint(input.x, "x");
        const y = input.y == null ? Math.floor(bounds.height / 2) : scalePoint(input.y, "y");
        const deltaY = Math.max(-1200, Math.min(1200, Math.round(Number(input.deltaY) || 0)));
        if (!deltaY) throw new Error("Desktop scroll amount is required");
        contents.sendInputEvent({ type: "mouseWheel", x, y, deltaY });
      } else {
        throw new Error("Desktop action is unsupported");
      }
      await wait(Math.min(Math.max(Number(input.settleMs) || 350, 0), 3000));
      return this.capture(contextId);
    },

    setInteractive(rawContextId) {
      const contextId = rawContextId == null ? null : desktopWorkspaceContextId(rawContextId);
      const targetEntry = contextId === null ? null : entries.get(contextId);
      if (contextId !== null && !targetEntry) {
        return Promise.reject(new Error("That desktop workspace slot is not open"));
      }
      return serializeInteractiveChange(async () => {
        if (targetEntry && entries.get(contextId) !== targetEntry) {
          throw new Error("That desktop workspace slot is not open");
        }
        // Always finish every demotion before promoting. The queue is part of
        // this invariant: overlapping renderer IPC calls cannot observe a flag
        // change while the old interactive noVNC document is still reloading.
        for (const entry of entries.values()) {
          if (
            entries.get(entry.contextId) === entry &&
            entry.interactive &&
            entry.contextId !== contextId
          ) {
            await loadMode(entry, false);
          }
        }
        if (targetEntry && !targetEntry.interactive) {
          await loadMode(targetEntry, true);
        }
        return true;
      });
    },

    close(rawContextId) {
      if (rawContextId == null) {
        for (const entry of entries.values()) removeEntry(entry);
        return true;
      }
      const contextId = desktopWorkspaceContextId(rawContextId);
      const entry = entries.get(contextId);
      if (entry) removeEntry(entry);
      return true;
    },

    closeAll() {
      for (const entry of entries.values()) removeEntry(entry);
    },

    size() {
      return entries.size;
    },
  };
}

module.exports = {
  MAX_WORKSPACE_VIEWS,
  createDesktopWorkspaceManager,
  desktopWorkspaceContextId,
  desktopWorkspaceUrl,
  normalizeDesktopWorkspaceBounds,
};
