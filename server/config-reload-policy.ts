/** Settings that no provider reads at construction time. Everything else is
 * conservatively treated as provider configuration. Profile is intentionally
 * absent: Ruijie Harness captures profile.email as expectedAccountEmail. */
const PRESENTATION_ONLY_KEYS = new Set([
  "language",
  "tts",
  "imageGen",
  "vps",
  "rooms",
  "localVm",
  "features",
  "browserProfiles",
]);

export function providerReloadRequired(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).some((key) => !PRESENTATION_ONLY_KEYS.has(key));
}
