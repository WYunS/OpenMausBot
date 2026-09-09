import { isValidElement, type ChangeEvent, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { FeishuSetup as FeishuCard } from "./FeishuCard";
import { feishuCopy as copy } from "../l10n/feishu";
import type { FeishuBot, FeishuSnapshot } from "./model";

// Exercise the card's actual handlers and controlled values without a DOM dependency.
const draft = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useId: () => "feishu-test",
  useState: () => [draft.value, (value: string | null) => { draft.value = value; }],
}));

afterEach(() => { draft.value = null; });

const initial: FeishuSnapshot = {
  state: { supported: true, cliPath: "", nodePath: "", botId: "", im: "off", toolsEnabled: false, userAuthorized: false, botAuthorized: false },
  busy: null, error: null,
};
const bots: FeishuBot[] = [{ id: "bot-1", name: "甲" }, { id: "bot-2", name: "乙" }, { id: "hidden", name: "隐藏", hidden: true }];

function controls(node: ReactNode, type: "button" | "select") {
  const result: { children?: ReactNode; disabled?: boolean; value?: string; onClick?: () => void; onChange?: (event: ChangeEvent<HTMLSelectElement>) => void }[] = [];
  function visit(child: ReactNode) {
    if (Array.isArray(child)) return child.forEach(visit);
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type === type) result.push(child.props);
    visit(child.props.children);
  }
  visit(node);
  return result;
}

it("chooses a bot locally before connecting and sends exactly one oneClickConnect action", () => {
  const invoke = vi.fn();
  const render = () => FeishuCard({ native: { ...initial, available: true, invoke }, bots, selectedBotId: "bot-1" });
  controls(render(), "select")[0].onChange?.({ target: { value: "bot-2" } } as ChangeEvent<HTMLSelectElement>);
  expect(invoke).not.toHaveBeenCalled();
  expect(controls(render(), "select")[0].value).toBe("bot-2");
  controls(render(), "button")[0].onClick?.();
  expect(invoke.mock.calls).toEqual([["oneClickConnect", { botId: "bot-2" }]]);
});

it("switches an active bot natively without reconnecting or optimistically changing the binding", () => {
  const invoke = vi.fn();
  let snapshot: FeishuSnapshot = { ...initial, state: { ...initial.state!, im: "ready", toolsEnabled: true, botId: "bot-1" } };
  const render = () => FeishuCard({ native: { ...snapshot, available: true, invoke }, bots, selectedBotId: "bot-1" });
  controls(render(), "select")[0].onChange?.({ target: { value: "bot-2" } } as ChangeEvent<HTMLSelectElement>);
  expect(invoke.mock.calls).toEqual([["selectBot", { botId: "bot-2" }]]);
  expect(controls(render(), "select")[0].value).toBe("bot-1");
  snapshot = { ...snapshot, busy: "selectBot" };
  expect(controls(render(), "select")[0].disabled).toBe(true);
  snapshot = { ...snapshot, busy: null, state: { ...snapshot.state!, botId: "bot-2" } };
  expect(controls(render(), "select")[0].value).toBe("bot-2");
  expect(controls(render(), "select")[0].disabled).toBe(false);
  expect(controls(render(), "button").map((button) => button.children)).toEqual([copy.disconnect]);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("retains the native bot on a failed switch, with retry and no latent action", () => {
  const invoke = vi.fn();
  const ready = { ...initial, state: { ...initial.state!, botId: "bot-1", im: "ready" as const, toolsEnabled: true } };
  const props = { native: { ...ready, available: true, invoke }, bots, selectedBotId: "bot-1" };
  controls(FeishuCard(props), "select")[0].onChange?.({ target: { value: "bot-2" } } as ChangeEvent<HTMLSelectElement>);
  const failed = FeishuCard({ ...props, native: { ...props.native, error: copy.actionFailed } });
  expect(controls(failed, "select")[0].value).toBe("bot-1");
  expect(controls(failed, "button").map((button) => button.children)).toEqual([copy.retry, copy.disconnect]);
  expect(invoke.mock.calls).toEqual([["selectBot", { botId: "bot-2" }]]);
});

it("never queues connection when bots are missing, hidden or later become available", () => {
  const invoke = vi.fn();
  for (const availableBots of [[], bots.filter((bot) => bot.hidden)]) {
    const card = FeishuCard({ native: { ...initial, available: true, invoke }, bots: availableBots, selectedBotId: "bot-1" });
    expect(controls(card, "button")[0].disabled).toBe(true);
    controls(card, "button")[0].onClick?.();
    controls(card, "select")[0].onChange?.({ target: { value: "hidden" } } as ChangeEvent<HTMLSelectElement>);
  }
  const card = FeishuCard({ native: { ...initial, available: true, invoke }, bots, selectedBotId: "bot-1" });
  expect(controls(card, "button")[0].disabled).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});

it("allows cancel but no connect or bot switch while busy even if an interim read says ready", () => {
  const invoke = vi.fn();
  const card = FeishuCard({ native: { ...initial, state: { ...initial.state!, phase: "ready", im: "ready", toolsEnabled: true, botId: "bot-1" }, busy: "oneClickConnect", available: true, invoke }, bots, selectedBotId: "bot-1" });
  const buttons = controls(card, "button");
  expect(buttons.map((button) => button.children)).toEqual([copy.connect, copy.cancel]);
  expect(buttons[0].disabled).toBe(true);
  buttons[0].onClick?.();
  controls(card, "select")[0].onChange?.({ target: { value: "bot-2" } } as ChangeEvent<HTMLSelectElement>);
  expect(buttons[1].disabled).toBe(false);
  buttons[1].onClick?.();
  expect(invoke.mock.calls).toEqual([["disconnect"]]);
});

it("retries uncertain initialization through the same host action, with no renderer confirmation flags", () => {
  const invoke = vi.fn();
  const card = FeishuCard({ native: { ...initial, state: { ...initial.state!, errorCode: "INITIALIZATION_UNCERTAIN", phase: "error" }, available: true, invoke }, bots, selectedBotId: "bot-1" });
  const buttons = controls(card, "button");
  expect(buttons.map((button) => button.children)).toEqual([copy.retry, copy.disconnect]);
  expect(buttons[0].disabled).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  buttons[0].onClick?.();
  expect(invoke.mock.calls).toEqual([["oneClickConnect", { botId: "bot-1" }]]);
});

it("offers explicit browser recreation for an unavailable app, never a silent replacement", () => {
  const invoke = vi.fn();
  const props = { native: { ...initial, state: { ...initial.state!, errorCode: "APP_UNAVAILABLE", phase: "error" as const },
    available: true, invoke }, bots, selectedBotId: "bot-1" };
  const card = FeishuCard(props);
  expect(invoke).not.toHaveBeenCalled();
  const recreate = controls(card, "button").find((button) => button.children === copy.recreate);
  expect(recreate?.disabled).toBe(false);
  recreate?.onClick?.();
  expect(invoke.mock.calls).toEqual([["recreateApp", { botId: "bot-1" }]]);
});

it.each(["CONFIG_EXISTS", "CONFIG_NOT_EMPTY"])("offers explicit safe recreation after interrupted setup reports %s", (errorCode) => {
  const invoke = vi.fn();
  const props = { native: { ...initial, state: { ...initial.state!, errorCode, phase: "error" as const },
    available: true, invoke }, bots, selectedBotId: "bot-1" };
  const recreate = controls(FeishuCard(props), "button").find((button) => button.children === copy.recreate);
  expect(recreate?.disabled).toBe(false);
  recreate?.onClick?.();
  expect(invoke.mock.calls).toEqual([["recreateApp", { botId: "bot-1" }]]);
});
