import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CloudBackendPicker } from "./CloudBackendPicker";

describe("CloudBackendPicker", () => {
  it("keeps the Ruijie sandbox visible but unavailable for release", () => {
    const html = renderToStaticMarkup(createElement(CloudBackendPicker, {
      value: "box",
      vpsSupported: true,
      onChange: vi.fn(),
    }));

    expect(html).toContain("Ruijie sandbox");
    expect(html).toContain("Temporarily unavailable");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Ruijie sandbox is temporarily unavailable"[^>]*>Ruijie sandbox/);
  });
});
