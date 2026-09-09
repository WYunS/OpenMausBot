import { describe, expect, it } from "vitest";

import {
  consequenceLine,
  executableFingerprint,
  proposalError,
  reviewedProposalSha256,
  type ToolProposalCardData,
} from "./tool-proposal";

const proposal = (patch: Partial<ToolProposalCardData> = {}): ToolProposalCardData => ({
  version: 1,
  capability: "calendar",
  kind: "mcp",
  label: "Fastmail Calendar MCP",
  summary: "Read and create events on a Fastmail calendar.",
  packageId: "@example/fastmail-calendar-mcp",
  packageVersion: "1.4.2",
  publisher: "example",
  homepage: "https://example.com/fastmail-mcp",
  command: "npx",
  args: ["-y", "@example/fastmail-calendar-mcp@1.4.2"],
  envNames: ["FASTMAIL_TOKEN"],
  sources: [{ url: "https://www.npmjs.com/package/@example/fastmail-calendar-mcp", note: "package page" }],
  ...patch,
});

describe("proposalError", () => {
  it("accepts a proposal a person could actually check", () => {
    expect(proposalError(proposal())).toBeNull();
  });

  it("refuses a version range — the approval was for what was on screen", () => {
    // "^1.4.2" can become a different program tomorrow, under the same click.
    for (const packageVersion of ["^1.4.2", "~1.4", "1.x", "latest", ""]) {
      expect(proposalError(proposal({ packageVersion }))).toMatch(/exact version/);
    }
  });

  it("refuses a proposal with nothing to check", () => {
    expect(proposalError(proposal({ sources: [] }))).toMatch(/source/);
    // "the model said so" is not a source anyone can open
    expect(proposalError(proposal({ sources: [{ url: "trust me" }] }))).toMatch(/https/);
    expect(proposalError(proposal({ sources: [{ url: "http://example.com" }] }))).toMatch(/https/);
  });

  it("refuses one that does not say what it is or what would run", () => {
    expect(proposalError(proposal({ label: "  " }))).toMatch(/name/);
    expect(proposalError(proposal({ packageId: "" }))).toMatch(/package/);
    expect(proposalError(proposal({ command: "" }))).toMatch(/command/);
  });
});

describe("executableFingerprint", () => {
  it("changes when what runs changes", () => {
    const base = executableFingerprint(proposal());
    expect(executableFingerprint(proposal({ command: "node" }))).not.toBe(base);
    expect(executableFingerprint(proposal({ args: ["-y", "@example/other@1.4.2"] }))).not.toBe(base);
    expect(executableFingerprint(proposal({ packageVersion: "1.4.3" }))).not.toBe(base);
    expect(executableFingerprint(proposal({ envNames: ["FASTMAIL_TOKEN", "AWS_SECRET_ACCESS_KEY"] }))).not.toBe(base);
  });

  it("does not change when only the words around it change", () => {
    // Rewording the pitch must not invalidate an approval; changing the
    // program must. These are the two halves of the same rule.
    const base = executableFingerprint(proposal());
    expect(executableFingerprint(proposal({ summary: "totally different pitch" }))).toBe(base);
    expect(executableFingerprint(proposal({ sources: [{ url: "https://example.com/else" }] }))).toBe(base);
    expect(executableFingerprint(proposal({ label: "Renamed" }))).toBe(base);
  });

  it("reads the same environment whatever order it was listed in", () => {
    expect(executableFingerprint(proposal({ envNames: ["B", "A"] })))
      .toBe(executableFingerprint(proposal({ envNames: ["A", "B"] })));
  });
});

describe("reviewedProposalSha256", () => {
  it("only echoes a real hash, so an old card stays decline-only", () => {
    expect(reviewedProposalSha256(proposal({ sha256: "a".repeat(64) }))).toBe("a".repeat(64));
    expect(reviewedProposalSha256(proposal({ sha256: undefined }))).toBeUndefined();
    expect(reviewedProposalSha256(proposal({ sha256: "nope" }))).toBeUndefined();
  });
});

describe("consequenceLine", () => {
  it("names what approving does, not what it is called", () => {
    // The consent has to be about code running, because that is what happens.
    const line = consequenceLine(proposal());
    expect(line).toContain("npx -y @example/fastmail-calendar-mcp@1.4.2");
    expect(line).toContain("on this computer");
    expect(consequenceLine(proposal({ kind: "cli" }))).toContain("on this computer");
  });
});
