// @vitest-environment jsdom
// 浏览器身份 per host (owner 2026-11-28): 清除浏览数据… chooses 所有主机 or one host and sends that host; each configured
// host's storage row offers 退出登录 there (the confirm names the host); a removed host's leftover row reads
// 「已移除的主机」 (its id in the tooltip) with its size and offers 清除; the page says what 跨主机同步 carries.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIdentityBridge, BrowserIdentityStorage, BrowserIdentityView } from "../src/shared/browserIdentity";

const ids = vi.hoisted(() => ({ bridge: {} as Record<string, unknown> }));
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {}, browser: { identities: ids.bridge } }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/lib/stopIdle", () => ({ hostLabel: (id: string) => ({ local: "SAMPLEHOSTA", "ssh-samplehostb": "samplehostb" } as Record<string, string>)[id] ?? id }));
vi.mock("../src/renderer/src/modules/browser/BrowserSettings", () => ({ BrowserSitePermissionSettings: () => null }));
vi.mock("../src/renderer/src/modules/browser/identityMenus", () => ({ openIdentityHistory: () => {}, openIdentityPage: () => {}, openIdentityPasswords: () => {} }));

import { I18nProvider } from "../src/renderer/src/i18n";
import { useBrowserIdentities, useIdentityPage } from "../src/renderer/src/modules/browser/identities";
import { BrowserIdentitySubPage } from "../src/renderer/src/modules/browser/IdentitySettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "1a2b3c4d";
const MB = 1024 * 1024;
const view: BrowserIdentityView = { id: ID, name: "工作", color: "teal", initial: "工", isDefault: false, createdAt: 0, updatedAt: 0, revision: 1, hosts: ["local", "ssh-samplehostb"], openTabs: 2 };
const STORAGE: BrowserIdentityStorage[] = [
  { hostId: "local", siteDataBytes: 13 * MB, cacheBytes: 173 * MB },
  { hostId: "ssh-samplehostb", siteDataBytes: 4 * MB, cacheBytes: 38 * MB },
  { hostId: "ssh-b79c33a8", siteDataBytes: 21 * MB, cacheBytes: null, removedHost: true },
];
const SITES: Record<string, string[]> = { local: [".outlook.office.com"], "ssh-samplehostb": [".github.com"], "ssh-b79c33a8": [] };

let root: Root | null = null, container: HTMLDivElement;
const fake = {
  storage: vi.fn(async () => structuredClone(STORAGE)),
  signedInSites: vi.fn(async (_id: string, hostId: string) => SITES[hostId] ?? []),
  passwords: vi.fn(async () => []),
  clearData: vi.fn(async (_request: Parameters<BrowserIdentityBridge["clearData"]>[0]) => {}),
  signOut: vi.fn(async () => {}),
  signOutHost: vi.fn(async () => {}),
  clearLeftover: vi.fn(async () => {}),
} satisfies Partial<BrowserIdentityBridge>;

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const buttonIn = (sel: string, text: string) => [...document.querySelectorAll<HTMLButtonElement>(`${sel} button`)].find((b) => b.textContent === text) ?? null;

beforeEach(async () => {
  localStorage.setItem("cutex-desktop.locale", "zh-CN");
  Object.assign(ids.bridge, fake);
  for (const f of Object.values(fake)) f.mockClear();
  useBrowserIdentities.setState({ supported: true, state: { identities: [view], current: ID } });
  useIdentityPage.setState({ id: ID });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(h(I18nProvider, null, h(BrowserIdentitySubPage))); });
  await settle();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("浏览器身份 per host", () => {
  it("lists each configured host with 退出登录 and a removed host's leftover as 「已移除的主机」 with 清除", () => {
    expect($("[data-identity-storage=local]")?.textContent).toContain("SAMPLEHOSTA");
    expect(buttonIn("[data-identity-storage=local]", "退出登录…")).not.toBeNull();
    expect(buttonIn("[data-identity-storage=ssh-samplehostb]", "退出登录…")).not.toBeNull();
    const leftover = $("[data-identity-storage=ssh-b79c33a8]")!;
    expect(leftover.hasAttribute("data-removed-host")).toBe(true);
    expect(leftover.textContent).toContain("已移除的主机");
    expect(leftover.textContent).toContain("留下的数据 21.0 MB");
    expect(leftover.textContent).not.toContain("量不出来");
    expect(leftover.querySelector("[title]")?.getAttribute("title")).toBe("主机 ssh-b79c33a8，已经不在主机列表里");
    expect(buttonIn("[data-identity-storage=ssh-b79c33a8]", "退出登录…")).toBeNull();
    expect(buttonIn("[data-identity-storage=ssh-b79c33a8]", "清除…")).not.toBeNull();
    expect($("[data-identity-sync-note]")?.textContent).toBe("跨主机同步只带身份的名字和颜色；这个身份的登录、网站数据、密码和历史都留在这台电脑上，按主机分开");
  });

  it("退出登录 on one host names the host and signs out there only", async () => {
    await click(buttonIn("[data-identity-storage=ssh-samplehostb]", "退出登录…"));
    expect($("[data-identity-confirm-text]")?.textContent).toBe("退出「工作」在 samplehostb 上的登录？会关掉它在 samplehostb 上的标签，清掉它在 samplehostb 上的 Cookie、网站数据和缓存。其他主机上的登录和这个身份的网站权限都留着。");
    expect($("[role=dialog] h2")?.textContent).toBe("退出登录 · 工作 · samplehostb");
    await click($("[data-identity-confirm=signOutHost]"));
    expect(fake.signOutHost).toHaveBeenCalledWith(ID, "ssh-samplehostb");
    expect(fake.signOut).not.toHaveBeenCalled();
    expect($("[role=dialog]")).toBeNull();
  });

  it("清除 on a removed host's row clears that leftover", async () => {
    await click(buttonIn("[data-identity-storage=ssh-b79c33a8]", "清除…"));
    expect($("[data-identity-confirm-text]")?.textContent).toContain("已移除的主机 ssh-b79c33a8");
    await click($("[data-identity-confirm=clearLeftover]"));
    expect(fake.clearLeftover).toHaveBeenCalledWith(ID, "ssh-b79c33a8");
  });

  it("清除浏览数据… defaults to 所有主机, offers only configured hosts, and sends the chosen host", async () => {
    await click(buttonIn("[data-identity-page]", "清除浏览数据…"));
    const choices = [...document.querySelectorAll("[data-identity-clear-host]")].map((b) => b.textContent);
    expect(choices).toEqual(["所有主机", "SAMPLEHOSTA", "samplehostb"]);
    expect($("[data-identity-clear-host=all]")?.getAttribute("aria-checked")).toBe("true");
    await click($("[data-identity-clear-do]"));
    expect(fake.clearData).toHaveBeenLastCalledWith(expect.objectContaining({ identityId: ID, hostId: "all" }));

    await click(buttonIn("[data-identity-page]", "清除浏览数据…"));
    await click($("[data-identity-clear-host=ssh-samplehostb]"));
    expect($("[data-identity-clear-scope-host]")?.textContent).toBe("只清 samplehostb 上的数据，其他主机不受影响");
    // 只清这些网站… lists that host's sites only; one picked → its origin goes with the chosen host.
    await click($("[data-identity-clear-dialog] [role=checkbox][aria-label='只清这些网站…']"));
    expect($("[data-identity-clear-dialog]")?.textContent).toContain("github.com");
    expect($("[data-identity-clear-dialog]")?.textContent).not.toContain("outlook.office.com");
    await click($("[data-identity-clear-dialog] [role=checkbox][aria-label='.github.com']"));
    await click($("[data-identity-clear-do]"));
    expect(fake.clearData).toHaveBeenLastCalledWith(expect.objectContaining({ identityId: ID, hostId: "ssh-samplehostb", origins: ["https://github.com"] }));

    await click(buttonIn("[data-identity-page]", "清除浏览数据…"));
    await click($("[data-identity-clear-host=ssh-samplehostb]"));
    await click($("[data-identity-clear-do]"));
    expect(fake.clearData).toHaveBeenLastCalledWith(expect.objectContaining({ identityId: ID, hostId: "ssh-samplehostb", types: ["siteData", "cache"] }));
    expect(fake.clearData.mock.lastCall?.[0]).not.toHaveProperty("origins");
  });
});
