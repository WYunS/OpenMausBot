/**
 * Rung 3 of the tool ladder: something for this job exists in the world, and
 * the bot found it. See `docs/plans/tool-ladder.md`.
 *
 * This is the rung with teeth. "Search the web, find an MCP server, install
 * it" is mechanically a supply-chain attack: rank a malicious server for
 * "google calendar mcp" and you have code running on the user's computer,
 * holding whatever they connect to it. So the bot's job here ends at
 * PROPOSING. It never installs, never runs, and never writes a server.
 *
 * What makes the approval real rather than a formality:
 *
 *   - Provenance is on screen. The package, the exact version, who publishes
 *     it, and the pages the bot actually read to decide.
 *   - The consent names the consequence — this command will run on your
 *     computer — instead of asking whether to "add an integration".
 *   - The approval is bound to the exact command shown, by hash. A proposal
 *     that changes after it was displayed cannot be approved by a click on
 *     the old one.
 */

/** What kind of thing was found. Each runs differently, and a person should
 * be told which one they are agreeing to. */
export type ProposedToolKind = "mcp" | "cli";

export interface ToolProposalSource {
  /** What the bot read. Shown so the user can check its homework. */
  url: string;
  /** Why it mattered, in the bot's words. */
  note?: string;
}

export interface ToolProposalCardData {
  version: 1;
  /** The capability this answers — the same words the ladder started with. */
  capability: string;
  kind: ProposedToolKind;
  /** Human name: "Google Calendar MCP". */
  label: string;
  /** What it does, in the bot's words. */
  summary: string;
  /** Package or repository id, e.g. "@some/calendar-mcp". */
  packageId: string;
  /** Exact version. A range is not provenance. */
  packageVersion: string;
  /** Who publishes it, as the bot found it. Unverified by us, and labelled
   * that way on the card. */
  publisher?: string;
  homepage?: string;
  /** The command that will run if this is approved, exactly. */
  command: string;
  args: string[];
  /** Environment variable NAMES only. Values are never proposed by a model. */
  envNames?: string[];
  sources: ToolProposalSource[];
  /** Binds the approval to the command above. */
  sha256?: string;
  settled?: "approved" | "declined";
}

export const MAX_SOURCES = 6;
export const MAX_ARGS = 12;

/**
 * The fields an approval is actually agreeing to: what will run.
 *
 * Deliberately not the whole card. The summary and the sources can be
 * reworded without changing what executes; the command, its arguments, the
 * package version and the environment it reads cannot.
 */
export function executableFingerprint(proposal: ToolProposalCardData): string {
  return JSON.stringify([
    proposal.kind,
    proposal.packageId,
    proposal.packageVersion,
    proposal.command,
    proposal.args,
    [...(proposal.envNames ?? [])].sort(),
  ]);
}

/** The hash a current client echoes after it displayed the command. Old or
 * malformed cards deliberately return undefined and stay decline-only. */
export function reviewedProposalSha256(proposal: ToolProposalCardData): string | undefined {
  if (!proposal.sha256 || !/^[a-f0-9]{64}$/i.test(proposal.sha256)) return undefined;
  return proposal.sha256;
}

/** One line naming what approval actually does, for the card. */
export function consequenceLine(proposal: ToolProposalCardData): string {
  const runs = [proposal.command, ...proposal.args].join(" ");
  return proposal.kind === "mcp"
    ? `Approving runs ${runs} on this computer whenever the bot works, with access to whatever you connect to it.`
    : `Approving runs ${runs} on this computer when the bot uses it.`;
}

/** Reject a proposal that is not answerable, before anyone is shown it. */
export function proposalError(proposal: Partial<ToolProposalCardData>): string | null {
  if (!proposal.label?.trim()) return "a proposal needs a name";
  if (!proposal.packageId?.trim()) return "a proposal needs the package or repository it comes from";
  // A range is not provenance: "^1" can become a different program tomorrow,
  // and the approval was for what was on screen today.
  if (!proposal.packageVersion?.trim() || /[\^~*x]|latest/i.test(proposal.packageVersion)) {
    return "a proposal needs one exact version, not a range or \"latest\"";
  }
  if (!proposal.command?.trim()) return "a proposal needs the command that would run";
  if ((proposal.args?.length ?? 0) > MAX_ARGS) return `a proposal may pass at most ${MAX_ARGS} arguments`;
  // Without a source there is nothing to check, and "the model said so" is
  // not evidence anyone can act on.
  if (!proposal.sources?.length) return "a proposal needs at least one source the user can check";
  if (proposal.sources.some((source) => !/^https:\/\//i.test(source.url ?? ""))) {
    return "every source must be an https link";
  }
  return null;
}
