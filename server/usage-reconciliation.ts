import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { TaskUsage } from "./store.ts";

export interface SessionUsage {
  input: number;
  output: number;
  cachedInput?: number;
}

interface ReconciliationTask {
  threadId: string;
}

interface ReconciliationBot {
  id: string;
  tasks?: ReconciliationTask[];
}

interface HarnessSessionRef {
  instanceId: string;
  sessionId: string;
}

interface StoredRuntimeEvent {
  type?: unknown;
  provider?: unknown;
  providerInstanceId?: unknown;
  threadId?: unknown;
  turnId?: unknown;
  sessionId?: unknown;
}

export interface TaskUsageReplacement {
  botId: string;
  threadId: string;
  usage: TaskUsage;
}

async function runtimeEvents(file: string): Promise<StoredRuntimeEvent[]> {
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch {
    return [];
  }
  return source.split(/\r?\n/u).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const value = JSON.parse(line) as unknown;
      return value && typeof value === "object" ? [value as StoredRuntimeEvent] : [];
    } catch {
      return [];
    }
  });
}

/**
 * Rebuild task totals from the exact Harness sessions recorded in the task's
 * durable runtime log. A task is left untouched unless every completed turn
 * belongs to Harness and every referenced session can be read; a partial
 * number would look authoritative while silently under-counting history.
 *
 * The returned values replace task usage rather than being added to it, so
 * opening Settings or restarting the app can safely run reconciliation again.
 */
export async function reconcileRuijieHarnessUsage(
  bots: readonly ReconciliationBot[],
  eventsDir: string,
  readSessionUsage: (instanceId: string, sessionId: string) => Promise<SessionUsage | null>,
): Promise<TaskUsageReplacement[]> {
  const replacements: TaskUsageReplacement[] = [];
  for (const bot of bots) {
    for (const task of bot.tasks ?? []) {
      const events = await runtimeEvents(join(eventsDir, `${task.threadId}.ndjson`));
      const sessionByTurn = new Map<string, HarnessSessionRef>();
      for (const event of events) {
        if (
          event.type === "session.started"
          && event.provider === "ruijieHarness"
          && typeof event.providerInstanceId === "string"
          && typeof event.turnId === "string"
          && typeof event.sessionId === "string"
          && event.sessionId
        ) {
          sessionByTurn.set(event.turnId, { instanceId: event.providerInstanceId, sessionId: event.sessionId });
        }
      }

      const completed = new Map<string, StoredRuntimeEvent>();
      for (const event of events) {
        if (event.type === "turn.completed" && typeof event.turnId === "string") completed.set(event.turnId, event);
      }
      if (completed.size === 0) continue;

      const sessions = new Map<string, HarnessSessionRef>();
      let complete = true;
      for (const [turnId, event] of completed) {
        if (event.provider !== "ruijieHarness") {
          complete = false;
          break;
        }
        const session = sessionByTurn.get(turnId);
        if (!session) {
          complete = false;
          break;
        }
        sessions.set(`${session.instanceId}\0${session.sessionId}`, session);
      }
      if (!complete || sessions.size === 0) continue;

      const usageBySession = await Promise.all(
        [...sessions.values()].map(async (session) => ({
          session,
          usage: await readSessionUsage(session.instanceId, session.sessionId).catch(() => null),
        })),
      );
      if (usageBySession.some(({ usage }) => usage === null)) continue;

      let input = 0;
      let output = 0;
      let cachedInput = 0;
      let cachedKnown = false;
      for (const { usage } of usageBySession) {
        if (!usage) continue;
        input += usage.input;
        output += usage.output;
        if (usage.cachedInput !== undefined) {
          cachedInput += usage.cachedInput;
          cachedKnown = true;
        }
      }
      replacements.push({
        botId: bot.id,
        threadId: task.threadId,
        usage: {
          input,
          output,
          ...(cachedKnown ? { cachedInput } : {}),
          costUsd: null,
          turns: completed.size,
        },
      });
    }
  }
  return replacements;
}
