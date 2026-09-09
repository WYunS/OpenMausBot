import { useEffect, useRef, useState } from "react";
import type { FeishuAction, FeishuSnapshot } from "./model";
import { createFeishuSession } from "./session";

export function useFeishu(enabled: boolean) {
  const bridge = typeof window !== "undefined" && window.ogb?.platform === "win32"
    && !window.ogb.remoteClient?.active ? window.ogb?.feishu : undefined;
  const [snapshot, setSnapshot] = useState<FeishuSnapshot>({ state: null, busy: null, error: null });
  const session = useRef<ReturnType<typeof createFeishuSession> | null>(null);
  useEffect(() => {
    if (!enabled || !bridge) return;
    setSnapshot({ state: null, busy: null, error: null });
    const current = createFeishuSession(bridge, setSnapshot);
    session.current = current;
    return () => {
      current.dispose();
      session.current = null;
    };
  }, [bridge, enabled]);
  return {
    ...snapshot,
    available: Boolean(bridge),
    invoke: (action: FeishuAction, input?: { botId?: string }) => session.current?.invoke(action, input),
  };
}
