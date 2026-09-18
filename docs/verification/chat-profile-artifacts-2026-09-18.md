# Chat profile and artifact patches — 2026-09-18

The sidebar now keeps the bot name and conversation preview without a separate
role/title line above the name. The role remains available in bot settings.

An explicit user request such as “你叫照片bot，负责帮我找公开照片” can now call
`update_profile` to persist the bot's own name, title, description and standing
instructions immediately. Saving updates the store, SOUL mirror, live UI and
profile history. A name-only update preserves other fields and their history.
The setup prompt follows the same rule. Suggestions, another bot's profile and
working-folder changes continue through `propose_profile`. Turn capability,
sender/thread ownership and unattended/peer-turn checks protect the direct route.

Bot-authored remote images load inline, with full-image thumbnails, enlargement,
retry and an original-source link. Local Markdown file links offer an in-app
preview for supported images, PDF, HTML and text, plus download. Other formats
retain download. Local files still pass the exact message's authorization and
workspace containment checks. HTML previews run without scripts. Website clicks
use the desktop browser bridge with visible failure feedback. Output guidance
asks models to link real files in the current workspace and actual image URLs.

## Evidence

Commands run from the repository:

```powershell
corepack pnpm typecheck
corepack pnpm exec vitest run server/profile-requests.test.ts server/setup-mode.test.ts server/drivers/agents-proxy.test.ts server/message-file.test.ts src/components/AttachmentPreview.test.ts src/components/ChatMarkdown.test.ts src/components/SidebarBotListItem.test.ts server/system-prompt.test.ts
corepack pnpm exec vitest run server/index.test.ts -t 'user-requested identity|proposed profile change'
corepack pnpm exec vitest run server/index.test.ts -t 'downloads only a file|downloads an image rendered|streams an authorized message|downloads an exact user attachment'
node --experimental-strip-types scripts/verify-chat-profile-artifacts.ts
node scripts/prepare-local-preview.mjs
```

- Typecheck passed; lint of changed files passed.
- Eight focused suites: **208 tests passed**. Real HTTP fixture: **6 tests passed**.
- The desktop fixture uses a disposable home and a scripted provider that calls
  the real injected MCP proxy. The actual composer sends the Chinese identity
  request; the profile is persisted without a card. Reload and a second turn
  verify that the new standing instructions reach the provider.
- Chromium verifies both remote and local images decode, enlargement/Escape,
  text/HTML previews, script isolation, and website handoff through the bridge.
- Local evidence: `.omb-scratch/verify-evidence/chat-profile-artifacts/` contains
  `workflow.json`, `mcp-evidence.jsonl`, `ui.json` and screenshots. The fixture
  log path is recorded there. Fixture server and temporary home are cleaned up.
- Screenshot review caught and corrected the preview's dark-theme background.
- Local development app rebuilt and reopened through its existing launcher.
  Read-only inspection of the new process confirmed the compiled UI asset,
  zero redundant title rows, the direct-profile instruction and artifact-output
  guidance. The 14 existing bots remained present and idle. Build hashes and
  runtime checks are in `live-readonly.json`; live conversations were not used
  for mutation tests.
- The Windows containment fixture now uses a directory junction to exercise
  the same realpath boundary without requiring elevated file-symlink privileges.

Full-repository lint reports 11 existing warnings in unrelated files, including
the pre-existing `scripts/debug` files; they were not changed for this patch.

This verifies the application/tool workflow with a scripted provider, not the
semantic reliability or response time of every live model. Remote URLs must
remain reachable, and local output files must still exist inside the authorized
workspace. PDF preview is implemented through Chromium's viewer; the automated
desktop recipe covers images, text and HTML, not PDF or Office rendering.
This change does not alter Vega/Comet scheduling or MCP timeout behavior.
