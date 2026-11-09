// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ target: "A", menus: [] as any[], answer: null as ((value: string | null) => void) | null,
  enabled: true, control: { hiddenTarget: "reveal", viewport: { width: 1280, height: 720 }, idleDetachSeconds: 30 },
  apis: {} as Record<string, any>, frames: { pageDataUsage: vi.fn(), pageDataClear: vi.fn() },
  browser: { cursorColor: vi.fn(), resetOrigins: vi.fn(), externalPages: vi.fn(), sitePermissions: vi.fn() }, notice: vi.fn(), prompt: vi.fn(),
}));
vi.mock("../src/renderer/src/i18n", async () => {
  const { en } = await import("../src/renderer/src/lib/settingsRiskMessages");
  const t = (key: string, vars: Record<string, unknown> = {}) => ((en as Record<string, string>)[key] ?? key)
    .replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match));
  return { useI18n: () => ({ t, locale: "en" }), translate: t };
});
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  return { useApp: create(() => ({ hosts: null, daemon: { kind: "connected" }, byHost: {}, openSettings: vi.fn() })) };
});
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: (host: string) => fixture.apis[host], bridge: { browser: fixture.browser, frames: fixture.frames } }));
vi.mock("../src/renderer/src/lib/targetHost", async () => {
  const { useApp } = await import("../src/renderer/src/store");
  return { useTargetHostId: () => fixture.target, useTargetHostLabel: () => `Host ${fixture.target}`,
    useTargetFeatures: () => new Set(["agent-project-boundary", "agent-external-grants"]), useTargetSidebar: () => ({
      active: [{ cutexSessionId: "agent-a", displayName: "Agent A" }, { cutexSessionId: "agent-b", displayName: "Agent B" }], retired: [],
      hostRows: { "agent-a": { projectId: "one" }, "agent-b": { projectId: "two" } },
      projects: { projects: [{ project_id: "one", presentation: { display_name: "Project One" } }, { project_id: "two", presentation: { display_name: "Project Two" } }] },
    }), useTargetSelect: () => vi.fn(), useTargetApi: () => fixture.apis[fixture.target] };
});
vi.mock("../src/renderer/src/lib/hostScope", () => ({ hostData: (state: any) => ({ daemon: state.daemon }) }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostData: () => ({ daemon: { kind: "connected", baseUrl: "http://fixture", hostId: fixture.target } }), useHostScope: () => ({}) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({
  closeMenu: vi.fn(),
  openMenuFrom: (_element: unknown, menus: any[]) => { fixture.menus = menus; },
  promptDialog: (...args: unknown[]) => { fixture.prompt(...args); return new Promise<string | null>(resolve => { fixture.answer = resolve; }); },
}));
vi.mock("../src/renderer/src/components/SearchablePicker", async () => {
  const { createElement: e } = await import("react");
  return {
    SearchableSelect: ({ value, options, onChange }: any) => e("select", { value, onChange: (event: any) => onChange(event.target.value) },
      e("option", { value: "" }, "Pick"), ...options.map((option: any) => e("option", { key: option.value, value: option.value }, option.label))),
    SearchablePickerBody: () => null,
  };
});
vi.mock("../src/renderer/src/modules/Outlet", () => ({ SettingsSections: () => null }));
vi.mock("../src/renderer/src/components/settings/GlobalSettings", () => ({ MessageTemplatesSection: () => null }));
vi.mock("../src/renderer/src/components/settings/OwnerDevices", () => ({ accessRefusalText: vi.fn(), scopeOptions: [], useOwnerLocalLock: () => ({ locked: false }) }));
vi.mock("../src/renderer/src/components/Avatar", () => ({ Avatar: () => null }));
vi.mock("../src/renderer/src/components/ProjectBadge", () => ({ ProjectBadge: () => null }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ projectIcons: {} }) }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: { notice: fixture.notice } } }));
vi.mock("../src/renderer/src/modules/browser/controlSettings", () => ({ useBrowserControlSettings: () => [fixture.control, vi.fn()] }));
vi.mock("../src/renderer/src/modules/browser/tabs", () => ({ useBrowserEnabled: () => fixture.enabled }));
vi.mock("../src/renderer/src/modules/browser/BrowserHostSettings", () => ({ BrowserHostSettings: () => null }));
vi.mock("../src/renderer/src/modules/browser/BrowserClaimSettings", () => ({ BrowserClaimSettings: () => null }));
vi.mock("../src/renderer/src/components/SettingsHostFrame", () => ({ SettingsDevicePart: ({ children }: any) => children, SettingsHostPart: ({ children }: any) => children }));
vi.mock("../src/renderer/src/components/settings/Form", async () => {
  const { createElement: e } = await import("react");
  const Button = ({ children, onClick, disabled, title }: any) => e("button", { type: "button", onClick, disabled, title }, children);
  return {SettingsGroup: ({ children }: any) => children, SettingsEffectCard: ({ children }: any) => children,  Button, AddButton: Button, RefreshButton: ({ onClick, disabled }: any) => e(Button, { onClick, disabled }, "refresh"),
    ResetButton: ({ onClick, disabled, title }: any) => e(Button, { onClick, disabled }, title ?? "reset"),
    Section: ({ children, actions, title, id }: any) => e("section", { id, "aria-label": title }, actions, children),
    SettingRow: ({ children, label, reset }: any) => e("div", {}, e("span", {}, label), reset, children),
    Segmented: ({ options, onChange }: any) => e("div", {}, options.map((option: any) => e(Button, { key: option.value, onClick: () => onChange(option.value) }, option.label))),
    Select: ({ value, options, onChange, label }: any) => e("select", { value, "aria-label": label, onChange: (event: any) => onChange(event.target.value) }, options.map((option: any) => e("option", { key: option.value, value: option.value }, option.label))),
    TextInput: ({ value, onChange, onKeyDown, label }: any) => e("input", { value, "aria-label": label, onKeyDown, onChange: (event: any) => onChange(event.target.value) }),
    ArmedRemove: ({ onRemove, title, disabled }: any) => e(Button, { onClick: onRemove, disabled }, title),
    Notice: ({ children }: any) => e("p", {}, children), ErrorNote: ({ children }: any) => e("p", { role: "alert" }, children),
    EmptyState: ({ children }: any) => e("p", {}, children), ListRow: ({ title, actions }: any) => e("div", {}, title, actions),
    ListFilter: () => null, SubPageRow: ({ title, summary, onOpen }: any) => e("button", { type: "button", "data-settings-subpage": "", onClick: onOpen }, title, summary),
    Loading: () => null, LinkRow: () => null, TextLink: Button, NumberField: () => null, Toggle: () => null };
});

import { CollabExternalSubPage, CollabLinksSubPage, CollabPage } from "../src/renderer/src/components/settings/SecuritySettings";
import { CorsSection, RemoteAccessSection } from "../src/renderer/src/components/settings/RemoteAccess";
import { BrowserSettings } from "../src/renderer/src/modules/browser/BrowserSettings";
import { clearPageData } from "../src/renderer/src/modules/artifacts/pageData";
import { useApp } from "../src/renderer/src/store";

let element: HTMLDivElement, root: Root;
const security = (mode = "isolated") => ({ crossProjectAccess: mode, crossProjectAccessDefault: "isolated", links: [], externalAgents: [] });
function makeApi(mode = "isolated") {
  let current = { agentSecurity: security(mode), managementListen: ["127.0.0.1"], managementListenDefault: ["127.0.0.1"],
    managementListenEntries: [{ entry: "127.0.0.1", kind: "loopback", port: 24370 }], managementCorsOrigins: [], managementCorsOriginsDefault: [] };
  return { getSettings: vi.fn(async () => current), patchAgentSecurity: vi.fn(async (change: any) => (current = { ...current, agentSecurity: { ...current.agentSecurity, ...change } })),
    patchSettings: vi.fn(async (change: any) => (current = { ...current, ...change })), set: (change: any) => { current = { ...current, ...change }; } };
}
async function render(component: any) { await act(async () => { root.render(h(component)); }); }
function button(label: string) {
  const found = [...element.querySelectorAll("button")].find(item => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}: ${element.textContent}`);
  return found;
}
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function answer(value: string | null) { await act(async () => { fixture.answer?.(value); }); }
function roundTripEpoch() {
  const original = useApp.getState().hosts;
  act(() => {
    useApp.setState({ hosts: { ...original, hosts: original!.hosts.map(host => host.id === "A" ? { ...host, conn: { ...host.conn, epoch: "a-2" } } : host) } } as never);
    useApp.setState({ hosts: original });
  });
}
async function choose(select: HTMLSelectElement, value: string) { await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function input(label: string, value: string) {
  const target = element.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(target, value); target.dispatchEvent(new Event("input", { bubbles: true })); });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.clearAllMocks(); fixture.target = "A"; fixture.enabled = true; fixture.answer = null; fixture.menus = [];
  fixture.apis = { A: makeApi(), B: makeApi() };
  useApp.setState({ hosts: { active: "A", hosts: [{ id: "A", label: "Host A", conn: { epoch: "a-1" } }, { id: "B", label: "Host B", conn: { epoch: "b-1" } }] } } as never);
  fixture.browser.cursorColor.mockResolvedValue({ color: "#7966db" });
  fixture.browser.externalPages.mockResolvedValue({ stored: true }); fixture.browser.sitePermissions.mockResolvedValue([]); fixture.browser.resetOrigins.mockResolvedValue(undefined);
  fixture.frames.pageDataUsage.mockResolvedValue({ items: [{ hostId: "A", artifactId: "page-1", name: "Budget", bytes: 2048, updatedAt: "one" }] });
  fixture.frames.pageDataClear.mockResolvedValue(undefined);
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("settings risk interactions", () => {
  it("does not widen visibility on first click or cancel; requires exact typing", async () => {
    await render(CollabPage); await click("security.crossProject.host");
    expect(fixture.apis.A.patchAgentSecurity).not.toHaveBeenCalled();
    expect(fixture.prompt.mock.calls[0]![2].hint).toContain("Host A");
    await answer(null); expect(fixture.apis.A.patchAgentSecurity).not.toHaveBeenCalled();
    await click("security.crossProject.host"); await answer("Host A "); expect(fixture.apis.A.patchAgentSecurity).not.toHaveBeenCalled();
    await click("security.crossProject.host"); await answer("Host A");
    expect(fixture.apis.A.patchAgentSecurity).toHaveBeenCalledWith({ crossProjectAccess: "host" });
  });
  it("invalidates a typed approval on host switch and never writes the new host", async () => {
    await render(CollabPage); await click("security.crossProject.host"); fixture.target = "B"; await render(CollabPage); await answer("Host A");
    expect(fixture.apis.A.patchAgentSecurity).not.toHaveBeenCalled(); expect(fixture.apis.B.patchAgentSecurity).not.toHaveBeenCalled();
  });
  it("narrows visibility directly and refuses a stale backend value after confirmation", async () => {
    fixture.apis.A = makeApi("host"); await render(CollabPage); await click("security.crossProject.isolated");
    expect(fixture.prompt).not.toHaveBeenCalled(); expect(fixture.apis.A.patchAgentSecurity).toHaveBeenCalledWith({ crossProjectAccess: "isolated" });
    await click("security.crossProject.host"); fixture.apis.A.set({ agentSecurity: { ...security(), links: [["project:one", "project:two"]] } }); await answer("Host A");
    expect(fixture.apis.A.patchAgentSecurity).toHaveBeenCalledTimes(1);
  });
  it("requires inline confirmation for project links and invalidates it when an input changes", async () => {
    await render(CollabLinksSubPage); const selects = element.querySelectorAll("select");
    await choose(selects[0]!, "project:one"); await choose(selects[1]!, "project:two"); await click("security.links.add");
    expect(fixture.apis.A.patchAgentSecurity).not.toHaveBeenCalled(); expect(element.textContent).toContain("Project One");
    await choose(selects[1]!, "agent:missing"); expect(element.querySelector("[data-settings-risk-confirm]")).toBeNull();
    await choose(selects[1]!, "project:two"); await click("security.links.add"); await click("Cancel"); expect(fixture.apis.A.patchAgentSecurity).not.toHaveBeenCalled();
    await click("security.links.add"); await click("Confirm and save");
    expect(fixture.apis.A.patchAgentSecurity).toHaveBeenCalledWith({ links: [["project:one", "project:two"]] });
  });
  it("links on the page are an entry: count and first pairs, no editor; the sub-page has the add row above the list", async () => {
    const links = [["project:one", "project:two"], ["project:one", "agent:a"], ["project:two", "agent:b"], ["agent:a", "agent:b"]];
    fixture.apis.A.set({ agentSecurity: { ...security(), links } });
    await render(CollabPage);
    expect(element.textContent).toContain("security.links.count");
    expect(element.textContent).toContain("Project One ⇄ Project Two");
    expect(element.querySelectorAll("select")).toHaveLength(0);
    expect(element.textContent).not.toContain("security.links.add");
    expect(element.querySelector("[data-settings-subpage]")).not.toBeNull();
    await render(CollabLinksSubPage);
    const add = [...element.querySelectorAll("button")].find((b) => b.textContent === "security.links.add")!;
    const firstPair = [...element.querySelectorAll('[title="project:one"]')][0]!;
    expect(add.compareDocumentPosition(firstPair) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(element.querySelector('section[aria-label*="security.links.countMax"]')).not.toBeNull();
  });
  it("external agents on the page are an entry: count and first names, no add or remove there", async () => {
    fixture.apis.A.set({ agentSecurity: { ...security(), externalAgents: [{ project: "one", agent: "agent-b" }] } });
    await render(CollabPage);
    expect(element.textContent).toContain("security.external.total");
    expect(element.textContent).not.toContain("security.external.add");
    expect(element.textContent).not.toContain("security.external.remove");
    await render(CollabExternalSubPage);
    expect(element.textContent).toContain("security.external.add");
    expect(element.textContent).toContain("security.external.remove");
    expect(element.querySelector('section[aria-label*="security.external.totalMax"]')).not.toBeNull();
  });
  it("selecting an external agent only arms an explicit target confirmation", async () => {
    await render(CollabExternalSubPage); await click("security.external.add");
    await act(async () => { fixture.menus[0].flyout.props.onPick("agent-b"); });
    expect(fixture.apis.A.patchAgentSecurity).not.toHaveBeenCalled(); expect(element.querySelector("[data-settings-risk-confirm]")?.textContent).toContain("Agent B");
    await click("Confirm and save"); expect(fixture.apis.A.patchAgentSecurity).toHaveBeenCalledWith({ externalAgents: [{ project: "one", agent: "agent-b" }] });
  });
  it("requires typed scope confirmation for network listening and CORS additions", async () => {
    await render(RemoteAccessSection); await click("remote.addTailscale"); expect(fixture.apis.A.patchSettings).not.toHaveBeenCalled();
    expect(fixture.prompt.mock.calls[0]![2].hint).toContain("tailscale"); await answer(null); expect(fixture.apis.A.patchSettings).not.toHaveBeenCalled();
    await render(CorsSection); await input("remote.cors.add", "https://new.example"); await click("remote.cors.add"); expect(fixture.apis.A.patchSettings).not.toHaveBeenCalled();
    await answer("Host A"); expect(fixture.apis.A.patchSettings).toHaveBeenCalledWith({ managementCorsOrigins: ["https://new.example"] });
  });
  it("confirms a widening default reset and applies a narrowing default reset directly", async () => {
    fixture.apis.A.set({ managementCorsOrigins: ["https://old.example"], managementCorsOriginsDefault: ["https://new.example"] });
    await render(CorsSection); await click("remote.resetDefault");
    expect(fixture.apis.A.patchSettings).not.toHaveBeenCalled(); expect(fixture.prompt.mock.calls[0]![2].hint).toContain("https://new.example");
    await answer("Host A"); expect(fixture.apis.A.patchSettings).toHaveBeenCalledWith({ managementCorsOrigins: null });
    act(() => root.unmount()); root = createRoot(element); fixture.prompt.mockClear(); fixture.apis.A.patchSettings.mockClear();
    fixture.apis.A.set({ managementCorsOrigins: ["https://old.example", "https://new.example"] });
    await render(CorsSection); await click("remote.resetDefault");
    expect(fixture.prompt).not.toHaveBeenCalled(); expect(fixture.apis.A.patchSettings).toHaveBeenCalledWith({ managementCorsOrigins: null });
  });
  it("listening reset only prompts when defaults expand access, and loopback additions keep the normal save flow", async () => {
    fixture.apis.A.set({ managementListenDefault: ["127.0.0.1", "tailscale"] });
    await render(RemoteAccessSection); await click("remote.resetDefault");
    expect(fixture.apis.A.patchSettings).not.toHaveBeenCalled(); await answer(null);
    await click("remote.addAddress"); await input("remote.addAddress", "127.0.0.2"); await click("remote.add");
    expect(fixture.apis.A.patchSettings).toHaveBeenCalledWith({ managementListen: ["127.0.0.1", "127.0.0.2"] });
    expect(element.querySelector('input[aria-label="remote.addAddress"]')).toBeNull();
    act(() => root.unmount()); root = createRoot(element); fixture.prompt.mockClear(); fixture.apis.A.patchSettings.mockClear();
    fixture.apis.A.set({ managementListen: ["127.0.0.1", "tailscale"], managementListenDefault: ["127.0.0.1"] });
    await render(RemoteAccessSection); await click("remote.resetDefault");
    expect(fixture.prompt).not.toHaveBeenCalled(); expect(fixture.apis.A.patchSettings).toHaveBeenCalledWith({ managementListen: null });
  });
  it("does not commit an inline approval if inputs change during the preflight read", async () => {
    await render(CollabLinksSubPage); const selects = element.querySelectorAll("select");
    await choose(selects[0]!, "project:one"); await choose(selects[1]!, "project:two"); await click("security.links.add");
    let complete!: (value: unknown) => void;
    fixture.apis.A.getSettings.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await click("Confirm and save"); await choose(selects[1]!, "");
    await act(async () => { complete({ agentSecurity: security() }); });
    expect(fixture.apis.A.patchAgentSecurity).not.toHaveBeenCalled();
  });
  it("invalidates approvals across a connection epoch round trip even when React batches both changes", async () => {
    await render(CollabPage); await click("security.crossProject.host");
    const original = useApp.getState().hosts;
    act(() => {
      useApp.setState({ hosts: { ...original, hosts: original!.hosts.map(host => host.id === "A" ? { ...host, conn: { ...host.conn, epoch: "a-2" } } : host) } } as never);
      useApp.setState({ hosts: original });
    });
    await answer("Host A"); expect(fixture.apis.A.patchAgentSecurity).not.toHaveBeenCalled();
  });
  it("releases the security save lock after a pending preflight's batched epoch round trip", async () => {
    await render(CollabPage);
    let complete!: (value: unknown) => void;
    const current = await fixture.apis.A.getSettings();
    fixture.apis.A.getSettings.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await click("security.crossProject.host"); await answer("Host A");
    roundTripEpoch(); await act(async () => { complete(current); });
    expect(fixture.apis.A.patchAgentSecurity).not.toHaveBeenCalled();
    await click("security.crossProject.host"); await answer("Host A");
    expect(fixture.apis.A.patchAgentSecurity).toHaveBeenCalledWith({ crossProjectAccess: "host" });
  });
  it("releases the CORS save lock after a pending preflight's batched epoch round trip", async () => {
    await render(CorsSection); await input("remote.cors.add", "https://new.example");
    let complete!: (value: unknown) => void;
    const current = await fixture.apis.A.getSettings();
    fixture.apis.A.getSettings.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await click("remote.cors.add"); await answer("Host A"); roundTripEpoch();
    await act(async () => { complete(current); });
    expect(fixture.apis.A.patchSettings).not.toHaveBeenCalled(); expect(button("remote.cors.add").disabled).toBe(false);
    await click("remote.cors.add"); await answer("Host A");
    expect(fixture.apis.A.patchSettings).toHaveBeenCalledWith({ managementCorsOrigins: ["https://new.example"] });
  });
  it("releases the listen save lock after a pending preflight's batched epoch round trip", async () => {
    await render(RemoteAccessSection);
    let complete!: (value: unknown) => void;
    const current = await fixture.apis.A.getSettings();
    fixture.apis.A.getSettings.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await click("remote.addTailscale"); await answer("Host A"); roundTripEpoch();
    await act(async () => { complete(current); });
    expect(fixture.apis.A.patchSettings).not.toHaveBeenCalled(); expect(button("remote.addTailscale").disabled).toBe(false);
    await click("remote.addTailscale"); await answer("Host A");
    expect(fixture.apis.A.patchSettings).toHaveBeenCalledWith({ managementListen: ["127.0.0.1", "tailscale"] });
  });
  it("an old security request cannot unlock a newer host's pending request", async () => {
    await render(CollabPage);
    let completeOld!: (value: unknown) => void, completeNew!: (value: unknown) => void;
    const oldState = await fixture.apis.A.getSettings();
    fixture.apis.A.getSettings.mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }));
    await click("security.crossProject.host"); await answer("Host A");
    fixture.target = "B"; await render(CollabLinksSubPage);
    const selects = element.querySelectorAll("select");
    await choose(selects[0]!, "project:one"); await choose(selects[1]!, "project:two"); await click("security.links.add");
    const newState = await fixture.apis.B.getSettings();
    fixture.apis.B.getSettings.mockImplementationOnce(() => new Promise(resolve => { completeNew = resolve; }));
    await click("Confirm and save"); await act(async () => { completeOld(oldState); });
    expect(button("security.links.add").disabled).toBe(true);
    expect(fixture.apis.A.patchAgentSecurity).not.toHaveBeenCalled(); expect(fixture.apis.B.patchAgentSecurity).not.toHaveBeenCalled();
    await act(async () => { completeNew(newState); });
    expect(fixture.apis.B.patchAgentSecurity).toHaveBeenCalledWith({ links: [["project:one", "project:two"]] });
  });
  it("an old remote preflight cannot unlock a newer host's pending write", async () => {
    await render(CorsSection); await input("remote.cors.add", "https://new.example");
    let completeOld!: (value: unknown) => void, completeNew!: (value: unknown) => void;
    const oldState = await fixture.apis.A.getSettings();
    fixture.apis.A.getSettings.mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }));
    await click("remote.cors.add"); await answer("Host A");
    fixture.apis.B.set({ managementCorsOrigins: ["https://existing.example"] });
    fixture.target = "B"; await render(CorsSection);
    const newState = await fixture.apis.B.getSettings();
    fixture.apis.B.patchSettings.mockImplementationOnce(() => new Promise(resolve => { completeNew = resolve; }));
    await click("remote.remove"); await act(async () => { completeOld(oldState); });
    expect(button("remote.cors.add").disabled).toBe(true); expect(fixture.apis.A.patchSettings).not.toHaveBeenCalled();
    expect(fixture.apis.B.patchSettings).toHaveBeenCalledWith({ managementCorsOrigins: [] });
    await act(async () => { completeNew({ ...newState, managementCorsOrigins: [] }); });
    expect(button("remote.cors.add").disabled).toBe(false);
  });
  it("browser origin reset has no first-click request and can be cancelled or confirmed", async () => {
    await render(BrowserSettings); await click("browser.origins.reset"); expect(fixture.browser.resetOrigins).not.toHaveBeenCalled();
    await click("Cancel"); expect(fixture.browser.resetOrigins).not.toHaveBeenCalled();
    await click("browser.origins.reset"); await click("Confirm rebuild"); expect(fixture.browser.resetOrigins).toHaveBeenCalledTimes(1);
    expect(element.querySelector("#settings-site-permissions")).not.toBeNull(); expect(element.querySelector("#settings-site-origins")).not.toBeNull();
  });
  it("browser reset approval expires when its settings change", async () => {
    await render(BrowserSettings); await click("browser.origins.reset"); fixture.enabled = false; await render(BrowserSettings);
    expect(element.querySelector("[data-settings-risk-confirm]")).toBeNull(); expect(fixture.browser.resetOrigins).not.toHaveBeenCalled();
  });
  it("browser reset disarms on Escape and after the standard countdown without a request", async () => {
    await render(BrowserSettings); vi.useFakeTimers(); await click("browser.origins.reset");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(element.querySelector("[data-settings-risk-confirm]")).toBeNull(); expect(fixture.browser.resetOrigins).not.toHaveBeenCalled();
    await click("browser.origins.reset"); act(() => { vi.advanceTimersByTime(5001); });
    expect(element.querySelector("[data-settings-risk-confirm]")).toBeNull(); expect(fixture.browser.resetOrigins).not.toHaveBeenCalled();
    act(() => { vi.runOnlyPendingTimers(); });
  });
  it("CORS input changes invalidate the dialog and keep the edited draft", async () => {
    await render(CorsSection); await input("remote.cors.add", "https://old.example"); await click("remote.cors.add");
    await input("remote.cors.add", "https://new.example"); await answer("Host A");
    expect(fixture.apis.A.patchSettings).not.toHaveBeenCalled(); expect(element.querySelector<HTMLInputElement>("input")?.value).toBe("https://new.example");
    await click("remote.cors.add"); await answer("Host A"); expect(fixture.apis.A.patchSettings).toHaveBeenCalledWith({ managementCorsOrigins: ["https://new.example"] });
  });
  it("page clear names this desktop, page, host and size, and requires exact typing", async () => {
    const operation = clearPageData("A", { artifactId: "page-1", name: "Budget" }); await Promise.resolve();
    expect(fixture.frames.pageDataClear).not.toHaveBeenCalled();
    const hint = fixture.prompt.mock.calls[0]![2].hint;
    expect(hint).toContain("this desktop application"); expect(hint).toContain("Budget"); expect(hint).toContain("Host A"); expect(hint).toContain("2");
    fixture.answer?.("Budget"); await operation; expect(fixture.frames.pageDataClear).toHaveBeenCalledWith("A", "page-1");
  });
  it("page clear refuses cancellation and data changed while its dialog was open", async () => {
    let operation = clearPageData("A", { artifactId: "page-1", name: "Budget" }); await Promise.resolve(); fixture.answer?.(null); await operation;
    expect(fixture.frames.pageDataClear).not.toHaveBeenCalled();
    operation = clearPageData("A", { artifactId: "page-1", name: "Budget" }); await Promise.resolve();
    fixture.frames.pageDataUsage.mockResolvedValue({ items: [{ hostId: "A", artifactId: "page-1", name: "Budget", bytes: 4096, updatedAt: "two" }] });
    fixture.answer?.("Budget"); await operation; expect(fixture.frames.pageDataClear).not.toHaveBeenCalled();
  });
  it("page clear rejects a host selection round trip during the dialog", async () => {
    const operation = clearPageData("A", { artifactId: "page-1", name: "Budget" }); await Promise.resolve();
    const original = useApp.getState().hosts;
    useApp.setState({ hosts: { ...original, active: "B" } } as never); useApp.setState({ hosts: original });
    fixture.answer?.("Budget"); await operation; expect(fixture.frames.pageDataClear).not.toHaveBeenCalled();
  });
});
