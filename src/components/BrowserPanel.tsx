import { useState } from "react";
import { browserUnavailableReason } from "@/lib/feature-flags";
import { useStore, type Bot } from "@/state/store";

export function BrowserPanel({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const engine = state.config?.browserEngine;
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installing = requested || engine?.installing === true;

  const install = async () => {
    setError(null);
    setRequested(true);
    try {
      const response = await fetch("/api/browser-engine/install", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `The server answered ${response.status}.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRequested(false);
    }
  };

  if (engine?.kind === "engine" && !installing && !engine.installError && !error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-2 rounded-xl bg-card p-5">
        <div className="text-[15px] font-medium text-ink">{bot.name} has its own browser</div>
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          agent-browser {engine.version ?? ""} runs it as an isolated session with its own logins, which persist across restarts.
          Pages the bot looks at appear in the chat as screenshots. A live view you can watch and take over is coming next.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-3 rounded-xl bg-card p-5">
      <div className="text-[15px] font-medium text-ink">{engine?.kind === "engine" ? "Browser installation incomplete" : "Browser engine not installed"}</div>
      <p className="text-[13px] leading-relaxed text-ink-secondary">{engine?.kind === "engine"
        ? "agent-browser is installed, but Chrome setup has not finished. Retry the browser installation."
        : browserUnavailableReason(state.config)}</p>
      {engine?.installable || engine?.kind === "engine" ? (
        <button type="button" onClick={() => void install()} disabled={installing} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-60">
          {installing ? "Installing… (a one-time download of about 160 MB)" : engine?.kind === "engine" ? "Retry browser installation" : "Install the browser engine"}
        </button>
      ) : null}
      {engine?.installError ? <p role="alert" className="text-[12px] text-danger">Last attempt failed: {engine.installError}</p> : null}
      {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
