import { describe, expect, it } from "vitest";
import {
  hostComputerIntent,
  shouldFallbackCloudToHost,
  shouldMountLocalComputer,
} from "./local-routing.ts";

describe("local computer routing", () => {
  it("never lets Linux Auto fall back to the user's desktop", () => {
    expect(
      shouldMountLocalComputer({
        requested: undefined,
        hostPlatform: "linux",
        providerSupportsLocal: true,
      }),
    ).toBe(false);
  });

  it("requires an explicit local selection and an approval-capable provider on Linux", () => {
    expect(
      shouldMountLocalComputer({
        requested: "local",
        hostPlatform: "linux",
        providerSupportsLocal: true,
      }),
    ).toBe(true);
    expect(
      shouldMountLocalComputer({
        requested: "local",
        hostPlatform: "linux",
        providerSupportsLocal: false,
      }),
    ).toBe(false);
  });

  it("mounts the local computer on Windows when explicitly selected and supported by the provider", () => {
    expect(
      shouldMountLocalComputer({
        requested: "local",
        hostPlatform: "win32",
        providerSupportsLocal: true,
      }),
    ).toBe(true);
    expect(
      shouldMountLocalComputer({
        requested: "local",
        hostPlatform: "win32",
        providerSupportsLocal: false,
      }),
    ).toBe(false);
  });

  it("preserves the established macOS Auto fallback", () => {
    expect(
      shouldMountLocalComputer({
        requested: undefined,
        hostPlatform: "darwin",
        providerSupportsLocal: true,
      }),
    ).toBe(true);
  });

  it("never mounts the local desktop for explicit cloud/off or on an unsupported host", () => {
    for (const requested of ["cloud", "off"] as const) {
      expect(
        shouldMountLocalComputer({
          requested,
          hostPlatform: "darwin",
          providerSupportsLocal: true,
        }),
      ).toBe(false);
    }
    expect(
      shouldMountLocalComputer({
        requested: "local",
        hostPlatform: "freebsd",
        providerSupportsLocal: true,
      }),
    ).toBe(false);
  });
});

describe("host computer intent", () => {
  it.each([
    "请在本机打开文件",
    "操作我这台电脑上的 Excel",
    "在当前电脑打开下载目录",
    "使用本台机器运行它",
    "用宿主机完成",
    "do this on my computer",
    "open it on the host machine",
  ])("recognises an explicit host request: %s", (text) => {
    expect(hostComputerIntent(text)).toBe("require");
  });

  it.each([
    "不要操作本机，用云电脑",
    "别碰我的电脑",
    "如果看到 Windows 本机就立即停止且绝不输入",
    "第一步必须确认是锐捷 Linux/Xfce 沙箱；如果看到 Windows 本机立即停止。",
    "do not use this computer",
  ])("recognises an explicit host prohibition: %s", (text) => {
    expect(hostComputerIntent(text)).toBe("forbid");
  });

  it.each([
    "打开电脑里的浏览器",
    "在桌面整理一下文件",
    "打开网页并搜索资料",
    "帮我处理这个任务",
    "刚才清理回合被本机 Bot 重启中断，现在继续锐捷沙箱",
  ])("keeps ambiguous computer language on the bound computer: %s", (text) => {
    expect(hostComputerIntent(text)).toBe("unspecified");
  });
});

describe("explicit cloud fallback", () => {
  it("fails closed when a Ruijie desktop bridge is unavailable", () => {
    expect(shouldFallbackCloudToHost({
      cloudBackend: "ruijie-sandbox",
      hostIntent: "unspecified",
    })).toBe(false);
  });

  it("preserves the existing fallback for ordinary Box/VPS computers", () => {
    expect(shouldFallbackCloudToHost({ cloudBackend: "box", hostIntent: "unspecified" })).toBe(true);
    expect(shouldFallbackCloudToHost({ cloudBackend: "vps", hostIntent: "require" })).toBe(true);
    expect(shouldFallbackCloudToHost({ cloudBackend: "box", hostIntent: "forbid" })).toBe(false);
  });
});
