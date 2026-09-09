import assert from "node:assert/strict";
import { test } from "node:test";

import authModule from "./desktop-server-auth.cjs";

const { DESKTOP_MUTATION_HEADER, desktopServerHeaders, isDesktopMutationTarget } = authModule;
const TOKEN = "a".repeat(43);

test("adds the owner capability to packaged main-process mutations", () => {
  assert.deepEqual(desktopServerHeaders(
    { "content-type": "application/json" },
    { packaged: true, token: TOKEN },
  ), {
    "content-type": "application/json",
    [DESKTOP_MUTATION_HEADER]: TOKEN,
  });
});

test("leaves development requests unchanged and rejects bad packaged tokens", () => {
  assert.deepEqual(desktopServerHeaders({ accept: "application/json" }, {
    packaged: false,
    token: "",
  }), { accept: "application/json" });
  assert.throws(() => desktopServerHeaders({}, { packaged: true, token: "short" }), /invalid/);
});

test("adds the desktop capability to API calls passing through the source Vite proxy", () => {
  const options = { serverPort: 38799, developmentUrl: "http://127.0.0.1:5199" };
  assert.equal(isDesktopMutationTarget("http://127.0.0.1:38799/api/config", options), true);
  assert.equal(isDesktopMutationTarget("http://127.0.0.1:5199/api/connectors/gmail/authorize", options), true);
  assert.equal(isDesktopMutationTarget("http://127.0.0.1:5199/src/main.tsx", options), false);
  assert.equal(isDesktopMutationTarget("https://example.com/api/connectors/gmail/authorize", options), false);
});
