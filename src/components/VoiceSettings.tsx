// Per-agent voice profile. The key is shared; the voice and autoplay choice
// belong to the selected bot.
//
// The voice list comes from the harness, which holds the key — the
// renderer never talks to ElevenLabs itself.
import { useEffect, useState } from "react";
import { Check, Loader2, Volume2 } from "lucide-react";

import { api, useStore, type Bot, type ConfigStatus } from "@/state/store";
import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { speaker } from "@/lib/tts";
import {
  listLocalSystemVoices,
  localSystemVoicesAvailable,
  remoteSystemVoice,
  remoteVoiceProvider,
  setRemoteSystemVoice,
  setRemoteVoiceProvider,
  type RemoteVoiceProvider,
} from "@/lib/local-voice";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { Switch } from "./SettingsPrimitives";

const SAMPLE = "Morning. Overnight the tests went green, and I left two notes for you in the thread.";

export function VoiceSettings({
  bot,
  onPatch,
  workspaceConfigurationLocked = false,
}: {
  bot: Bot;
  onPatch: (patch: Partial<Pick<Bot, "voice" | "speakReplies">>) => void;
  workspaceConfigurationLocked?: boolean;
}) {
  const { state, dispatch } = useStore();
  const tts = state.config?.tts;

  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<Array<{ id: string; label: string; description?: string }>>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);

  const { capabilities } = useDesktopCapabilities();
  const localMacClient = workspaceConfigurationLocked && localSystemVoicesAvailable();
  const [deviceProvider, setDeviceProvider] = useState<RemoteVoiceProvider>(() => remoteVoiceProvider());
  const [deviceVoice, setDeviceVoice] = useState(() => remoteSystemVoice(bot.id));
  const usesLocalSystem = localMacClient && deviceProvider === "system";
  // Host configuration still controls host-rendered ElevenLabs audio. A
  // paired Mac owns its installed-voice choice locally.
  const provider = tts?.provider ?? "elevenlabs";
  const systemVoicesAvailable = capabilities.host.platform === "darwin";
  const hostConfigured = Boolean(tts?.configured);
  const configured = usesLocalSystem || hostConfigured;

  useEffect(() => {
    setDeviceVoice(remoteSystemVoice(bot.id));
  }, [bot.id]);

  useEffect(() => {
    if (usesLocalSystem) {
      const load = () => setVoices(listLocalSystemVoices());
      load();
      window.speechSynthesis.addEventListener("voiceschanged", load);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
    }
    if (!hostConfigured) {
      setVoices([]);
      return;
    }
    let alive = true;
    setLoadingVoices(true);
    api("/api/tts/voices")
      .then((r: { voices?: typeof voices; error?: string }) => {
        if (!alive) return;
        setVoices(r.voices ?? []);
        if (r.error) setError(r.error);
      })
      .catch(() => alive && setVoices([]))
      .finally(() => alive && setLoadingVoices(false));
    return () => {
      alive = false;
    };
  }, [hostConfigured, provider, usesLocalSystem]);

  const chooseDeviceProvider = (next: RemoteVoiceProvider) => {
    setRemoteVoiceProvider(next);
    setDeviceProvider(next);
    setError(null);
  };

  const chooseVoice = (voiceId: string) => {
    if (usesLocalSystem) {
      setRemoteSystemVoice(bot.id, voiceId);
      setDeviceVoice(voiceId);
      return;
    }
    onPatch({ voice: voiceId });
  };

  const setProvider = (next: "elevenlabs" | "system") => {
    if (next === provider || switching || (next === "system" && !systemVoicesAvailable)) return;
    setSwitching(true);
    setError(null);
    // the provider is a setting, not a secret — it rides the ordinary
    // config write, and the key row reappears or disappears with it
    api("/api/config", { method: "PUT", body: JSON.stringify({ tts: { provider: next } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSwitching(false));
  };

  const saveKey = () => {
    const nextKey = key.trim();
    if (!nextKey) return Promise.resolve();
    setSaving(true);
    setError(null);
    const request = window.ogb?.setCredential
      ? window.ogb.setCredential("ttsKey", nextKey)
      : api("/api/config", { method: "PUT", body: JSON.stringify({ tts: { key: nextKey } }) });
    return request
      .then((status: ConfigStatus) => {
        dispatch({ type: "configStatus", config: status });
        setKey("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  if (!tts) return null;

  const selectedVoice = usesLocalSystem ? deviceVoice : (bot.voice ?? "");
  const ready = usesLocalSystem || (hostConfigured && Boolean(selectedVoice || tts.voice));

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">{t("botSettings.voice.title")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        {localMacClient
          ? t("botSettings.voice.macHelp")
          : workspaceConfigurationLocked
            ? t("botSettings.voice.agentHelp")
            : <>{t("botSettings.voice.workspaceHelp")}
              {provider === "system"
                ? systemVoicesAvailable
                  ? t("botSettings.voice.systemVoicesHelp")
                  : t("botSettings.voice.systemUnavailableHelp")
                : t("botSettings.voice.sharedKeyHelp")}</>}
      </div>

      {localMacClient && (
        <div className="mt-4">
          <div className="mb-2 text-[13px] text-ink-secondary">{t("botSettings.voice.outputMac")}</div>
          <div className="inline-flex rounded-xl bg-inset p-1" role="radiogroup" aria-label={t("botSettings.voice.outputMac")}>
            {([
              { value: "system", label: t("botSettings.voice.macVoices"), available: true },
              { value: "host", label: provider === "elevenlabs" ? t("botSettings.voice.hostElevenLabs") : t("botSettings.voice.hostVoice"), available: hostConfigured },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={deviceProvider === option.value}
                disabled={!option.available}
                title={!option.available ? t("botSettings.voice.hostNotConfigured") : undefined}
                onClick={() => chooseDeviceProvider(option.value)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-50",
                  deviceProvider === option.value ? "bg-raised text-ink shadow" : "text-ink-secondary hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!workspaceConfigurationLocked && (systemVoicesAvailable || provider === "system") && (
        <div className="mt-4">
          <div className="mb-2 text-[13px] text-ink-secondary">{t("botSettings.voice.engine")}</div>
          <div className="inline-flex rounded-xl bg-inset p-1" role="radiogroup" aria-label={t("botSettings.voice.engine")}>
            {([
              { value: "elevenlabs", label: "ElevenLabs", available: true },
              { value: "system", label: t("botSettings.voice.macVoices"), available: systemVoicesAvailable },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={provider === option.value}
                disabled={switching || !option.available}
                title={!option.available ? t("botSettings.voice.macOnly") : undefined}
                onClick={() => setProvider(option.value)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-50",
                  provider === option.value ? "bg-raised text-ink shadow" : "text-ink-secondary hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!workspaceConfigurationLocked && provider === "elevenlabs" && (
        <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
          <span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-raised-hover")} />
          <span>{t("botSettings.voice.elevenLabsKey")}</span>
          {configured && <span className="text-[11px] text-success">{t("common.connected")}</span>}
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && key.trim() && void saveKey()}
            placeholder={configured ? t("botSettings.voice.replaceKey") : t("botSettings.voice.keyPlaceholder")}
            aria-label={t("botSettings.voice.elevenLabsKey")}
            autoComplete="off"
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
          />
          <button
            onClick={() => void saveKey()}
            disabled={saving || !key.trim()}
            className="flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />{t("common.save")}</>}
          </button>
        </div>
        {!configured && (
          <a
            href="https://elevenlabs.io/app/settings/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block text-[12px] font-medium text-accent hover:underline"
          >
            {t("botSettings.voice.getKey")}
          </a>
        )}
        </div>
      )}

      {configured && (
        <div className="mt-4">
          <div className="mb-1.5 text-[13px] text-ink-secondary">{t("botSettings.voice.title")}</div>
          <div className="flex gap-2">
            <select
              value={selectedVoice}
              onChange={(e) => chooseVoice(e.target.value)}
              aria-label={t("botSettings.voice.botVoiceAria", { name: bot.name })}
              className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink focus:border-hairline focus:outline-none"
            >
              <option value="">
                {loadingVoices
                  ? t("botSettings.voice.loading")
                  : usesLocalSystem
                    ? t("botSettings.voice.macDefault")
                    : tts.voice
                      ? t("botSettings.voice.workspaceDefault")
                      : t("botSettings.voice.pick")}
              </option>
              {selectedVoice && !voices.some((voice) => voice.id === selectedVoice) && (
                <option value={selectedVoice}>{t("botSettings.voice.current")}</option>
              )}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.description ? ` — ${v.description}` : ""}
                </option>
              ))}
            </select>
            <button
              onClick={() => void speaker.speak(SAMPLE, { voiceId: bot.voice, botId: bot.id })}
              disabled={!ready}
              title={ready ? t("botSettings.voice.hear") : t("botSettings.voice.pickFirst")}
              aria-label={t("botSettings.voice.hear")}
              className="flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Volume2 size={14} /> {t("botSettings.voice.try")}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-hairline/40 pt-4">
        <div>
          <div className="text-[13px] font-medium text-ink">{t("botSettings.voice.readAloud")}</div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">
            {t("botSettings.voice.readAloudHelp")}
          </div>
        </div>
        <Switch
          checked={Boolean(bot.speakReplies)}
          aria-label={t("botSettings.voice.readAloudAria")}
          onClick={() => onPatch({ speakReplies: !bot.speakReplies })}
        />
      </div>

      {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
