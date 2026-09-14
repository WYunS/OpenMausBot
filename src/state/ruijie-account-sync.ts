export type AccountViewState = {
  status: RuijieAccountState["status"] | "checking" | "unavailable";
  summary?: RuijieAccountSummary;
  message?: string;
};

type Profile = { name?: string; email?: string };

type AdoptOptions = {
  next: RuijieAccountState;
  currentProfile?: Profile;
  saveProfile(summary?: RuijieAccountSummary): Promise<void>;
  setState(next: AccountViewState): void;
  refreshRuijieHarness(): Promise<unknown>;
  refreshInstances(): Promise<unknown>;
  reportSupplementalFailure(stage: "profile" | "harness" | "instances", cause: unknown): void;
};

/**
 * Adopt the authoritative desktop SSO state before running supplemental syncs.
 * Profile/catalog failures must never turn a valid SSO session into signed-out.
 */
export async function adoptRuijieAccountState({
  next,
  currentProfile,
  saveProfile,
  setState,
  refreshRuijieHarness,
  refreshInstances,
  reportSupplementalFailure,
}: AdoptOptions): Promise<void> {
  const nextProfile = next.status === "ready" || next.summary
    ? {
        name: next.summary?.account.name ?? next.summary?.account.email?.split("@")[0] ?? "锐捷用户",
        email: next.summary?.account.email ?? "",
      }
    : { name: "", email: "" };
  const profileChanged = currentProfile?.name !== nextProfile.name || currentProfile?.email !== nextProfile.email;

  // The IPC result is the authority for authentication. Publish it first so
  // an unrelated config write or provider refresh cannot roll login back.
  setState(next);
  if (!profileChanged) return;

  try {
    await saveProfile(next.status === "ready" || next.summary ? next.summary : undefined);
  } catch (cause) {
    reportSupplementalFailure("profile", cause);
  }
  try {
    await refreshRuijieHarness();
  } catch (cause) {
    reportSupplementalFailure("harness", cause);
  }
  try {
    void refreshInstances().catch((cause) => reportSupplementalFailure("instances", cause));
  } catch (cause) {
    reportSupplementalFailure("instances", cause);
  }
}
