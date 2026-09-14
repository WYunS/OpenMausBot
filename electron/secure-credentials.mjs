// Reading the OS-encrypted credential store (credentials.bin via safeStorage).
//
// The whole point of this module is one distinction main.mjs used to lose:
//
//   empty        the store was read, and the user has saved nothing
//   ok           the store was read, here is what is in it
//   unavailable  the store could NOT be read — we know nothing
//
// Those first two are facts. The third is ignorance, and it must not be
// spelled the same way as "empty": a caller that cannot tell them apart
// starts the app as though the user had never connected anything, and — far
// worse — registers a fresh installation over the top of the real one.
//
// macOS says "temporarily unavailable. Please try again." for a keychain that
// is merely busy at that instant, which is exactly what happens when the app
// asks a few hundred milliseconds too early. So we try again, briefly, before
// admitting ignorance.
export const CREDENTIAL_READ_DELAYS_MS = [100, 200, 400, 800];
const message = (error) => (error instanceof Error ? error.message : String(error));

export async function readSecureCredentials({
  exists,
  isAvailable,
  readFile,
  decrypt,
  sleep,
  delays = CREDENTIAL_READ_DELAYS_MS,
}) {
  if (!exists()) return { status: "empty", credentials: {} };

  let lastError = "the operating-system credential store is unavailable";
  // delays.length retries AFTER the first attempt
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    try {
      if (!(await isAvailable())) {
        lastError = "the operating-system credential store is unavailable";
        continue;
      }
      const decrypted = await decrypt(readFile());
      const text = typeof decrypted === "string" ? decrypted : decrypted?.result;
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { status: "unavailable", credentials: {}, error: "the credential store is not readable" };
        }
        return { status: "ok", credentials: parsed };
      } catch {
        // Corruption is not a timing problem; retrying only delays the
        // report. It is still ignorance, never emptiness.
        return { status: "unavailable", credentials: {}, error: "the credential store is not readable" };
      }
    } catch (error) {
      lastError = message(error);
    }
  }
  return { status: "unavailable", credentials: {}, error: lastError };
}

/** Keep probing an OS credential store that was unavailable during boot.
 * A transient keychain/safeStorage failure must not leave the whole desktop
 * process permanently credential-less. The caller owns cancellation so this
 * loop can run for the lifetime of the app without keeping shutdown alive. */
export async function recoverSecureCredentials({
  read,
  sleep,
  onRecovered,
  shouldContinue = () => true,
  delays = [2_000, 5_000, 15_000, 30_000],
}) {
  if (!Array.isArray(delays) || delays.length === 0) throw new TypeError("credential recovery needs at least one delay");
  let attempt = 0;
  while (shouldContinue()) {
    await sleep(delays[Math.min(attempt, delays.length - 1)]);
    if (!shouldContinue()) return false;
    const result = await read();
    // This loop only follows an unavailable read of an existing encrypted
    // file. If the file disappears meanwhile, "empty" is not enough evidence
    // to replace the unknown document with {}.
    if (result?.status === "ok") {
      await onRecovered(result.credentials ?? {});
      return true;
    }
    attempt += 1;
  }
  return false;
}
