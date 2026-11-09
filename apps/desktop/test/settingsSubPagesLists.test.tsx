// @vitest-environment jsdom
// Lists with first rows on the page and 全部 on a sub-page: the page shows only the first rows, the sub-page all.
import { act, createElement as h, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ audit: [] as unknown[], next: null as number | null, open: vi.fn(), sites: [] as { pool: string; origin: string; permission: string; allow: boolean }[], forget: [] as unknown[] }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { browser: { sitePermissions: async (forget?: unknown) => { if (forget) fx.forget.push(forget); return fx.sites; } } } }));
vi.mock("../src/renderer/src/modules/browser/BrowserCursorSettings", () => ({ BrowserCursorSettings: () => null }));
vi.mock("../src/renderer/src/modules/browser/BrowserHostSettings", () => ({ BrowserHostSettings: () => null }));
vi.mock("../src/renderer/src/modules/browser/BrowserClaimSettings", () => ({ BrowserClaimSettings: () => null }));
vi.mock("../src/renderer/src/modules/browser/BrowserDesktopLoopbackSettings", () => ({ BrowserDesktopLoopbackSettings: () => null }));
vi.mock("../src/renderer/src/modules/browser/controlSettings", () => ({ useBrowserControlSettings: () => [{}, vi.fn()] }));
vi.mock("../src/renderer/src/modules/browser/tabs", () => ({ useBrowserEnabled: () => true }));
vi.mock("../src/renderer/src/components/SettingsHostFrame", () => ({ SettingsDevicePart: ({ children }: any) => children, SettingsHostPart: ({ children }: any) => children }));
vi.mock("../src/renderer/src/components/settings/SettingsRiskConfirmation", () => ({ SettingsRiskConfirmation: () => null }));
vi.mock("../src/renderer/src/lib/useSettingsRisk", () => ({ useSettingsRisk: () => ({ capture: () => () => true, invalidate: () => {} }) }));
vi.mock("../src/renderer/src/lib/settingsFocus", () => ({ useScrollToSettingsAnchor: () => {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => vars?.n !== undefined ? `${key}:${vars.n}` : key }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ openSettings: fx.open }) } }));
vi.mock("../src/renderer/src/lib/targetHost", () => {
  const api = { approvalRules: async () => ({ revision: 1, rules: [] }), approvalRuleAudit: async () => ({ audit: fx.audit, nextCursor: fx.next }) };
  return { useTargetApi: () => api, useTargetSidebar: () => null };
});
vi.mock("../src/renderer/src/components/settings/Form", async () => {
  const { createElement: e } = await import("react");
  return {
    Section: ({ title, actions, children }: any) => e("section", { "aria-label": title }, actions, children), SettingsGroup: ({ children }: any) => children, ErrorNote: ({ children }: any) => e("p", {}, children),
    ListFilter: ({ count, value, onChange }: any) => count > 8 ? e("input", { "aria-label": "filter", value, onChange: (ev: any) => onChange(ev.target.value) }) : null,
    SubPageRow: ({ title, onOpen }: any) => e("button", { type: "button", "data-settings-subpage": "", onClick: onOpen }, title),
  };
});
vi.mock("../src/renderer/src/components/Button", () => ({ Button: () => null }));
vi.mock("../src/renderer/src/components/TypedRuleConfirmation", () => ({ TypedRuleConfirmation: () => null }));

import { ApprovalRuleAuditAll, ApprovalRulesSettings } from "../src/renderer/src/modules/approvals/ApprovalRules";
import { BrowserSitePermissionSettings, BrowserSitesSubPage } from "../src/renderer/src/modules/browser/BrowserSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, box: HTMLDivElement;
beforeEach(() => { fx.next = null; fx.open.mockReset(); box = document.createElement("div"); document.body.append(box); root = createRoot(box); });
afterEach(() => { act(() => root.unmount()); box.remove(); });
const draw = async (Page: ComponentType) => { await act(async () => root.render(h(Page))); };
const entry = () => box.querySelector<HTMLButtonElement>("[data-settings-subpage]");
const audit = (n: number) => Array.from({ length: n }, (_, i) => ({ auditId: `a${i}`, at: "2026-11-08T00:00:00Z", action: "matched", result: `result-${i}`, ruleId: `rule-${i}`, details: {} }));

describe("规则审计", () => {
  it("the page shows the newest five and leads to all of them", async () => {
    fx.audit = audit(7);
    await draw(ApprovalRulesSettings);
    expect(box.querySelectorAll("li")).toHaveLength(5);
    expect(box.textContent).toContain("result-4");
    expect(box.textContent).not.toContain("result-5");
    expect(entry()!.textContent).toBe("approvals.rules.audit.all:7");
    act(() => entry()!.click());
    expect(fx.open).toHaveBeenCalledWith("collab", { sub: "audit" });
  });
  it("no entry when all of them fit", async () => {
    fx.audit = audit(5);
    await draw(ApprovalRulesSettings);
    expect(box.querySelectorAll("li")).toHaveLength(5);
    expect(entry()).toBeNull();
  });
  it("says latest when the host has more than one read returns", async () => {
    fx.audit = audit(100); fx.next = 100;
    await draw(ApprovalRulesSettings);
    expect(entry()!.textContent).toBe("approvals.rules.audit.latest:100");
  });
  it("the sub-page shows every row and filters them", async () => {
    fx.audit = audit(12);
    await draw(ApprovalRuleAuditAll);
    expect(box.querySelectorAll("li")).toHaveLength(12);
    const input = box.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "rule-11");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(box.querySelectorAll("li")).toHaveLength(1);
  });
});

describe("网站权限", () => {
  const sites = (n: number) => Array.from({ length: n }, (_, i) => ({ pool: "owner", origin: `https://s${i}.example`, permission: "camera", allow: true }));
  const origins = () => [...box.querySelectorAll("[data-browser-site-permissions] .font-medium")].map((e) => e.textContent);
  const OnPage = () => h(BrowserSitePermissionSettings);
  it("the page shows the first five with their actions and leads to all of them", async () => {
    fx.sites = sites(7); fx.forget = [];
    await draw(OnPage);
    expect(origins()).toHaveLength(5);
    expect(entry()!.textContent).toBe("browser.sitePermissions.all:7");
    act(() => entry()!.click());
    expect(fx.open).toHaveBeenCalledWith("browser", { sub: "sites" });
    const forget = [...box.querySelectorAll("button")].find((b) => b.textContent === "browser.sitePermissions.forget")!;
    await act(async () => forget.click());
    expect(fx.forget).toEqual([{ pool: "owner", origin: "https://s0.example" }]);
    expect(box.querySelector("[data-browser-site-permissions-forget-all]")).not.toBeNull();
  });
  it("no entry when all of them fit", async () => {
    fx.sites = sites(5);
    await draw(OnPage);
    expect(origins()).toHaveLength(5);
    expect(entry()).toBeNull();
  });
  it("the sub-page lists every site, and forgetting all stays there", async () => {
    fx.sites = sites(12);
    await draw(BrowserSitesSubPage);
    expect(origins()).toHaveLength(12);
    expect(entry()).toBeNull();
    expect(box.querySelector("[data-browser-site-permissions-forget-all]")).not.toBeNull();
  });
});
