import { Loader2, LogOut } from "lucide-react";

export function AccountSignOutConfirm({
  email,
  busy,
  onCancel,
  onConfirm,
}: {
  email?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div role="alertdialog" aria-labelledby="sign-out-title" className="px-2.5 py-2">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-control text-ink-secondary">
          <LogOut size={15} />
        </span>
        <div className="min-w-0 pt-0.5">
          <div id="sign-out-title" className="text-[13.5px] font-semibold text-ink">退出当前账号？</div>
          <div className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">
            {email ? <span className="block truncate">{email}</span> : null}
            之后可以重新登录。
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="flex min-w-[94px] items-center justify-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-raised-hover disabled:opacity-60"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
          确认退出登录
        </button>
      </div>
    </div>
  );
}
