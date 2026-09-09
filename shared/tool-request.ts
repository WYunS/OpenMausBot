/**
 * The first two rungs of the tool ladder: use what is connected, or connect
 * what the catalog has. See `docs/plans/tool-ladder.md`.
 *
 * A bot that needs a tool it does not have says so in a CAPABILITY — "calendar",
 * "email", "spreadsheet" — never a vendor and never a slug. The harness turns
 * that into the apps it can actually connect, because a model-authored list can
 * name a provider that does not exist or that we have no way to authorize, and
 * a person cannot tell those apart from a real one until they have clicked it.
 *
 * So: the model owns the capability, the harness owns the slugs.
 */

/** Nobody reads past six, and a long list makes the choice feel like work. */
export const MAX_CANDIDATES = 6;
/** Free text on the naming step. Long enough for "Work (billing)". */
export const MAX_ACCOUNT_NAME = 60;

/** One app the user could pick, as the card shows it. */
export interface ToolCandidate {
  slug: string;
  label: string;
  blurb: string;
  logo?: string | null;
  domain?: string | null;
  /** Already connected. Shown as such, and picking it needs no sign-in. */
  connected?: boolean;
}

/** What the card is waiting on. */
export type ToolRequestStep = "choose" | "name";

/** How it ended, once it has. */
export type ToolRequestOutcome =
  /** handed to the connector card — sign-in is running */
  | "connecting"
  /** the chosen app was already connected; the job just carried on */
  | "ready"
  /** "I'll connect it later" */
  | "later"
  /** the catalog had nothing for this capability */
  | "none"
  /** …and the user asked the bot to go and look for one (rung 3) */
  | "searching";

export interface ToolRequestCardData {
  version: 1;
  /** The bot's own words for what it needs. Never a slug. */
  capability: string;
  /** Why it needs it, if it said. */
  reason?: string;
  candidates: ToolCandidate[];
  step: ToolRequestStep;
  /** The slug picked on the choose step. */
  chosen?: string;
  settled?: ToolRequestOutcome;
}

/**
 * Words that mean the same capability to a person and different things to a
 * catalog. Deliberately small and hand-written: a big generated ontology would
 * be worse, because every wrong entry here shows up as an app the user is
 * offered for a job it cannot do.
 */
const SYNONYMS: Record<string, readonly string[]> = {
  calendar: ["calendar", "event", "scheduling", "meeting"],
  event: ["calendar", "event"],
  meeting: ["calendar", "meeting", "conferencing"],
  email: ["email", "mail", "inbox"],
  mail: ["email", "mail", "inbox"],
  inbox: ["email", "mail", "inbox"],
  spreadsheet: ["spreadsheet", "sheet", "excel"],
  sheet: ["spreadsheet", "sheet", "excel"],
  document: ["document", "doc", "word"],
  doc: ["document", "doc"],
  note: ["note", "page", "wiki"],
  chat: ["chat", "message", "channel"],
  message: ["chat", "message", "channel"],
  messaging: ["chat", "message", "channel"],
  issue: ["issue", "ticket", "project", "task"],
  ticket: ["issue", "ticket", "support"],
  project: ["project", "issue", "task"],
  crm: ["crm", "contact", "deal", "lead"],
  file: ["file", "drive", "storage"],
  storage: ["file", "drive", "storage"],
  payment: ["payment", "invoice", "billing"],
  invoice: ["invoice", "billing", "payment"],
  design: ["design", "prototype"],
  code: ["code", "repository", "git"],
  repository: ["code", "repository", "git"],
  analytics: ["analytics", "metric", "event"],
};

/** Split into lowercase word tokens; punctuation and case are noise here. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Naive de-pluralization. "calendars" and "calendar" are the same ask. */
function singular(word: string): string {
  if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es") && !word.endsWith("ses")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Every term worth searching for, from what the bot actually said. */
export function searchTerms(capability: string): string[] {
  const out = new Set<string>();
  for (const raw of tokens(capability)) {
    const word = singular(raw);
    // Single letters and "the"-class words match everything and mean nothing.
    if (word.length < 3) continue;
    out.add(word);
    for (const term of SYNONYMS[word] ?? []) out.add(term);
  }
  return [...out];
}

/**
 * How well one app answers the capability.
 *
 * The tiers matter more than the numbers: a name match is evidence, a blurb
 * match is a hint. Ranking them the same is how "calendar" ends up offering
 * six apps that merely mention calendars in their description.
 */
function score(candidate: ToolCandidate, terms: readonly string[]): number {
  if (!terms.length) return 0;
  const label = tokens(candidate.label).map(singular);
  const slug = candidate.slug.toLowerCase();
  const blurb = tokens(candidate.blurb ?? "").map(singular);
  let total = 0;
  for (const term of terms) {
    if (label.includes(term) || slug === term) total += 6;
    else if (slug.includes(term)) total += 4;
    else if (candidate.label.toLowerCase().includes(term)) total += 3;
    else {
      // Within a blurb, WHERE the word appears is the only signal left, and
      // it is a real one: these descriptions lead with what the app is for.
      // Outlook's "Email, calendar and contacts" opens with it; HubSpot's
      // "CRM with deals, contacts and a calendar view" mentions it in
      // passing. Without this they tie, and a CRM is offered as a calendar.
      const at = blurb.indexOf(term);
      if (at >= 0) total += at < 4 ? 2 : 1;
    }
  }
  return total;
}

/**
 * The weakest evidence worth offering someone.
 *
 * One late mention in a blurb scores 1, and that is not enough on its own:
 * "veterinary records" matched Airtable and Salesforce that way, because a
 * database does hold records. Offering the wrong app costs a real sign-in and
 * leaves the person worse off than being told we have nothing — and being told
 * is what the next rung of the ladder is for.
 */
const MIN_SCORE = 2;

/**
 * The apps to offer for a capability, best first.
 *
 * Already-connected apps are surfaced ahead of the rest at equal evidence:
 * the best answer to "I need a calendar" is usually the calendar you already
 * connected, and offering to connect a second one first reads as a bug.
 */
export function matchToolkits(
  capability: string,
  catalog: readonly ToolCandidate[],
  options: { connected?: ReadonlySet<string>; limit?: number } = {},
): ToolCandidate[] {
  const terms = searchTerms(capability);
  const connected = options.connected ?? new Set<string>();
  const limit = options.limit ?? MAX_CANDIDATES;
  const scored = catalog
    .map((candidate) => ({
      candidate: connected.has(candidate.slug) ? { ...candidate, connected: true } : candidate,
      score: score(candidate, terms),
    }))
    .filter((row) => row.score >= MIN_SCORE);
  scored.sort((a, b) => {
    const connectedGap = Number(b.candidate.connected ?? false) - Number(a.candidate.connected ?? false);
    if (connectedGap) return connectedGap;
    if (b.score !== a.score) return b.score - a.score;
    // A stable last resort, so the same catalog always offers the same order.
    return a.candidate.label.localeCompare(b.candidate.label);
  });
  return scored.slice(0, limit).map((row) => row.candidate);
}

/** The name the account is saved under when the user accepts the suggestion. */
export function defaultAccountName(candidates: readonly ToolCandidate[], chosen: string): string {
  return candidates.find((candidate) => candidate.slug === chosen)?.label ?? "";
}
