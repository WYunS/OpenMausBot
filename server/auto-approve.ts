// What the harness does with a provider's permission request.
//
// Nothing here decides whether an action is safe. Each approval level is a
// provider's own permission mode passed straight through, and a request that
// reaches this process is one the provider left for a person. The only
// verdict the app synthesizes is Full access, because that level is the
// person's explicit, separately confirmed grant to answer every prompt.
// Questions never come through here: a bot's question always reaches a human.

import { type ApprovalMode } from "../shared/approval-mode.ts";

/** Full access is the person's explicit grant to this receiving bot, including
 * delegated work. It never inherits the sender's mode or elevates another bot.
 * Custom is a provider-config choice rather than an app Full-access grant, so
 * peer-started Custom turns use Auto. Provider support and grant confirmation
 * are checked by the caller. */
export function approvalModeForOrigin(mode: ApprovalMode, origin: { peerInitiated: boolean }): ApprovalMode {
  if (mode === "custom" && origin.peerInitiated) return "auto";
  return mode;
}

export type AutoVerdictSource =
  | "full-access"
  | "native-approval"
  | "explicit-approval-block"
  | "no-grant";

export interface AutoVerdict {
  approve: string | null;
  source: AutoVerdictSource;
}

export function autoVerdict(
  mode: ApprovalMode,
  tool: string,
  context?: { requiresExplicitApproval?: boolean },
): AutoVerdict {
  if (mode === "full") return { approve: `approved ${tool} (full access)`, source: "full-access" };
  if (context?.requiresExplicitApproval) return { approve: null, source: "explicit-approval-block" };
  if (mode === "auto" || mode === "custom") return { approve: null, source: "native-approval" };
  return { approve: null, source: "no-grant" };
}

export const HELD_NOTE = {
  "approval.held.native": "The provider requires your approval for this action.",
  "approval.held.sandbox":
    "This changes the provider sandbox, so only Full access can approve it automatically.",
  "approval.held.undeliveredFull": "Full access couldn't deliver this approval.",
  "approval.held.undelivered": "Approve for me couldn't answer this one.",
} as const;

export type HeldNoteKey = keyof typeof HELD_NOTE;

export function approvalHeldNote(context: {
  source?: AutoVerdictSource;
  permission: boolean;
}): HeldNoteKey | undefined {
  if (!context.permission) return undefined;
  if (context.source === "explicit-approval-block") return "approval.held.sandbox";
  if (context.source === "native-approval") return "approval.held.native";
  return undefined;
}

export function approvalHeldReason(context: {
  source?: AutoVerdictSource;
  permission: boolean;
}): string | undefined {
  const key = approvalHeldNote(context);
  return key && HELD_NOTE[key];
}
