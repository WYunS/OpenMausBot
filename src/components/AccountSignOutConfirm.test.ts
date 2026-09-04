import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountSignOutConfirm } from "./AccountSignOutConfirm";

describe("AccountSignOutConfirm", () => {
  it("requires a distinct confirmation action and keeps cancellation available", () => {
    const markup = renderToStaticMarkup(createElement(AccountSignOutConfirm, {
      email: "user@ruijie.com.cn",
      busy: false,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }));

    expect(markup).toContain("退出当前账号？");
    expect(markup).toContain("user@ruijie.com.cn");
    expect(markup).toContain("取消");
    expect(markup).toContain("确认退出登录");
  });
});
