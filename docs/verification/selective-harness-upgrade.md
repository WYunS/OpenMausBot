# Selective v0.1.84 upgrade: offline acceptance

These fixtures verify the real Bot renderer/store and the real Bot HTTP server
with its real Ruijie Harness adapter. The native Harness service, model and
computer are **offline protocol fixtures**, not production systems. No live
account, desktop, user data or external app is modified.

## Server and transport

```powershell
node node_modules/vitest/vitest.mjs run server/selective-harness.e2e.test.ts server/drivers/ruijie-harness.test.ts
```

The server fixture owns a temporary HOME, config/database, loopback HTTP peer
and WebSocket `events.mux`. It uses the existing test-only Local VM boundary
replacement. It checks:

- A stalled turn remains busy beyond the old six-second cleanup grace. Another
  Bot cannot acquire the shared computer until the matching Harness terminal
  and `session.list` idle state are both confirmed. A fresh retry can then run.
- Explicit Off outranks host wording and mounts neither Bot computer nor browser
  MCP. The existing agents MCP remains mounted.
- Native multiple-question IDs, order, detail and options survive the actual
  event fold, HTTP response validation and durable card save. Flat multi-question
  answers fail with 400; transient receipt failure is retryable (502); a business
  option named Allow remains an answer, not a permission grant.
- Provider reload waits for the sidecar to stop instead of dropping its owner.

The driver regressions additionally check wrapped native history, missing
turn/start, old terminal events, repeated Stop, startup cancellation, and
computer-retry admission racing Stop. Unknown terminal/idle state retains
ownership rather than pretending the tool stopped.

The Bot approval selector does not currently expose Full for Harness: its native
permissions are managed by Harness. The real-server test uses Bot Auto; it does
not pretend to grant or verify native Full access.

## Headless renderer

Pass an explicitly reviewed, already-staged browser bundle (never a live profile):

```powershell
node --experimental-strip-types scripts/verify-selective-upgrade.ts --browser-bundle D:/ChatGPT/Bot/downloads/OpenMausBot-source/dist-native/browser/win32-x64
```

This launches a disposable `control-omb` server and real React/store preview.
Only question delivery receipts are intercepted. It checks full plan detail,
multi-select plus Other, Allow as business text, failed delivery recovery,
cancellation, screenshot zoom/Escape and unexpected console errors.
The native payload path is tested separately by the real-server fixture above.

Evidence is in `.omb-scratch/verify-evidence/selective-upgrade/`: UI `report.json`,
before/multiple/answered PNGs, and the server fixture's `server.log`. The UI report
also records its persistent temporary server log path. Each fixture stops only
the child and browser session it owns, and removes only its temporary home.

## Boundaries

These checks do not prove macOS native signing or final installer contents,
production SSO/refresh/quota behavior, real Lark operations, actual model-driven
computer actions, or every natural-language paraphrase. Package and live-service
acceptance remain separate. The tests do not enable shared computers, cloud
backup, log truncation, a USD spending cap, or a new permission mode.
