import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EngineToggle } from "./EngineToggle";

describe("EngineToggle", () => {
  it("parks the thumb on the left when off and slides it right when on", () => {
    const off = renderToStaticMarkup(createElement(EngineToggle, {
      checked: false,
      busy: false,
      label: "开启 Grok",
      onChange: () => undefined,
    }));
    const on = renderToStaticMarkup(createElement(EngineToggle, {
      checked: true,
      busy: false,
      label: "关闭 Codex",
      onChange: () => undefined,
    }));

    expect(off).toContain("left-0.5");
    expect(off).toContain("translate-x-0");
    expect(on).toContain("translate-x-4");
    expect(on).toContain("motion-reduce:transition-none");
    expect(off).toContain('aria-checked="false"');
    expect(on).toContain('aria-checked="true"');
  });
});
