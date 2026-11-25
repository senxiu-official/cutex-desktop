// @vitest-environment jsdom
// Claude r56 (owner accepted 2026-11-23): during a running turn a model change applies on the next request, the effort
// only from the next turn. Where a running Claude agent's effort can be changed, 「强度下一轮生效」 says so.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

// The store double is too thin for the avatar stack (agent looks, Profile pictures): icons are stubbed.
vi.mock("../src/renderer/src/components/EntityIcon", () => import("./helpers/entityIconStub"));

const fx = vi.hoisted(() => ({ state: {} as any, ticked: [] as any[], app: {} as any }));
vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/lib/batchModel", () => ({
  useBatchModel: (select?: (s: any) => unknown) => select ? select(fx.state) : fx.state,
  scopeAgents: () => [], batchSources: () => [{ key: "source", model: "opus", profile: "claude", count: 1 }],
  batchRows: () => fx.ticked, tickedRows: () => fx.ticked,
  runningOn: () => false, applyBatch: () => {}, chooseEffort: () => {}, chooseSource: () => {}, chooseTarget: () => {}, closeBatchModel: () => {}, setBatchScope: () => {}, toggleBatchRow: () => {},
}));
vi.mock("../src/renderer/src/store", async (original) => ({ ...(await original<object>()), useApp: (select: (s: object) => unknown) => select(fx.app), sidebarOf: () => null }));
vi.mock("../src/renderer/src/lib/ownerContext", () => ({ useOwnerWindow: () => window }));

const { effortAppliesNextTurn, isEffortChange, turnRunning } = await import("../src/renderer/src/lib/effortNextTurn");
const { EffortPicker } = await import("../src/renderer/src/components/ConversationModelControls");
const { BatchModelDialog } = await import("../src/renderer/src/components/BatchModelDialog");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mount = async (node: ReturnType<typeof h>) => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, done: async () => { await act(async () => root.unmount()); host.remove(); } };
};

describe("the rule", () => {
  it("a running turn: ledger delivery turn / finishing, or the legacy busy flag; not a start or a hold", () => {
    const d = (state: string, reason: string | null = null) => ({ state, reason }) as never;
    expect(turnRunning(true, d("turn"), false)).toBe(true);
    expect(turnRunning(true, d("finishing"), false)).toBe(true);
    expect(turnRunning(true, d("starting"), true)).toBe(false);
    expect(turnRunning(true, d("held", "hostBusy"), true)).toBe(false);
    expect(turnRunning(true, d("idle"), true)).toBe(false);
    expect(turnRunning(false, null, true)).toBe(true);
    // Review: a ledger session whose delivery is not read yet is unknown, not idle — the runtime's turn answers.
    expect(turnRunning(true, null, true)).toBe(true);
    expect(turnRunning(true, undefined, true)).toBe(true);
    expect(turnRunning(true, null, false)).toBe(false);
    expect(turnRunning(false, null, false)).toBe(false);
  });
  it("a pick that is the raw current value is no change (Claude's none shows as no level; review P3)", () => {
    expect(isEffortChange("none", "none")).toBe(false);
    expect(isEffortChange("high", "high")).toBe(false);
    expect(isEffortChange("high", "none")).toBe(true);
    expect(isEffortChange("none", "high")).toBe(true);
    expect(isEffortChange("medium", null)).toBe(true);
    expect(isEffortChange("medium", undefined)).toBe(true);
  });
  it("only Claude agents", () => {
    expect(effortAppliesNextTurn("claude", true)).toBe(true);
    expect(effortAppliesNextTurn("claude", false)).toBe(false);
    for (const runtime of ["codex", "dsh", "kimi", null]) expect(effortAppliesNextTurn(runtime, true)).toBe(false);
  });
});

describe("effort chip", () => {
  const picker = (nextTurn?: string) => h(EffortPicker, { effort: "high", efforts: ["low", "medium", "high"], onChange: () => {}, claude: true, nextTurn });
  it("a running Claude turn: the chip's hover and the panel say it", async () => {
    const { host, done } = await mount(picker("composer.effort.nextTurn"));
    expect(host.querySelector("[title]")?.getAttribute("title")).toContain("composer.effort.nextTurn");
    await act(async () => host.querySelector("button")!.click());
    expect(document.querySelector("[data-effort-next-turn]")?.textContent).toBe("composer.effort.nextTurn");
    await done();
  });
  it("otherwise nothing", async () => {
    const { host, done } = await mount(picker());
    expect(host.querySelector("[title]")?.getAttribute("title") ?? "").not.toContain("composer.effort.nextTurn");
    await act(async () => host.querySelector("button")!.click());
    expect(document.querySelector("[data-effort-next-turn]")).toBeNull();
    await done();
  });
});

describe("batch model change", () => {
  const row = (patch: object) => ({ id: "a", name: "A", projectId: null, profile: "claude", runtime: "claude", online: true, busy: true, threadId: "t", model: "opus", effort: "medium", block: null, when: "afterTurn", effortSent: "high", effortFallback: false, effortNone: false, ...patch });
  const open = async (rows: object[], app: object = {}) => {
    fx.ticked = rows;
    fx.app = app;
    fx.state = { scope: { hostId: "local", label: "All" }, sourceKey: "source", target: "claude-opus-5-5", effort: "high", unticked: new Set(), runtimeModels: new Map(), phase: "choose", results: [], catalog: [{ id: "claude-opus-5-5", displayName: "Opus 5.5", supportedReasoningEfforts: ["low", "high"] }], pendingReads: 0 };
    return mount(h(BatchModelDialog));
  };
  it("an effort reaching a running Claude agent: one line under the effort choice", async () => {
    const { host, done } = await open([row({})]);
    expect(host.querySelector("[data-batch-effort-next-turn]")?.textContent).toBe("composer.effort.nextTurn");
    await done();
  });
  it("reads and keeps the listed online agents' ledgers while open; releases on close", async () => {
    const release = vi.fn();
    const watchInputs = vi.fn(() => release);
    const { done } = await open([row({ id: "a" }), row({ id: "b", online: false }), row({ id: "c", busy: false })], { watchInputs });
    expect(watchInputs).toHaveBeenCalledWith(["a", "c"], "local");
    expect(release).not.toHaveBeenCalled();
    await done();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["idle", { busy: false }], ["Codex", { runtime: "codex" }], ["no effort sent", { effortSent: null }], ["blocked", { block: "fixedAtCreation" }],
  ])("%s: no line", async (_name, patch) => {
    const { host, done } = await open([row(patch)]);
    expect(host.querySelector("[data-batch-effort-next-turn]")).toBeNull();
    await done();
  });
});

// Review P2 + follow-up: one running rule for the row's 「正在运行：本轮结束后生效」 (BatchRow.when), the post-apply text
// (BatchResult.when = row.when) and the effort line (row.busy) — the composer's (lib/effortNextTurn).
describe("batch rows: the running rule", async () => {
  const actual = await vi.importActual<typeof import("../src/renderer/src/lib/batchModel")>("../src/renderer/src/lib/batchModel");
  const session = (id: string, activeTurnId: string | null) => ({
    cutexSessionId: id, displayName: id, lifecycle: "active", profile: "claude", configuredProfile: null, launchedProfile: null,
    effectiveNextLaunch: { profile: "claude", source: "session_configured" }, native: { threadId: `th-${id}`, schema: null },
    runtime: { appServerConnected: true, activeTurnId, threadSettings: { model: "opus", effort: "medium" } },
    runtimeDefaults: null,
    launchBinding: { profileId: "claude", variantId: "v", runtime: "claude", credential: { source: "stored" }, model: null, reasoningEffort: null, runtimePackageVersion: null },
  }) as never;
  const ledgerApp = (state: string | null, reason: string | null = null) => ({ features: new Set(["input-ledger-v1"]), byHost: {}, inputs: state ? { "local\na": { delivery: { state, reason } } } : {} }) as never;
  const rowFor = (app: never, activeTurnId: string | null) => {
    const s0 = session("a", activeTurnId);
    const agent = actual.batchAgent(s0, null, actual.runningOn(app, "local", s0));
    const source = actual.batchSources([agent])[0]!;
    return actual.batchRows([agent], source, "claude-opus-5-5", new Map(), { choice: "high", catalogTarget: { supportedReasoningEfforts: ["low", "high"], defaultReasoningEffort: "high" } as never })[0]!;
  };
  it("ledger host, finishing with activeTurnId already gone: running — row afterTurn, effort line on", () => {
    const r = rowFor(ledgerApp("finishing"), null);
    expect([r.busy, r.when]).toEqual([true, "afterTurn"]);
    expect(effortAppliesNextTurn(r.runtime, r.busy) && !!r.effortSent).toBe(true);
  });
  it.each([["held (hostBusy)", "held", "hostBusy"], ["starting", "starting", null], ["idle", "idle", null]] as const)(
    "ledger host, %s with a stale activeTurnId: not running — row now, no effort line", (_n, state, reason) => {
      const r = rowFor(ledgerApp(state, reason), "turn-stale");
      expect([r.busy, r.when]).toEqual([false, "now"]);
      expect(effortAppliesNextTurn(r.runtime, r.busy)).toBe(false);
    });
  it("ledger host, no delivery read yet (unopened agent) with activeTurnId: running until the delivery says otherwise", () => {
    const before = rowFor(ledgerApp(null), "turn-1");
    expect([before.busy, before.when]).toEqual([true, "afterTurn"]);
    expect(effortAppliesNextTurn(before.runtime, before.busy) && !!before.effortSent).toBe(true);
    // The delivery arrives: idle → now, no effort line.
    const after = rowFor(ledgerApp("idle"), "turn-1");
    expect([after.busy, after.when]).toEqual([false, "now"]);
    // Not read and no active turn: now.
    expect(rowFor(ledgerApp(null), null).when).toBe("now");
  });
  it("ledger host, turn: running", () => {
    expect(rowFor(ledgerApp("turn"), "turn-1").when).toBe("afterTurn");
  });
  it("older host: the runtime's active turn", () => {
    const app = { features: new Set(), byHost: {}, inputs: {} } as never;
    expect(rowFor(app, "turn-1").when).toBe("afterTurn");
    expect(rowFor(app, null).when).toBe("now");
  });
  it("the result after applying keeps the row's when", () => {
    expect(actual.batchAgent(session("a", null), null).busy).toBe(false); // no rule given: activeTurnId, as before
    expect(actual.batchAgent(session("a", "t"), null).busy).toBe(true);
  });
});
