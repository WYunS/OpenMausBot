import { feishuCopy } from "../l10n/feishu";
import { feishuActionInterrupts, type FeishuAction, type FeishuBridge, type FeishuSnapshot } from "./model";

// Poll within an action's generation for progress; invalidate those reads when
// the action settles or is interrupted so they cannot restore cancelled state.
export function createFeishuSession(bridge: FeishuBridge, publish: (snapshot: FeishuSnapshot) => void) {
  let alive = true;
  let generation = 0;
  let polling = false;
  let lastPoll = -Infinity;
  let snapshot: FeishuSnapshot = { state: null, busy: null, error: null };
  const update = (patch: Partial<FeishuSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    publish(snapshot);
  };
  const poll = async () => {
    if (!alive || polling || snapshot.busy === "disconnect") return;
    const fast = snapshot.state?.pending || ["oneClickConnect", "recreateApp", "selectBot"].includes(snapshot.busy ?? "");
    if (Date.now() - lastPoll < (fast ? 400 : 2000)) return;
    lastPoll = Date.now();
    polling = true;
    const request = generation;
    try {
      const state = await bridge.state();
      if (alive && request === generation) update({ state, error: snapshot.error === feishuCopy.actionFailed ? snapshot.error : null });
    } catch {
      if (alive && request === generation && snapshot.error !== feishuCopy.actionFailed) update({ error: feishuCopy.readFailed });
    } finally {
      polling = false;
    }
  };
  const timer = setInterval(() => void poll(), 400);
  void poll();
  return {
    async invoke(action: FeishuAction, input?: { botId?: string }) {
      if (!alive || (snapshot.busy && !feishuActionInterrupts(action, snapshot.busy))) return;
      const request = ++generation;
      const starting = action === "oneClickConnect" || action === "recreateApp";
      update({ busy: action, error: null,
        ...(starting && snapshot.state ? { state: { ...snapshot.state, pending: true, phase: "detecting",
          error: undefined, errorCode: undefined, im: "off", toolsEnabled: false } } : {}),
      });
      try {
        const state = await bridge.invoke(action, input);
        if (alive && request === generation) update({ state, error: null });
      } catch {
        if (alive && request === generation) update({ error: feishuCopy.actionFailed });
      } finally {
        if (alive && request === generation) {
          generation++;
          update({ busy: null });
        }
      }
    },
    dispose() {
      alive = false;
      generation++;
      clearInterval(timer);
    },
  };
}
