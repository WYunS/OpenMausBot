import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { readSessionState, takePairingCodeFromLocation } from "./lib/session";
import { bootstrapBrand } from "./lib/brand";
import { applySkin, readSkin } from "./lib/skins";
import { claimRendererRoot } from "./lib/renderer-root";
import { PairPage } from "./pair/PairPage";
import "./styles.css";

// Before the first paint, not inside a component: stamping the skin during
// render would show one frame of the default palette first. The brand (window
// title, accent) is fetched the same way so a white-labelled deployment never
// flashes the default name; it waits at most a moment and falls back silently.
applySkin(readSkin());

/** A pairing link lands on /pair. A remote browser without a session lands
 * there too, because every API call would otherwise fail with "pair this
 * device"; on the owner's own machine the server trusts loopback and this
 * check is a single fast request. */
async function chooseRoot(): Promise<React.ReactNode> {
  if (location.pathname === "/pair") return <PairPage initialCode={takePairingCodeFromLocation()} />;
  const session = await readSessionState();
  if (session.kind === "unauthenticated") return <PairPage initialCode={null} reason={session.error} />;
  return <App />;
}

const { root, dispose: disposeRoot } = claimRendererRoot(
  document.getElementById("root")!,
  createRoot,
);
let disposed = false;

// Vite can re-evaluate this entry module when one of its bootstrap imports
// changes. Without disposing the old root, every edit leaves another complete
// App mounted in the same container: dialogs appear to reopen, and background
// effects (desktop/browser/session sync) run once per leaked root.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    disposeRoot();
  });
}

void Promise.all([bootstrapBrand(), chooseRoot()]).then(([, view]) => {
  // A slow bootstrap may finish after a newer HMR generation has replaced it.
  if (!disposed) root.render(<StrictMode>{view}</StrictMode>);
});
