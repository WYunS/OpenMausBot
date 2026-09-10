import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DATA_DIR } from "./config.ts";
import { writeFileAtomic } from "./atomic.ts";
import type { ToolkitCard } from "./composio.ts";

const cacheSchema = z.object({
  identity: z.string(), at: z.number(),
  cards: z.array(z.object({
    slug: z.string(), label: z.string(), blurb: z.string(), logo: z.string().nullable(),
    domain: z.string().nullable(), noAuth: z.boolean().optional(),
  })),
});

/** Metadata only: retain the official image URLs, never embed substitute art
 * or mix a different project's catalog into the current installation. */
export function readToolkitCatalogCache(identity: string) {
  try {
    const cache = cacheSchema.parse(JSON.parse(readFileSync(join(DATA_DIR, "toolkit-catalog-cache.json"), "utf8")));
    return cache.identity === identity ? cache : null;
  } catch { return null; }
}

export function writeToolkitCatalogCache(cache: { identity: string; at: number; cards: ToolkitCard[] }) {
  try {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileAtomic(join(DATA_DIR, "toolkit-catalog-cache.json"), JSON.stringify(cache), { mode: 0o600 });
  } catch { /* Optional display cache must not fail a successful catalog read. */ }
}
