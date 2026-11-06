// ⌘K quick switcher (modules/quick-switch): matching and ranking, scope filtering, keyboard actions,
// what an open does per kind (in place vs beside), the item builders, the Shelf pages (lib/shelves read
// API) and the artifact cache. The palette's own keyboard handling: test/quickSwitchPalette.test.tsx.
import { describe, expect, it, vi } from "vitest";
import { Globe, Headphones, SquareDashed } from "lucide-react";
import type { ArtifactSummary } from "../src/shared/artifactStore";
import type { ServiceView } from "../src/shared/ipc";
import { besideAction, flatRows, hasBeside, isQuickSwitchKey, matchItem, matchPinyin, matchToken, moveSelection, nextScope, paletteKey, parseRecent, planOpen, pushRecent, rankItems, RECENT_KEEP, SCOPES, type QsItem, type QsTarget } from "../src/renderer/src/modules/quick-switch/model";
import { setKeybindingPlatform } from "../src/renderer/src/lib/keybindings";
import { runOpen, type OpenDeps } from "../src/renderer/src/modules/quick-switch/open";
import { agentItems, artifactItems, newShelfPageItem, pageItems, serviceItems, shelfPageItems } from "../src/renderer/src/modules/quick-switch/items";
import { ARTIFACT_TTL_MS, cachedArtifacts, loadArtifacts, resetArtifactCache } from "../src/renderer/src/modules/quick-switch/artifacts";
import type { AgentRow, SidebarGroup } from "../src/renderer/src/lib/sidebar";
import type { NavItem } from "../src/renderer/src/modules/slots";

const shelf = vi.hoisted(() => ({
  pages: [] as unknown[],
  opened: [] as string[],
  throws: false,
}));
vi.mock("../src/renderer/src/lib/shelves", () => ({
  listShelfPages: () => {
    if (shelf.throws) throw new Error("layout not ready");
    return shelf.pages;
  },
  openShelfPage: (id: string) => (shelf.opened.push(id), id !== "gone"),
}));
vi.mock("../src/renderer/src/lib/sideComponents", () => ({ sideRegistry: () => new Map([["browser.tab", { item: { icon: Globe } }]]) }));
const { readShelfPages, showShelfPage } = await import("../src/renderer/src/modules/quick-switch/shelfPages");

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",")})` : key);

let seq = 0;
function item(kind: QsItem["kind"], title: string, extra: Partial<QsItem> = {}): QsItem {
  const target: QsTarget =
    kind === "agent" ? { kind, hostId: "local", sessionId: title } : kind === "service" ? { kind, hostId: "local", slug: title } : kind === "artifact" ? { kind, hostId: "local", ref: `${title}@latest`, name: title } : kind === "page" ? { kind, page: `x.${title}` as `${string}.${string}` } : { kind, shelfId: "s1", pageId: title };
  return { id: `${kind}:${title}`, kind, title, rank: seq++, target, ...extra };
}

describe("matching", () => {
  it("scores exact > prefix > word start > substring > subsequence", () => {
    const s = (q: string, text: string) => matchToken(q, text)?.score ?? -1;
    expect(s("cutex", "cutex")).toBe(100);
    expect(s("cut", "cutex-dev")).toBe(80);
    expect(s("dev", "cutex-dev")).toBe(65);
    expect(s("tex", "cutex-dev")).toBe(50);
    const fuzzy = s("cxd", "cutex-dev");
    expect(fuzzy).toBeGreaterThan(0);
    expect(fuzzy).toBeLessThan(50);
    expect(s("zz", "cutex-dev")).toBe(-1);
    // one letter never fuzzes; letters far apart do not either
    expect(s("q", "cutex")).toBe(-1);
    expect(s("res", "HOST-A Experiment Console")).toBe(-1);
    expect(matchToken("cxd", "cutex-dev", false)).toBeNull();
  });

  it("is case-insensitive, finds camelCase / CJK word starts and returns highlight ranges", () => {
    expect(matchToken("SET", "settings")).toEqual({ score: 80, ranges: [[0, 3]] });
    expect(matchToken("ui", "settingUi")?.score).toBe(65);
    // Every CJK character starts a word: 「书」 in 听书管家 is a word start.
    expect(matchToken("书", "听书管家")).toEqual({ score: 65, ranges: [[1, 2]] });
    expect(matchToken("cxd", "cutex-dev")?.ranges).toEqual([[0, 1], [4, 5], [6, 7]]);
  });

  it("needs every token; terms (ids, slugs) count less than the title and are not highlighted", () => {
    const a = { title: "听书管家", terms: ["audiobook-agent"], subtitle: "生活" };
    expect(matchItem("audio", a)).toEqual({ score: 80 * 0.6, ranges: [] });
    expect(matchItem("听书 生活", a)?.score).toBeGreaterThan(0);
    expect(matchItem("听书 工作", a)).toBeNull();
    // Terms never match as a subsequence.
    expect(matchItem("srvc", { title: "服务", terms: ["services.page"] })).toBeNull();
    // Title wins over an equally good term.
    expect(matchItem("cutex", { title: "cutex", terms: ["cutex"] })!.score).toBe(100);
  });
});

describe("ranking and scope filtering", () => {
  const items = [
    item("agent", "cutex-dev"),
    item("agent", "听书管家"),
    item("agent", "hachimi"),
    item("service", "audiobook", { title: "听书", terms: ["audiobook", "tingshu"] }),
    item("artifact", "论文阅读清单"),
    item("page", "settings", { title: "设置" }),
    item("shelfPage", "p1", { title: "听书" }),
  ];

  it("empty query in 全部: recents first (newest first), then each kind in base order, recents not repeated", () => {
    const recent = [
      { id: "service:audiobook", at: 20 },
      { id: "agent:hachimi", at: 30 },
      { id: "gone:x", at: 40 },
    ];
    const sections = rankItems(items, { query: "", scope: "all", recent });
    expect(sections.map((s) => s.id)).toEqual(["recent", "agent", "artifact", "page", "shelfPage"]);
    expect(sections[0]!.rows.map((r) => r.item.id)).toEqual(["agent:hachimi", "service:audiobook"]);
    expect(sections[1]!.rows.map((r) => r.item.title)).toEqual(["cutex-dev", "听书管家"]);
  });

  it("caps sections in 全部; a single scope lists all of its kind with its recents first", () => {
    const many = Array.from({ length: 9 }, (_, i) => item("agent", `agent-${i}`));
    const all = rankItems(many, { query: "", scope: "all" });
    expect(all[0]!.rows).toHaveLength(5);
    expect(all[0]!.total).toBe(9);
    const one = rankItems([...many, item("service", "svc")], { query: "", scope: "agent", recent: [{ id: "agent:agent-7", at: 1 }] });
    expect(one).toHaveLength(1);
    expect(one[0]!.rows).toHaveLength(9);
    expect(one[0]!.rows[0]!.item.id).toBe("agent:agent-7");
  });

  it("a scope keeps only its kind; with a query the best section comes first", () => {
    expect(flatRows(rankItems(items, { query: "听", scope: "service" })).map((r) => r.item.kind)).toEqual(["service"]);
    const sections = rankItems(items, { query: "听书", scope: "all" });
    // 听书 (service, exact) and 听书 (Shelf page, exact) beat 听书管家 (prefix).
    expect(sections.map((s) => s.id)).toEqual(["service", "shelfPage", "agent"]);
    expect(sections[0]!.rows[0]!.ranges).toEqual([[0, 2]]);
    // Matches by term: the slug / pinyin-ish keyword given as a term.
    expect(flatRows(rankItems(items, { query: "tingshu", scope: "all" })).map((r) => r.item.id)).toEqual(["service:audiobook"]);
    expect(rankItems(items, { query: "nothing-like-this", scope: "all" })).toEqual([]);
  });

  it("recently opened breaks ties between equal matches", () => {
    const a = item("agent", "alpha-one");
    const b = item("agent", "alpha-two");
    const rows = flatRows(rankItems([a, b], { query: "alpha", scope: "all", recent: [{ id: b.id, at: 5 }] }));
    expect(rows.map((r) => r.item.id)).toEqual([b.id, a.id]);
  });

  it("recents: newest first, one per id, bounded; bad prefs are dropped", () => {
    let list = pushRecent([], "a", 1);
    list = pushRecent(list, "b", 2);
    list = pushRecent(list, "a", 3);
    expect(list).toEqual([{ id: "a", at: 3 }, { id: "b", at: 2 }]);
    for (let i = 0; i < 30; i++) list = pushRecent(list, `x${i}`, 10 + i);
    expect(list).toHaveLength(RECENT_KEEP);
    expect(parseRecent([{ id: "a", at: 1 }, { id: 3 }, null, "x"])).toEqual([{ id: "a", at: 1 }]);
    expect(parseRecent({})).toEqual([]);
  });
});

describe("keyboard", () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; isComposing: boolean; code: string }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

  it("Ctrl+K opens on Windows / Linux, ⌘K on macOS (not the other modifier, not with Shift / Alt)", () => {
    expect(isQuickSwitchKey(key("k", { ctrlKey: true }))).toBe(true);
    expect(isQuickSwitchKey(key("K", { ctrlKey: true, code: "KeyK" }))).toBe(true);
    // A non-Latin layout: the physical key.
    expect(isQuickSwitchKey(key("л", { ctrlKey: true, code: "KeyK" }))).toBe(true);
    expect(isQuickSwitchKey(key("k", { metaKey: true }))).toBe(false);
    setKeybindingPlatform("mac");
    expect(isQuickSwitchKey(key("k", { metaKey: true }))).toBe(true);
    expect(isQuickSwitchKey(key("k", { ctrlKey: true }))).toBe(false);
    setKeybindingPlatform("other");
    expect(isQuickSwitchKey(key("k", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isQuickSwitchKey(key("k", { ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("maps ↑ ↓ Tab Enter Esc; Ctrl/⌘+Enter = beside; IME keys are the input's", () => {
    expect(paletteKey(key("ArrowDown"), false)).toEqual({ type: "move", delta: 1 });
    expect(paletteKey(key("ArrowUp"), false)).toEqual({ type: "move", delta: -1 });
    expect(paletteKey(key("Tab"), false)).toEqual({ type: "scope", back: false });
    expect(paletteKey(key("Tab", { shiftKey: true }), false)).toEqual({ type: "scope", back: true });
    expect(paletteKey(key("Enter"), false)).toEqual({ type: "open", beside: false });
    expect(paletteKey(key("Enter", { ctrlKey: true }), false)).toEqual({ type: "open", beside: true });
    expect(paletteKey(key("Enter", { metaKey: true }), true)).toEqual({ type: "open", beside: true });
    expect(paletteKey(key("Enter", { metaKey: true }), false)).toEqual({ type: "open", beside: false });
    expect(paletteKey(key("Escape"), false)).toEqual({ type: "close" });
    expect(paletteKey(key("k", { ctrlKey: true }), false)).toEqual({ type: "close" });
    expect(paletteKey(key("Enter", { isComposing: true }), false)).toBeNull();
    expect(paletteKey(key("a"), false)).toBeNull();
    expect(paletteKey(key("ArrowLeft"), false)).toBeNull();
    // macOS: Ctrl+N / Ctrl+P move too.
    expect(paletteKey(key("n", { ctrlKey: true }), true)).toEqual({ type: "move", delta: 1 });
  });

  it("Tab cycles the scopes and wraps; selection wraps", () => {
    expect(nextScope("all")).toBe("agent");
    expect(nextScope("shelfPage")).toBe("all");
    expect(nextScope("all", true)).toBe("shelfPage");
    let s = SCOPES[0]!;
    for (let i = 0; i < SCOPES.length; i++) s = nextScope(s);
    expect(s).toBe("all");
    expect(moveSelection(0, -1, 4)).toBe(3);
    expect(moveSelection(3, 1, 4)).toBe(0);
    expect(moveSelection(1, 1, 0)).toBe(0);
  });
});

describe("pinyin (pinyin.ts + model matchPinyin)", () => {
  async function lib() {
    const { loadPinyin, pinyinUnits, withPinyin } = await import("../src/renderer/src/modules/quick-switch/pinyin");
    const py = await loadPinyin();
    expect(py).not.toBeNull();
    return { py: py!, pinyinUnits, withPinyin };
  }

  it("units: the readings of Chinese characters (polyphonic ones too, ü as v / u), Latin letters as themselves; none for Latin-only titles", async () => {
    const { py, pinyinUnits } = await lib();
    expect(pinyinUnits("听书", py)).toEqual([
      { at: 0, len: 1, syl: ["ting"], zh: true },
      { at: 1, len: 1, syl: ["shu"], zh: true },
    ]);
    expect(pinyinUnits("KKS 听书", py)!.map((u) => [u.at, u.syl[0]])).toEqual([[0, "k"], [1, "k"], [2, "s"], [4, "ting"], [5, "shu"]]);
    expect(pinyinUnits("重庆", py)![0]!.syl).toEqual(expect.arrayContaining(["chong", "zhong"]));
    expect(pinyinUnits("绿", py)![0]!.syl).toEqual(expect.arrayContaining(["lv", "lu"]));
    expect(pinyinUnits("cutex-dev", py)).toBeNull();
    // Traditional characters too
    expect(pinyinUnits("聽書", py)!.map((u) => u.syl[0])).toEqual(["ting", "shu"]);
  });

  it("matches full pinyin, initials and a mix, with highlight ranges on the characters", async () => {
    const { py, pinyinUnits } = await lib();
    const units = pinyinUnits("听书", py)!;
    expect(matchPinyin("tingshu", units)).toEqual({ score: 80, ranges: [[0, 2]] });
    expect(matchPinyin("ts", units)).toEqual({ score: 74, ranges: [[0, 2]] });
    expect(matchPinyin("tshu", units)?.ranges).toEqual([[0, 2]]);
    expect(matchPinyin("tings", units)?.ranges).toEqual([[0, 2]]);
    expect(matchPinyin("ting", units)).toEqual({ score: 72, ranges: [[0, 1]] });
    expect(matchPinyin("shu", units)).toEqual({ score: 56, ranges: [[1, 2]] });
    expect(matchPinyin("TingShu", units)?.score).toBe(80);
    // zh / ch / sh count as initials; a cut-off reading in the middle does not
    const zs = pinyinUnits("张三", py)!;
    expect(matchPinyin("zhs", zs)).not.toBeNull();
    expect(matchPinyin("zs", zs)).not.toBeNull();
    expect(matchPinyin("tinshu", units)).toBeNull();
    // one letter: the first character only
    expect(matchPinyin("t", units)?.ranges).toEqual([[0, 1]]);
    expect(matchPinyin("s", units)).toBeNull();
    expect(matchPinyin("tx", units)).toBeNull();
    expect(matchPinyin("听", units)).toBeNull();
    // across Latin letters and a space; the run must use a Chinese character
    const mixed = pinyinUnits("KKS 听书", py)!;
    expect(matchPinyin("kksts", mixed)?.ranges).toEqual([[0, 3], [4, 6]]);
    expect(matchPinyin("kks", mixed)).toBeNull();
  });

  it("items: pinyin finds Chinese titles (rank after a literal hit); Latin titles rank exactly as before", async () => {
    const { py, withPinyin } = await lib();
    const items = withPinyin([item("service", "听书"), item("service", "tingle"), item("agent", "test-runner"), item("agent", "调试助手"), item("page", "设置")], py);
    const titles = (q: string) => flatRows(rankItems(items, { query: q, scope: "all" })).map((r) => r.item.title);
    expect(titles("tingshu")).toEqual(["听书"]);
    expect(titles("ts")).toContain("听书");
    expect(titles("tsz")).toEqual(["调试助手"]);
    // from the start ranks above inside (调试助手: 试助)
    expect(titles("sz")).toEqual(["设置", "调试助手"]);
    expect(matchItem("ting shu", items[0]!)?.ranges).toEqual([[0, 2]]);
    // a literal hit stays first: 「ting」 is a prefix of tingle (80) above 听书's pinyin (72)
    expect(flatRows(rankItems(items, { query: "ting", scope: "service" })).map((r) => r.item.title)).toEqual(["tingle", "听书"]);
    // Latin titles get no units: the ranking of a Latin list is the same with or without pinyin
    const latin = [item("agent", "cutex-dev"), item("agent", "ui-tester"), item("service", "audiobook"), item("page", "settings"), item("artifact", "report")];
    expect(withPinyin(latin, py)).toEqual(latin);
    for (const q of ["cu", "t", "set", "re", "cxd", "ui test"]) expect(rankItems(withPinyin(latin, py), { query: q, scope: "all" })).toEqual(rankItems(latin, { query: q, scope: "all" }));
    // not loaded (null): literal only
    expect(withPinyin(items, null)).toBe(items);
  });
});

describe("opening: in place vs beside per kind", () => {
  const shows = (id: string) => id === "local";

  it("agents: the focused conversation pane in place, a second column beside", () => {
    const target: QsTarget = { kind: "agent", hostId: "ssh-a", sessionId: "s1" };
    expect(planOpen(target, false, shows)).toEqual({ via: "panes", kind: "core.conversation", params: { sessionId: "s1", hostId: "ssh-a" }, beside: false });
    expect(planOpen(target, true, shows)).toMatchObject({ via: "panes", kind: "core.conversation", beside: true });
  });

  it("services: the owner browser tab (system browser when the browser module is off / another host)", () => {
    const plan = planOpen({ kind: "service", hostId: "local", slug: "audiobook" }, false, shows);
    expect(plan).toEqual({ via: "panes", kind: "browser.service", params: { url: "cutex:service/audiobook/" }, beside: false, fallback: { via: "serviceExternal", hostId: "local", slug: "audiobook" } });
    expect(planOpen({ kind: "service", hostId: "local", slug: "a" }, true, shows, "听书")).toEqual({ via: "workspace", ref: { kind: "service", hostId: "local", key: "a", title: "听书" }, mode: "beside" });
    expect(planOpen({ kind: "service", hostId: "ssh-b", slug: "a" }, false, shows)).toEqual({ via: "serviceExternal", hostId: "ssh-b", slug: "a" });
  });

  it("artifacts: artifacts.view in the tool area; another host's through its ref", () => {
    expect(planOpen({ kind: "artifact", hostId: "local", ref: "af-1@latest", name: "论文" }, false, shows)).toMatchObject({ via: "panes", kind: "artifacts.view", params: { ref: "af-1@latest", name: "论文" }, beside: false });
    expect(planOpen({ kind: "artifact", hostId: "local", ref: "af-1@latest", name: "论文" }, true, shows)).toEqual({ via: "workspace", ref: { kind: "artifact", hostId: "local", key: "af-1@latest", title: "论文" }, mode: "beside" });
    expect(planOpen({ kind: "artifact", hostId: "ssh-b", ref: "af-1@latest", name: "论文" }, false, shows)).toEqual({ via: "ref", ref: { hostId: "ssh-b", kind: "artifact", key: "af-1@latest", title: "论文", params: {} } });
  });

  it("pages: page:<id> (string params only); command entries run; Shelf pages jump, never beside", () => {
    expect(planOpen({ kind: "page", page: "services.page", params: { tab: "x" } }, false, shows)).toEqual({ via: "panes", kind: "page:services.page", params: { tab: "x" }, beside: false });
    expect(planOpen({ kind: "page", page: "services.page", params: { tab: "x" } }, true, shows, "服务")).toEqual({ via: "workspace", ref: { kind: "page", hostId: "", key: "services.page", title: "服务" }, mode: "beside", pageParams: { tab: "x" } });
    const run = vi.fn();
    expect(planOpen({ kind: "run", run }, true, shows)).toEqual({ via: "run", run });
    expect(planOpen({ kind: "shelfPage", shelfId: "s", pageId: "p" }, true, shows)).toEqual({ via: "shelfPage", shelfId: "s", pageId: "p" });
    expect(hasBeside({ kind: "shelfPage", shelfId: "s", pageId: "p" })).toBe(false);
    expect(hasBeside({ kind: "run", run })).toBe(false);
    expect(hasBeside({ kind: "agent", hostId: "l", sessionId: "s" })).toBe(true);
  });

  it("Ctrl/⌘+↵ per kind and workspace count: agents side by side; services / artifacts into the other workspace's Shelf (two) or a new Shelf page (one); pages into the other workspace (two only)", () => {
    const one = { workspaces: 1, otherHostId: null };
    const two = { workspaces: 2, otherHostId: "local" };
    const twoRemote = { workspaces: 2, otherHostId: "ssh-b" };
    const svc: QsTarget = { kind: "service", hostId: "local", slug: "audiobook" };
    const art: QsTarget = { kind: "artifact", hostId: "local", ref: "af@latest", name: "n" };
    const page: QsTarget = { kind: "page", page: "services.page" };
    const agent: QsTarget = { kind: "agent", hostId: "local", sessionId: "s" };
    expect(besideAction(agent, one, shows)).toBe("sideBySide");
    expect(besideAction(agent, two, shows)).toBe("sideBySide");
    expect(besideAction(svc, one, shows)).toBe("newPage");
    expect(besideAction(svc, two, shows)).toBe("otherShelf");
    expect(besideAction(art, one, shows)).toBe("newPage");
    expect(besideAction(art, two, shows)).toBe("otherShelf");
    expect(besideAction(page, one, shows)).toBeNull();
    expect(besideAction(page, two, shows)).toBe("otherWorkspace");
    // a page over the whole window (设置) has no workspace to go to
    expect(besideAction({ kind: "page", page: "settings.page" }, { ...two, fullWindowPage: (p: string) => p === "settings.page" }, shows)).toBeNull();
    // the other workspace's Shelf shows another host: no beside for this host's service
    expect(besideAction(svc, twoRemote, shows)).toBeNull();
    expect(besideAction({ kind: "service", hostId: "ssh-b", slug: "x" }, twoRemote, shows)).toBe("otherShelf");
    // one workspace whose Shelf does not show the host: ↵ opens it outside the Shelf, no beside
    expect(besideAction({ kind: "service", hostId: "ssh-b", slug: "x" }, one, shows)).toBeNull();
    expect(besideAction({ kind: "shelfPage", shelfId: "s", pageId: "p" }, two, shows)).toBeNull();
    expect(besideAction({ kind: "run", run: () => {} }, two, shows)).toBeNull();
    expect(hasBeside(svc, two, shows)).toBe(true);
    expect(hasBeside(page, one, shows)).toBe(false);
  });

  it("beside for services / artifacts / pages goes through the workspaces API (openRef \"beside\"); nothing opened is reported", async () => {
    const d = deps();
    expect(await runOpen(planOpen({ kind: "service", hostId: "local", slug: "a" }, true, shows, "A"), d)).toEqual({ ok: true });
    expect(d.openRef).toHaveBeenLastCalledWith({ kind: "service", hostId: "local", key: "a", title: "A" }, "beside", {});
    await runOpen(planOpen({ kind: "artifact", hostId: "local", ref: "af@latest", name: "n" }, true, shows), d);
    expect(d.openRef).toHaveBeenLastCalledWith({ kind: "artifact", hostId: "local", key: "af@latest", title: "n" }, "beside", {});
    await runOpen(planOpen({ kind: "page", page: "services.page", params: { tab: "x" } }, true, shows), d);
    expect(d.openRef).toHaveBeenLastCalledWith({ kind: "page", hostId: "", key: "services.page" }, "beside", { pageParams: { tab: "x" } });
    expect(d.panesOpen).not.toHaveBeenCalled();
    d.openRef.mockResolvedValueOnce(false);
    expect(await runOpen(planOpen({ kind: "service", hostId: "local", slug: "a" }, true, shows), d)).toEqual({ ok: false, reason: "not-opened" });
  });

  function deps(panes: ReturnType<OpenDeps["panesOpen"]> = { status: "opened", kind: "k", paneId: "p", instanceId: null }) {
    return {
      panesOpen: vi.fn((..._args: Parameters<OpenDeps["panesOpen"]>) => panes),
      refsOpen: vi.fn(async () => ({ status: "opened", where: "card" }) as const),
      openServiceExternal: vi.fn(async () => {}),
      openShelfPage: vi.fn((pageId: string) => pageId !== "gone"),
      openRef: vi.fn(async (..._args: Parameters<OpenDeps["openRef"]>) => true),
    } satisfies OpenDeps;
  }

  it("dispatches to services.panes.open with beside / focus", async () => {
    const d = deps();
    expect(await runOpen(planOpen({ kind: "agent", hostId: "local", sessionId: "s1" }, false, shows), d)).toEqual({ ok: true });
    expect(d.panesOpen).toHaveBeenLastCalledWith("core.conversation", { sessionId: "s1", hostId: "local" }, { focus: true });
    await runOpen(planOpen({ kind: "agent", hostId: "local", sessionId: "s1" }, true, shows), d);
    expect(d.panesOpen).toHaveBeenLastCalledWith("core.conversation", { sessionId: "s1", hostId: "local" }, { beside: true, focus: true });
    await runOpen(planOpen({ kind: "page", page: "approvals.page" }, false, shows), d);
    expect(d.panesOpen).toHaveBeenLastCalledWith("page:approvals.page", {}, { focus: true });
    expect(await runOpen(planOpen({ kind: "shelfPage", shelfId: "s", pageId: "p" }, false, shows), d)).toEqual({ ok: true });
    expect(d.openShelfPage).toHaveBeenCalledWith("p");
    expect(await runOpen(planOpen({ kind: "shelfPage", shelfId: "s", pageId: "gone" }, false, shows), d)).toEqual({ ok: false, reason: "gone" });
    expect(d.refsOpen).not.toHaveBeenCalled();
  });

  it("falls back when the pane kind is unavailable; reports why otherwise", async () => {
    const off = deps({ status: "unavailable", reason: "module-off" });
    expect(await runOpen(planOpen({ kind: "service", hostId: "local", slug: "a" }, false, shows), off)).toEqual({ ok: true });
    expect(off.openServiceExternal).toHaveBeenCalledWith("a", "local");
    expect(await runOpen(planOpen({ kind: "artifact", hostId: "local", ref: "af@latest", name: "n" }, false, shows), off)).toEqual({ ok: true });
    expect(off.refsOpen).toHaveBeenCalledWith({ hostId: "local", kind: "artifact", key: "af@latest", title: "n", params: {} });
    expect(await runOpen(planOpen({ kind: "agent", hostId: "local", sessionId: "s" }, false, shows), off)).toEqual({ ok: false, reason: "module-off" });
    const stale = deps({ status: "stale" });
    expect(await runOpen(planOpen({ kind: "page", page: "a.b" }, false, shows), stale)).toEqual({ ok: false, reason: "stale" });
    const broken = deps();
    broken.openServiceExternal.mockRejectedValueOnce(new Error("boom"));
    expect(await runOpen({ via: "serviceExternal", hostId: "x", slug: "y" }, broken)).toEqual({ ok: false, reason: "boom" });
  });
});

describe("items", () => {
  const row = (id: string, name: string, extra: Partial<AgentRow> = {}): AgentRow =>
    ({ id, name, subtitle: "", status: "idle", isDirector: false, pinned: false, lastActivity: 0, profile: null, color: null, session: { cutexSessionId: id } as AgentRow["session"], hostId: "local", key: `["local","${id}"]` as AgentRow["key"], ...extra }) as AgentRow;

  it("agents: 需要你 / running / new result first, then the latest activity; host offline = disabled", () => {
    const groups: SidebarGroup[] = [
      { kind: "project", id: "p1", hostId: "local", name: "cutex-dev", badge: "C", color: "blue", online: [row("a", "quiet", { lastActivity: 50 }), row("b", "busy", { status: "running", lastActivity: 1 }), row("c", "asks", { lastActivity: 2 })], offline: [] },
      { kind: "independent", id: "__independent__", hostId: "ssh-x", online: [row("d", "remote", { hostId: "ssh-x", key: undefined, lastActivity: 99 })], offline: [] },
    ];
    const signals = new Map([
      ['["local","b"]', "running" as const],
      ['["local","c"]', "needsYou" as const],
    ]);
    const items = agentItems({ groups, chats: [row("e", "chat", { lastActivity: 70 })], signals, stateOf: (h) => (h === "ssh-x" ? "offline" : "live"), focus: "local" }, t);
    expect(items.map((i) => i.title)).toEqual(["asks", "busy", "chat", "quiet", "remote"]);
    expect(items[0]!.badge).toEqual({ text: "quick-switch.status.needsYou", tone: "attention" });
    expect(items[0]!.subtitle).toBe("cutex-dev");
    expect(items[2]!.subtitle).toBe("quick-switch.chats");
    const remote = items.find((i) => i.title === "remote")!;
    expect(remote).toMatchObject({ disabled: true, hostId: "ssh-x", subtitle: "quick-switch.noProject", target: { kind: "agent", hostId: "ssh-x", sessionId: "d" } });
    expect(items.map((i) => i.rank)).toEqual([0, 1, 2, 3, 4]);
  });

  it("agents: an owner-set 显示名称 is the title, the agent's own name still finds it", () => {
    const aliased = row("x", "小星", { session: { cutexSessionId: "x", displayName: "小星", displayNameOverride: "小星", formalAgentName: "astra-composer" } as AgentRow["session"] });
    const groups: SidebarGroup[] = [{ kind: "independent", id: "__independent__", hostId: "local", online: [aliased, row("y", "plain")], offline: [] }];
    const items = agentItems({ groups, chats: [], signals: new Map(), stateOf: () => "live", focus: "local" }, t);
    const item = items.find((i) => i.id === "agent:local:x")!;
    expect(item.title).toBe("小星");
    expect(matchItem("astra-comp", item)).not.toBeNull();
    expect(items.find((i) => i.id === "agent:local:y")!.terms).toEqual(["y"]);
  });

  it("services: per host, running first; slug searchable", () => {
    const svc = (slug: string, health: ServiceView["health"]) => ({ slug, displayName: slug === "b" ? "" : `S-${slug}`, health }) as ServiceView;
    const items = serviceItems([{ hostId: "local", services: [svc("a", "stopped"), svc("b", "reachable")], state: "live" }], t);
    expect(items.map((i) => [i.title, i.badge?.text ?? null])).toEqual([["b", null], ["S-a", "quick-switch.status.stopped"]]);
    expect(items[1]!.terms).toEqual(["a"]);
    expect(items[1]!.target).toEqual({ kind: "service", hostId: "local", slug: "a" });
  });

  it("artifacts: newest first, archived dropped, latest version ref", () => {
    const a = (id: string, updatedAt: string, archivedAt: string | null = null) => ({ artifactId: id, name: `N-${id}`, kind: "report", latestVersion: 3, updatedAt, archivedAt }) as ArtifactSummary;
    const items = artifactItems([{ hostId: "local", project: "P", items: [a("x", "2026-10-01"), a("y", "2026-10-20"), a("z", "2026-10-21", "2026-10-21")] }], t);
    expect(items.map((i) => i.title)).toEqual(["N-y", "N-x"]);
    expect(items[0]!.target).toEqual({ kind: "artifact", hostId: "local", ref: "y@latest", name: "N-y" });
    expect(items[0]!.subtitle).toBe("quick-switch.sub.artifact(project=P,n=3)");
  });

  it("pages: nav.primary entries (page targets and commands), disabled when unavailable", () => {
    const run = vi.fn();
    const nav = (id: string, target: NavItem["target"], area?: NavItem["area"]) => ({ id, icon: Globe, titleKey: `${id}.title`, target, ...(area ? { area } : {}) }) as unknown as NavItem;
    const items = pageItems([{ item: nav("services.nav", { page: "services.page" }), disabled: false }, { item: nav("x.cmd", { run }, "footer"), disabled: true }], t);
    expect(items[0]).toMatchObject({ title: "services.nav.title", target: { kind: "page", page: "services.page" }, subtitle: "quick-switch.sub.page" });
    expect(items[1]).toMatchObject({ disabled: true, target: { kind: "run", run }, subtitle: "quick-switch.sub.footer" });
  });

  it("Shelf pages: from lib/shelves (left Shelf first), side + rail place, the shown one marked, the rail's icon", () => {
    shelf.pages = [
      { shelfId: "L", side: "left", pageId: "p1", index: 1, name: "网页", icon: null, firstKind: "browser.tab", inView: true, focused: false, panes: 1, shelfCollapsed: true },
      { shelfId: "R", side: "right", pageId: "p2", index: 1, name: "听书", icon: "headphones", firstKind: null, inView: true, focused: true, panes: 2, shelfCollapsed: false },
      { shelfId: "R", side: "right", pageId: "p3", index: 2, name: "任务", icon: null, firstKind: null, inView: false, focused: false, panes: 0, shelfCollapsed: false },
    ];
    const pages = readShelfPages();
    // A collapsed Shelf's page is not "showing"; icons: the first pane's kind, the page's own, the generic one.
    expect(pages.map((p) => [p.name, p.side, p.index, p.current])).toEqual([["网页", "left", 1, false], ["听书", "right", 1, true], ["任务", "right", 2, false]]);
    expect(pages[0]!.icon).toBe(Globe);
    expect(pages[1]!.icon).toBe(Headphones);
    // An empty page: its own dashed square (not the Shelf toggle's / layers icon; owner 2026-10-25).
    expect(pages[2]!.icon).toBe(SquareDashed);
    const items = shelfPageItems(pages, t);
    expect(items.map((i) => i.subtitle)).toEqual(["quick-switch.sub.shelfLeft(n=1)", "quick-switch.sub.shelfRight(n=1)", "quick-switch.sub.shelfRight(n=2)"]);
    expect(items[1]!.badge?.text).toBe("quick-switch.status.showing");
    expect(items[1]!.target).toEqual({ kind: "shelfPage", shelfId: "R", pageId: "p2" });
    shelf.throws = true;
    expect(readShelfPages()).toEqual([]);
    shelf.throws = false;
    expect(showShelfPage("p2")).toBe(true);
    expect(shelf.opened).toEqual(["p2"]);
  });

  it("新建空页 closes the Shelf pages section and runs lib/sideActions newPage — also with no page yet (owner 2026-10-24)", () => {
    const run = vi.fn();
    const item = newShelfPageItem(t, run, 0);
    expect(item).toMatchObject({ kind: "shelfPage", title: "side.newPage", subtitle: "quick-switch.sub.newShelfPage (Ctrl+Shift+N)", rank: 0 });
    const plan = planOpen(item.target, false, () => true);
    expect(plan.via).toBe("run");
    if (plan.via === "run") void plan.run();
    expect(run).toHaveBeenCalledTimes(1);
    expect(flatRows(rankItems([item], { query: "empty page", scope: "shelfPage" })).map((r) => r.item.id)).toEqual(["shelf:new"]);
  });
});

describe("artifact lists", () => {
  it("one fetch per project per minute, shared while in flight, errors left out", async () => {
    resetArtifactCache();
    const fetch = vi.fn(async (hostId: string, q: { project?: string }) => {
      if (q.project === "bad") throw new Error("403");
      return { scope: { kind: "project", id: q.project! }, items: [{ artifactId: `${hostId}-${q.project}` } as ArtifactSummary], nextCursor: null } as never;
    });
    const projects = [
      { hostId: "local", projectId: "p1", name: "P1" },
      { hostId: "local", projectId: "bad", name: "Bad" },
    ];
    const [a, b] = await Promise.all([loadArtifacts(projects, fetch, 0), loadArtifacts(projects, fetch, 0)]);
    expect(a.map((s) => s.project)).toEqual(["P1"]);
    expect(b).toEqual(a);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ project: "p1", archived: "false" });
    expect(cachedArtifacts(projects).map((s) => s.project)).toEqual(["P1"]);
    await loadArtifacts(projects, fetch, Date.now() + 1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await loadArtifacts(projects, fetch, Date.now() + ARTIFACT_TTL_MS + 1);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
