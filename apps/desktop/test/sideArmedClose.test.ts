// Closing on the right side that would end something (a component's `closeConfirm`, e.g. a running
// terminal) is confirmed in place, click-twice style — no modal (lib/sideActions.ts, lib/sideMenus.tsx,
// the menu's `armed` rows in lib/contextMenu.ts + components/Overlays.tsx).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import { applyOpen, emptyLayout, place, placeSpec, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { selectStep, type MenuAction, type MenuEntry } from "../src/renderer/src/lib/contextMenu";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

// The expected armed copy is the zh string; the i18n language would otherwise follow the ambient
// locale (macOS: system region, not LANG), making the test machine-dependent.
vi.stubGlobal("navigator", { ...globalThis.navigator, language: "zh-CN" });

const warnings = new Map<string, string>();
const closed: string[][] = [];
vi.mock("../src/renderer/src/lib/sideServices", () => ({
  closeWarnings: (ids: readonly string[]) => ids.flatMap((id) => (warnings.has(id) ? [warnings.get(id)!] : [])),
  closeSideInstances: async (ids: readonly string[]) => {
    closed.push([...ids]);
  },
  sideReveal: () => {},
}));
vi.mock("../src/renderer/src/lib/sideComponents", () => ({
  sideRegistry: () => new Map([["terminal.pty", { moduleId: "terminal", item: { titleKey: "side.close", icon: () => null, placement: { home: "workspace" } } }]]),
  sideViewNow: () => ({ hostId: "local", sessionId: "A", workspaceKey: "w1", available: () => true }),
  specFrom: () => placeSpec({ home: "workspace" }),
}));
vi.mock("../src/renderer/src/lib/refActions", () => ({ refActionEntries: () => [] }));

const { useSide } = await import("../src/renderer/src/lib/sideLayoutStore");
const { cardMenu, pageMenu, tabMenu } = await import("../src/renderer/src/lib/sideMenus");
const { cardCloseWarnings, closeCard, closePage } = await import("../src/renderer/src/lib/sideActions");

const BINDING: SideBinding = { kind: "agent", hostId: "local", sessionId: "A" };
let clock = 1000;
function open(layout: SideLayout, key: string): { layout: SideLayout; id: string } {
  const spec = placeSpec({ home: "workspace" });
  const decision = place(layout, { kind: "terminal.pty", binding: BINDING, key, transient: false, activePage: layout.activePage, columnOpen: layout.open }, spec, () => 800);
  const applied = applyOpen(layout, decision, { kind: "terminal.pty", binding: BINDING, key, state: null, v: 1, pinned: false }, ++clock, { reveal: true, home: "workspace" });
  return { layout: applied.layout, id: applied.instanceId };
}

function actions(entries: MenuEntry[]): MenuAction[] {
  return entries.filter((e): e is MenuAction => !!e && e !== "separator");
}

let ids: string[] = [];
beforeEach(() => {
  warnings.clear();
  closed.length = 0;
  let l = emptyLayout();
  const a = open(l, "t1");
  const b = open(a.layout, "t2");
  l = b.layout;
  ids = [a.id, b.id];
  useSide.setState({ layout: l });
});

const cardId = () => useSide.getState().layout.pages[0]!.cards[0]!.id;
const pageId = () => useSide.getState().layout.pages[0]!.id;

describe("menu rows with an in-place confirm", () => {
  const row: MenuAction = { label: "Close", armed: "Click again", onSelect: () => {} };
  it("arms first, runs on the second select", () => {
    expect(selectStep(row, null)).toBe("arm");
    expect(selectStep(row, row)).toBe("run");
    // another armed row does not count
    expect(selectStep(row, { ...row })).toBe("arm");
  });
  it("plain, disabled and submenu rows run (runAction ignores the disabled ones)", () => {
    expect(selectStep({ label: "x", onSelect: () => {} }, null)).toBe("run");
    expect(selectStep({ ...row, disabled: true }, null)).toBe("run");
    expect(selectStep({ ...row, submenu: [] }, null)).toBe("run");
  });
});

describe("side close confirms in place", () => {
  it("both terminals land in one card", () => {
    expect(useSide.getState().layout.pages[0]!.cards[0]!.tabs).toEqual(ids);
  });

  it("nothing to end: the close rows run right away", () => {
    const close = actions(cardMenu(cardId())).at(-1)!;
    expect(close.armed).toBeUndefined();
    expect(actions(pageMenu(pageId())).find((a) => a.danger)!.armed).toBeUndefined();
    expect(actions(tabMenu(ids[0]!)).find((a) => a.label === "关闭其他")?.armed).toBeUndefined();
  });

  it("a running terminal: the rows arm with what closing ends", () => {
    warnings.set(ids[1]!, "终端 2 将被结束");
    expect(cardCloseWarnings(cardId())).toEqual(["终端 2 将被结束"]);
    expect(actions(cardMenu(cardId())).at(-1)!.armed).toBe("再点一次关闭 · 终端 2 将被结束");
    expect(actions(pageMenu(pageId())).find((a) => a.danger)!.armed).toBe("再点一次关闭 · 终端 2 将被结束");
    // 关闭其他 from t1 ends t2; from t2 it ends nothing
    expect(actions(tabMenu(ids[0]!)).find((a) => a.label === "关闭其他")!.armed).toBe("再点一次关闭 · 终端 2 将被结束");
    expect(actions(tabMenu(ids[1]!)).find((a) => a.label === "关闭其他")!.armed).toBeUndefined();
    // the tab's own 关闭: arms only for the tab that ends something
    expect(actions(tabMenu(ids[1]!)).at(-1)!.armed).toBe("再点一次关闭 · 终端 2 将被结束");
    expect(actions(tabMenu(ids[0]!)).at(-1)!.armed).toBeUndefined();
    warnings.set(ids[0]!, "终端 1 将被结束");
    expect(actions(cardMenu(cardId())).at(-1)!.armed).toBe("再点一次关闭 · 终端 1 将被结束 · 终端 2 将被结束");
  });

  it("the close itself never asks (the confirm happened in place)", () => {
    warnings.set(ids[0]!, "终端 1 将被结束");
    closeCard(cardId());
    expect(closed).toEqual([ids]);
    closePage(pageId());
    expect(closed).toEqual([ids, ids]);
  });
});
