import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRetainedComputerOwners, retainComputerOwner } from "./retained-computers.ts";

describe("retained computer ownership", () => {
  it("persists only identity, preserves other owners, and deduplicates retries", () => {
    const dir = join(homedir(), "retained");
    retainComputerOwner(dir, { id: "one", name: "One" });
    retainComputerOwner(dir, { id: "two", name: "Two" });
    retainComputerOwner(dir, { id: "one", name: "Renamed" });
    expect(readRetainedComputerOwners(dir)).toEqual([
      { botId: "two", name: "Two", deleted: true, inUse: false },
      { botId: "one", name: "Renamed", deleted: true, inUse: false },
    ]);
  });
  it("does not overwrite an unreadable ownership journal", () => {
    const dir = join(homedir(), "broken-retained");
    mkdirSync(dir);
    writeFileSync(join(dir, "retained-computer-owners.json"), "null");
    expect(() => retainComputerOwner(dir, { id: "one", name: "One" })).toThrow(/invalid/);
  });
});
