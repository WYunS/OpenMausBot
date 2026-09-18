# Windows Markdown image paths — 2026-09-18

The user's two image replies rendered a bare red `Image unavailable` before
any image request was issued. The original PNGs existed and were valid images
(1080×719 and 1624×1080), under their conversation's pinned workspace.

The stored Markdown used absolute Windows paths with backslashes. CommonMark
consumed the `\.` separator before `.openmausbot` as a punctuation escape,
joining the user directory and hidden directory. The HTML conversion then
encoded remaining backslashes as `%5C`, so the renderer's Windows path detector
did not recognize the drive path and the protocol filter erased the image URL.

`shared/markdown-windows-paths.ts` now restores portable separators from the
exact source span of an already-parsed Windows link, image or definition. Only
the destination is adopted; labels, titles and Markdown source offsets remain
unchanged. Rendering and message-scoped file authorization use the same rule.
Code blocks and prose do not grant file access, and workspace realpath checks
remain enforced. Stored conversation text is not rewritten.

## Reproduction and validation

Before the fix, the focused tests reproduced the user's red image text, a lost
separator before the hidden directory, and failed path authorization:

```powershell
corepack pnpm exec vitest run src/components/ChatMarkdown.test.ts server/message-file.test.ts -t 'Windows backslash image|Windows separators'
```

After the fix:

- The two full suites passed: 62 tests, including reference images with spaces
  and parentheses, preserved labels/source offsets, and no access via code fences.
- Four real-server message-file API tests passed.
- Typecheck and lint of changed files passed.
- `node --experimental-strip-types scripts/verify-chat-profile-artifacts.ts`
  launched the isolated server and real renderer. Its generated reply now uses
  an absolute Windows backslash path, hidden directory, and Chinese filename.
  Both inline display and a file-link POST preview decoded successfully.
- Read-only replay of the user's two original message image references resolved
  and opened both files through the unchanged workspace containment check.

Evidence is retained locally in
`.omb-scratch/verify-evidence/image-url-repair/` and
`.omb-scratch/verify-evidence/chat-profile-artifacts/`. The former contains
the original message/DOM capture and original-file validation; the latter has
fixture workflow/tool receipts and screenshots. The first patch's fixture only
used a relative ASCII image path and therefore missed this Windows-specific bug.
