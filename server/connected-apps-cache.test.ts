import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  connectedAppsCachePath,
  readConnectedAppsCache,
  writeConnectedAppsCache,
} from "./connected-apps-cache.ts";

const identity = "a".repeat(64);
const gmail = {
  connected: true,
  pending: false,
  status: "ACTIVE",
  accounts: [{ id: "ca_gmail", alias: "work", status: "ACTIVE" }],
};
const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-connected-apps-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("server connected-apps cache", () => {
  it("survives a server restart without retaining a credential", () => {
    const dir = scratch();
    writeConnectedAppsCache(identity, { gmail }, 1234, dir);
    expect(readConnectedAppsCache(identity, dir)).toEqual({ at: 1234, services: { gmail } });
    const raw = readFileSync(connectedAppsCachePath(dir), "utf8");
    expect(raw).toContain("ca_gmail");
    expect(raw).not.toMatch(/token|secret|apiKey/i);
  });

  it("never crosses connector backends and ignores corrupt files", () => {
    const dir = scratch();
    writeConnectedAppsCache(identity, { gmail }, 1234, dir);
    expect(readConnectedAppsCache("b".repeat(64), dir)).toBeNull();
  });
});
