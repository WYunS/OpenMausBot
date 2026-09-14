import { describe, expect, it, vi } from "vitest";

import { botSettingsCloseHandlers } from "./bot-settings-close";

describe("bot settings close interaction", () => {
  it("closes on pointer-up even when Electron never synthesizes a click", () => {
    const close = vi.fn();
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    const handlers = botSettingsCloseHandlers(close);

    handlers.onPointerDown({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();

    handlers.onPointerUp({ stopPropagation, preventDefault });
    expect(close).toHaveBeenCalledOnce();

    handlers.onClick({ stopPropagation, preventDefault });
    expect(stopPropagation).toHaveBeenCalledTimes(3);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it("still closes from a keyboard-generated click", () => {
    const close = vi.fn();
    const handlers = botSettingsCloseHandlers(close);
    handlers.onClick({ stopPropagation: vi.fn(), preventDefault: vi.fn() });
    expect(close).toHaveBeenCalledOnce();
  });
});
