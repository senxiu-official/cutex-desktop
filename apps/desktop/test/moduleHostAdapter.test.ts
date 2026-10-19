// Integration checks against the actual pinned mainline settings registry.
// Existing moduleHost.test.ts and modules.test.ts remain unchanged.
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubServices } from "./serviceStub";
import type { AppModuleContext, AppModuleHost } from "../src/renderer/src/modules/slots";
import type { KeyValueStorage } from "../src/renderer/src/modules/types";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (message: string) => message }));

const { MODULES } = await import("../src/renderer/src/modules/registry");
const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { MOCK_BASE_FEATURES, MOCK_NEW_FEATURES } = await import("../src/renderer/src/dev/mockFeatures");
const { startAppModules } = await import("../src/renderer/src/modules/app");
const { useApp } = await import("../src/renderer/src/store");
const ALL_FEATURES = [...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES, "management-client-tokens", "session-attachments", "fs-dir-browse"];
const hosts: AppModuleHost[] = [];
function storage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}
async function fixture(saved = storage(), features: readonly string[] | null = ALL_FEATURES) {
  const host = createModuleHost({ modules: MODULES, slots: SLOT_SPECS, host: { id: "fixture-local", kind: "local", features: features === null ? null : new Set(features) },
    storage: saved, services: () => stubServices(), log() {} });
  hosts.push(host);
  await host.idle();
  return host;
}
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.dispose())); });

describe("mainline package adapter: actual settings modules", () => {
  it("keeps registry items/components and unchanged slot arrays stable through a local-to-SSH transition", async () => {
    const host = await fixture();
    const pages = host.snapshot("settings.page"), sections = host.snapshot("settings.section");
    const pageIds = pages.map(row => row.item.id), sectionIds = sections.map(row => row.item.id);
    const observations: { pages: string[]; sections: string[] }[] = [];
    const unsubscribe = host.subscribe(() => observations.push({
      pages: host.snapshot("settings.page").map(row => row.item.id),
      sections: host.snapshot("settings.section").map(row => row.item.id),
    }));
    await host.setHost({ id: "fixture-ssh", kind: "ssh", features: new Set(ALL_FEATURES) });
    unsubscribe();
    expect(host.snapshot("settings.page")).toBe(pages);
    expect(host.snapshot("settings.section")).toBe(sections);
    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) { expect(observation.pages).toEqual(pageIds); expect(observation.sections).toEqual(sectionIds); }
    for (const row of pages) {
      const original = MODULES.find(module => module.id === row.moduleId)!.contributes!["settings.page"]!.find(item => item.id === row.item.id)!;
      expect(row.item).toBe(original); expect(row.item.Page).toBe(original.Page);
    }
    for (const [id, status] of host.statuses()) expect([id, status.state.kind]).toEqual([id, MODULES.find((m) => m.id === id)?.defaultEnabled === false ? "disabled" : "active"]);
  });

  it("updates actual remote-access notices across loading/legacy/new capabilities without replacing their components", async () => {
    const host = await fixture(storage(), null);
    const allPages = host.snapshot("settings.page");
    const remote = MODULES.find(module => module.id === "remote-access")!;
    for (const id of ["remote-access.listen", "remote-access.pairing"]) {
      const row = host.snapshot("settings.section").find(entry => entry.item.id === id)!;
      expect(row).toMatchObject({ mode: "notice", waiting: true });
      expect(row.item).toBe(remote.contributes!["settings.section"]!.find(item => item.id === id));
    }
    expect(host.snapshot("settings.section").some(row => row.item.id === "remote-access.cors")).toBe(false);
    await host.setHost({ id: "fixture-ssh", kind: "ssh", features: new Set(MOCK_BASE_FEATURES) });
    expect(host.snapshot("settings.page")).toBe(allPages);
    expect(host.snapshot("settings.section").find(row => row.item.id === "remote-access.listen")).toMatchObject({ mode: "notice", waiting: false, missing: ["listen-settings"] });
    await host.setHost({ id: "fixture-ssh", kind: "ssh", features: new Set(ALL_FEATURES) });
    // Every page keeps its row; the capability-gated Claude 账户 joins as a section of Profile (claude-accounts), not a page.
    // One page joins: 后端更新 (backend-upgrade, 系统 group right before 更新与诊断 since 2026-10-15). 互联 (module peers, hidden
    // without peers-v2) is a section of 访问管理 since 2026-10-19; NCI 远程作业 (module nci) is off by default.
    const joined = host.snapshot("settings.page");
    expect(joined.filter(row => row.item.id !== "backend-upgrade.page")).toEqual(allPages);
    expect(joined.find(row => row.item.id === "backend-upgrade.page")).toMatchObject({ mode: "show", item: { page: "backend", group: "system" } });
    expect(host.snapshot("settings.section").find(row => row.item.id === "peers.access")).toMatchObject({ mode: "show", item: { page: "access" } });
    expect(host.snapshot("settings.section").find(row => row.item.id === "claude-accounts.accounts")).toMatchObject({ mode: "show", item: { page: "profiles" } });
    for (const item of remote.contributes!["settings.section"]!) {
      const row = host.snapshot("settings.section").find(entry => entry.item.id === item.id)!;
      expect(row.mode).toBe("show"); expect(row.item.Section).toBe(item.Section);
    }
  });

  it("persists toggles for real codex-config and archive modules, restores defaults, and keeps core settings locked", async () => {
    const saved = storage(); const host = await fixture(saved);
    const original = host.snapshot("settings.page");
    await host.setEnabled("codex-config", false); await host.setEnabled("archive", false);
    expect(host.snapshot("settings.page").some(row => ["codex-config", "archive"].includes(row.moduleId))).toBe(false);
    for (const id of ["shell", "conversation", "connection", "agent-config", "notifications"]) {
      await host.setEnabled(id, false);
      expect(host.isEnabled(id)).toBe(true); expect(host.statuses().get(id)?.state.kind).toBe("active");
    }
    expect(JSON.parse(saved.data.get("cutex-desktop.modules")!).enabled).toEqual({ "codex-config": false, archive: false });
    const restarted = await fixture(saved);
    expect(restarted.statuses().get("codex-config")?.state.kind).toBe("disabled");
    expect(restarted.statuses().get("archive")?.state.kind).toBe("disabled");
    await restarted.setEnabled("codex-config", true); await restarted.setEnabled("archive", true);
    expect(JSON.parse(saved.data.get("cutex-desktop.modules")!).enabled).toEqual({});
    expect(restarted.snapshot("settings.page").map(row => row.item.id)).toEqual(original.map(row => row.item.id));
    for (const row of restarted.snapshot("settings.page")) expect(row.item).toBe(original.find(item => item.item.id === row.item.id)!.item);
  });

  it("preserves stable Map and object-pref snapshots required by existing React hooks", async () => {
    const host = await fixture();
    const statuses = host.statuses(); const pages = host.snapshot("settings.page");
    expect(host.statuses()).toBe(statuses);
    const prefs = host.prefs("archive"); expect(host.prefs("archive")).toBe(prefs);
    const fallback = { nested: [1] };
    expect(prefs.get("missing", fallback)).toBe(fallback);
    prefs.set("filter", { nested: [2] });
    const value = prefs.get("filter", fallback);
    expect(prefs.get("filter", fallback)).toBe(value);
    const listener = vi.fn(); const unsubscribe = prefs.subscribe(listener);
    prefs.set("filter", { nested: [3] });
    expect(listener).toHaveBeenCalledOnce(); expect(prefs.get("filter", fallback)).not.toBe(value);
    expect(host.snapshot("settings.page")).toBe(pages); expect(host.statuses()).toBe(statuses);
    unsubscribe();
  });

  it("fences every current UI service immediately on host changes and on disposal", async () => {
    const captured: AppModuleContext[] = [];
    const original = useApp.getState();
    const effects = { notify: vi.fn(), openSettings: vi.fn(), openPage: vi.fn(), closePage: vi.fn() };
    useApp.setState({ ...effects, featuresKnown: true, features: new Set(ALL_FEATURES) });
    const host = startAppModules([...MODULES, { id: "scope-probe", titleKey: "shell.title", activate(ctx) { captured.push(ctx); } }]);
    hosts.push(host);
    const invoke = (ctx: AppModuleContext) => {
      ctx.services.ui.notice("scope", "info"); ctx.services.ui.openSettings("general");
      ctx.services.ui.openPage("projects.page", { project: "original" }); ctx.services.ui.closePage();
    };
    const called = (count: number) => { for (const effect of Object.values(effects)) expect(effect).toHaveBeenCalledTimes(count); };
    try {
      await host.idle(); const old = captured[0]!;
      invoke(old); called(1);
      useApp.setState({ features: new Set([...ALL_FEATURES, "fixture-generation-change"]) });
      // The switch invalidates old services synchronously, before the next lifecycle pass.
      expect(old.signal.aborted).toBe(true); invoke(old); called(1);
      await host.idle(); expect(captured).toHaveLength(2);
      const current = captured[1]!; invoke(current); called(2);
      const disposal = host.dispose(); invoke(current); called(2); await disposal;
      expect(() => useApp.setState({ features: new Set([...ALL_FEATURES, "after-dispose"]) })).not.toThrow();
      // A disposed singleton may be replaced; its store subscription must stay revoked.
      const replacement = startAppModules([]); hosts.push(replacement); await replacement.idle();
      expect(replacement).not.toBe(host);
    } finally {
      useApp.setState({ notify: original.notify, openSettings: original.openSettings, openPage: original.openPage,
        closePage: original.closePage, features: original.features, featuresKnown: original.featuresKnown });
    }
  });
});

describe("mainline package adapter: actual status modules", () => {
  it("retains all seven status definitions and component references across placement and host changes", async () => {
    const host = await fixture();
    const before = host.snapshot("conversation.status");
    expect(before.map(row => row.moduleId)).toEqual(["goal", "plan", "background-terminals", "subagents", "delegations", "jobs", "alarms"]);
    const plan = before.find(row => row.moduleId === "plan")!.item;
    host.setPlacement("conversation.status", plan, "both");
    expect(host.placement("conversation.status", plan)).toBe("both");
    expect(host.snapshot("conversation.status")).toBe(before);
    await host.setHost({ id: "status-ssh", kind: "ssh", features: new Set(ALL_FEATURES) });
    expect(host.snapshot("conversation.status")).toBe(before);
    for (const row of before) {
      const original = MODULES.find(module => module.id === row.moduleId)!.contributes!["conversation.status"]![0]!;
      expect(row.item).toBe(original);
      expect(row.item.Body).toBe(original.Body);
      expect(row.item.useStatus).toBe(original.useStatus);
    }
  });

  it("keeps default removal durable across module toggles and restart, with stable placement snapshots", async () => {
    const saved = storage();
    const host = await fixture(saved);
    const goal = host.snapshot("conversation.status").find(row => row.moduleId === "goal")!.item;
    expect(host.placements()).toBe(host.placements());
    host.setPlacement("conversation.status", goal, "off");
    const changed = host.placements();
    await host.setEnabled("goal", false);
    expect(host.placements()).toBe(changed);
    host.setPlacement("conversation.status", goal, goal.defaultPlace);
    await host.setEnabled("goal", true);
    expect(host.placements()).toEqual({});
    expect(JSON.parse(saved.data.get("cutex-desktop.modules")!).place).toEqual({});
    const restarted = await fixture(saved);
    expect(restarted.placement("conversation.status", goal)).toBe(goal.defaultPlace);
  });
});


describe("current page/navigation contract", () => {
  it("keeps baseline page and navigation contributions through host changes, and removes only disabled owners", async () => {
    const host = await fixture();
    const pages = host.snapshot("main.page"), nav = host.snapshot("nav.primary");
    expect(pages.map(entry => entry.item.id)).toContain("shell.settings");
    expect(pages.map(entry => entry.item.id)).toContain("projects.page");
    await host.setHost({ id: "page-ssh", kind: "ssh", features: new Set(ALL_FEATURES) });
    expect(host.snapshot("main.page")).toBe(pages);
    expect(host.snapshot("nav.primary")).toBe(nav);
    await host.setEnabled("projects", false);
    expect(host.snapshot("main.page")).toEqual(pages.filter(entry => entry.moduleId !== "projects"));
    expect(host.snapshot("nav.primary")).toEqual(nav.filter(entry => entry.moduleId !== "projects"));
    await host.setEnabled("projects", true);
    expect(host.snapshot("main.page").map(entry => entry.item)).toEqual(pages.map(entry => entry.item));
  });
});

describe("renderer facade dynamic registration", () => {
  it("publishes a live registry and Map status removal without replacing unrelated pages", async () => {
    const host = await fixture(), oldModules = host.modules, page = host.snapshot("main.page").find(row => row.item.id === "projects.page")!;
    const renders = vi.fn(), capture: AppModuleContext[] = [];
    const definition = { id: "registration-probe", titleKey: "shell.title" as const,
      contributes: { "main.page": [{ id: "registration-probe.page" as const, Page: () => null, useTitle: () => [] }] },
      activate(ctx: AppModuleContext) { capture.push(ctx); } };
    const off = host.subscribe(renders);
    await host.addModules([definition]);
    expect(host.modules).not.toBe(oldModules); expect(host.modules.at(-1)).toBe(definition);
    expect(host.statuses().get("registration-probe")?.state.kind).toBe("active");
    expect(host.snapshot("main.page").find(row => row.item.id === "projects.page")).toBe(page);
    capture[0]!.prefs.set("mode", "compact");
    await host.removeModule("registration-probe");
    expect(host.modules.map(module => module.id)).toEqual(oldModules.map(module => module.id));
    expect(host.statuses().has("registration-probe")).toBe(false);
    expect(host.snapshot("main.page").some(row => row.item.id === "registration-probe.page")).toBe(false);
    await host.addModules([definition]);
    expect(capture[1]!.generation).toBe(capture[0]!.generation + 1);
    expect(capture[1]!.prefs.get("mode", "")).toBe("compact");
    expect(renders).toHaveBeenCalled(); off();
  });
});
