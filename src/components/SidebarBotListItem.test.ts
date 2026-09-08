import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";

vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({}),
}));

import { ArchivedBotsButton, BotActionConfirmDialog, BotDeleteMenuItem, BotListItem } from "./Sidebar";

const bot = (overrides: Partial<Bot> = {}): Bot => ({
  id: "atlas",
  threadId: "thread-atlas",
  name: "Atlas",
  title: "",
  description: "",
  notifications: true,
  color: "green",
  unread: false,
  modelSelection: { instanceId: "claude", model: "test" },
  messages: [],
  ...overrides,
});

function renderRow(candidate: Bot, archiveDisabled: boolean) {
  return renderToStaticMarkup(createElement(
    StoreProvider,
    null,
    createElement(BotListItem, {
      bot: candidate,
      density: "comfortable",
      onMenu: vi.fn(),
      onArchive: vi.fn(),
      archiveDisabled,
    }),
  ));
}

describe("BotListItem", () => {
  it("leaves the full Chief card as one selectable hit area", () => {
    const markup = renderRow(bot({ chiefOfStaff: true }), false);

    expect(markup).toContain('data-sidebar-bot-row="atlas"');
    expect(markup).not.toContain('aria-label="Archive Atlas"');
  });

  it("renders the inline Archive action only when it is available", () => {
    expect(renderRow(bot(), true)).not.toContain('aria-label="Archive Atlas"');
    expect(renderRow(bot(), false)).toContain('aria-label="Archive Atlas"');
  });
});

describe("bot deletion feedback", () => {
  it("disables the destructive action while persistent computers are checked", () => {
    const markup = renderToStaticMarkup(createElement(BotDeleteMenuItem, {
      deleting: true,
      onClick: vi.fn(),
    }));

    expect(markup).toContain("Checking computers…");
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
  });

  it("offers Delete again after the check settles", () => {
    const markup = renderToStaticMarkup(createElement(BotDeleteMenuItem, {
      deleting: false,
      onClick: vi.fn(),
    }));

    expect(markup).toContain(">Delete</button>");
    expect(markup).not.toContain('disabled=""');
  });
});

describe("bot action confirmation", () => {
  it("explains that archiving keeps the conversation and can be reversed", () => {
    const markup = renderToStaticMarkup(createElement(BotActionConfirmDialog, {
      bot: bot(),
      action: "archive",
      busy: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    }));

    expect(markup).toContain("Archive Atlas?");
    expect(markup).toContain("conversation is kept");
    expect(markup).toContain("Archived bots");
    expect(markup).toContain(">Archive</button>");
  });

  it("makes permanent deletion and conversation loss explicit", () => {
    const markup = renderToStaticMarkup(createElement(BotActionConfirmDialog, {
      bot: bot(),
      action: "delete",
      busy: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    }));

    expect(markup).toContain("Delete Atlas permanently?");
    expect(markup).toContain("conversation history");
    expect(markup).toContain(">Delete permanently</button>");
  });
});

describe("archived bots navigation", () => {
  it("keeps a visible archived-bots entry with its count", () => {
    const markup = renderToStaticMarkup(createElement(ArchivedBotsButton, {
      count: 2,
      density: "comfortable",
      onClick: vi.fn(),
    }));

    expect(markup).toContain("Archived bots");
    expect(markup).toContain(">2</span>");
  });

  it("keeps the entry enabled and visually consistent when the archive is empty", () => {
    const markup = renderToStaticMarkup(createElement(ArchivedBotsButton, {
      count: 0,
      density: "comfortable",
      onClick: vi.fn(),
    }));

    expect(markup).toContain("Archived bots");
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain("opacity-45");
    expect(markup).toContain("hover:bg-raised/60");
  });
});
