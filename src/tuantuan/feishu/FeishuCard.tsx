import { useEffect, useId, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { feishuCopy as copy } from "../l10n/feishu";
import {
  feishuActionAllowed, feishuConnected, feishuErrorMessage,
  type FeishuAction, type FeishuBot, type FeishuSnapshot,
} from "./model";

interface FeishuCardProps {
  native: FeishuSnapshot & {
    available: boolean;
    invoke(action: FeishuAction, input?: { botId?: string }): Promise<void> | undefined;
  };
  bots: FeishuBot[];
  selectedBotId: string;
}

function ConnectionWait({ browserWaiting }: { browserWaiting: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  if (seconds < 8) return null;
  return <p className="mt-1 text-[12px] tabular-nums text-ink-secondary">
    {copy.elapsed} {seconds} {copy.seconds}{seconds >= 20 && !browserWaiting ? ` · ${copy.slow}` : ""}
  </p>;
}

export function FeishuCard(props: FeishuCardProps) {
  const { native } = props;
  const [expanded, setExpanded] = useState(false);
  const connected = feishuConnected(native.state, native.error) === true;
  const pending = Boolean(native.busy || native.state?.pending);
  const failed = Boolean(native.error || native.state?.errorCode || native.state?.error || native.state?.phase === "error" || native.state?.im === "error");
  const phase = native.state?.phase;
  const status = !native.available || native.state?.supported === false ? copy.unsupported
    : failed ? copy.phase.error : pending ? phase && phase !== "ready" ? copy.phase[phase] : copy.busy
    : connected ? copy.connected : native.state?.recoveryPending ? copy.recoveryResume : !native.state ? copy.checking
    : native.state.im !== "off" || native.state.toolsEnabled ? copy.partial : copy.subtitle;
  const id = useId();
  return (
    <section aria-label={copy.title} className="min-h-[88px] min-w-0 border-b border-hairline/35 px-1 py-4">
      <div className="flex items-center gap-3">
        <img src="/tuantuan/feishu-logo.jpg" alt="" className="size-11 shrink-0 rounded-lg object-contain" />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
            {copy.title}{connected && <Check size={13} className="text-success" aria-hidden="true" />}
          </h3>
          <p role="status" aria-live="polite" className="mt-0.5 truncate text-[12.5px] text-ink-secondary" title={status}>{status}</p>
        </div>
        <button type="button" aria-expanded={expanded} aria-controls={`${id}-settings`}
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-[88px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-raised px-3 py-2 text-[12.5px] text-ink hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent">
          {pending && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
          {expanded ? copy.collapse : connected || pending ? copy.manage : failed ? copy.retryShort : copy.connectShort}
          {expanded && <ChevronDown size={12} aria-hidden="true" />}
        </button>
      </div>
      {expanded && <div id={`${id}-settings`} className="mt-3 min-w-0 sm:ml-14">
        <FeishuSetup {...props} />
      </div>}
    </section>
  );
}

export function FeishuSetup({ native, bots, selectedBotId }: FeishuCardProps) {
  const [draftBotId, setDraftBotId] = useState<string | null>(null);
  const id = useId();
  const { state, busy, available } = native;
  const unsupported = !available || state?.supported === false;
  const failed = Boolean(native.error || state?.error || state?.errorCode || state?.phase === "error" || state?.im === "error");
  const errorMessage = native.error ? native.error === copy.readFailed ? copy.readFailed : copy.actionFailed
    : feishuErrorMessage(state?.errorCode);
  const pending = Boolean(busy || state?.pending);
  const active = Boolean(state && (state.im !== "off" || state.toolsEnabled || state.pairingCode));
  const visibleBots = bots.filter((bot) => !bot.hidden);
  // Once active, the native binding is authoritative, including on switch failure.
  const candidate = active ? state?.botId : draftBotId ?? (state?.botId || selectedBotId);
  const botId = visibleBots.find((bot) => bot.id === candidate)?.id ?? "";
  const connected = feishuConnected(state, native.error) === true;
  const phase = state?.phase;
  const status = unsupported ? copy.unsupported
    : busy === "disconnect" ? copy.stopping
    : failed ? copy.phase.error
    : pending ? phase && phase !== "ready" ? copy.phase[phase] : busy === "selectBot" ? copy.switching : copy.busy
    : connected ? copy.connected
    : phase && phase !== "ready" ? copy.phase[phase]
    : !state ? copy.checking : active ? copy.partial : copy.inactive;
  const imStatus = !state || native.error ? copy.unknown
    : state.pairingCode ? copy.verifyingIdentity : copy.im[state.im];
  const toolsStatus = !state || native.error ? copy.unknown : state.toolsEnabled ? copy.toolsOn : copy.toolsOff;
  const canStop = pending || active || failed || Boolean(state?.login);
  const recovery = ["APP_UNAVAILABLE", "CONFIG_EXISTS", "CONFIG_NOT_EMPTY"].includes(state?.errorCode ?? "")
    || state?.recoveryPending;

  return (
    <section aria-label={copy.settingsTitle} className="min-w-0">
      <dl className="mt-3 grid min-w-0 gap-2 text-[12.5px] sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-ink-secondary">{copy.imLabel}</dt><dd className="text-ink">{imStatus}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-ink-secondary">{copy.toolsLabel}</dt><dd className="text-ink">{toolsStatus}</dd>
        </div>
      </dl>
      <div className="mt-3 flex items-start gap-2">
        {pending && !failed && <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-ink-secondary" aria-hidden="true" />}
        <p role="status" aria-live="polite" aria-atomic="true" className="min-w-0 break-words text-[12.5px] text-ink-secondary">{status}</p>
      </div>
      {pending && !failed && busy !== "disconnect" && <ConnectionWait key={phase ?? busy}
        browserWaiting={phase === "creatingApp" || phase === "authorizing"} />}
      {!unsupported && failed && <p role="alert" className="mt-2 text-[12.5px] text-danger">{errorMessage}</p>}
      {recovery && <p className="mt-2 text-[12px] text-ink-secondary">{state?.recoveryPending ? copy.recoveryPending : copy.recoveryHelp}</p>}
      <p className="mt-3 text-[12px] text-ink-secondary">{copy.disclosure}</p>
      {!unsupported && !failed && pending && (phase === "authorizing" || state?.login) && <p className="mt-2 text-[12px] text-ink-secondary">{copy.browserHelp}</p>}
      <div className="mt-3 min-w-0 space-y-2 text-[12.5px]">
        <label htmlFor={`${id}-bot`} className="block font-medium text-ink">{copy.botLabel}</label>
        <select id={`${id}-bot`} value={botId} disabled={unsupported || pending || !visibleBots.length}
          onChange={(event) => {
            const nextBotId = event.target.value;
            if (!visibleBots.some((bot) => bot.id === nextBotId)
              || !feishuActionAllowed("selectBot", native, nextBotId, available)) return;
            if (active) {
              setDraftBotId(null);
              if (nextBotId !== state?.botId) void native.invoke("selectBot", { botId: nextBotId });
            } else {
              setDraftBotId(nextBotId);
            }
          }}
          className="block w-full min-w-0 max-w-full rounded-lg border border-hairline bg-raised px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
          <option value="" disabled>{copy.chooseBot}</option>
          {visibleBots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
        </select>
        {!visibleBots.length && <p className="text-ink-secondary">{copy.noBots}</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {recovery && <button type="button"
          disabled={!feishuActionAllowed("recreateApp", native, botId, available)}
          onClick={() => {
            if (feishuActionAllowed("recreateApp", native, botId, available)) void native.invoke("recreateApp", { botId });
          }}
          className="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
          {state?.recoveryPending ? copy.recoveryResume : copy.recreate}
        </button>}
        {(!connected || failed || pending) && <button type="button"
          disabled={!feishuActionAllowed("oneClickConnect", native, botId, available)}
          onClick={() => {
            if (feishuActionAllowed("oneClickConnect", native, botId, available)) void native.invoke("oneClickConnect", { botId });
          }}
          className="rounded-lg bg-raised px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
          {failed ? copy.retry : copy.connect}
        </button>}
        {canStop && <button type="button"
          disabled={!feishuActionAllowed("disconnect", native, botId, available)}
          onClick={() => {
            if (feishuActionAllowed("disconnect", native, botId, available)) void native.invoke("disconnect");
          }}
          className="rounded-lg bg-raised px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
          {pending ? copy.cancel : copy.disconnect}
        </button>}
      </div>
      {canStop && <p className="mt-2 text-[12px] text-ink-secondary">{copy.disconnectHelp}</p>}
    </section>
  );
}
