// 托盘 = 任务栏 (lib/trayOpen, docs/design/001-tray-taskbar.md): the open items as read back (malformed dropped),
// added newest first (deduped, capped), the layout watch seeing a replace (the same pane, another agent) and
// the open list after it (the replaced one joins, agents on screen leave).
import { describe, expect, it, vi } from "vitest";
import { layoutChange, MAX_OPEN, openAfter, readOpen, withOpen, withoutOpen, type OpenAgent } from "../src/renderer/src/lib/trayOpen";
import { addConversationColumn, bindPane, conversationPanes, defaultLayout, MAIN_PANE, type PaneLayout } from "../src/renderer/src/lib/paneLayout";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const one = (sessionId: string | null = "A"): PaneLayout => defaultLayout({ sidebarOpen: true, sidebarWidth: 240, hostId: "local", sessionId });
const two = (a = "A", b = "B"): PaneLayout => addConversationColumn(one(a), { hostId: "local", sessionId: b }, 1);
const o = (sessionId: string, at = 0, extra: Partial<OpenAgent> = {}): OpenAgent => ({ hostId: "local", sessionId, at, ...extra });

describe("readOpen", () => {
  it("malformed input: nothing", () => {
    expect(readOpen(null)).toEqual([]);
    expect(readOpen("x")).toEqual([]);
    expect(readOpen({ open: "x" })).toEqual([]);
    expect(readOpen([o("A")])).toEqual([]);
  });

  it("drops malformed entries and duplicates; keeps a valid side; a bad `at` reads 0", () => {
    const raw = {
      v: 1,
      open: [null, 3, { hostId: "local" }, { hostId: "", sessionId: "A" }, { hostId: "local", sessionId: 5 }, o("A", 7, { side: "left" }), o("A", 9), { hostId: "local", sessionId: "B", at: "soon", side: "up" }],
    };
    expect(readOpen(raw)).toEqual([o("A", 7, { side: "left" }), o("B", 0)]);
  });

  it("caps at MAX_OPEN", () => {
    const raw = { open: Array.from({ length: MAX_OPEN + 5 }, (_, i) => o(`s${i}`, i)) };
    const read = readOpen(raw);
    expect(read).toHaveLength(MAX_OPEN);
    expect(read[0]!.sessionId).toBe("s0");
  });
});

describe("withOpen / withoutOpen", () => {
  it("newest first; already there: moved up with its new side; the same id on another host is another agent", () => {
    let list = withOpen([], o("A", 1));
    list = withOpen(list, o("B", 2));
    expect(list.map((x) => x.sessionId)).toEqual(["B", "A"]);
    list = withOpen(list, o("A", 3, { side: "right" }));
    expect(list).toEqual([o("A", 3, { side: "right" }), o("B", 2)]);
    list = withOpen(list, { hostId: "ssh-b", sessionId: "A", at: 4 });
    expect(list).toHaveLength(3);
    expect(withoutOpen(list, { hostId: "local", sessionId: "A" }).map((x) => `${x.hostId}|${x.sessionId}`)).toEqual(["ssh-b|A", "local|B"]);
  });

  it("caps at MAX_OPEN (the oldest go)", () => {
    let list: OpenAgent[] = [];
    for (let i = 0; i < MAX_OPEN + 3; i++) list = withOpen(list, o(`s${i}`, i));
    expect(list).toHaveLength(MAX_OPEN);
    expect(list[0]!.sessionId).toBe(`s${MAX_OPEN + 2}`);
    expect(list.some((x) => x.sessionId === "s0")).toBe(false);
  });
});

describe("layoutChange", () => {
  it("the same pane showing another agent = a replace", () => {
    const prev = one("A");
    const next = bindPane(prev, MAIN_PANE, "local", "C");
    expect(layoutChange(prev, next)).toEqual({ replaced: [{ paneId: MAIN_PANE, from: { hostId: "local", sessionId: "A" }, to: { hostId: "local", sessionId: "C" } }], onScreen: [{ hostId: "local", sessionId: "C" }] });
  });

  it("not a replace: an empty pane getting an agent, an agent leaving to nothing, a pane added", () => {
    expect(layoutChange(one(null), one("A")).replaced).toEqual([]);
    expect(layoutChange(one("A"), one(null))).toEqual({ replaced: [], onScreen: [] });
    const added = two("A", "B");
    expect(conversationPanes(added)).toHaveLength(2);
    expect(layoutChange(one("A"), added)).toEqual({ replaced: [], onScreen: [{ hostId: "local", sessionId: "A" }, { hostId: "local", sessionId: "B" }] });
  });

  it("another host, same session id: a replace", () => {
    const prev = one("A");
    const next = bindPane(prev, MAIN_PANE, "ssh-b", "A");
    expect(layoutChange(prev, next).replaced).toHaveLength(1);
  });

  it("a pane that closed is not a replace", () => {
    const prev = two("A", "B");
    const p2 = conversationPanes(prev)[1]!;
    const next = bindPane(one("A"), MAIN_PANE, "local", "A");
    expect(layoutChange(prev, next).replaced.some((r) => r.paneId === p2)).toBe(false);
  });
});

describe("openAfter", () => {
  it("a replaced agent joins (newest first, at `now`); agents on screen leave", () => {
    const prev = two("A", "B");
    const p2 = conversationPanes(prev)[1]!;
    // C was open in the tray and comes on screen in place of B.
    const next = bindPane(prev, p2, "local", "C");
    const list = [o("C", 1), o("D", 2)];
    expect(openAfter(list, layoutChange(prev, next), 50)).toEqual([o("B", 50), o("D", 2)]);
  });

  it("the replaced agent still on screen elsewhere (a swap): it does not join", () => {
    const prev = two("A", "B");
    const p2 = conversationPanes(prev)[1]!;
    const swapped = bindPane(bindPane(prev, MAIN_PANE, "local", "B"), p2, "local", "A");
    expect(openAfter([], layoutChange(prev, swapped), 9)).toEqual([]);
  });

  it("nothing changed: the same list back (identity)", () => {
    const list = [o("D", 2)];
    const l = one("A");
    expect(openAfter(list, layoutChange(l, l), 5)).toBe(list);
  });
});
