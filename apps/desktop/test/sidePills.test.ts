// Page-button content (lib/sidePills.ts; docs/desktop-modules.md §18.3): icon order, ≤ 5 icons or
// 4 + "+n", collapsed icons, badges summed per card from the visible instances.
import { describe, expect, it } from "vitest";
import type { SideTabInfo } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { emptyLayout, type SideLayout, type SideViewContext } from "../src/renderer/src/lib/sideLayout";
import { attentionText, PILL_CAP, pillContent } from "../src/renderer/src/lib/sidePills";

/** One page; each entry = a card of `kind` with instances bound to the given agents. */
function layoutOf(cards: { kind: ItemId; agents: string[]; collapsed?: boolean }[]): SideLayout {
  const l = emptyLayout();
  const page = { id: "p1", groups: ["workspace"], cards: [] as SideLayout["pages"][number]["cards"] };
  for (const c of cards) {
    const tabs: string[] = [];
    for (const a of c.agents) {
      const id = `i${++l.seq}`;
      l.instances[id] = { kind: c.kind, binding: { kind: "agent", hostId: "local", sessionId: a }, key: id, state: null, v: 1, pinned: false, lastActiveAt: l.seq };
      tabs.push(id);
    }
    page.cards.push({ id: `c${++l.seq}`, kind: c.kind, tabs, active: tabs[0] ?? null, size: 1 / cards.length, collapsed: !!c.collapsed });
  }
  l.pages.push(page);
  l.activePage = "p1";
  l.open = true;
  return l;
}

const ctx = (over: Partial<SideViewContext> = {}): SideViewContext => ({ hostId: "local", sessionId: "A", workspaceKey: null, available: () => true, ...over });

describe("pillContent", () => {
  it("one icon per visible card in card order; collapsed flag; tab count", () => {
    const l = layoutOf([{ kind: "a.files", agents: ["A"] }, { kind: "a.diff", agents: ["A", "A", "B"], collapsed: true }, { kind: "a.other", agents: ["B"] }]);
    const pill = pillContent(l, l.pages[0]!, ctx(), () => undefined);
    expect(pill.icons.map((i) => i.kind)).toEqual(["a.files", "a.diff"]);
    expect(pill.icons[1]).toMatchObject({ collapsed: true, count: 2 });
    expect(pill.more).toBe(0);
  });

  it(`at most ${PILL_CAP} icons, else ${PILL_CAP - 1} + n`, () => {
    const five = layoutOf(Array.from({ length: 5 }, (_, k) => ({ kind: `k.${k}` as ItemId, agents: ["A"] })));
    expect(pillContent(five, five.pages[0]!, ctx(), () => undefined)).toMatchObject({ more: 0 });
    expect(pillContent(five, five.pages[0]!, ctx(), () => undefined).icons).toHaveLength(5);
    const seven = layoutOf(Array.from({ length: 7 }, (_, k) => ({ kind: `k.${k}` as ItemId, agents: ["A"] })));
    const pill = pillContent(seven, seven.pages[0]!, ctx(), () => undefined);
    expect(pill.icons.map((i) => i.kind)).toEqual(["k.0", "k.1", "k.2", "k.3"]);
    expect(pill.more).toBe(3);
  });

  it("badges are summed per card and per page from visible instances only", () => {
    const l = layoutOf([{ kind: "a.x", agents: ["A", "A", "B"] }, { kind: "a.y", agents: ["A"] }]);
    const info: Record<string, SideTabInfo> = {
      i1: { title: "1", attention: 2 },
      i2: { title: "2", attention: 1, unread: true },
      i3: { title: "3", attention: 50, busy: true }, // agent B: not visible
      i5: { title: "5", busy: true },
    };
    const pill = pillContent(l, l.pages[0]!, ctx(), (id) => info[id]);
    expect(pill.icons[0]).toMatchObject({ attention: 3, unread: true, busy: false });
    expect(pill.icons[1]).toMatchObject({ attention: 0, unread: false, busy: true });
    expect(pill).toMatchObject({ attention: 3, unread: true, busy: true });
  });

  it("a page of other agents has no icons or badges (it is not in the lane at all: lanePages)", () => {
    const l = layoutOf([{ kind: "a.chat", agents: ["A", "B"] }]);
    const pill = pillContent(l, l.pages[0]!, ctx({ sessionId: "C" }), () => ({ title: "x", attention: 4 }));
    expect(pill.icons).toEqual([]);
    expect(pill).toMatchObject({ attention: 0, unread: false, busy: false });
  });

  it("dormant cards (module off) get no icon; an empty page is the launcher", () => {
    const l = layoutOf([{ kind: "a.on", agents: ["A"] }, { kind: "b.off", agents: ["A"] }]);
    const pill = pillContent(l, l.pages[0]!, ctx({ available: (k) => k !== "b.off" }), () => undefined);
    expect(pill.icons.map((i) => i.kind)).toEqual(["a.on"]);
    const launcher = { id: "p9", groups: [], cards: [], launcher: true };
    expect(pillContent(l, launcher, ctx(), () => undefined)).toMatchObject({ launcher: true, icons: [] });
  });

  it("attention text caps at 9+", () => {
    expect(attentionText(3)).toBe("3");
    expect(attentionText(9)).toBe("9");
    expect(attentionText(10)).toBe("9+");
  });
});
