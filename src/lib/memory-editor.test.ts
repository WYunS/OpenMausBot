import { describe, expect, it } from "vitest";
import { initialMemoryEditor, memoryEditorReducer } from "./memory-editor";

const loaded = (path: string, text = "", hash = "initial") => ({
  type: "loaded" as const, doc: { path, text, hash, exists: true },
});

describe("memory editor drafts", () => {
  it("keeps separate unsaved main and topic drafts when switching back and forth", () => {
    let state = memoryEditorReducer(initialMemoryEditor, loaded("MEMORY.md", "Saved note"));
    state = memoryEditorReducer(state, { type: "edit", path: "MEMORY.md", text: "Unsaved main note" });
    state = memoryEditorReducer(state, { type: "select", path: "memory/client.md" });
    state = memoryEditorReducer(state, loaded("memory/client.md", "Client note"));
    state = memoryEditorReducer(state, { type: "edit", path: "memory/client.md", text: "Unsaved client note" });
    state = memoryEditorReducer(state, { type: "select", path: "MEMORY.md" });
    state = memoryEditorReducer(state, loaded("MEMORY.md", "Saved note"));
    expect(state.drafts["MEMORY.md"]).toMatchObject({ text: "Unsaved main note", dirty: true, hash: "initial" });
    expect(state.drafts["memory/client.md"]).toMatchObject({ text: "Unsaved client note", dirty: true });
  });

  it("applies a completed save's hash without erasing text entered after that save", () => {
    let state = memoryEditorReducer(initialMemoryEditor, loaded("MEMORY.md"));
    state = memoryEditorReducer(state, { type: "edit", path: "MEMORY.md", text: "Submitted note" });
    state = memoryEditorReducer(state, { type: "edit", path: "MEMORY.md", text: "Submitted note\nNew typing" });
    state = memoryEditorReducer(state, {
      type: "saved", sent: { path: "MEMORY.md", text: "Submitted note" },
      doc: { path: "MEMORY.md", text: "Submitted note", hash: "saved-hash", exists: true },
    });
    expect(state.drafts["MEMORY.md"]).toMatchObject({ text: "Submitted note\nNew typing", hash: "saved-hash", dirty: true });
  });

  it("does not switch the selected file when an older file save or fetch completes", () => {
    let state = memoryEditorReducer(initialMemoryEditor, loaded("MEMORY.md", "Main"));
    state = memoryEditorReducer(state, { type: "select", path: "memory/topic.md" });
    state = memoryEditorReducer(state, loaded("memory/topic.md", "Topic"));
    state = memoryEditorReducer(state, {
      type: "saved", sent: { path: "MEMORY.md", text: "Main" },
      doc: { path: "MEMORY.md", text: "Main", hash: "next", exists: true },
    });
    state = memoryEditorReducer(state, loaded("MEMORY.md", "Main", "next"));
    expect(state.path).toBe("memory/topic.md");
    expect(state.drafts["memory/topic.md"]?.text).toBe("Topic");
    expect(state.drafts["MEMORY.md"]?.dirty).toBe(false);
  });

  it("discards only the explicitly selected draft and keeps conflict recovery file-scoped", () => {
    let state = memoryEditorReducer(initialMemoryEditor, loaded("MEMORY.md", "Main"));
    state = memoryEditorReducer(state, { type: "edit", path: "MEMORY.md", text: "My main draft" });
    state = memoryEditorReducer(state, { type: "conflict", path: "MEMORY.md", current: "Bot note", currentHash: "bot-hash" });
    state = memoryEditorReducer(state, { type: "reloadConflict", path: "MEMORY.md" });
    expect(state.drafts["MEMORY.md"]).toMatchObject({ text: "Bot note", savedDraft: "My main draft", hash: "bot-hash", dirty: false });
    state = memoryEditorReducer(state, { type: "select", path: "memory/topic.md" });
    state = memoryEditorReducer(state, loaded("memory/topic.md", "Saved topic"));
    state = memoryEditorReducer(state, { type: "edit", path: "memory/topic.md", text: "Topic draft" });
    state = memoryEditorReducer(state, { ...loaded("memory/topic.md", "Saved topic"), discard: { text: "Topic draft", hash: "initial" } });
    expect(state.drafts["memory/topic.md"]).toMatchObject({ text: "Saved topic", dirty: false });
    expect(state.drafts["MEMORY.md"]?.savedDraft).toBe("My main draft");
  });

  it("does not discard new typing that happened while a discard reload was pending", () => {
    let state = memoryEditorReducer(initialMemoryEditor, loaded("MEMORY.md", "Saved"));
    state = memoryEditorReducer(state, { type: "edit", path: "MEMORY.md", text: "Discard this version" });
    const discard = { ...loaded("MEMORY.md", "Saved"), discard: { text: "Discard this version", hash: "initial" } };
    state = memoryEditorReducer(state, { type: "edit", path: "MEMORY.md", text: "Newer typing" });
    state = memoryEditorReducer(state, discard);
    expect(state.drafts["MEMORY.md"]).toMatchObject({ text: "Newer typing", dirty: true });
  });
});
