// Contract 1.2 (docs/desktop-modules.md §16): status surfaces, effective placement, reveal and the
// closable status capsule. Scenario ids (S1–S7) follow docs/desktop-modules.md §16.8.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubServices } from "./serviceStub";
import type { AppModule, AppModuleHost, StatusItem, StatusPlace, StatusSurfaceItem } from "../src/renderer/src/modules/slots";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { MODULES } = await import("../src/renderer/src/modules/registry");
const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const S = await import("../src/renderer/src/lib/statusSurfaces");
const { overlayInsets, withReservation } = await import("../src/renderer/src/lib/overlayLayout");
const { capsuleViewMounted, registerCapsuleView, revealInCapsule } = await import("../src/renderer/src/modules/status-capsule/capsuleState");
const { getUiPrefs } = await import("../src/renderer/src/lib/prefs");
const { MOCK_BASE_FEATURES, MOCK_NEW_FEATURES } = await import("../src/renderer/src/dev/mockFeatures");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");

const ALL = [...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES, "management-client-tokens", "session-attachments", "fs-dir-browse"];
const PLACES: StatusPlace[] = ["bar", "capsule", "both", "off"];
const SRC = join(__dirname, "../src/renderer/src");

const surfaceItem = (surface: "bar" | "capsule", reveal?: StatusSurfaceItem["reveal"]): StatusSurfaceItem =>
  ({ id: `${surface === "bar" ? "shell" : "status-capsule"}.${surface}` as StatusSurfaceItem["id"], surface, intents: surface === "bar" ? ["view", "edit"] : ["view"], ...(reveal ? { reveal } : {}) });
type Providers = ReturnType<typeof S.surfaceProviders>;
const providers = (capsule: "on" | "disabled" | "failed" | "absent" | "not-ready", reveal?: StatusSurfaceItem["reveal"]): Providers => ({
  bar: { surface: "bar", available: true, moduleId: "shell", item: surfaceItem("bar") },
  capsule:
    capsule === "on"
      ? { surface: "capsule", available: true, moduleId: "status-capsule", item: surfaceItem("capsule", reveal ?? (() => "opened")) }
      : { surface: "capsule", available: false, moduleId: capsule === "absent" ? null : "status-capsule", reason: capsule },
});

const hosts: AppModuleHost[] = [];
const storage = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
async function appHost(modules: readonly AppModule[] = MODULES, saved = storage()) {
  const host = createModuleHost({
    modules, slots: SLOT_SPECS, host: { id: "local", kind: "local", features: new Set(ALL) }, storage: saved,
    services: () => stubServices(), log() {},
    validate: (candidates, existing) => S.checkStatusContributions(candidates, existing),
  });
  hosts.push(host);
  await host.idle();
  return host;
}
const providersOf = (host: AppModuleHost) => S.surfaceProviders(host.modules, host.statuses(), host.snapshot("conversation.statusSurface"));
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.dispose()));
});

describe("S1 resolver: saved choice × capsule state", () => {
  const both = ["bar", "capsule"] as const;
  it("matches the §16.3 table and never rewrites the saved choice", () => {
    const effective = (capsule: Parameters<typeof providers>[0]) =>
      Object.fromEntries(PLACES.map((p) => [p, S.resolvePlacement(p, both, providers(capsule)).effective.join("+") || "none"]));
    expect(effective("on")).toEqual({ bar: "bar", capsule: "capsule", both: "bar+capsule", off: "none" });
    for (const state of ["disabled", "failed", "absent", "not-ready"] as const) {
      expect(effective(state), state).toEqual({ bar: "bar", capsule: "none", both: "bar", off: "none" });
      for (const p of PLACES) {
        const r = S.resolvePlacement(p, both, providers(state));
        expect(r.requested).toBe(p);
        expect(r.unavailable).toEqual(p === "capsule" || p === "both" ? [{ surface: "capsule", reason: state }] : []);
      }
    }
  });

  it("an item that does not support a surface reports unsupported (not a provider error)", () => {
    expect(S.resolvePlacement("both", ["capsule"], providers("on"))).toEqual({ requested: "both", effective: ["capsule"], unavailable: [{ surface: "bar", reason: "unsupported" }] });
    expect(S.itemSurfaces({ Bar: undefined })).toEqual(["capsule"]);
    expect(S.itemSurfaces({ Bar: () => null })).toEqual(["bar", "capsule"]);
    expect(S.itemSurfaces({ Bar: () => null, supportedSurfaces: ["bar"] })).toEqual(["bar"]);
  });

  it("with the real registry: capsule on → disabled → removed → re-added; saved choices and status modules unchanged", async () => {
    const host = await appHost();
    const plan = host.snapshot("conversation.status").find((e) => e.item.id === "plan.status")!.item;
    host.setPlacement("conversation.status", plan, "both");
    const overrides = host.placements();
    expect(providersOf(host).capsule).toMatchObject({ available: true, moduleId: "status-capsule" });
    expect(providersOf(host).bar).toMatchObject({ available: true, moduleId: "shell" });

    await host.setEnabled("status-capsule", false);
    expect(providersOf(host).capsule).toEqual({ surface: "capsule", available: false, moduleId: "status-capsule", reason: "disabled" });
    expect(S.resolvePlacement(host.placement("conversation.status", plan) as StatusPlace, S.itemSurfaces(plan), providersOf(host)).effective).toEqual(["bar"]);
    expect(host.placements()).toBe(overrides);
    for (const id of ["goal", "plan", "background-terminals", "subagents", "delegations", "jobs"]) expect(host.statuses().get(id)!.state.kind, id).toBe("active");

    const capsuleModule = MODULES.find((m) => m.id === "status-capsule")!;
    await host.setEnabled("status-capsule", true);
    await host.removeModule("status-capsule");
    expect(providersOf(host).capsule).toEqual({ surface: "capsule", available: false, moduleId: null, reason: "absent" });
    await host.addModules([capsuleModule]);
    expect(providersOf(host).capsule).toMatchObject({ available: true, moduleId: "status-capsule" });
    expect(host.placement("conversation.status", plan)).toBe("both");
  });

  it("a provider whose module failed reports failed", async () => {
    const shell = MODULES.find((m) => m.id === "shell")!;
    const broken: AppModule = { id: "status-capsule", titleKey: "status-capsule.moduleTitle", contributes: { "conversation.statusSurface": [surfaceItem("capsule")] }, activate() { throw new Error("boom"); } };
    const host = await appHost([shell, broken]);
    expect(providersOf(host).capsule).toEqual({ surface: "capsule", available: false, moduleId: "status-capsule", reason: "failed" });
  });
});

describe("S2 registration checks", () => {
  const mod = (id: string, contributes: AppModule["contributes"]): AppModule => ({ id, titleKey: "shell.title", contributes });
  const status = (id: string, extra: Partial<StatusItem>): StatusItem => ({ id: id as StatusItem["id"], titleKey: "shell.title", defaultPlace: "capsule", useStatus: () => null, Body: () => null, ...extra });

  it("the built-in registry passes; bar = shell, capsule = status-capsule", () => {
    expect(S.checkStatusContributions(MODULES)).toEqual(new Map());
    const providers = S.surfaceProviders(MODULES, new Map(), []);
    expect([providers.bar.moduleId, providers.capsule.moduleId]).toEqual(["shell", "status-capsule"]);
  });

  it("rejects duplicate / unknown surfaces, bar without a Bar and an unsupported default place", () => {
    const first = mod("a", { "conversation.statusSurface": [{ id: "a.s", surface: "capsule", intents: ["view"] }] });
    const second = mod("b", { "conversation.statusSurface": [{ id: "b.s", surface: "capsule", intents: ["view"] }] });
    expect([...S.checkStatusContributions([first, second])]).toEqual([["b", 'status surface "capsule" already provided by a (b.s)']]);
    // Against already registered providers (even a disabled one keeps its id).
    expect(S.checkStatusContributions([second], [first]).get("b")).toMatch(/already provided by a/);
    expect(S.checkStatusContributions([mod("c", { "conversation.statusSurface": [{ id: "c.s", surface: "sidebar" as never, intents: ["view"] }] })]).get("c")).toMatch(/unknown status surface/);
    expect(S.checkStatusContributions([mod("d", { "conversation.status": [status("d.x", { supportedSurfaces: ["bar"] })] })]).get("d")).toMatch(/without a Bar/);
    expect(S.checkStatusContributions([mod("e", { "conversation.status": [status("e.x", { defaultPlace: "both" })] })]).get("e")).toMatch(/defaultPlace "both" is not supported/);
    expect(S.checkStatusContributions([mod("f", { "conversation.status": [status("f.x", { supportedSurfaces: ["capsule"], defaultPlace: "bar", Bar: () => null })] })]).get("f")).toMatch(/defaultPlace "bar"/);
    // "off" is always valid; a v1.1 item with a Bar may default to both.
    expect(S.checkStatusContributions([mod("g", { "conversation.status": [status("g.x", { defaultPlace: "off", supportedSurfaces: [] }), status("g.y", { defaultPlace: "both", Bar: () => null })] })])).toEqual(new Map());
  });

  it("the adapter: an initial duplicate fails alone (the first keeps the surface); addModules rejects the whole batch", async () => {
    const shell = MODULES.find((m) => m.id === "shell")!;
    const capsule = MODULES.find((m) => m.id === "status-capsule")!;
    const thief = mod("thief", { "conversation.statusSurface": [{ id: "thief.s", surface: "capsule", intents: ["view"] }] });
    const host = await appHost([shell, capsule, thief]);
    expect(host.statuses().get("thief")!.state).toMatchObject({ kind: "failed", error: expect.stringMatching(/already provided by status-capsule/) });
    expect(providersOf(host).capsule).toMatchObject({ available: true, moduleId: "status-capsule" });
    const ok = mod("innocent", {});
    const before = host.modules;
    await expect(host.addModules([ok, mod("thief2", { "conversation.statusSurface": [{ id: "thief2.s", surface: "bar", intents: ["view"] }] })])).rejects.toThrow(/thief2: status surface "bar" already provided by shell/);
    expect(host.modules).toBe(before);
    expect(host.statuses().has("innocent")).toBe(false);
  });
});

describe("S3 reveal: view / edit routing", () => {
  const scope = { hostId: "h", sessionId: "s" };
  const env = (place: StatusPlace, capsule: Parameters<typeof providers>[0], reveal?: StatusSurfaceItem["reveal"], supported: readonly ("bar" | "capsule")[] = ["bar", "capsule"]) => {
    const p = providers(capsule, reveal);
    return { current: () => ({ hostId: "h", sessionId: "s" }), providers: () => p, item: () => ({ supported, resolved: S.resolvePlacement(place, supported, p) }) };
  };
  const run = (place: StatusPlace, capsule: Parameters<typeof providers>[0], intent: "view" | "edit", withPanel = true, supported?: readonly ("bar" | "capsule")[]) => {
    const calls: string[] = [];
    const result = S.revealStatus(env(place, capsule, (t) => (calls.push(`capsule:${t.itemId}`), "opened"), supported), scope, "goal.status", intent, withPanel ? () => calls.push("bar") : undefined);
    return { result, calls };
  };

  it("view goes to the capsule only when it alone shows the item; both / bar / off use the bar panel", () => {
    expect(run("capsule", "on", "view")).toEqual({ result: { status: "opened", surface: "capsule" }, calls: ["capsule:goal.status"] });
    expect(run("both", "on", "view")).toEqual({ result: { status: "opened", surface: "bar" }, calls: ["bar"] });
    expect(run("bar", "on", "view")).toEqual({ result: { status: "opened", surface: "bar" }, calls: ["bar"] });
    expect(run("off", "on", "view")).toEqual({ result: { status: "opened", surface: "bar" }, calls: ["bar"] });
  });

  it("edit always goes to the bar (the capsule cannot edit), whatever the saved choice", () => {
    for (const place of PLACES) expect(run(place, "on", "edit"), place).toEqual({ result: { status: "opened", surface: "bar" }, calls: ["bar"] });
  });

  it("capsule off: capsule-only items fall back to the bar panel; without one the result says why", () => {
    expect(run("capsule", "disabled", "view")).toEqual({ result: { status: "opened", surface: "bar" }, calls: ["bar"] });
    expect(run("capsule", "disabled", "view", false)).toEqual({ result: { status: "unavailable", unavailable: [{ surface: "capsule", reason: "disabled" }] }, calls: [] });
    // An item without a bar part and no capsule: unavailable, never a silent success.
    expect(run("capsule", "disabled", "view", true, ["capsule"])).toEqual({ result: { status: "unavailable", unavailable: [{ surface: "capsule", reason: "disabled" }] }, calls: [] });
  });

  it("a capsule view that is not mounted is not-ready: the bar panel if there is one, else unavailable", () => {
    const notReady = (withPanel: boolean) => {
      const calls: string[] = [];
      const result = S.revealStatus(env("capsule", "on", () => "not-ready"), scope, "goal.status", "view", withPanel ? () => calls.push("bar") : undefined);
      return { result, calls };
    };
    expect(notReady(true)).toEqual({ result: { status: "opened", surface: "bar" }, calls: ["bar"] });
    expect(notReady(false)).toEqual({ result: { status: "unavailable", unavailable: [{ surface: "capsule", reason: "not-ready" }] }, calls: [] });
  });

  it("an item the agent does not show is unavailable", () => {
    const e = { ...env("bar", "on"), item: () => null };
    expect(S.revealStatus(e, scope, "goal.status", "view", () => {})).toEqual({ status: "unavailable", unavailable: [] });
  });

  it("legacy home / showInCapsule are derived from the effective placement", () => {
    expect(S.legacyHome(S.resolvePlacement("capsule", ["bar", "capsule"], providers("on")))).toBe("capsule");
    expect(S.legacyHome(S.resolvePlacement("capsule", ["bar", "capsule"], providers("disabled")))).toBe("bar");
  });
});

describe("S4 reveal: stale scope and provider restarts", () => {
  it("another host or agent than the caller rendered for → stale, nothing opens", () => {
    for (const current of [{ hostId: "h2", sessionId: "s" }, { hostId: "h", sessionId: "s2" }, { hostId: "h", sessionId: null }]) {
      const calls: string[] = [];
      const p = providers("on", () => (calls.push("capsule"), "opened"));
      const result = S.revealStatus({ current: () => current, providers: () => p, item: () => ({ supported: ["bar", "capsule"], resolved: S.resolvePlacement("capsule", ["bar", "capsule"], p) }) }, { hostId: "h", sessionId: "s" }, "x.status", "view", () => calls.push("bar"));
      expect(result).toEqual({ status: "stale" });
      expect(calls).toEqual([]);
    }
  });

  it("the capsule opens only a mounted view; an old view's release never drops a newer one", () => {
    expect(revealInCapsule({ sessionId: "agent-1", itemId: "plan.status" })).toBe("not-ready");
    const releaseOld = registerCapsuleView("agent-1");
    const releaseNew = registerCapsuleView("agent-1"); // remounted (e.g. the module restarted)
    releaseOld();
    expect(capsuleViewMounted("agent-1")).toBe(true);
    expect(revealInCapsule({ sessionId: "agent-1", itemId: "plan.status" })).toBe("opened");
    expect(getUiPrefs().capsuleOpen).toBe(true);
    expect(revealInCapsule({ sessionId: "agent-2", itemId: "plan.status" })).toBe("not-ready");
    releaseNew();
    releaseNew();
    expect(revealInCapsule({ sessionId: "agent-1", itemId: "plan.status" })).toBe("not-ready");
  });
});

describe("S5 plan checklist", () => {
  it("the timeline shows the full checklist when no surface shows 计划 (capsule-only with the capsule off)", () => {
    const supported = ["bar", "capsule"] as const;
    expect(S.shownSomewhere(S.resolvePlacement("capsule", supported, providers("on")))).toBe(true);
    expect(S.shownSomewhere(S.resolvePlacement("capsule", supported, providers("disabled")))).toBe(false);
    expect(S.shownSomewhere(S.resolvePlacement("both", supported, providers("disabled")))).toBe(true);
    expect(S.shownSomewhere(S.resolvePlacement("off", supported, providers("on")))).toBe(false);
    expect(S.shownSomewhere(null)).toBe(false); // the plan module itself off
    const card = readFileSync(join(SRC, "modules/plan/PlanCard.tsx"), "utf8");
    expect(card).toMatch(/if \(!shownSomewhere\(placement\)\) return <Checklist/);
  });
});

describe("S6 turning the capsule off releases it", () => {
  it("its overlay, surface and settings section leave the slots; prefs stay; turning it on restores the same items", async () => {
    const host = await appHost();
    const ids = (slot: "conversation.overlay" | "conversation.statusSurface" | "settings.section") => host.snapshot(slot).map((e) => e.item.id);
    expect(ids("conversation.overlay")).toContain("status-capsule.overlay");
    const otherOverlays = ids("conversation.overlay").filter(id => id !== "status-capsule.overlay");
    expect(ids("conversation.statusSurface")).toEqual(["shell.statusBar", "status-capsule.surface"]);
    const overlay = host.snapshot("conversation.overlay").find(e => e.item.id === "status-capsule.overlay")!.item;
    const ui = JSON.stringify(getUiPrefs());
    await host.setEnabled("status-capsule", false);
    expect(ids("conversation.overlay")).toEqual(otherOverlays);
    expect(ids("conversation.statusSurface")).toEqual(["shell.statusBar"]);
    expect(ids("settings.section")).not.toContain("status-capsule.settings");
    expect(JSON.stringify(getUiPrefs())).toBe(ui); // corner / edge / size / folds kept
    await host.setEnabled("status-capsule", true);
    expect(host.snapshot("conversation.overlay").find(e => e.item.id === "status-capsule.overlay")!.item).toBe(overlay);
  });

  it("an overlay's reservation goes when it reports null (unmount / render error)", () => {
    let m = withReservation(new Map(), "status-capsule.overlay", { anchor: "top", overColumn: true });
    expect(overlayInsets(m.values())).toEqual({ top: true, bottom: false, stickyTop: true });
    expect(withReservation(m, "status-capsule.overlay", { anchor: "top", overColumn: true })).toBe(m);
    m = withReservation(m, "status-capsule.overlay", { anchor: "bottom", overColumn: false });
    expect(overlayInsets(m.values())).toEqual({ top: false, bottom: false, stickyTop: false });
    m = withReservation(m, "status-capsule.overlay", null);
    expect(m.size).toBe(0);
    expect(overlayInsets(m.values())).toEqual({ top: false, bottom: false, stickyTop: false });
  });

  it("only the capsule (and the right-side status card, §18.9) call an item's useStatus (mounted-view polling stops with them); the conversation never names it", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
    const callers = files(SRC).filter((f) => /\.item\.useStatus\(|\bitem\.useStatus\(/.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f).replaceAll("\\", "/"));
    // lib/sideComponents.tsx: the status:<id> card body, mounted only while that card is shown.
    expect(callers).toEqual(["lib/sideComponents.tsx", "modules/status-capsule/StatusCapsule.tsx"]);
    const conversation = readFileSync(join(SRC, "components/Conversation.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(conversation).not.toMatch(/StatusCapsule|status-capsule|capsule/i);
    // No second path pokes the capsule DOM from shell code.
    for (const rel of ["lib/statusItemsView.ts", "lib/statusItems.ts", "components/StatusBar.tsx"]) {
      const code = readFileSync(join(SRC, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, rel).not.toMatch(/getElementById|capsuleOpen|capsuleFoldedItems|setUiPref/);
    }
  });
});

describe("S7 settings with the capsule off", () => {
  it("the placement page 状态显示 (`status`) stays, only the capsule's own section goes", async () => {
    const host = await appHost();
    await host.setEnabled("status-capsule", false);
    const page = host.snapshot("settings.page").find((e) => e.item.page === "status");
    expect(page?.item.id).toBe("shell.status");
    expect(page?.mode).toBe("show");
    expect(host.snapshot("settings.section").filter((e) => e.item.page === "status")).toEqual([]);
  });

  it("capsule / both cannot be picked as a new choice; a saved one stays readable with its reason", () => {
    const supported = ["bar", "capsule"] as const;
    expect(PLACES.map((p) => S.placeSelectable(p, supported, providers("disabled")))).toEqual([true, false, false, true]);
    expect(PLACES.map((p) => S.placeSelectable(p, supported, providers("on")))).toEqual([true, true, true, true]);
    // Settings do not depend on a mounted conversation: a not-mounted capsule is still selectable.
    expect(S.placeSelectable("capsule", supported, providers("on", () => "not-ready"))).toBe(true);
    expect(S.resolvePlacement("capsule", supported, providers("disabled")).unavailable).toEqual([{ surface: "capsule", reason: "disabled" }]);
  });

  it("every unavailable reason has its note in both locales", () => {
    for (const reason of ["unsupported", "absent", "disabled", "unavailable", "not-ready", "failed"]) {
      const key = `shell.statusPlace.unavailable.${reason}`;
      expect((zhCN as Record<string, string>)[key], key).toBeTruthy();
      expect((en as Record<string, string>)[key], key).toBeTruthy();
    }
  });
});
