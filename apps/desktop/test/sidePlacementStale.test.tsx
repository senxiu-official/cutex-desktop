// @vitest-environment jsdom
// 组件默认位置 (owner 2026-11-24): rows read 「已移到「已关闭的页」」 while their select showed 工作区. A move (§18.7)
// whose page is closed is over: the settings show no move, opening follows the default rules (the sanity-limit
// fallback included: it used to go to a page sharing the closed page's groups), and the record is dropped on save.
// A move onto a page that is still there: the hint and the select both name that page.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ registry: new Map() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}${JSON.stringify(vars)}` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideRegistry: () => fx.registry,
  sideRegistry: () => fx.registry,
}));
const NONE: never[] = [];
vi.mock("../src/renderer/src/modules/app", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  appModules: () => ({ subscribe: () => () => {}, snapshot: () => NONE, statuses: () => new Map(), modules: [] }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { emptyLayout, movedTo, place, placeSpec, prepareForSave, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { MAX_SHELF_PAGES } from "../src/renderer/src/lib/shelfLimits";
import { useSide } from "../src/renderer/src/lib/sideLayoutStore";
import type { ItemId } from "../src/renderer/src/modules/types";
import { SidesDefaultsSubPage } from "../src/renderer/src/components/settings/SidesSettings";

const icon = () => null;
const item = (id: string, home: string) => ({ id, titleKey: id, icon, placement: { home }, instances: "singleton", defaultBinding: "host" });
for (const [id, home] of [["workspace.preview", "workspace"], ["side-chat.chat", "chat"], ["subagents.thread", "workspace"], ["alarms.list", "workspace"]] as const) fx.registry.set(id, { item: item(id, home), moduleId: "m" });

/** `n` pages p1…pn (groups g0…, page p1 holds the Files pane, the others a pane each); overrides as given. */
function layoutWith(overrides: SideLayout["overrides"], n = 1): SideLayout {
  const l = emptyLayout();
  for (let k = 0; k < n; k++) {
    const kind = k === 0 ? "workspace.files" : "subagents.thread";
    const inst = `i${k + 1}`;
    l.instances[inst] = { kind, binding: { kind: "host", hostId: "local" }, key: `k${k}`, state: null, v: 1, lastActiveAt: k + 1, pinned: false } as never;
    l.pages.push({ id: `p${k + 1}`, groups: [`g${k}`], cards: [{ id: `c${k + 1}`, kind, tabs: [inst], active: inst, size: 1, collapsed: false }] } as never);
  }
  return { ...l, open: true, activePage: "p1", seq: 1000, overrides };
}
const OVERRIDES = {
  "workspace.preview": { page: "p70", groups: ["user:p70"], at: 1 }, // moved onto a page of its own, since closed
  "side-chat.chat": { page: "p80", groups: ["g2"], at: 2 }, // moved onto a page since closed (merged groups)
  "alarms.list": { page: "p1", groups: ["g0"], at: 3 }, // moved onto the Files page, still there
};

describe("a move whose page is closed", () => {
  it("is no move: movedTo answers the page only while it is there", () => {
    const l = layoutWith(OVERRIDES);
    expect(movedTo(l, "workspace.preview")).toBeNull();
    expect(movedTo(l, "side-chat.chat")).toBeNull();
    expect(movedTo(l, "alarms.list")?.id).toBe("p1");
    expect(movedTo(l, "workspace.files")).toBeNull();
  });

  it("at a full Shelf, the fallback follows the default rules, not a page that shares the closed page's groups", () => {
    const l = layoutWith(OVERRIDES, MAX_SHELF_PAGES);
    const req = (kind: string) => ({ kind: kind as ItemId, binding: { kind: "host" as const, hostId: "local" }, key: SINGLETON_KEY, transient: false, activePage: l.activePage, columnOpen: true });
    const chat = place(l, req("side-chat.chat"), placeSpec({ home: "chat" }), () => 0);
    expect(chat).not.toMatchObject({ via: "override" });
    expect(chat).not.toMatchObject({ page: { id: "p3" } }); // p3 carries g2
    expect(place(l, req("alarms.list"), placeSpec({ home: "workspace" }), () => 0)).toMatchObject({ via: "override", page: { id: "p1" } });
  });

  it("is dropped on save; a live move is kept", () => {
    const saved = prepareForSave(layoutWith(OVERRIDES), { persist: () => true });
    expect(Object.keys(saved.overrides)).toEqual(["alarms.list"]);
  });
});

describe("组件默认位置 rows", () => {
  let root: Root | null = null;
  let host: HTMLDivElement;
  beforeEach(() => { host = document.body.appendChild(document.createElement("div")); useSide.setState({ layout: layoutWith(OVERRIDES) } as never); });
  afterEach(() => { act(() => root?.unmount()); root = null; host.remove(); });
  const select = (id: string) => [...host.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === id) as HTMLSelectElement;

  it("never name a closed page; the hint and the select tell the same place", () => {
    act(() => { root = createRoot(host); root.render(h(SidesDefaultsSubPage)); });
    const text = host.textContent ?? "";
    expect(text).not.toContain("gonePage");
    // closed pages: no move shown; the select shows the default group
    expect(select("workspace.preview").value).toBe("workspace");
    expect(select("side-chat.chat").value).toBe("chat");
    expect(text.match(/shell\.sides\.defaults\.moved\{/g)).toHaveLength(1);
    // the live move onto the Files page: the hint and the selected entry name the same page
    const live = select("alarms.list");
    const shown = live.options[live.selectedIndex]!.textContent!;
    expect(shown.startsWith("shell.sides.defaults.movedOption")).toBe(true);
    const page = JSON.parse(shown.slice("shell.sides.defaults.movedOption".length)).page as string;
    expect(page).toBeTruthy();
    expect(text).toContain(`shell.sides.defaults.moved${JSON.stringify({ page })}`);
  });
});
