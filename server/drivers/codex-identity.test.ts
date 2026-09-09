import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeTempDir } from "../testing/cleanup.ts";
import { codexAccountEmail, codexHome } from "./codex-identity.ts";

// A fabricated auth.json in a disposable home: the shape Codex writes, with
// placeholder tokens. No real credential is read or created.
const token = (claims: unknown) =>
  `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature-fixture`;
const BELL = String.fromCharCode(7);

describe("Codex account identity", () => {
  let home: string;
  const env = () => ({ HOME: home });
  const write = (body: unknown, dir = join(home, ".codex")) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "auth.json"), typeof body === "string" ? body : JSON.stringify(body));
  };
  const authFile = (claims: unknown) => ({
    OPENAI_API_KEY: null,
    tokens: { id_token: token(claims), access_token: "access-fixture", refresh_token: "refresh-fixture", account_id: "acct-fixture" },
    last_refresh: "2026-09-09T00:00:00Z",
  });

  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "omb-codex-identity-")); });
  afterEach(async () => { await removeTempDir(home); });

  it("reads only the email claim from the stored id token", async () => {
    write(authFile({ email: "ada@example.test", "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } }));
    expect(await codexAccountEmail(env())).toBe("ada@example.test");
  });

  it("follows CODEX_HOME when it is absolute and refuses a relative one", async () => {
    write(authFile({ email: "elsewhere@example.test" }), join(home, "profiles", "work"));
    expect(await codexAccountEmail({ HOME: home, CODEX_HOME: join(home, "profiles", "work") })).toBe("elsewhere@example.test");
    expect(codexHome({ HOME: home, CODEX_HOME: "profiles/work" })).toBeNull();
    expect(await codexAccountEmail({ HOME: home, CODEX_HOME: "profiles/work" })).toBeNull();
    expect(codexHome({ HOME: home })).toBe(join(home, ".codex"));
  });

  it.each([
    ["no file", undefined],
    ["an API-key login", { OPENAI_API_KEY: "sk-fixture", tokens: null }],
    ["a token that is not a JWT", { tokens: { id_token: "opaque-fixture" } }],
    ["claims that are not JSON", { tokens: { id_token: "a.b.c" } }],
    ["an invalid email", authFile({ email: "not an email" })],
    ["a control character in the email", authFile({ email: `ada${BELL}@example.test` })],
    ["a non-string email", authFile({ email: 42 })],
    ["malformed JSON", "{not json"],
  ])("returns nothing for %s", async (_label, body) => {
    if (body !== undefined) write(body);
    expect(await codexAccountEmail(env())).toBeNull();
  });

  it("ignores an oversized file rather than parsing it", async () => {
    write(JSON.stringify(authFile({ email: "ada@example.test" })) + " ".repeat(300 * 1024));
    expect(await codexAccountEmail(env())).toBeNull();
  });
});
