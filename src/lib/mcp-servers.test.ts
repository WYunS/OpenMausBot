import { describe, expect, it } from "vitest";

import { mcpServersForBot } from "./mcp-servers";

describe("mcpServersForBot", () => {
  const all = [
    { name: "notes", enabled: true },
    { name: "linear", enabled: true },
    { name: "off", enabled: false },
  ];

  it("gives a bot without a list every enabled server", () => {
    expect(mcpServersForBot(all, undefined).map((s) => s.name)).toEqual(["notes", "linear"]);
    expect(mcpServersForBot(all, null).map((s) => s.name)).toEqual(["notes", "linear"]);
  });

  it("narrows to the bot's own names and never revives a disabled server", () => {
    expect(mcpServersForBot(all, ["linear", "off", "gone"]).map((s) => s.name)).toEqual(["linear"]);
    expect(mcpServersForBot(all, [])).toEqual([]);
  });
});
