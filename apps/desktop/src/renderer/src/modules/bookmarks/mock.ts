import type { ModuleMock } from "../../dev/mockTypes";

/** Preview only. No daemon endpoint: bookmarks are device preferences. Existing preview data wins. */
export const previewBookmarks = () => {
  const at = "2026-10-11T01:00:00Z";
  const turn = (sessionId: string, turnId: string, name: string, snippet: string, ordinal?: number) => ({ hostId: "local", kind: "turn", key: `${sessionId}:${turnId}`, title: ordinal ? `${name} · #${ordinal}` : name, params: { sessionId, turnId, ...(ordinal ? { ordinal: String(ordinal) } : {}) }, snapshot: { at, agentName: name, snippet } });
  const agent = (hostId: string, sessionId: string, title: string) => ({ hostId, kind: "agent", key: sessionId, title, params: { sessionId }, snapshot: { at, agentName: title } });
  const refs = [
    turn("eva", "turn-1", "Eva", "最初的设计讨论", 1),
    turn("wave", "wave-t36", "Wave-Director", "看看先前的这一轮，不离开当前阅读位置。", 36),
    turn("eva", "reverted-preview-turn", "Eva", "已撤销的来源轮：短片段仍可查找。"),
    agent("local", "mika", "Mika"),
    { hostId: "local", kind: "notes.note", key: "note-preview-1", title: "批注：旁注与聊天分开", params: { noteId: "note-preview-1" } },
    { hostId: "local", kind: "workspace.preview", key: "docs/DESIGN.md", title: "DESIGN.md", params: { path: "docs/DESIGN.md", sessionId: "eva" } },
    agent("preview-offline", "helper", "Offline helper"),
  ];
  return { version: 2 as const, records: refs.map((ref, index) => ({ id: `bookmark-preview-${index}`, createdAt: at, ref })) };
};
export const mock: ModuleMock = {
  start() {
    try { if (localStorage.getItem("cutex-desktop.module.bookmarks") === null) localStorage.setItem("cutex-desktop.module.bookmarks", JSON.stringify({ saved: previewBookmarks() })); } catch { /* preview storage can be disabled */ }
  },
};
