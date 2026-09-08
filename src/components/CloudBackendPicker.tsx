// The Box / Self-hosted VPS segmented control shown under the "Runs on"
// picker whenever a bot can end up on a cloud computer. One component, two
// homes (ComputerPanel and the bot settings dialog's Access section), so the copy and the disabled
// rules can never drift apart.
import type { CloudBackend } from "../../server/contracts.ts";
import { RUIJIE_SANDBOX_ENABLED, RUIJIE_SANDBOX_UNAVAILABLE_MESSAGE } from "../../server/product-features";
import { cn } from "@/lib/cn";

export function CloudBackendPicker({
  value,
  compact = false,
  vpsSupported,
  onChange,
}: {
  value: CloudBackend;
  compact?: boolean;
  vpsSupported: boolean;
  onChange: (backend: CloudBackend) => void;
}) {
  return (
    <div className="mt-3 rounded-lg bg-inset p-3">
      <div className="text-[12px] font-medium text-ink">{compact ? "Cloud provider" : "Cloud backend"}</div>
      <div className="mt-0.5 text-[11.5px] text-ink-secondary">
        {compact
          ? value === "vps" ? "Your own server, connected over SSH." : "A hosted computer managed by Box."
          : value === "vps"
          ? "Auto reuses a running VPS by default. Enable Start VPS automatically to let Auto create or wake its managed container, or choose Cloud to do it explicitly. Open the live desktop securely from the computer panel."
          : value === "ruijie-sandbox"
            ? "Creates a pooled Ruijie Linux sandbox with live preview, VNC Take Control, and visual mouse-and-keyboard tools for the bot."
          : "Box is the default hosted computer. Choose Self-hosted VPS to use your SSH-configured Linux Docker host."}
      </div>
      <div className="mt-2 flex overflow-hidden rounded-lg border border-hairline/40">
        {(["box", "vps", "ruijie-sandbox"] as const).map((backend, i) => {
          const disabled = (backend === "vps" && !vpsSupported) || (backend === "ruijie-sandbox" && !RUIJIE_SANDBOX_ENABLED);
          const title = backend === "ruijie-sandbox" && !RUIJIE_SANDBOX_ENABLED
            ? RUIJIE_SANDBOX_UNAVAILABLE_MESSAGE
            : disabled
              ? "Self-hosted VPS requires Claude or an ACP engine"
              : undefined;
          return (
            <button
              key={backend}
              disabled={disabled}
              title={title}
              onClick={() => onChange(backend)}
              className={cn(
                "flex-1 py-1.5 text-[12px]",
                i > 0 && "border-l border-hairline/40",
                disabled && "cursor-not-allowed opacity-40",
                value === backend ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
              )}
            >
              {backend === "vps" ? "Self-hosted VPS" : backend === "ruijie-sandbox" ? "Ruijie sandbox" : "Box"}
            </button>
          );
        })}
      </div>
      {!RUIJIE_SANDBOX_ENABLED && <div className="mt-1.5 text-[11px] text-ink-secondary">Ruijie sandbox · Temporarily unavailable</div>}
    </div>
  );
}
