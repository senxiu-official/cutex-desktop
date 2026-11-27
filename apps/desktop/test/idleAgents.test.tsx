// @vitest-environment jsdom
// 设置 → 归档 → 整理不常用的智能体 (owner 2026-11-26): active agents filtered by days unused / project / Profile / online;
// busy, open delegations, Directors, 副主管, cutex's allowedActions without archive and service owners are never archived;
// pinned / owner-paused start unticked; 归档所选 is an in-place second click; each agent is read again and archived with
// cutex/session/retire; failures stay listed and selected.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";

const fx = vi.hoisted(() => ({
  groups: [] as unknown[],
  active: [] as SessionResource[],
  records: {} as Record<string, unknown>,
  services: [] as { ownerCutexSessionId: string }[],
  paused: new Set<string>(),
  sessionAction: vi.fn(),
  api: { storageItems: vi.fn() },
}));
vi.mock("../src/renderer/src/lib/sidebarView", () => ({ useSidebarModel: () => ({ groups: fx.groups, chats: [], archived: [] }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "local", useTargetFeatures: () => new Set(["host-storage"]), useTargetSelect: () => async () => {} }));
vi.mock("../src/renderer/src/lib/hostLists", () => ({ hostApi: () => fx.api }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({ useHostRecords: () => fx.records }));
vi.mock("../src/renderer/src/lib/agentPause", () => ({ useAgentPauses: (select: (s: unknown) => unknown) => select({ byKey: {} }), agentPauseNow: (_h: string, id: string) => (fx.paused.has(id) ? { phase: "paused" } : null) }));
vi.mock("../src/renderer/src/lib/settingsFocus", () => ({ useScrollToSettingsAnchor: () => {} }));
vi.mock("../src/renderer/src/components/Avatar", () => ({ Avatar: () => null }));
vi.mock("../src/renderer/src/store", () => {
  const state = () => ({ hosts: { active: "local" }, services: fx.services, byHost: {}, sessionAction: fx.sessionAction, refreshHostSidebar: async () => {} });
  return { useApp: Object.assign((select: (s: unknown) => unknown) => select(state()), { getState: state }), sidebarOf: () => ({ active: fx.active }) };
});
vi.mock("../src/renderer/src/i18n", async () => {
  const { zhCN } = await import("../src/renderer/src/modules/archive/i18n");
  return { useI18n: () => ({ locale: "zh-CN", t: (key: string, vars: Record<string, unknown> = {}) => String((zhCN as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? "")) }) };
});
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Section: ({ title, children }: { title?: string; children: React.ReactNode }) => h("section", null, h("h2", null, title), children),
  EmptyState: ({ children }: { children: React.ReactNode }) => h("p", { "data-empty": "" }, children),
  SettingsGroup: ({ children }: { children: React.ReactNode }) => children,
  Button: (props: object) => h("button", { type: "button", ...props }),
  TextLink: ({ children, onClick }: { children: React.ReactNode; onClick(): void }) => h("button", { "data-link": "", onClick }, children),
  ListRow: ({ leading, title, detail, actions, below }: Record<string, React.ReactNode>) => h("div", { "data-row": "" }, leading, h("span", null, title), h("span", { "data-detail": "" }, detail), actions, below),
  TextInput: ({ value, onChange, label }: { value: string; onChange(v: string): void; label?: string }) => h("input", { "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }),
  Select: ({ value, options, onChange, label }: { value: string; options: { value: string; label: string }[]; onChange(v: string): void; label?: string }) =>
    h("select", { "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, options.map((o) => h("option", { key: o.value, value: o.value }, o.label))),
}));
vi.mock("../src/renderer/src/lib/armedConfirm", async () => {
  const { useState } = await import("react");
  return { ARMED_FORM_BUTTON: "armed", useArmed: () => useState(false) };
});

const { IdleAgents } = await import("../src/renderer/src/modules/archive/IdleAgents");
const { idleExclusion, matchesIdle, sortIdle, defaultPicks, parseDays, DEFAULT_IDLE_FILTER, NO_PROJECT } = await import("../src/renderer/src/modules/archive/idleFilter");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
const NOW = Date.now();
function session(id: string, daysAgo: number, over: Partial<SessionResource> = {}): SessionResource {
  const at = new Date(NOW - daysAgo * DAY).toISOString();
  return { cutexSessionId: id, revision: 2, lifecycle: "active", retiredAt: null, displayName: id, createdAt: new Date(NOW - 400 * DAY).toISOString(), activity: { lastConversationAt: at },
    runtime: { status: "offline", activeTurnId: null, runtimeGeneration: 1 }, avatar: null, allowedActions: ["archive", "send", "start"], archiveKind: "active", ...over } as unknown as SessionResource;
}
const row = (s: SessionResource, over: Record<string, unknown> = {}) => ({ id: s.cutexSessionId, name: s.cutexSessionId, status: "offline", isDirector: false, pinned: false, profile: "omega", color: null, session: s, ...over });
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

let unmount = () => {};
let node: HTMLDivElement;
beforeEach(() => {
  const old = session("old", 40), mid = session("mid", 20), fresh = session("fresh", 1), busy = session("busy", 30, { runtime: { status: "online", activeTurnId: "t1", runtimeGeneration: 1 } } as never);
  const dir = session("dir", 50), deputy = session("deputy", 50), locked = session("locked", 50, { allowedActions: ["send"] }), svc = session("svc", 50), asker = session("asker", 50);
  const pinned = session("pinned", 60), paused = session("paused", 60), other = session("other", 25);
  fx.active = [old, mid, fresh, busy, dir, deputy, locked, svc, asker, pinned, paused, other];
  fx.groups = [
    { kind: "project", id: "p1", name: "P1", online: [row(busy, { status: "running" })], offline: [row(old), row(mid), row(fresh), row(dir, { isDirector: true }), row(deputy, { isOperator: true }), row(locked), row(svc), row(asker), row(pinned, { pinned: true }), row(paused)] },
    { kind: "independent", id: "__independent__", online: [], offline: [row(other, { profile: "gamma" })] },
  ];
  fx.records = { d1: { askId: "d1", target: "asker", requester: { kind: "agent", cutexSessionId: "x" }, status: "running" } };
  fx.services = [{ ownerCutexSessionId: "svc" }];
  fx.paused = new Set(["paused"]);
  fx.sessionAction.mockReset().mockResolvedValue({});
  fx.api.storageItems.mockReset().mockResolvedValue({ store: "light-homes", nextCursor: null, items: [{ id: "h-old", cutexSessionId: "old", state: "active", bytes: 3 * 1024 ** 2, files: 1 }] });
});
afterEach(() => { unmount(); document.body.innerHTML = ""; });
async function mount() {
  node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(h(IdleAgents)));
  await flush();
  unmount = () => act(() => root.unmount());
}
const rows = () => [...node.querySelectorAll<HTMLElement>("[data-idle-row]")].map((e) => `${e.dataset.idleRow}${e.dataset.idleExcluded ? `:${e.dataset.idleExcluded}` : ""}`);
const button = (text: string) => [...node.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("idleFilter", () => {
  it("names the first reason an agent cannot be archived here", () => {
    const s = session("x", 30);
    const base = { session: s, busy: false, openDelegations: 0, isDirector: false, isDeputy: false, ownedServices: 0 };
    expect(idleExclusion(base)).toBeNull();
    expect(idleExclusion({ ...base, busy: true, isDirector: true })).toBe("busy");
    expect(idleExclusion({ ...base, openDelegations: 2 })).toBe("delegations");
    expect(idleExclusion({ ...base, isDirector: true })).toBe("director");
    expect(idleExclusion({ ...base, isDeputy: true })).toBe("deputy");
    expect(idleExclusion({ ...base, session: session("x", 30, { allowedActions: ["send"] }) })).toBe("notAllowed");
    // An older cutex without allowedActions: the menu's 归档 rule (allowed).
    expect(idleExclusion({ ...base, session: session("x", 30, { allowedActions: undefined }) })).toBeNull();
    expect(idleExclusion({ ...base, ownedServices: 1 })).toBe("services");
  });

  it("filters by days unused, project, Profile and online; unknown activity never counts as unused", () => {
    const facts = (id: string, days: number | null, over: object = {}) => ({ id, name: id, session: session(id, 1), project: { id: "p1", name: "P1" }, profile: "omega", online: false, lastActiveAt: days === null ? null : NOW - days * DAY, pinned: false, paused: false, exclusion: null, ...over });
    const f = { ...DEFAULT_IDLE_FILTER, days: 14 };
    expect(matchesIdle(facts("a", 14), f, NOW)).toBe(true);
    expect(matchesIdle(facts("a", 13), f, NOW)).toBe(false);
    expect(matchesIdle(facts("a", null), f, NOW)).toBe(false);
    expect(matchesIdle(facts("a", null), { ...f, days: 0 }, NOW)).toBe(true);
    expect(matchesIdle(facts("a", 30, { project: null }), { ...f, project: NO_PROJECT }, NOW)).toBe(true);
    expect(matchesIdle(facts("a", 30), { ...f, project: "p2" }, NOW)).toBe(false);
    expect(matchesIdle(facts("a", 30), { ...f, profile: "gamma" }, NOW)).toBe(false);
    expect(matchesIdle(facts("a", 30, { online: true }), { ...f, online: "offline" }, NOW)).toBe(false);
    const sorted = sortIdle([facts("b", 20), facts("x", 90, { exclusion: "busy" }), facts("a", 60), facts("p", 70, { pinned: true })], "zh-CN");
    expect(sorted.map((x) => x.id)).toEqual(["p", "a", "b", "x"]);
    expect(defaultPicks(sorted)).toEqual(["a", "b"]);
    expect([parseDays("45"), parseDays("0"), parseDays("abc"), parseDays("99999")]).toEqual([45, null, null, null]);
  });
});

describe("整理不常用的智能体 page", () => {
  it("lists agents unused for 14+ days with the reasons; 全选 ticks only the archivable, not pinned / paused ones", async () => {
    await mount();
    const shown = rows();
    expect(shown.filter((r) => !r.includes(":"))).toEqual(["paused", "pinned", "old", "other", "mid"]);
    expect(new Set(shown.filter((r) => r.includes(":")))).toEqual(new Set(["dir:director", "deputy:deputy", "locked:notAllowed", "svc:services", "asker:delegations", "busy:busy"]));
    expect(shown).not.toContain("fresh");
    expect(node.textContent).toContain("你暂停了它，默认不选");
    expect(node.textContent).toContain("3 MiB");
    await click(node.querySelector("[data-idle-batch] [role=checkbox]")!);
    expect(node.querySelector("[data-idle-count]")!.textContent).toContain("已选 3 个");
    // A project filter keeps the independent one out.
    await act(() => { const s = node.querySelector<HTMLSelectElement>('select[aria-label="项目"]')!; s.value = "p1"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(rows()).not.toContain("other");
  });

  it("archives the picked ones after a second click; a refusal stays listed and selected", async () => {
    fx.sessionAction.mockImplementation(async (id: string) => { if (id === "mid") throw new Error("revision_conflict"); return {}; });
    await mount();
    await click(node.querySelector("[data-idle-batch] [role=checkbox]")!);
    await click(button("归档所选"));
    expect(fx.sessionAction).not.toHaveBeenCalled();
    expect(node.textContent).toContain("归档后可以在「已归档的{}」里恢复。");
    await click(node.querySelector("[data-idle-archive-armed]")!);
    await flush();
    expect(fx.sessionAction.mock.calls.map((c) => [c[0], c[1], c[2], c[3]]).sort()).toEqual([
      ["mid", "cutex/session/retire", { reason: "desktop" }, "local"], ["old", "cutex/session/retire", { reason: "desktop" }, "local"], ["other", "cutex/session/retire", { reason: "desktop" }, "local"],
    ]);
    expect(node.querySelector("[data-idle-progress]")!.textContent).toContain("已归档 2 / 3 个");
    expect(node.querySelector("[data-idle-failures]")!.textContent).toContain("mid：revision_conflict");
    expect(node.querySelector("[data-idle-count]")!.textContent).toContain("已选 1 个");
  });

  it("reads the agent again before its call: one that started working meanwhile is not archived", async () => {
    await mount();
    await click(node.querySelector("[data-idle-batch] [role=checkbox]")!);
    fx.active = fx.active.map((s) => (s.cutexSessionId === "old" ? { ...s, runtime: { ...s.runtime, activeTurnId: "t9" } } as SessionResource : s));
    await click(button("归档所选"));
    await click(node.querySelector("[data-idle-archive-armed]")!);
    await flush();
    expect(fx.sessionAction.mock.calls.map((c) => c[0]).sort()).toEqual(["mid", "other"]);
    expect(node.querySelector("[data-idle-failures]")!.textContent).toContain("old：正在工作");
  });
});
