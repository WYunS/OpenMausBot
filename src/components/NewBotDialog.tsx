// "New bot": pick a starting point. A blank bot is one card among the
// roles; a role only pre-fills the profile (name, job, standing
// instructions, browser) — nothing is connected or scheduled for you, the
// Overview checklist and /setup pick up from there.
import { useEffect, useRef } from "react";
import { Bot as BotIcon, X } from "lucide-react";

import { track } from "@/lib/analytics";
import { BOT_ROLES, type BotRole } from "@/lib/bot-roles";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";

const APP_LABELS: Record<string, string> = {
  gmail: "Gmail",
  github: "GitHub",
  discord: "Discord",
  slack: "Slack",
  googlecalendar: "Calendar",
  notion: "Notion",
  linear: "Linear",
};

export function NewBotDialog() {
  const { dispatch } = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = () => dispatch({ type: "toggleNewBot", open: false });

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (dialogRef.current?.querySelector<HTMLElement>("button") ?? dialogRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      returnFocus?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = (role?: BotRole) => {
    track("bot_created", { role: role?.id ?? "blank" });
    dispatch({ type: "newBot", role });
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("sidebar.newBot")}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-hairline/60 bg-card shadow-2xl shadow-black/60"
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <h2 className="text-[17px] font-semibold text-ink">{t("sidebar.newBot")}</h2>
            <p className="mt-1 text-[13px] text-ink-secondary">Start from a job, or from nothing. You can change everything afterwards.</p>
          </div>
          <button type="button" onClick={close} aria-label={t("common.close")} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2.5 overflow-y-auto p-5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => create()}
            className="flex min-h-[112px] flex-col items-start gap-1.5 rounded-xl border border-dashed border-hairline/60 bg-raised/40 p-4 text-left hover:border-accent/50 hover:bg-raised"
          >
            <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
              <BotIcon size={16} className="text-ink-secondary" /> Blank bot
            </span>
            <span className="text-[12.5px] leading-relaxed text-ink-secondary">No name, no instructions. Send it /setup and it interviews you.</span>
          </button>
          {BOT_ROLES.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => create(role)}
              className={cn(
                "flex min-h-[112px] flex-col items-start gap-1.5 rounded-xl border border-hairline/50 bg-raised/40 p-4 text-left",
                "hover:border-accent/50 hover:bg-raised",
              )}
            >
              <span className="text-[14px] font-medium text-ink">{role.title}</span>
              <span className="text-[12.5px] leading-relaxed text-ink-secondary">{role.description}</span>
              {role.apps.length > 0 && (
                <span className="mt-auto flex flex-wrap gap-1 pt-1">
                  {role.apps.map((slug) => (
                    <span key={slug} className="rounded-full bg-inset px-2 py-0.5 text-[11px] text-ink-secondary">
                      {APP_LABELS[slug] ?? slug}
                    </span>
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
