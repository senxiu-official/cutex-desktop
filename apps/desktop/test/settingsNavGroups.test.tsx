// @vitest-environment jsdom
// The settings nav's groups after the owner's moves (2026-11-11): 你 on its own at the top, 键盘与手势 under 应用,
// 关于 / 新功能 / 帮助 as 帮助与关于 at the bottom; one 主人通知 (the four owner_notify levels in its card, not a band
// of 事件分级). Old deep links keep landing on the same pages (the grouping is display only).
import { act, createElement as h, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { stubServices } from "./serviceStub";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MODULES } = await import("../src/renderer/src/modules/registry");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { MOCK_NEW_FEATURES } = await import("../src/renderer/src/dev/mockFeatures");
const { NAV_PAGE_GROUPS, SETTINGS_NAV_UNTITLED, navGroupOf, settingsNavGroups, settingsNavPage, settingsTab, subPageOfAnchor } = await import("../src/renderer/src/lib/settingsNav");
const { OwnerNotifyLevelsContext, useOwnerNotifyLevels } = await import("../src/renderer/src/lib/ownerNotifyLevels");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

async function pages() {
  const host = createModuleHost({ modules: MODULES, slots: SLOT_SPECS, host: { id: "local", kind: "local", features: new Set(MOCK_NEW_FEATURES) }, storage: memoryStorage(), services: () => stubServices(), log: () => {} });
  await host.idle();
  return host.snapshot("settings.page").filter((e) => e.mode === "show");
}

describe("settings nav groups (owner 2026-11-11)", () => {
  it("你 first and alone, 键盘与手势 last in 应用, 系统 keeps 模块 and the updates, 帮助与关于 at the bottom", async () => {
    const groups = settingsNavGroups(await pages());
    const byGroup = Object.fromEntries(groups.map((g) => [g.group, g.entries.map((e) => e.item.page)]));
    expect(groups.map((g) => g.group)).toEqual(["you", "app", "panels", "connection", "agents", "tools", "data", "system", "help"]);
    expect(byGroup.you).toEqual(["me"]);
    expect(byGroup.app!.at(-1)).toBe("shortcuts");
    expect(byGroup.app!.slice(0, 2)).toEqual(["general", "appearance"]);
    expect(byGroup.connection).not.toContain("me");
    expect(byGroup.connection).toContain("hosts");
    expect(byGroup.system).toContain("modules");
    expect(byGroup.system).not.toContain("shortcuts");
    for (const p of ["about", "whats-new", "help"]) expect(byGroup.system).not.toContain(p);
    expect(byGroup.help).toEqual(["about", "whats-new", "help"]);
  });

  it("a display grouping: the modules still declare their old group; only 你 has no heading", async () => {
    const all = await pages();
    const declared = (p: string) => all.find((e) => e.item.page === p)!.item.group;
    expect(declared("me")).toBe("connection");
    expect(declared("shortcuts")).toBe("system");
    expect(declared("about")).toBe("system");
    for (const [page, group] of Object.entries(NAV_PAGE_GROUPS)) expect(navGroupOf({ page, group: declared(page) })).toBe(group);
    expect(SETTINGS_NAV_UNTITLED).toEqual(["you"]);
    expect([zhCN["settings.group.help"], zhCN["settings.group.you"]]).toEqual(["帮助与关于", "你"]);
    expect([en["settings.group.help"], en["settings.group.you"]]).toEqual(["Help & about", "You"]);
  });

  it("old deep links land on the same pages, and the nav marks them in their new group", async () => {
    const all = await pages();
    for (const tab of ["me", "shortcuts", "about", "whats-new", "help", "notifications", "modules"]) {
      expect(settingsTab({ tab })).toBe(tab);
      expect(settingsNavPage(all, tab)).toBe(tab);
      expect(all.some((e) => e.item.page === tab)).toBe(true);
    }
    // Pages with a nav parent still mark the parent; anchors on moved pages stay on their page (no sub-page).
    for (const e of all.filter((x) => x.item.navParent)) expect(settingsNavPage(all, e.item.page)).toBe(e.item.navParent);
    const me = all.find((e) => e.item.page === "me")!.item;
    expect(subPageOfAnchor(me, "devices")).toBeUndefined();
  });

  it("settings search lists every page once, in the new nav order (details included)", async () => {
    const all = await pages();
    const ordered = settingsNavGroups(all, true).flatMap((g) => g.entries.map((e) => e.item.page));
    expect(new Set(ordered).size).toBe(all.length);
    expect(ordered[0]).toBe("me");
    expect(ordered.slice(-3)).toEqual(["about", "whats-new", "help"]);
  });
});

describe("one 主人通知 (lib/ownerNotifyLevels)", () => {
  const render = async (node: ReactNode) => {
    const box = document.createElement("div");
    const root = createRoot(box);
    await act(async () => root.render(node));
    return { box, unmount: () => act(() => root.unmount()) };
  };
  function Card({ show }: { show: boolean }) {
    const rows = useOwnerNotifyLevels(show);
    return h("div", { "data-card": "" }, rows);
  }

  it("the card shows the level rows and tells 事件分级 to leave its band out, until it goes", async () => {
    const shown: boolean[] = [];
    const slot = { rows: h("span", { "data-rows": "" }, "levels"), onShown: (v: boolean) => void shown.push(v) };
    const { box, unmount } = await render(h(OwnerNotifyLevelsContext, { value: slot }, h(Card, { show: true })));
    expect(box.querySelector("[data-card] [data-rows]")).not.toBeNull();
    expect(shown).toEqual([true]);
    unmount();
    expect(shown).toEqual([true, false]);
  });

  it("no rows (host without levels) or the card not showing them: the band stays", async () => {
    const shown: boolean[] = [];
    const none = await render(h(OwnerNotifyLevelsContext, { value: { rows: null, onShown: (v: boolean) => void shown.push(v) } }, h(Card, { show: true })));
    const off = await render(h(OwnerNotifyLevelsContext, { value: { rows: h("span", {}, "x"), onShown: (v: boolean) => void shown.push(v) } }, h(Card, { show: false })));
    expect(none.box.textContent).toBe("");
    expect(off.box.textContent).toBe("");
    expect(shown).toEqual([]);
    none.unmount();
    off.unmount();
  });
});
