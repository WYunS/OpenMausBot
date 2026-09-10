import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import type { ConnectorServiceState } from "./composio.ts";

const accountSchema = z.object({
  id: z.string().min(1),
  alias: z.string().optional(),
  status: z.string(),
}).strict();

const serviceSchema = z.object({
  connected: z.boolean(),
  pending: z.boolean(),
  status: z.string(),
  accounts: z.array(accountSchema),
}).strict();

const cacheSchema = z.object({
  version: z.literal(1),
  identity: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.number().int().nonnegative(),
  services: z.record(z.string(), serviceSchema),
}).strict();

export interface ConnectedAppsCacheEntry {
  at: number;
  services: Record<string, ConnectorServiceState>;
}

export function connectedAppsCachePath(dataDir = DATA_DIR): string {
  return join(dataDir, "connected-apps-cache.json");
}

export function readConnectedAppsCache(
  identity: string,
  dataDir = DATA_DIR,
): ConnectedAppsCacheEntry | null {
  try {
    const path = connectedAppsCachePath(dataDir);
    if (!existsSync(path)) return null;
    const parsed = cacheSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (parsed.identity !== identity) return null;
    return { at: parsed.at, services: parsed.services };
  } catch {
    return null;
  }
}

export function writeConnectedAppsCache(
  identity: string,
  services: Record<string, ConnectorServiceState>,
  now = Date.now(),
  dataDir = DATA_DIR,
): void {
  try {
    writeFileAtomic(
      connectedAppsCachePath(dataDir),
      `${JSON.stringify({ version: 1, identity, at: now, services }, null, 2)}\n`,
      { mode: 0o600 },
    );
  } catch {
    // A last-known-good display cache must never break live connector reads.
  }
}
