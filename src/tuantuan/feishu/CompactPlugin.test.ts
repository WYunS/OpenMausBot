import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { FeishuCard } from "./FeishuCard";
import { feishuCopy } from "../l10n/feishu";

const expanded = vi.hoisted(() => ({ value: false }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: () => [expanded.value, (value: boolean) => { expanded.value = value; }],
  useId: () => "compact-feishu",
}));
afterEach(() => { expanded.value = false; });
const props = {
  native: {
    available: true, busy: null, error: null, invoke: vi.fn(),
    state: { supported: true, cliPath: "", nodePath: "", botId: "one", im: "off" as const, toolsEnabled: false, userAuthorized: false, botAuthorized: false },
  },
  bots: [{ id: "one", name: "测试 bot" }], selectedBotId: "one",
};
function button(node: ReactNode): { onClick(): void } | undefined {
  if (Array.isArray(node)) return node.map(button).find(Boolean);
  if (!isValidElement<{ children?: ReactNode; onClick(): void }>(node)) return;
  return node.type === "button" ? node.props : button(node.props.children);
}
it("defaults to the standard compact application row with no bot chooser or setup panel", () => {
  const html = renderToStaticMarkup(createElement(FeishuCard, props));
  expect(html).toContain("min-h-[88px]");
  expect(html).toContain(feishuCopy.title);
  expect(html).toContain('src="/tuantuan/feishu-logo.jpg"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("<select");
  expect(html).not.toContain(feishuCopy.disclosure);
});
it("connect reveals configuration without starting any authorization", () => {
  button(FeishuCard(props))!.onClick();
  expect(expanded.value).toBe(true);
  expect(props.native.invoke).not.toHaveBeenCalled();
});
it("connected and failed states remain compact and expose a management action", () => {
  for (const state of [{ ...props.native.state, im: "ready" as const, toolsEnabled: true }, { ...props.native.state, phase: "error" as const, errorCode: "SCOPE_REQUIRED" }]) {
    const html = renderToStaticMarkup(createElement(FeishuCard, { ...props, native: { ...props.native, state } }));
    expect(html).not.toContain("<select");
    expect(html).not.toContain(feishuCopy.disclosure);
    expect(html).toContain(state.im === "ready" ? feishuCopy.manage : feishuCopy.retryShort);
  }
});
