const TAKEOVER_MOUSE_INPUTS = new Set(["mouseDown", "mouseWheel"]);
const TAKEOVER_KEYBOARD_INPUTS = new Set(["keyDown", "char"]);

/** Viewing, focusing, maximizing and moving the pointer are observational.
 * Only an input which can mutate the remote desktop asks the server to pause
 * the bot. */
export function desktopViewerInputTakesControl(input) {
  if (!input || typeof input !== "object") return false;
  if (input.source === "mouse") return TAKEOVER_MOUSE_INPUTS.has(input.type);
  if (input.source === "keyboard") return TAKEOVER_KEYBOARD_INPUTS.has(input.type);
  return false;
}

/** Coalesce the burst around one physical click/key into one lease request. */
export function createDesktopViewerTakeoverNotifier(send, contextId) {
  let sent = false;
  return (input) => {
    if (sent || !contextId || !desktopViewerInputTakesControl(input)) return false;
    sent = true;
    send({ contextId });
    return true;
  };
}
