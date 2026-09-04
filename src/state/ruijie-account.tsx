import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "./store";

type AccountViewState = {
  status: RuijieAccountState["status"] | "checking" | "unavailable";
  summary?: RuijieAccountSummary;
  message?: string;
};

interface AccountContextValue {
  state: AccountViewState;
  desktopSso: boolean;
  refresh(): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

async function saveProfile(summary?: RuijieAccountSummary): Promise<void> {
  const profile = summary
    ? {
        name: summary.account.name ?? summary.account.email?.split("@")[0] ?? "锐捷用户",
        email: summary.account.email ?? "",
      }
    : { name: "", email: "" };
  const response = await fetch("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `账号同步失败（HTTP ${response.status}）`);
  }
}

export function RuijieAccountProvider({ children }: { children: ReactNode }) {
  const { state: appState, refreshInstances, refreshRuijieHarness } = useStore();
  const bridge = window.ogb?.ruijieAccount;
  const [state, setState] = useState<AccountViewState>(bridge ? { status: "checking" } : { status: "unavailable" });

  const adopt = useCallback(async (next: RuijieAccountState) => {
    const nextProfile = next.status === "ready" || next.summary
      ? {
          name: next.summary?.account.name ?? next.summary?.account.email?.split("@")[0] ?? "锐捷用户",
          email: next.summary?.account.email ?? "",
        }
      : { name: "", email: "" };
    const current = appState.config?.profile;
    const profileChanged = current?.name !== nextProfile.name || current?.email !== nextProfile.email;
    if (profileChanged) await saveProfile(next.status === "ready" || next.summary ? next.summary : undefined);
    setState(next);
    if (profileChanged) {
      await refreshRuijieHarness();
      // Keep catalogs and unrelated engine health fresh, but never hold the
      // account UI on their multi-second CLI probes.
      void refreshInstances();
    }
  }, [appState.config?.profile, refreshInstances, refreshRuijieHarness]);

  const refresh = useCallback(async () => {
    if (!bridge) {
      setState({ status: "unavailable" });
      return;
    }
    try {
      await adopt(await bridge.state());
    } catch (cause) {
      setState({ status: "error", message: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [adopt, bridge]);

  const signIn = useCallback(async () => {
    if (!bridge) return;
    setState({ status: "authorizing" });
    try {
      await adopt(await bridge.signIn());
    } catch (cause) {
      setState({ status: "signed-out", message: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [adopt, bridge]);

  const signOut = useCallback(async () => {
    if (!bridge) return;
    const next = await bridge.signOut();
    await adopt(next);
  }, [adopt, bridge]);

  useEffect(() => {
    void refresh();
    if (!bridge) return;
    const timer = window.setInterval(() => { void refresh(); }, 5 * 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [bridge, refresh]);

  const value = useMemo(() => ({ state, desktopSso: Boolean(bridge), refresh, signIn, signOut }), [state, bridge, refresh, signIn, signOut]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useRuijieAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useRuijieAccount must be used within RuijieAccountProvider");
  return value;
}
