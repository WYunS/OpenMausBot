import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CloudBackendPicker } from "./CloudBackendPicker";

describe("CloudBackendPicker", () => {
  it("offers the Ruijie sandbox as an enabled backend", () => {
    const html = renderToStaticMarkup(createElement(CloudBackendPicker, {
      value: "box",
      vpsSupported: true,
      onChange: vi.fn(),
    }));

    expect(html).toContain("Ruijie sandbox");
    expect(html).not.toContain("Temporarily unavailable");
    expect(html).toMatch(/<button[^>]*>Ruijie sandbox<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Ruijie sandbox<\/button>/);
  });
});
