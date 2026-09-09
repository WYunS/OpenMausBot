import { describe, expect, it } from "vitest";

import {
  MAX_CANDIDATES,
  matchToolkits,
  searchTerms,
  type ToolCandidate,
} from "./tool-request";

/** A slice of the real catalog, blurbs included, because the blurbs are what
 * a careless matcher trips over. */
const CATALOG: ToolCandidate[] = [
  { slug: "googlecalendar", label: "Google Calendar", blurb: "Read and create events" },
  { slug: "outlook", label: "Outlook", blurb: "Email, calendar and contacts" },
  { slug: "calendly", label: "Calendly", blurb: "Scheduling links and bookings" },
  { slug: "gmail", label: "Gmail", blurb: "Read and send email" },
  { slug: "googlesheets", label: "Google Sheets", blurb: "Read and update spreadsheets" },
  { slug: "notion", label: "Notion", blurb: "Pages and databases" },
  { slug: "linear", label: "Linear", blurb: "Issues and project tracking" },
  { slug: "slack", label: "Slack", blurb: "Post updates and read channels" },
  { slug: "github", label: "GitHub", blurb: "Issues, pull requests, and code" },
  // the trap: a CRM whose description happens to mention calendars
  { slug: "hubspot", label: "HubSpot", blurb: "CRM with deals, contacts and a calendar view" },
];

const labels = (candidates: ToolCandidate[]) => candidates.map((candidate) => candidate.label);

describe("searchTerms", () => {
  it("expands a capability into the words a catalog actually uses", () => {
    expect(searchTerms("calendar")).toContain("event");
    expect(searchTerms("email")).toEqual(expect.arrayContaining(["email", "mail", "inbox"]));
  });

  it("reads plurals and phrases the way a person writes them", () => {
    expect(searchTerms("calendars")).toContain("calendar");
    expect(searchTerms("my spreadsheets")).toEqual(expect.arrayContaining(["spreadsheet", "excel"]));
  });

  it("drops words too short to mean anything", () => {
    // "a", "to" and friends match every blurb in the catalog
    expect(searchTerms("a to do")).not.toContain("a");
    expect(searchTerms("a to do")).not.toContain("to");
  });
});

describe("matchToolkits", () => {
  it("puts the app whose NAME answers the capability first", () => {
    expect(labels(matchToolkits("calendar", CATALOG))[0]).toBe("Google Calendar");
  });

  it("does not offer an app that merely mentions the word in passing", () => {
    const found = labels(matchToolkits("calendar", CATALOG));
    // HubSpot's blurb ends "...and a calendar view". It is not a calendar, and
    // connecting it would cost a real sign-in for nothing.
    expect(found).not.toContain("HubSpot");
    // Outlook's opens "Email, calendar and contacts" — that one counts.
    expect(found).toContain("Outlook");
    expect(found.indexOf("Google Calendar")).toBeLessThan(found.indexOf("Outlook"));
  });

  it("finds an app through a synonym the catalog uses instead", () => {
    // Calendly's blurb says "scheduling", never "calendar"
    expect(labels(matchToolkits("calendar", CATALOG))).toContain("Calendly");
    expect(labels(matchToolkits("email", CATALOG))).toContain("Gmail");
    expect(labels(matchToolkits("spreadsheet", CATALOG))).toContain("Google Sheets");
  });

  it("surfaces what is already connected before offering a second one", () => {
    const found = matchToolkits("calendar", CATALOG, { connected: new Set(["outlook"]) });
    expect(found[0]!.label).toBe("Outlook");
    expect(found[0]!.connected).toBe(true);
    // and the rest are still offered, unmarked
    expect(found[1]!.connected).toBeUndefined();
  });

  it("offers nothing rather than something irrelevant", () => {
    // The next rung of the ladder is where "we have nothing for that" is
    // handled; a bad guess here sends someone to connect the wrong app.
    expect(matchToolkits("underwater welding", CATALOG)).toEqual([]);
    expect(matchToolkits("", CATALOG)).toEqual([]);
  });

  it("still answers a capability the catalog words happen to cover", () => {
    // "records" is a real catalog word — Airtable is "Bases and records" — so
    // asking for records SHOULD find it. The floor is there to drop passing
    // mentions, not to make the matcher timid.
    const records = [...CATALOG, { slug: "airtable", label: "Airtable", blurb: "Bases and records" }];
    expect(labels(matchToolkits("records", records))).toContain("Airtable");
  });

  it("never offers more than a person will read", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      slug: `cal${index}`,
      label: `Calendar ${index}`,
      blurb: "events",
    }));
    expect(matchToolkits("calendar", many)).toHaveLength(MAX_CANDIDATES);
  });

  it("orders the same catalog the same way every time", () => {
    const once = labels(matchToolkits("issues", CATALOG));
    const twice = labels(matchToolkits("issues", [...CATALOG].reverse()));
    expect(once).toEqual(twice);
  });
});
