// Display identity for the ChatGPT account Codex signed in on this server.
// `codex login status` only reports "Logged in using ChatGPT", so the email
// comes from the id token Codex keeps in CODEX_HOME/auth.json. Only the
// email claim is decoded; access and refresh tokens never leave the file.
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const MAX_AUTH_FILE_BYTES = 256 * 1024;
const MAX_CLAIMS_CHARS = 16_384;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where this environment's Codex keeps its credentials, or null when the
 * configured home is not absolute (the login controller refuses those too). */
export function codexHome(env: Record<string, string | undefined>): string | null {
  if (env.CODEX_HOME) return isAbsolute(env.CODEX_HOME) ? resolve(env.CODEX_HOME) : null;
  const home = env.HOME || env.USERPROFILE || homedir();
  return isAbsolute(home) ? join(home, ".codex") : null;
}

function claimsOf(idToken: unknown): Record<string, unknown> | null {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3 || parts[1]!.length > MAX_CLAIMS_CHARS) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The signed-in ChatGPT email, or null when Codex is signed out, uses an
 * API key, or stores something this version does not recognise. */
export async function codexAccountEmail(env: Record<string, string | undefined>): Promise<string | null> {
  const dir = codexHome(env);
  if (!dir) return null;
  const file = join(dir, "auth.json");
  try {
    if ((await stat(file)).size > MAX_AUTH_FILE_BYTES) return null;
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    const tokens = parsed && typeof parsed === "object" ? (parsed as { tokens?: unknown }).tokens : null;
    if (!tokens || typeof tokens !== "object") return null;
    const email = claimsOf((tokens as { id_token?: unknown }).id_token)?.email;
    return typeof email === "string" && email.length <= 254 && EMAIL.test(email) && !/[\p{Cc}\p{Cf}]/u.test(email) ? email : null;
  } catch {
    return null;
  }
}
