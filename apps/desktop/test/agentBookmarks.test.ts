// Agent bookmarks merge into pin (owner decision 3, 2026-10-16): no 加书签 for agents (sidebar agent
// menu, 收藏当前…); existing agent bookmarks stay listed under 全部书签; turn bookmarks stay per conversation.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppSlotEntry, RefActionItem } from "../src/renderer/src/modules/slots";
import { agentRef, parseRef, turnRef } from "../src/renderer/src/lib/refs";
import { refActionApplies } from "../src/renderer/src/lib/refActionApplies";
import { addBookmark, bookmarkable, EMPTY_BOOKMARKS, homeBookmarks, matchingBookmarks } from "../src/renderer/src/modules/bookmarks/model";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));

let bookmarkAction: RefActionItem;
beforeAll(async () => {
  const mod = (await import("../src/renderer/src/modules/bookmarks/index")).default;
  bookmarkAction = mod.contributes!["ref.action"]![0]! as RefActionItem;
});

const entry = (item: Partial<RefActionItem>, mode: AppSlotEntry<"ref.action">["mode"] = "show") =>
  ({ moduleId: "m", mode, missing: [], waiting: false, item: { id: "x", icon: (() => null) as unknown as RefActionItem["icon"], titleKey: "bookmarks.add", run() {}, ...item } }) as unknown as AppSlotEntry<"ref.action">;

describe("agent bookmarks merge into pin", () => {
  it("the bookmark ref action skips agents (no 加书签 in the agent menu) but stays on turns and the rest", () => {
    expect(bookmarkAction.kinds).toBeUndefined();
    expect(bookmarkAction.excludeKinds).toEqual(["agent"]);
    const e = entry({ excludeKinds: bookmarkAction.excludeKinds });
    expect(refActionApplies(e, "agent")).toBe(false);
    for (const kind of ["turn", "notes.note", "side.page", "main.page", "workspace.preview"]) expect(refActionApplies(e, kind)).toBe(true);
    // `kinds` still narrows; an item not shown never applies.
    expect(refActionApplies(entry({ kinds: ["turn"] }), "agent")).toBe(false);
    expect(refActionApplies(entry({}, "disable"), "turn")).toBe(false);
  });

  it("收藏当前… offers no agent", () => {
    expect(bookmarkable(agentRef("local", "mika", "Mika"))).toBe(false);
    expect(bookmarkable(turnRef({ hostId: "local", sessionId: "eva", turnId: "t1" }))).toBe(true);
  });

  it("existing agent bookmarks stay listed under 全部, not in another conversation's home list", () => {
    let doc = addBookmark(EMPTY_BOOKMARKS, agentRef("local", "sora", "Sora"), parseRef, "b1", "2026-10-16T00:00:00Z");
    doc = addBookmark(doc, turnRef({ hostId: "local", sessionId: "eva", turnId: "t1", agentName: "Eva" }), parseRef, "b2", "2026-10-16T00:00:01Z");
    expect(matchingBookmarks(doc).map((r) => r.id)).toEqual(["b2", "b1"]);
    // Mika's gutter: nothing here (the empty state then says 「本会话还没有 · 共 2 条 → 查看全部」).
    expect(homeBookmarks(doc.records, "local", "mika")).toEqual([]);
    expect(homeBookmarks(doc.records, "local", "eva").map((r) => r.id)).toEqual(["b2"]);
  });
});
