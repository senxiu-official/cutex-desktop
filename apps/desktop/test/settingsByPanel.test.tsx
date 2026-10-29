// @vitest-environment jsdom
// Design 006 v1 (owner 2026-10-22, 「合面板」): the settings of the panels on screen are pages of a 面板 group right after
// 应用 (侧栏 · 会话 · 状态显示 · {{shelf}} · 托盘 · 桌面), old page ids keep aliases; each panel's ⋯ ends with 「⚙ X 设置…」
// (with its 动作预告); hovering a setting outlines the panel(s) it affects (Q9, after 150 ms); a 动作预告 switch (Q3,
// default on) gates every click preview; the 4 dead right-column prefs are dropped (Q5); 性能记录 is on 更新与诊断 (Q7);
// page data under {{shelf}} › 成果窗格 (Q8); 640 px said, not adjustable (Q6); 只看 {{shelf}} explained on 会话 (Q4).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { navGroupOf, PANEL_PAGES, settingsNavGroups, settingsTab } from "../src/renderer/src/lib/settingsNav";
import { clearForetell, setForetell, useForetellStore } from "../src/renderer/src/lib/foretell";
import { foretellOn, setForetellOn } from "../src/renderer/src/lib/foretellPref";
import { affectsForetell, anchorsAround, panelSettingsForetell, panelSettingsItem, PANEL_SELECTOR, settingsAffects, useSettingsAffectsHover } from "../src/renderer/src/lib/panelSettings";
import { useSettingsShelf } from "../src/renderer/src/lib/settingsShelf";
import { translate } from "../src/renderer/src/i18n";
import { useApp } from "../src/renderer/src/store";

const SRC = join(__dirname, "../src/renderer/src");
const src = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const page = (id: string, p: string, group: "app" | "connection" | "tools" | "system") => ({ item: { id, page: p, group } });

afterEach(() => {
  clearForetell();
  setForetellOn(true);
  vi.useRealTimers();
});

describe("the 面板 group (lib/settingsNav)", () => {
  it("panel pages show as their own group right after 应用, in a fixed order; the rest keep their group and order", () => {
    const pages = [page("g", "general", "app"), page("a", "appearance", "app"), page("sd", "sides", "app"), page("c", "conversation", "app"), page("sb", "sidebar", "app"), page("n", "notifications", "app"), page("t", "tray", "app"), page("d", "desktop", "app"), page("st", "status", "app"), page("h", "hosts", "connection"), page("m", "modules", "system")];
    const groups = settingsNavGroups(pages);
    expect(groups.map((g) => g.group)).toEqual(["app", "panels", "connection", "system"]);
    expect(groups[0]!.entries.map((e) => e.item.page)).toEqual(["general", "appearance", "notifications"]);
    expect(groups[1]!.entries.map((e) => e.item.page)).toEqual(["sidebar", "conversation", "status", "sides", "tray", "desktop"]);
    expect(PANEL_PAGES).toEqual(["sidebar", "conversation", "status", "sides", "tray", "desktop"]);
    // A display grouping: the module's own `group` is untouched (the contract's SettingsGroupId has no "panels").
    expect(navGroupOf({ page: "tray", group: "app" })).toBe("panels");
    expect(navGroupOf({ page: "appearance", group: "app" })).toBe("app");
    expect(src("modules/slots.ts")).toContain("group: SettingsGroupId;");
    expect(src("lib/settingsNav.ts")).toMatch(/export type SettingsGroupId = "app" \| "connection" \| "agents" \| "tools" \| "data" \| "system";/);
  });

  it("old page ids keep aliases: 输入区 (`composer`) lands on 会话; the folded host pages as before", () => {
    expect(settingsTab({ tab: "composer" })).toBe("conversation");
    expect(settingsTab({ tab: "peers" })).toBe("access");
    expect(settingsTab({ tab: "tray" })).toBe("tray");
    expect(settingsTab({})).toBe("general");
  });

  it("the shell's pages: 托盘 and 桌面 are new, 输入区 is a 会话 section; the panel pages carry the panel names", () => {
    const shell = src("modules/shell/index.ts");
    expect(shell).toMatch(/id: "shell\.tray", page: "tray"/);
    expect(shell).toMatch(/id: "shell\.desktop", page: "desktop"/);
    expect(shell).not.toMatch(/id: "shell\.composer", page: "composer"/);
    for (const id of ["shell.convWidth", "shell.composer", "shell.gutter", "shell.shelfOnly"]) expect(shell).toMatch(new RegExp(`id: "${id.replace(".", "\\.")}", page: "conversation"`));
    expect(shell).toMatch(/titleKey: "settings\.panel\.sidebar"/);
    expect(shell).toMatch(/titleKey: "settings\.panel\.status"/);
    expect(shell).toMatch(/titleKey: "settings\.panel\.shelf"/);
    expect(src("modules/conversation/index.ts")).toMatch(/titleKey: "settings\.panel\.conversation"/);
    const zh = src("i18n/zh-CN.ts");
    expect(zh).toContain('"settings.panel.conversation": "会话"');
    expect(zh).toContain('"settings.group.panels": "面板"');
    // The owner's naming rule (026): no 「列」 in a panel's name.
    for (const k of ["sidebar", "conversation", "status", "shelf", "tray", "desktop"]) expect(zh.match(new RegExp(`"settings\\.panel\\.${k}": "([^"]*)"`))?.[1]).not.toContain("列");
  });

  it("keeps module settings on their panel pages, with page data independently searchable on Shelf", () => {
    expect(src("modules/bookmarks/index.ts")).toMatch(/id: "bookmarks\.settings", page: "conversation"/);
    expect(src("modules/perf-log/index.ts")).toMatch(/id: "perf-log\.section", page: "updates"/);
    expect(src("components/settings/AppSettings.tsx")).toContain('<SettingsSections page="updates" />');
    expect(src("modules/artifacts/index.ts")).toMatch(/id: "artifacts\.settings", page: "sides"/);
    expect(src("modules/artifacts/index.ts")).toMatch(/id: "artifacts\.pageData", page: "sides"/);
    expect(src("modules/artifacts/Settings.tsx")).not.toContain("<PageDataSettings");
    expect(src("modules/artifacts/i18n.ts")).toContain('"artifacts.settings": "成果窗格"');
    expect(src("modules/home/index.ts")).toMatch(/id: "home\.desktopSettings", page: "desktop"/);
    // Q6: the page width is said, not a control; Q4: one line on 只看 Shelf, no switch.
    const ws = src("components/WorkSurfaceSettings.tsx");
    expect(ws).toMatch(/data-page-width-note[^>]*>\{PAGE_SHELF_WIDTH\} px</);
    const panels = src("components/settings/PanelPages.tsx");
    expect(panels).toContain("settings.panel.shelfOnlyHint");
    expect(panels).not.toMatch(/Toggle|Segmented/);
  });
});

describe("动作预告 switch (Q3)", () => {
  it("default on; off: no click preview shows (what the owner showed goes), the settings outline still does", () => {
    expect(foretellOn()).toBe(true);
    const owner = {};
    const f = { tone: "open" as const, text: "x", marks: [{ selector: "body" }] };
    setForetell(owner, f);
    expect(useForetellStore.getState().shown).toBe(f);
    setForetellOn(false);
    expect(localStorage.getItem("cutex-desktop.foretell")).toBe("off");
    setForetell(owner, { ...f, text: "y" });
    expect(useForetellStore.getState().shown).toBeNull();
    const outline = affectsForetell(["tray"])!;
    expect(outline.always).toBe(true);
    setForetell(owner, outline);
    expect(useForetellStore.getState().shown).toBe(outline);
    setForetellOn(true);
    expect(localStorage.getItem("cutex-desktop.foretell")).toBeNull();
    setForetell(owner, f);
    expect(useForetellStore.getState().shown).toBe(f);
  });

  it("the switch is on 外观 → 窗口与卡片", () => {
    expect(src("components/WorkSurfaceSettings.tsx")).toMatch(/data-foretell-switch[\s\S]*setForetellOn/);
  });
});

describe("the 4 dead right-column prefs (Q5)", () => {
  beforeEach(() => vi.resetModules());

  it("are left out on load and gone after the next save; 点击当前页图标 is no longer read", async () => {
    localStorage.setItem("cutex-desktop.ui", JSON.stringify({ sidePageBar: "tabs", sidePillAnchor: "bottom", sideLaneWhenHidden: "hide", sideCurrentPageClick: "collapse", sideRestore: false }));
    const prefs = await import("../src/renderer/src/lib/prefs");
    const now = prefs.getUiPrefs() as unknown as Record<string, unknown>;
    for (const k of prefs.DROPPED_PREFS) expect(k in now).toBe(false);
    expect(now.sideRestore).toBe(false);
    prefs.setUiPref("sideRestore", true);
    const saved = JSON.parse(localStorage.getItem("cutex-desktop.ui")!) as Record<string, unknown>;
    for (const k of prefs.DROPPED_PREFS) expect(k in saved).toBe(false);
    expect(saved.sideRestore).toBe(true);
    for (const f of ["lib/sideMenus.tsx", "lib/sideActions.ts"]) expect(src(f)).not.toContain("sideCurrentPageClick");
    expect(src("modules/shell/settingsSearch.ts")).not.toMatch(/shell\.sides\.(pillAnchor|laneWhenHidden|currentPageClick)|side\.pageBar/);
    localStorage.removeItem("cutex-desktop.ui");
  });
});

describe("「⚙ X 设置…」 (the entries)", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div data-side-work=""></div><aside data-settings-shelf=""></aside>`;
    const work = document.querySelector("[data-side-work]")!;
    vi.spyOn(work, "getBoundingClientRect").mockReturnValue({ left: 300, top: 40, width: 1200, height: 800, right: 1500, bottom: 840, x: 300, y: 40, toJSON() {} } as DOMRect);
  });
  afterEach(() => {
    useSettingsShelf.setState({ open: false });
    vi.restoreAllMocks();
  });

  it("the row opens that page; its foretell: blue where the Settings Shelf opens (its side, its width), the panel outlined", () => {
    const openSettings = vi.fn();
    useApp.setState({ openSettings } as never);
    useSettingsShelf.setState({ open: false, side: "left", width: 760 });
    const item = panelSettingsItem("tray");
    expect(item.label).toBe(translate("settings.panel.menu.tray"));
    const f = item.foretell!()!;
    expect(f.tone).toBe("open");
    expect(f.marks[0]).toMatchObject({ box: { left: 300, top: 40, width: 760, height: 800 }, text: translate("foretell.settingsHere", { page: translate("settings.panel.tray") }) });
    expect(f.marks[1]).toMatchObject({ selector: PANEL_SELECTOR.tray, text: translate("foretell.settingsPanel"), tone: "fold" });
    useSettingsShelf.setState({ side: "right" });
    expect(panelSettingsForetell("tray")!.marks[0]!.box).toMatchObject({ left: 1500 - 760, width: 760 });
    item.onSelect();
    expect(openSettings).toHaveBeenCalledWith("tray", undefined);
  });

  it("Settings already open: 设置换到「X」 on its card; a given panel selector is outlined (this very Shelf)", () => {
    useSettingsShelf.setState({ open: true });
    const f = panelSettingsForetell("sides", '[data-shelf="s1"]')!;
    expect(f.marks[0]).toMatchObject({ selector: "[data-settings-shelf]", text: translate("foretell.settingsSwitch", { page: translate("settings.panel.shelf") }) });
    expect(f.marks[1]!.selector).toBe('[data-shelf="s1"]');
  });

  it("every panel kind's menu ends with it", () => {
    expect(src("lib/shelfMenus.tsx")).toMatch(/panelSettingsItem\("sides", \{ panel: `\[data-shelf=/);
    expect(src("components/ConversationHeader.tsx")).toMatch(/entries\.push\(panelSettingsItem\("conversation"/);
    // The tray also offers all settings after its own page entry.
    expect(src("components/ChipTray.tsx")).toMatch(/panelSettingsItem\("tray"\)/);
    // …then 「使用小指南」 (lib/panelGuides) after a separator.
    expect(src("lib/customizeMenu.tsx")).toMatch(/return \[customizeSidebarItem\(t\), panelSettingsItem\("sidebar"\), \.\.\.panelGuideTail\(\{ panel: "sidebar" \}\)\];/);
    // The sidebar's own menu may start with 停止空闲的… (design 031); the tail stays last. One menu since the rail
    // went (2026-10-28): the popped sidebar reuses the roster.
    expect(src("components/Sidebar.tsx").match(/contextMenu\(\(\) => (?:\[\.\.\.hostStopIdleEntries\(t, <Power size=\{14\} \/>\), \.\.\.)?sidebarMenuTail\(t\)\]?\)/g)?.length).toBe(1);
    expect(src("modules/status-capsule/StatusCapsule.tsx")).toMatch(/panelSettingsForetell\("status", "\[data-status-capsule\]"\)/);
    expect(src("modules/home/DeskSurface.tsx")).toMatch(/panelSettingsItem\("desktop"\)/);
  });
});

describe("hovering a setting outlines its panel (Q9)", () => {
  it("maps the cards (innermost id first) to their panels, else the page's", () => {
    expect(settingsAffects("conversation", ["send", "shell.composer"])).toEqual(["composer"]);
    expect(settingsAffects("conversation", ["display"])).toEqual(["conversation"]);
    expect(settingsAffects("sides", ["shelf-place"])).toEqual(["rail", "shelf"]);
    expect(settingsAffects("appearance", ["launchArt"])).toEqual([]);
    expect(settingsAffects("tray", [])).toEqual(["tray"]);
    expect(settingsAffects("profiles", [])).toEqual([]);
    const el = document.createElement("div");
    el.innerHTML = `<section id="settings-shell.composer"><div id="settings-send"><span id="x">row</span></div></section>`;
    expect(anchorsAround(el.querySelector("#x"), el)).toEqual(["send", "shell.composer"]);
  });

  it("after 150 ms; moving within the card keeps it; leaving takes it away; maximised: nothing", () => {
    vi.useFakeTimers();
    let handlers: ReturnType<typeof useSettingsAffectsHover> | null = null;
    let disabled = false;
    function Probe() {
      handlers = useSettingsAffectsHover("conversation", disabled);
      return h("div", { id: "col", onPointerOver: (e: never) => handlers!.onPointerOver(e), onPointerLeave: () => handlers!.onPointerLeave() }, h("div", { id: "settings-send" }, h("span", { id: "a" }, "a"), h("span", { id: "b" }, "b")));
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(h(Probe)));
    const over = (id: string) => act(() => void host.querySelector(`#${id}`)!.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    over("a");
    expect(useForetellStore.getState().shown).toBeNull();
    act(() => void vi.advanceTimersByTime(160));
    const shown = useForetellStore.getState().shown!;
    expect(shown.always).toBe(true);
    expect(shown.marks.map((m) => m.selector)).toEqual([PANEL_SELECTOR.composer]);
    over("b");
    expect(useForetellStore.getState().shown).toBe(shown);
    act(() => handlers!.onPointerLeave());
    expect(useForetellStore.getState().shown).toBeNull();
    disabled = true;
    act(() => root.render(h(Probe)));
    over("a");
    act(() => void vi.advanceTimersByTime(160));
    expect(useForetellStore.getState().shown).toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it("the Settings Shelf's page column uses it (not while maximised)", () => {
    expect(src("components/SettingsShelf.tsx")).toMatch(/useSettingsAffectsHover\(tab, maximized\)/);
    expect(src("components/SettingsShelf.tsx")).toMatch(/data-settings-page-column="" \{\.\.\.affects\}/);
  });
});
