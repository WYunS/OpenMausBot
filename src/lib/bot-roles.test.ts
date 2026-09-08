import { describe, expect, it } from "vitest";

import { BOT_ROLES, botRole, roleProfilePatch } from "./bot-roles";

describe("bot roles", () => {
  it("are distinct, short, and each has instructions to start from", () => {
    const ids = BOT_ROLES.map((role) => role.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BOT_ROLES.length).toBeLessThanOrEqual(8);
    for (const role of BOT_ROLES) {
      expect(role.soul.length).toBeGreaterThan(40);
      expect(role.title).not.toBe("");
      expect(role.description.length).toBeLessThanOrEqual(120);
    }
  });

  it("turns a role into the profile patch a blank bot needs", () => {
    const patch = roleProfilePatch(botRole("research")!);
    expect(patch).toMatchObject({ name: "Scout", title: "Researcher", browser: true, computer: "browser" });
    expect(patch.soul).toContain("brief");
    // a role that leaves the computer on Auto sends no computer key at all
    expect("computer" in roleProfilePatch(botRole("assistant")!)).toBe(false);
  });
});
