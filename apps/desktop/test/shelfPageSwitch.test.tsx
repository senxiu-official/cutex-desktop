// @vitest-environment jsdom
// #35 (polish 0.2): Alt+1 / Alt+2 between a Shelf page with panes and an empty page of the same Shelf flickered
// the conversation column. One conversation is "framed" (in ConversationColumns) only while tool panes are on
// screen; that was read from the page in view, so the switch moved the conversation to another place in the tree
// and React remounted it (timeline, composer, scroll position). Now any page of a Shelf in view counts.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const NONE: never[] = [];
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({ subscribe: () => () => {}, snapshot: () => NONE, statuses: () => new Map(), modules: NONE }),
}));

const { toolPanesShown } = await import("../src/renderer/src/components/PaneHost");
const { addShelfPage, applyOpen, emptyLayout, pagesOfShelf, place, placeSpec, shelvesOf, switchPage, visibleCards, shownPages, SINGLETON_KEY } = await import("../src/renderer/src/lib/sideLayout");
type SideViewContext = import("../src/renderer/src/lib/sideLayout").SideViewContext;
type SideLayout = import("../src/renderer/src/lib/sideLayout").SideLayout;

const ctx: SideViewContext = { hostId: "local", sessionId: "A", workspaceKey: null, available: () => true };
const SPEC = placeSpec({ home: "workspace", order: 100 });

function withFiles(): SideLayout {
  const layout = emptyLayout();
  const binding = { kind: "follow", hostId: "local" } as const;
  const decision = place(layout, { kind: "workspace.files", binding, key: SINGLETON_KEY, transient: false, activePage: layout.activePage, columnOpen: layout.open }, SPEC, () => 100);
  return applyOpen(layout, decision, { kind: "workspace.files", binding, key: SINGLETON_KEY, state: null, v: 1, pinned: false }, 1, { reveal: true, home: "workspace" }).layout;
}

describe("tool panes shown (the single conversation's place in the tree)", () => {
  it("stays on across Alt+n to an empty page of the same Shelf", () => {
    const files = withFiles();
    const shelf = shelvesOf(files)[0]!.id;
    const more = addShelfPage(files, shelf);
    const [first, empty] = pagesOfShelf(more.layout, shelf);
    const onFiles = switchPage(more.layout, first!.id);
    const onEmpty = switchPage(more.layout, empty!.id);
    expect(toolPanesShown(onFiles, ctx)).toBe(true);
    // The page in view has nothing (what flipped it before) …
    expect(shownPages(onEmpty, ctx).some((p) => visibleCards(onEmpty, p, ctx).length > 0)).toBe(false);
    // … but the Shelf still holds panes for this agent: same tree, no remount.
    expect(toolPanesShown(onEmpty, ctx)).toBe(true);
  });

  it("is off with no panes for this agent, or with the Shelves closed", () => {
    expect(toolPanesShown(emptyLayout(), ctx)).toBe(false);
    const files = withFiles();
    expect(toolPanesShown({ ...files, open: false }, ctx)).toBe(false);
    // Another agent's view: an agent-bound pane is not this one's.
    const other = { ...ctx, sessionId: "B" };
    const binding = { kind: "agent", hostId: "local", sessionId: "A" } as const;
    const layout = emptyLayout();
    const decision = place(layout, { kind: "side-chat.chat", binding, key: SINGLETON_KEY, transient: false, activePage: layout.activePage, columnOpen: layout.open }, SPEC, () => 100);
    const agentOnly = applyOpen(layout, decision, { kind: "side-chat.chat", binding, key: SINGLETON_KEY, state: null, v: 1, pinned: false }, 2, { reveal: true, home: "workspace" }).layout;
    expect(toolPanesShown(agentOnly, ctx)).toBe(true);
    expect(toolPanesShown(agentOnly, other)).toBe(false);
  });
});
