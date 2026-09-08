// The tray under the composer input: the project this bot works in, the
// tools it has (computer, browser, connected apps, MCP servers), and the
// computer toggle — the "what can this bot do right now" strip that used
// to be split between the header and settings. Changing any of it still
// happens in bot settings; the tray shows and links.
import { useEffect, useState } from "react";
import { Folder, Monitor, Wrench } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { mcpServersForBot, useMcpServers } from "@/lib/mcp-servers";
import { api, useStore, type Bot } from "@/state/store";
import { preloadConnectedApps } from "./PluginsPanel";

const CHIP =
  "flex h-8 max-w-[200px] items-center gap-1.5 whitespace-nowrap rounded-full border border-hairline/20 px-3 text-[13px] text-ink-secondary transition-colors hover:bg-raised-hover hover:text-ink";

/** The folder the bot's shell tools run in. Click picks a folder on the
 * desktop (PATCHed directly, like the Access card, so a rejected path never
 * sticks) and opens the Access section elsewhere. */
function ProjectChip({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const task = bot.tasks?.find((item) => item.threadId === bot.threadId);
  const folder = task?.cwd === undefined ? bot.cwd : (task.cwd ?? undefined);
  const name = folder ? folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folder : null;
  const canPick = Boolean(window.ogb?.pickFolder);

  const choose = async () => {
    if (!canPick) {
      dispatch({ type: "toggleSettings", open: true, section: "access" });
      return;
    }
    const chosen = await window.ogb?.pickFolder?.(bot.cwd);
    if (!chosen) return;
    setSaving(true);
    try {
      await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ cwd: chosen }) });
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void choose()}
      disabled={saving}
      className={cn(CHIP, "disabled:opacity-50")}
      title={folder ? t("composer.tray.project", { folder }) : t("composer.tray.chooseProject")}
    >
      <Folder size={14} aria-hidden="true" />
      <span className={cn("truncate", name && "font-mono text-[12.5px]")}>{name ?? t("composer.tray.chooseProject")}</span>
    </button>
  );
}

function computerLabel(bot: Bot): string {
  switch (bot.computer) {
    case "off":
      return t("composer.tray.off");
    case "cloud":
      return "Cloud";
    case "vm":
      return "Local VM";
    case "local":
      return "This computer";
    case "browser":
      return t("composer.tray.browser");
    default:
      return "Auto";
  }
}

/** One chip, one popover: everything this bot can reach, each row linking
 * to where it is changed. */
function ToolsChip({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<string[] | null>(null);
  const { servers } = useMcpServers();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void preloadConnectedApps().then((inventory) => {
      if (cancelled) return;
      setApps(
        inventory.authoritative
          ? Object.entries(inventory.services).filter(([, status]) => status.connected).map(([slug]) => slug)
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const mounted = servers ? mcpServersForBot(servers, bot.mcpServers) : [];
  const browserOn = bot.browser !== false && bot.computer !== "off" && state.config?.features?.browser !== false;
  const appsOn = bot.composio !== false && Boolean(state.config?.composio?.configured);
  const count = (bot.computer !== "off" ? 1 : 0) + (browserOn ? 1 : 0) + (appsOn ? 1 : 0) + mounted.length;

  const openAccess = () => {
    setOpen(false);
    dispatch({ type: "toggleSettings", open: true, section: "access" });
  };
  const addMcp = () => {
    setOpen(false);
    dispatch({ type: "togglePlugins", open: true, surface: "mcp" });
  };

  const row = (label: string, value: string, on: boolean) => (
    <div className="flex items-center justify-between gap-4 px-3 py-1.5 text-[13px]">
      <span className="text-ink">{label}</span>
      <span className={cn("truncate text-right", on ? "text-ink-secondary" : "text-ink-secondary/60")}>{value}</span>
    </div>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className={cn(CHIP, open && "bg-raised-hover text-ink")}
        title={t("composer.tray.toolsHint")}
      >
        <Wrench size={14} aria-hidden="true" />
        <span>{t("composer.tray.tools")}</span>
        <span className="rounded-full bg-inset px-1.5 text-[11px] tabular-nums">{count}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-40 mb-2 w-72 overflow-hidden rounded-xl border border-hairline/50 bg-card py-1.5 shadow-2xl shadow-black/60">
            {row(t("composer.tray.computer"), computerLabel(bot), bot.computer !== "off")}
            {row(t("composer.tray.browser"), browserOn ? t("composer.tray.on") : t("composer.tray.off"), browserOn)}
            {row(
              t("composer.tray.apps"),
              !appsOn ? t("composer.tray.off") : apps === null ? "…" : apps.length === 0 ? t("composer.tray.none") : apps.join(", "),
              appsOn,
            )}
            {row(
              t("composer.tray.mcp"),
              servers === null ? "…" : mounted.length === 0 ? t("composer.tray.none") : mounted.map((server) => server.name).join(", "),
              mounted.length > 0,
            )}
            <div className="mt-1 border-t border-hairline/40 pt-1">
              <button type="button" onClick={openAccess} className="flex w-full px-3 py-1.5 text-left text-[13px] text-accent-text hover:bg-raised/70">
                {t("composer.tray.manage")}
              </button>
              <button type="button" onClick={addMcp} className="flex w-full px-3 py-1.5 text-left text-[13px] text-ink-secondary hover:bg-raised/70 hover:text-ink">
                {t("composer.tray.addMcp")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ComposerTray({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  return (
    <>
      <ProjectChip bot={bot} />
      <ToolsChip bot={bot} />
      <button
        type="button"
        onClick={() => dispatch({ type: "toggleComputer" })}
        aria-pressed={state.computerOpen}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-raised-hover",
          state.computerOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
        )}
        title={t("chat.computer")}
      >
        <Monitor size={17} />
      </button>
    </>
  );
}
