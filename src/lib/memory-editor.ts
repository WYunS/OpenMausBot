import { MEMORY_INDEX, type MemoryDoc } from "./memory";

export interface MemoryDraft {
  path: string;
  text: string;
  hash: string;
  dirty: boolean;
  readOnly: boolean;
  conflict?: { current: string; currentHash: string };
  savedDraft?: string | null;
}

export interface MemoryEditorState {
  path: string;
  drafts: Record<string, MemoryDraft>;
}

export const initialMemoryEditor: MemoryEditorState = { path: MEMORY_INDEX, drafts: {} };

type MemoryEditorAction =
  | { type: "select"; path: string }
  | { type: "loaded"; doc: MemoryDoc; discard?: Pick<MemoryDraft, "text" | "hash">; initialText?: string }
  | { type: "edit"; path: string; text: string }
  | { type: "saved"; sent: Pick<MemoryDraft, "path" | "text">; doc: MemoryDoc }
  | { type: "conflict"; path: string; current: string; currentHash: string }
  | { type: "reloadConflict"; path: string }
  | { type: "dismissDraft"; path: string }
  | { type: "remove"; path: string };

export function memoryEditorReducer(state: MemoryEditorState, action: MemoryEditorAction): MemoryEditorState {
  if (action.type === "select") return { ...state, path: action.path };
  const path = action.type === "loaded" ? action.doc.path : action.type === "saved" ? action.sent.path : action.path;
  const current = state.drafts[path];
  const put = (draft: MemoryDraft): MemoryEditorState => ({ ...state, drafts: { ...state.drafts, [path]: draft } });
  if (action.type === "loaded") {
    if (current?.dirty && (!action.discard || current.text !== action.discard.text || current.hash !== action.discard.hash)) return state;
    return put({
      path, text: action.doc.text || action.initialText || "", hash: action.doc.hash,
      dirty: action.initialText !== undefined, readOnly: path.startsWith("memory/log/"),
      savedDraft: current?.savedDraft,
    });
  }
  if (action.type === "remove") {
    const drafts = { ...state.drafts };
    delete drafts[path];
    return { path: state.path === path ? MEMORY_INDEX : state.path, drafts };
  }
  if (!current) return state;
  switch (action.type) {
    case "edit":
      return put({ ...current, text: action.text, dirty: true });
    case "saved": {
      const text = current.text === action.sent.text ? action.doc.text : current.text;
      return put({ ...current, text, hash: action.doc.hash, dirty: text !== action.doc.text, conflict: undefined, savedDraft: null });
    }
    case "conflict":
      return put({ ...current, conflict: { current: action.current, currentHash: action.currentHash } });
    case "reloadConflict":
      return current.conflict ? put({
        ...current, savedDraft: current.text, text: current.conflict.current,
        hash: current.conflict.currentHash, dirty: false, conflict: undefined,
      }) : state;
    case "dismissDraft":
      return put({ ...current, savedDraft: null });
  }
}
