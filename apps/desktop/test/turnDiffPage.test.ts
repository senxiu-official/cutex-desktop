import { expect, it } from "vitest";
import { applyOpen, emptyLayout, locate, place, placeSpec, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { turnDiffPage } from "../src/renderer/src/lib/turnDiffPage";
import { DIFF_COMPONENT, CHANGES_COMPONENT } from "../src/renderer/src/lib/sideKinds";
import type { Json } from "../src/renderer/src/modules/types";

const binding = { kind: "agent" as const, hostId: "local", sessionId: "agent" };
function open(layout: SideLayout, kind: typeof DIFF_COMPONENT | typeof CHANGES_COMPONENT, key: string, state: Json = null) {
  const spec = placeSpec(kind === DIFF_COMPONENT ? { home: "workspace", prefer: [{ containing: CHANGES_COMPONENT }, { group: "workspace" }], order: 400 } : { home: "workspace", order: 300 });
  const decision = place(layout, { kind, binding, key, transient: false, columnOpen: layout.open, activePage: layout.activePage }, spec);
  return applyOpen(layout, decision, { kind, binding, key, state, v: 1, pinned: true }, 1, { reveal: true, home: spec.home });
}
function mixed() {
  const changes = open(emptyLayout(), CHANGES_COMPONENT, "changes");
  const git = open(changes.layout, DIFF_COMPONENT, "git:a", { source: "git", path: "a" });
  const turn = open(git.layout, DIFF_COMPONENT, "turn:1:a", { source: "turn", turnId: "1", path: "a" });
  return { changes, git, turn };
}

it("separates only the turn tab from the Changes/git page and gives it the whole page", () => {
  const { changes, git, turn } = mixed();
  const previous = structuredClone(turn.layout);
  const next = turnDiffPage(turn.layout, turn.instanceId, 2);
  const own = locate(next, turn.instanceId)!;
  expect(own.page.id).not.toBe(changes.pageId);
  expect(own.page.shelf).toBe(locate(next, changes.instanceId)!.page.shelf);
  expect(own.page.cards).toHaveLength(1);
  expect(own.card.size).toBe(1);
  expect(locate(next, git.instanceId)!.page.id).toBe(changes.pageId);
  expect(locate(next, changes.instanceId)!.page.cards).toHaveLength(2);
  expect(next.overrides).toBe(turn.layout.overrides);
  expect(turn.layout).toEqual(previous);
});

it("reuses the turn-only page for another turn/file without creating empty pages", () => {
  const { turn } = mixed();
  const first = turnDiffPage(turn.layout, turn.instanceId, 2);
  const second = open(first, DIFF_COMPONENT, "turn:2:b", { source: "turn", turnId: "2", path: "b" });
  const next = turnDiffPage(second.layout, second.instanceId, 3);
  expect(next.pages).toHaveLength(2);
  expect(locate(next, second.instanceId)!.card.tabs).toEqual([turn.instanceId, second.instanceId]);
  expect(locate(next, second.instanceId)!.page.cards).toHaveLength(1);
  expect(turnDiffPage(next, second.instanceId, 4)).toBe(next);
});

it("opening Changes after a first turn diff creates its own page; later git diff still joins Changes", () => {
  const turn = open(emptyLayout(), DIFF_COMPONENT, "turn:1:a", { source: "turn" });
  const own = turnDiffPage(turn.layout, turn.instanceId, 2);
  const changes = open(own, CHANGES_COMPONENT, "changes");
  const git = open(changes.layout, DIFF_COMPONENT, "git:a", { source: "git" });
  expect(changes.pageId).not.toBe(turn.pageId);
  expect(git.pageId).toBe(changes.pageId);
  expect(locate(git.layout, turn.instanceId)!.page.cards).toHaveLength(1);
});

it("does not rewrite a stored user placement override when rescuing an already-open turn tab", () => {
  const { turn } = mixed();
  turn.layout.overrides[DIFF_COMPONENT] = { page: turn.pageId!, groups: ["workspace"], at: 10 };
  const next = turnDiffPage(turn.layout, turn.instanceId, 11);
  expect(next.overrides).toBe(turn.layout.overrides);
  expect(next.overrides[DIFF_COMPONENT]!.page).toBe(turn.pageId);
  expect(locate(next, turn.instanceId)!.page.id).not.toBe(turn.pageId);
});

it("keeps the nine-page limit instead of dropping another page or exceeding it", () => {
  const { turn } = mixed();
  const page = turn.layout.pages[0]!;
  const full = { ...turn.layout, pages: [...turn.layout.pages, ...Array.from({ length: 8 }, (_, i) => ({ ...page, id: `kept-${i}`, cards: [], kept: true }))] };
  expect(turnDiffPage(full, turn.instanceId, 2)).toBe(full);
});

it("leaves git diffs and unknown instances alone", () => {
  const { git } = mixed();
  expect(turnDiffPage(git.layout, git.instanceId, 2)).toBe(git.layout);
  expect(turnDiffPage(git.layout, "gone", 2)).toBe(git.layout);
});
