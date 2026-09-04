import { cn } from "@/lib/cn";

export function EngineToggle({
  checked,
  busy,
  label,
  onChange,
}: {
  checked: boolean;
  busy: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy || undefined}
      aria-label={label}
      onClick={() => onChange(!checked)}
      disabled={busy}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full shadow-inner",
        "transition-[background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        "disabled:cursor-wait disabled:opacity-80",
        checked ? "bg-accent" : "bg-control",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm",
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}
