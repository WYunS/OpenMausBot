import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, LoaderCircle, Monitor } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { useBotSettingsDerived, type BotPatch } from "./bot-settings/useBotSettingsDerived";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { composerRuntimeNotice, composerRuntimeState } from "@/lib/composer-runtime-state";

/** The compact composer exposes only the work destination, not model/settings controls. */
export function ComposerComputerPicker({ bot }: { bot: Bot }) {
  const { state, flushBotPatches } = useStore();
  const derived = useBotSettingsDerived(bot);
  const { ready: desktopReady } = useDesktopCapabilities();
  const runtimeStatus = composerRuntimeState(Boolean(derived.engine), state.instancesLoadState, desktopReady);
  const runtimeNotice = composerRuntimeNotice(runtimeStatus);
  const [pending, setPending] = useState(false);
  const [warning, setWarning] = useState(false);
  const [error, setError] = useState("");
  const busy = bot.busy || bot.tasks?.some(task => task.busy);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const modes = ["auto", "local", "cloud", "vm", "browser", "off"] as const;
  const current = bot.computer ?? "auto";
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => { setOpen(false); }, [bot.id, busy, pending]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const popup = menu.current;
      if (!anchor || !popup) return;
      setPosition({
        left: Math.max(12, Math.min(anchor.left, innerWidth - popup.offsetWidth - 12)),
        top: Math.max(12, anchor.top - popup.offsetHeight - 8),
      });
    };
    place();
    const popup = menu.current;
    (popup?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)')
      ?? popup?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? popup)?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const reposition = () => place();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, runtimeStatus]);
  const save = async (patch: BotPatch) => {
    setPending(true); setError("");
    try { derived.patch(patch); await flushBotPatches(bot.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  return <>
    <button ref={trigger} type="button" aria-label="执行电脑" aria-haspopup="menu"
      aria-busy={runtimeStatus === "loading" || undefined}
      aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={Boolean(busy || pending)}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }}
      className="flex h-8 max-w-36 shrink-0 items-center gap-1.5 rounded-full px-2 text-ui-small text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      title={error || runtimeNotice || (busy ? "任务结束后可切换执行电脑" : "执行电脑")}>
      <Monitor size={14} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate text-left">{t(`botSettings.access.mode.${current}`)}</span>
      {runtimeStatus === "loading" ? <LoaderCircle size={12} className="shrink-0 animate-spin" aria-hidden="true" /> : <ChevronDown size={12} className="shrink-0" aria-hidden="true" />}
    </button>
    {open && createPortal(<div ref={menu} id={menuId} role="menu" aria-label="执行电脑" tabIndex={-1}
      style={position}
      className="fixed z-[100] w-52 max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] overflow-y-auto rounded-xl border border-hairline/50 bg-menu p-1.5 text-ink shadow-lg shadow-black/25"
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.key === "Tab") { event.preventDefault(); close(); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      {runtimeNotice && <p role="status" className="px-3 py-2 text-ui-caption text-ink-secondary">{runtimeNotice}</p>}
      {modes.map(mode => <button key={mode} type="button" role="menuitemradio" data-computer-mode={mode}
        aria-checked={current === mode}
        disabled={runtimeStatus !== "ready" || (mode === "local" ? !derived.localSelectable : mode === "browser" ? !derived.browserSelectable : false)}
        title={runtimeNotice || (mode === "local" ? derived.localDisabledReason ?? undefined : mode === "browser" ? derived.browserDisabledReason : undefined)}
        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-ui-small text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:cursor-not-allowed ${runtimeStatus === "loading" ? "" : "disabled:text-ink-secondary"}`}
        onClick={() => {
          close();
          if (mode === "local" && derived.approvalMode === "auto") { setWarning(true); return; }
          void save({ computer: mode === "auto" ? null : mode, ...(mode === "browser" ? { browser: true } : {}) });
        }}>
        <span>{t(`botSettings.access.mode.${mode}`)}</span>
        {current === mode && <Check size={14} aria-hidden="true" />}
      </button>)}
    </div>, document.body)}
    {error && <span role="alert" className="max-w-36 text-ui-caption text-danger">{error}</span>}
    <LocalComputerAutoWarning open={warning} onCancel={() => setWarning(false)} onConfirm={() => {
      setWarning(false); void save({ computer: "local", acknowledgeLocalAuto: true });
    }} />
  </>;
}
