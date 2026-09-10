// Deleting a bot is a local operation. Keep only the non-secret ownership
// identity so legacy remote computers remain discoverable without contacting
// an offline provider, and never delete the remote computer implicitly.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";

export interface RetainedComputerOwner { botId: string; name: string; deleted: true; inUse: false }

export function readRetainedComputerOwners(dataDir: string): RetainedComputerOwner[] {
  const file = join(dataDir, "retained-computer-owners.json");
  if (!existsSync(file)) return [];
  const rows: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.botId !== "string" || typeof row.name !== "string")) {
    throw new Error("Retained computer ownership records are invalid");
  }
  return rows.map((row) => ({ botId: row.botId, name: row.name, deleted: true, inUse: false }));
}

export function retainComputerOwner(dataDir: string, bot: { id: string; name: string }): void {
  const owners = readRetainedComputerOwners(dataDir).filter((owner) => owner.botId !== bot.id);
  owners.push({ botId: bot.id, name: bot.name, deleted: true, inUse: false });
  mkdirSync(dataDir, { recursive: true });
  writeFileAtomic(join(dataDir, "retained-computer-owners.json"), JSON.stringify(owners), { mode: 0o600 });
}
