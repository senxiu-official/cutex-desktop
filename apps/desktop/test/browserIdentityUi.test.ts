// @vitest-environment jsdom
// 浏览器身份 package B: 「我的浏览器」 (D1) placement, the identity a new owner tab asks for, and the tab menu's
// 「用其他身份打开…」.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyOpen, emptyLayout, place, placeSpec, sanitizeLayout, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import { initBrowser, parseBrowserParams, restoreBrowser, type BrowserState } from "../src/renderer/src/modules/browser/browserState";
import { useBrowserIdentities } from "../src/renderer/src/modules/browser/identities";
import { browserTabMenu, newTabMenu } from "../src/renderer/src/modules/browser/identityMenus";
import { browserCache } from "../src/renderer/src/modules/browser/browserCache";
import type { BrowserIdentityView } from "../src/shared/browserIdentity";

const SPEC = placeSpec({ home: "browser", order: 100, fixedPage: { titleKey: "browser.myBrowser", icon: "globe" } });
const host: SideBinding = { kind: "host", hostId: "local" };
const agent: SideBinding = { kind: "agent", hostId: "local", sessionId: "A" };
let clock = 1;

function open(layout: SideLayout, binding: SideBinding, key: string): SideLayout {
  const decision = place(layout, { kind: "browser.tab", binding, key, transient: false, page: undefined, activePage: layout.activePage, columnOpen: layout.open }, SPEC);
  return applyOpen(layout, decision, { kind: "browser.tab", binding, key, state: { url: "about:blank" }, v: 1, pinned: true }, ++clock, { reveal: true, home: "browser" }).layout;
}

describe("「我的浏览器」 fixed page (D1)", () => {
  it("puts host-bound opens on one shared, kept page and agent-bound opens elsewhere", () => {
    let l = open(emptyLayout(), host, "t1");
    const fixed = l.pages.filter((p) => p.fixedHome === "browser");
    expect(fixed).toHaveLength(1);
    expect(fixed[0]).toMatchObject({ shared: true, kept: true, icon: "globe" });
    l = open(l, host, "t2");
    expect(l.pages.filter((p) => p.fixedHome === "browser")).toHaveLength(1);
    const page = l.pages.find((p) => p.fixedHome === "browser")!;
    expect(page.cards).toHaveLength(1);
    expect(page.cards[0]!.tabs).toHaveLength(2);
    l = open(l, agent, "t3");
    const agentInst = Object.entries(l.instances).find(([, i]) => i.key === "t3")![0];
    expect(page.cards[0]!.tabs).not.toContain(agentInst);
    expect(l.pages.find((p) => p.cards.some((c) => c.tabs.includes(agentInst)))?.fixedHome).toBeUndefined();
  });

  it("keeps fixedHome through a reload, once", () => {
    const l = open(emptyLayout(), host, "t1");
    const again = sanitizeLayout(JSON.parse(JSON.stringify(l)));
    expect(again.pages.filter((p) => p.fixedHome === "browser")).toHaveLength(1);
  });

});

describe("new owner tab identity", () => {
  it("parses a valid identity and drops an invalid one", () => {
    expect(parseBrowserParams({ url: "about:blank", browserIdentityId: "1a2b3c4d" })).toEqual({ url: "about:blank", browserIdentityId: "1a2b3c4d" });
    expect(parseBrowserParams({ url: "about:blank", browserIdentityId: "../x" })).toEqual({ url: "about:blank" });
  });

  it("carries it into a new owner tab only, and never restores it", () => {
    const s = initBrowser({ url: "https://example.com/", browserIdentityId: "1a2b3c4d" }, null);
    expect(s).toMatchObject({ newOwner: true, newIdentity: "1a2b3c4d" });
    const reused = initBrowser({ url: "https://example.com/", browserIdentityId: "5e6f7a8b" }, { url: "https://a.test/", title: "", tabKey: "00000000-0000-4000-8000-000000000001" });
    expect(reused.newIdentity).toBeUndefined();
    expect(restoreBrowser(s as never, 1)?.newIdentity).toBeUndefined();
  });
});

const view = (id: string, name: string, color: BrowserIdentityView["color"]): BrowserIdentityView =>
  ({ id, name, color, initial: name[0]!, isDefault: id === "default", createdAt: 0, updatedAt: 0, revision: 1, hosts: [], openTabs: 0 });

describe("identity menus", () => {
  beforeEach(() => {
    useBrowserIdentities.setState({ supported: true, state: { identities: [view("default", "个人", null), view("1a2b3c4d", "工作", "teal"), view("5e6f7a8b", "学校", "violet")], current: "1a2b3c4d" } });
  });

  it("＋▾ lists every identity and opens a blank tab in it", () => {
    const newTab = vi.fn();
    const items = newTabMenu(newTab) as { label: string; onSelect(): void }[];
    expect(items.map((i) => i.label)).toEqual(["个人", "工作", "学校"]);
    items[2]!.onSelect();
    expect(newTab).toHaveBeenCalledWith({ url: "about:blank", browserIdentityId: "5e6f7a8b" });
  });

  it("「用其他身份打开…」 offers the other identities with the same address", () => {
    const tabKey = "00000000-0000-4000-8000-000000000002";
    browserCache.update({ hostId: "local", tabKey, guestId: "g", url: "https://outlook.office.com/mail/", title: "Mail", loading: false, canGoBack: false, canGoForward: false, pool: "owner", browserIdentityId: "1a2b3c4d" } as never);
    const state: BrowserState = { url: "https://outlook.office.com/", title: "", tabKey };
    const newTab = vi.fn();
    // 后台播放 (bgplay.ts) comes first on an owner tab.
    const [bg, entry] = browserTabMenu({ id: "i1", kind: "browser.tab", binding: host, state, pinned: true }, { hostId: "local", newTab }) as { label: string; submenu: { label: string; onSelect(): void }[] }[];
    expect(bg!.label).toBe("Play in background");
    expect(entry!.submenu.map((i) => i.label)).toEqual(["个人", "学校"]);
    entry!.submenu[1]!.onSelect();
    expect(newTab).toHaveBeenCalledWith({ url: "https://outlook.office.com/mail/", browserIdentityId: "5e6f7a8b" });
  });

  it("offers nothing for an agent's tab; with one identity only 后台播放", () => {
    const state: BrowserState = { url: "https://a.test/", title: "", tabKey: "00000000-0000-4000-8000-000000000003", agentOpened: true };
    expect(browserTabMenu({ id: "i2", kind: "browser.tab", binding: host, state, pinned: true }, { hostId: "local", newTab: () => {} })).toEqual([]);
    useBrowserIdentities.setState({ state: { identities: [view("default", "个人", null)], current: "default" } });
    expect(browserTabMenu({ id: "i3", kind: "browser.tab", binding: host, state: { ...state, agentOpened: undefined }, pinned: true }, { hostId: "local", newTab: () => {} }).map((e) => (e as { label: string }).label)).toEqual(["Play in background"]);
  });
});
