import { describe, expect, it } from "vitest";
import { readToolkitCatalogCache, writeToolkitCatalogCache } from "./toolkit-catalog-cache.ts";

describe("official toolkit metadata persistence", () => {
  it("retains original URLs across disk reads and refuses another identity", () => {
    const cache = { identity: "project-one", at: 123, cards: [{
      slug: "gmail", label: "Gmail", blurb: "Mail", domain: "gmail.com",
      logo: "https://logos.composio.dev/api/gmail", noAuth: false,
    }] };
    writeToolkitCatalogCache(cache);
    expect(readToolkitCatalogCache("project-one")).toEqual(cache);
    expect(readToolkitCatalogCache("project-two")).toBeNull();
  });
});
