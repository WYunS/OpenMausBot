import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { reconcileRuijieHarnessUsage } from "./usage-reconciliation.ts";

const task = (threadId: string) => ({
  threadId,
  title: "fixture",
  createdAt: 1,
  resumeCursors: {},
  usage: { input: 0, output: 0, costUsd: null, turns: 2 },
});

function writeEvents(directory: string, threadId: string, events: unknown[]) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${threadId}.ndjson`), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

const temporaryDirectories: string[] = [];
const eventDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "openmaus-usage-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Ruijie Harness usage reconciliation", () => {
  it("uses exact session.started mappings, sums multiple sessions, and is idempotent", async () => {
    const eventDir = eventDirectory();
    writeEvents(eventDir, "thread-1", [
      { type: "session.started", provider: "ruijieHarness", providerInstanceId: "ruijieHarness", threadId: "thread-1", turnId: "turn-1", sessionId: "session-a" },
      { type: "turn.completed", provider: "ruijieHarness", providerInstanceId: "ruijieHarness", threadId: "thread-1", turnId: "turn-1" },
      { type: "session.started", provider: "ruijieHarness", providerInstanceId: "ruijieHarness", threadId: "thread-1", turnId: "turn-2", sessionId: "session-b" },
      { type: "turn.completed", provider: "ruijieHarness", providerInstanceId: "ruijieHarness", threadId: "thread-1", turnId: "turn-2" },
    ]);
    const bots = [{ id: "bot-1", tasks: [task("thread-1")] }];
    const read = async (_instanceId: string, sessionId: string) => sessionId === "session-a"
      ? { input: 100, output: 10, cachedInput: 70 }
      : { input: 200, output: 20, cachedInput: 150 };

    const first = await reconcileRuijieHarnessUsage(bots, eventDir, read);
    const second = await reconcileRuijieHarnessUsage(bots, eventDir, read);

    expect(first).toEqual([{ botId: "bot-1", threadId: "thread-1", usage: {
      input: 300, output: 30, cachedInput: 220, costUsd: null, turns: 2,
    } }]);
    expect(second).toEqual(first);
  });

  it("does not invent a partial total when any exact Harness session is unavailable", async () => {
    const eventDir = eventDirectory();
    writeEvents(eventDir, "thread-1", [
      { type: "session.started", provider: "ruijieHarness", providerInstanceId: "ruijieHarness", threadId: "thread-1", turnId: "turn-1", sessionId: "session-a" },
      { type: "turn.completed", provider: "ruijieHarness", providerInstanceId: "ruijieHarness", threadId: "thread-1", turnId: "turn-1" },
      { type: "session.started", provider: "ruijieHarness", providerInstanceId: "ruijieHarness", threadId: "thread-1", turnId: "turn-2", sessionId: "session-missing" },
      { type: "turn.completed", provider: "ruijieHarness", providerInstanceId: "ruijieHarness", threadId: "thread-1", turnId: "turn-2" },
    ]);

    const updates = await reconcileRuijieHarnessUsage(
      [{ id: "bot-1", tasks: [task("thread-1")] }],
      eventDir,
      async (_instanceId, sessionId) => sessionId === "session-a" ? { input: 100, output: 10 } : null,
    );

    expect(updates).toEqual([]);
  });
});
