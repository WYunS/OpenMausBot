import { describe, expect, it } from "vitest";

import englishCatalog from "../src/locales/en.json" with { type: "json" };
import { HELD_NOTE, approvalHeldNote, approvalHeldReason, approvalModeForOrigin, autoVerdict } from "./auto-approve.ts";

describe("autoVerdict", () => {
  it("answers only for Full access, and then answers everything", () => {
    expect(autoVerdict("full", "Bash")).toEqual({ approve: "approved Bash (full access)", source: "full-access" });
    expect(autoVerdict("full", "Bash", { requiresExplicitApproval: true })).toEqual({
      approve: "approved Bash (full access)", source: "full-access",
    });
  });

  it("leaves Auto and Custom requests with the person", () => {
    expect(autoVerdict("auto", "Bash")).toEqual({ approve: null, source: "native-approval" });
    expect(autoVerdict("custom", "Bash")).toEqual({ approve: null, source: "native-approval" });
  });

  it("does not judge actions in Ask or Edits", () => {
    for (const summary of ["wc -l notes.md", "rm -rf build", "cat ~/.ssh/id_rsa"]) {
      expect(autoVerdict("ask", summary)).toEqual({ approve: null, source: "no-grant" });
      expect(autoVerdict("edits", summary)).toEqual({ approve: null, source: "no-grant" });
    }
  });

  it("holds sandbox widening in every mode but Full", () => {
    for (const mode of ["ask", "edits", "auto", "custom"] as const) {
      expect(autoVerdict(mode, "shell", { requiresExplicitApproval: true }))
        .toEqual({ approve: null, source: "explicit-approval-block" });
    }
  });
});

describe("approvalModeForOrigin", () => {
  it("runs peer-started Custom turns as Auto and leaves other modes alone", () => {
    expect(approvalModeForOrigin("custom", { peerInitiated: true })).toBe("auto");
    expect(approvalModeForOrigin("custom", { peerInitiated: false })).toBe("custom");
    for (const mode of ["ask", "edits", "auto", "full"] as const) {
      expect(approvalModeForOrigin(mode, { peerInitiated: true })).toBe(mode);
    }
  });
});

describe("held notes", () => {
  it("explains provider requests and sandbox changes", () => {
    expect(approvalHeldNote({ source: "native-approval", permission: true })).toBe("approval.held.native");
    expect(approvalHeldNote({ source: "explicit-approval-block", permission: true })).toBe("approval.held.sandbox");
    expect(approvalHeldNote({ source: "no-grant", permission: true })).toBeUndefined();
    expect(approvalHeldNote({ source: "native-approval", permission: false })).toBeUndefined();
    expect(approvalHeldReason({ source: "native-approval", permission: true }))
      .toBe("The provider requires your approval for this action.");
  });

  it("has a catalog entry for every note", () => {
    for (const [key, value] of Object.entries(HELD_NOTE)) {
      expect(englishCatalog[key as keyof typeof englishCatalog], key).toBe(value);
    }
  });
});
