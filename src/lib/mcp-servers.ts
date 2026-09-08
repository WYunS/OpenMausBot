// The app-wide MCP server list (Plugins → MCP servers), shared by every
// place that shows it per bot: the Access section's switches and the
// composer's Tools chip. One fetch, cached for the window; `refresh` after
// the Plugins panel changes the list.
import { useEffect, useState } from "react";

import { api } from "@/state/store";

export interface McpServerSummary {
  name: string;
  enabled: boolean;
}

let cached: McpServerSummary[] | null = null;
let inflight: Promise<McpServerSummary[]> | null = null;
const listeners = new Set<(servers: McpServerSummary[]) => void>();

export function loadMcpServers(force = false): Promise<McpServerSummary[]> {
  if (!force && cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = api("/api/mcp/servers")
    .then((result) => {
      const servers: McpServerSummary[] = (result.servers ?? []).map((server: { name: string; enabled: boolean }) => ({
        name: server.name,
        enabled: Boolean(server.enabled),
      }));
      cached = servers;
      for (const listener of listeners) listener(servers);
      return servers;
    })
    .catch(() => cached ?? [])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The list, or null until the first load settles. Re-renders when any
 * caller refreshes it. */
export function useMcpServers(): { servers: McpServerSummary[] | null; refresh: () => Promise<McpServerSummary[]> } {
  const [servers, setServers] = useState<McpServerSummary[] | null>(cached);
  useEffect(() => {
    listeners.add(setServers);
    void loadMcpServers();
    return () => {
      listeners.delete(setServers);
    };
  }, []);
  return { servers, refresh: () => loadMcpServers(true) };
}

/** The servers a bot actually mounts: its own list when it has one (names
 * that no longer exist fall away), else every enabled server. Mirrors
 * server/config.ts customMcpServers so the chip and the turn agree. */
export function mcpServersForBot(all: McpServerSummary[], own: string[] | null | undefined): McpServerSummary[] {
  const enabled = all.filter((server) => server.enabled);
  if (own == null) return enabled;
  return enabled.filter((server) => own.includes(server.name));
}
