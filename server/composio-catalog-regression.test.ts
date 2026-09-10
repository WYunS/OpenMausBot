import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedToolkits, listToolkits, setManagedBrokerAccess } from "./composio.ts";
import type { AppConfig } from "./config.ts";

const cfg = {} as AppConfig;
afterEach(() => { setManagedBrokerAccess(null); vi.restoreAllMocks(); });

describe("official connector catalog recovery", () => {
  it("keeps official brand URLs available without the account broker", async () => {
    setManagedBrokerAccess(null);
    expect(cachedToolkits(cfg).cards).toHaveLength(24);
    const result = await listToolkits(cfg);
    for (const slug of ["gmail", "slack", "github", "googledrive", "notion"]) {
      expect(result.cards.find((card) => card.slug === slug)?.logo).toBe(`https://logos.composio.dev/api/${slug}`);
    }
  });

  it("accepts a slow official catalog and preserves it through a later outage", async () => {
    let offline = false;
    const server = createServer((_req, res) => {
      if (offline) { res.writeHead(503); res.end(); return; }
      setTimeout(() => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ items: [{ slug: "gmail", name: "Gmail", logo: "https://logos.composio.dev/api/gmail" }] }));
      }, 4_300);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number };
    setManagedBrokerAccess({ url: `http://127.0.0.1:${address.port}`, token: "a".repeat(64) });
    try {
      const first = await listToolkits(cfg);
      expect(first.source).toBe("api");
      expect(cachedToolkits(cfg)).toEqual(first);
      offline = true;
      const later = Date.now() + 601_000;
      vi.spyOn(Date, "now").mockReturnValue(later);
      const second = await listToolkits(cfg);
      expect(second).toEqual(first);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps earlier pages when a later page drops the connection", async () => {
    const server = createServer((req, res) => {
      if (req.url?.includes("cursor=")) { req.socket.destroy(); return; }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ items: [{ slug: "gmail", name: "Gmail" }], next_cursor: "second" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number };
    setManagedBrokerAccess({ url: `http://127.0.0.1:${address.port}`, token: "a".repeat(64) });
    try {
      expect(await listToolkits(cfg)).toMatchObject({ source: "api", cards: [{ slug: "gmail", logo: "https://logos.composio.dev/api/gmail" }] });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
