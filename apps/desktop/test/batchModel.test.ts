// 批量换模型 (owner 2026-11-18): which agents a batch change touches, how (live thread vs stored default), what is
// greyed with a reason, and the effort sent. lib/batchModel; main's check of the offline route: shared/sessionDefaults.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";

const api = { updateThreadSettings: vi.fn(async () => {}), sessionAction: vi.fn(async () => ({})), listModels: vi.fn(), profileModels: vi.fn() };
vi.mock("../src/renderer/src/store", () => ({ hostApi: () => api, sidebarOf: () => null, useApp: { getState: () => ({}) } }));

const { useBatchModel, applyBatch, applyOne, batchAgent, batchRows, batchSources, chooseEffort, chooseSource, chooseTarget, closeBatchModel, effortFor, inScope, openBatchModel, runtimeModel, tickedRows } = await import("../src/renderer/src/lib/batchModel");
const rm = (...ids: string[]) => ids.map((id) => runtimeModel({ id, model: id, efforts: ["low", "medium", "high"], defaultEffort: "medium" }));
const { checkDefaultsPatch } = await import("../src/shared/sessionDefaults");

function session(id: string, over: { profile?: string; model?: string; effort?: string; online?: boolean; busy?: boolean; runtime?: "codex" | "claude" | "dsh" | "kimi"; version?: string } = {}): SessionResource {
  const online = over.online ?? true;
  return {
    cutexSessionId: id, displayName: id, lifecycle: "active", profile: over.profile ?? "openai", configuredProfile: null, launchedProfile: null,
    effectiveNextLaunch: { profile: over.profile ?? "openai", source: "session_configured" },
    native: { threadId: `th-${id}`, schema: null },
    runtime: { appServerConnected: online, activeTurnId: over.busy ? "turn-1" : null, threadSettings: online ? { model: over.model ?? "gpt-6.1", effort: over.effort ?? "high" } : null } as never,
    runtimeDefaults: online ? null : { model: over.model ?? "gpt-6.1", reasoningEffort: over.effort ?? "high" },
    launchBinding: { profileId: "p", variantId: "v", runtime: over.runtime ?? "codex", credential: { source: "stored" }, model: null, reasoningEffort: null, runtimePackageVersion: over.version ?? null },
  } as unknown as SessionResource;
}

const agents = [
  batchAgent(session("live"), "proj-a"),
  batchAgent(session("busy", { busy: true }), "proj-a"),
  batchAgent(session("off", { online: false }), null),
  batchAgent(session("dsh", { runtime: "dsh" }), "proj-b"),
  batchAgent(session("claudeOff", { runtime: "claude", online: false }), null),
  batchAgent(session("oldNative", { version: "0.160.0-r58" }), "proj-a"),
  batchAgent(session("other", { model: "gpt-6" }), "proj-a"),
  batchAgent(session("anthropic", { profile: "claude-p", model: "gpt-6.1" }), "proj-a"),
];

describe("batch model rules", () => {
  it("lists the models in use per Profile with counts, most used first", () => {
    expect(batchSources(agents).map((s) => `${s.model}|${s.profile}|${s.count}`)).toEqual(["gpt-6.1|openai|6", "gpt-6.1|claude-p|1", "gpt-6|openai|1"]);
  });
  it("routes by runtime state and greys what cutex refuses or ignores, with the reason", () => {
    const source = batchSources(agents)[0]!;
    const rows = batchRows(agents, source, "gpt-6.2", new Map([["oldNative", rm("gpt-6", "gpt-6.1")], ["live", rm("gpt-6.1", "gpt-6.2")]]));
    const by = Object.fromEntries(rows.map((r) => [r.id, [r.block, r.when]]));
    expect(by).toEqual({
      live: [null, "now"],
      busy: [null, "afterTurn"],
      off: [null, "nextStart"],
      dsh: ["fixedAtCreation", "now"],
      claudeOff: ["claudeOffline", "nextStart"],
      oldNative: ["runtimeLacksModel", "now"],
    });
    // Another Profile's agents on the same model id, and agents on another model, are never in this batch.
    expect(rows.some((r) => r.id === "anthropic" || r.id === "other")).toBe(false);
    expect(rows.find((r) => r.id === "oldNative")?.runtimeVersion).toBe("0.160.0-r58");
    // Blocked rows sort last and are never ticked; unticked rows stay out.
    expect(rows.slice(-3).every((r) => r.block)).toBe(true);
    expect(tickedRows(rows, new Set(["busy"])).map((r) => r.id).sort()).toEqual(["live", "off"]);
  });
  it("an agent already on the target is not listed", () => {
    const source = batchSources(agents)[0]!;
    expect(batchRows(agents, source, "gpt-6.1", new Map())).toEqual([]);
  });
  it("scopes: selected agents, one project, independent agents, all", () => {
    const ids = (scope: Parameters<typeof inScope>[1]) => agents.filter((a) => inScope(a, scope)).map((a) => a.id);
    expect(ids({ ids: ["off", "dsh"] })).toEqual(["off", "dsh"]);
    expect(ids({ projectId: "proj-b" })).toEqual(["dsh"]);
    expect(ids({ independent: true })).toEqual(["off", "claudeOff"]);
    expect(ids({})).toHaveLength(agents.length);
  });
  it("effort: kept when offered, an explicit offered choice is sent, anything not offered falls back to the default", () => {
    const limits = { efforts: ["low", "medium", "high"], defaultEffort: "medium" };
    expect(effortFor({ effort: "high" }, "keep", limits)).toEqual({ effort: null, fallback: false, none: false });
    expect(effortFor({ effort: "xhigh" }, "keep", limits)).toEqual({ effort: "medium", fallback: true, none: false });
    expect(effortFor({ effort: null }, "keep", limits)).toEqual({ effort: null, fallback: false, none: false });
    expect(effortFor({ effort: "high" }, "low", limits)).toEqual({ effort: "low", fallback: false, none: false });
    expect(effortFor({ effort: "high" }, "xhigh", limits)).toEqual({ effort: "medium", fallback: true, none: false });
  });
  it("the preview shows each agent's own effort: its runtime's limits for the target first, the Profile catalog only without them", () => {
    const source = batchSources(agents)[0]!;
    const narrow = [runtimeModel({ id: "gpt-6.2", model: "gpt-6.2", efforts: ["low", "high"], defaultEffort: "high" })];
    const rows = batchRows(agents, source, "gpt-6.2", new Map([["live", narrow]]), { choice: "medium", catalogTarget: { supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" } });
    const by = Object.fromEntries(rows.map((r) => [r.id, [r.effortSent, r.effortFallback]]));
    expect(by.live).toEqual(["high", true]); // its runtime offers only low / high: its default, marked
    expect(by.off).toEqual(["medium", false]); // offline: the catalog decides
    expect(by.busy).toEqual(["medium", false]); // list not read: the catalog decides
  });
});

describe("applying one agent", () => {
  beforeEach(() => { api.updateThreadSettings.mockClear(); api.sessionAction.mockClear(); });
  const rowOf = (id: string) => batchRows(agents, batchSources(agents)[0]!, "gpt-6.2", new Map()).find((r) => r.id === id)!;
  it("online: the live thread (native thread/settings/update), effective from the next turn or after the running one", async () => {
    expect(await applyOne("local", rowOf("busy"), "gpt-6.2", "medium")).toEqual({ id: "busy", ok: true, when: "afterTurn" });
    expect(api.updateThreadSettings).toHaveBeenCalledWith("busy", "th-busy", { model: "gpt-6.2", effort: "medium" });
    expect(api.sessionAction).not.toHaveBeenCalled();
  });
  it("offline: stored on the agent's record for its next start (cutex/session/defaults/update)", async () => {
    expect(await applyOne("local", rowOf("off"), "gpt-6.2", null)).toEqual({ id: "off", ok: true, when: "nextStart" });
    expect(api.sessionAction).toHaveBeenCalledWith("off", "cutex/session/defaults/update", { patch: { model: "gpt-6.2" } });
    expect(api.updateThreadSettings).not.toHaveBeenCalled();
  });
  it("a refusal is that agent's result, with cutex's reason", async () => {
    api.updateThreadSettings.mockRejectedValueOnce(new Error("native_-32600: model not supported"));
    expect(await applyOne("local", rowOf("live"), "gpt-6.2", null)).toEqual({ id: "live", ok: false, error: "native_-32600: model not supported" });
  });
});

describe("main's check of the offline route", () => {
  it("lets the renderer store a model / effort, still only these keys", () => {
    expect(() => checkDefaultsPatch({ patch: { model: "gpt-6.2", reasoningEffort: "high" } })).not.toThrow();
    expect(() => checkDefaultsPatch({ patch: { model: "gpt-6.2" }, expectedRevision: 4 })).not.toThrow();
    for (const patch of [{ model: "" }, { model: " gpt" }, { model: "a\nb" }, { model: "x".repeat(201) }, { model: true }, { reasoningEffort: 3 }, { model: "gpt-6.2", serviceTier: "fast" }, { claudeAllowWrite: "gpt" }])
      expect(() => checkDefaultsPatch({ patch })).toThrow();
  });
});

describe("the runtime's own effort limits win over the Profile catalog (cross-review 2026-11-18)", () => {
  const source = { key: "p\u0000old", profile: "p", model: "old", count: 1 };
  const row = (effort: string, id = "a") => ({ id, name: id, projectId: null, profile: "p", runtime: "codex" as const, online: true, busy: false, threadId: `thread-${id}`, model: "old", effort, runtimeVersion: "r63", block: null, when: "now" as const, effortSent: null, effortFallback: false, effortNone: false });
  beforeEach(() => { closeBatchModel(); vi.clearAllMocks(); });
  it.each([["medium", "high"], ["keep", "xhigh"]])("choice %s (agent on %s): never sends an effort the agent's runtime does not offer for the target", async (choice, current) => {
    const a = row(current);
    openBatchModel({ hostId: "h", label: "scope" });
    api.listModels.mockResolvedValue([{ id: "new", model: "new", displayName: "new", efforts: ["low", "high"], defaultEffort: "high" }]);
    api.profileModels.mockResolvedValue({ models: [{ id: "new", supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" }] });
    await chooseSource(source, [a]);
    await vi.waitFor(() => expect(api.listModels).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    chooseTarget("new");
    chooseEffort(choice);
    await applyBatch([a]);
    expect(api.updateThreadSettings).toHaveBeenCalledWith("a", "thread-a", { model: "new", effort: "high" });
  });

  // Re-review 2026-11-18: an empty effort list from the agent's own runtime, and lists that arrive late.
  it("its runtime lists the target with no efforts: no effort is sent, whatever the catalog offers", async () => {
    const a = row("high");
    openBatchModel({ hostId: "h", label: "scope" });
    api.listModels.mockResolvedValue([{ id: "new", model: "new", efforts: [], defaultEffort: null }]);
    api.profileModels.mockResolvedValue({ models: [{ id: "new", supportedReasoningEfforts: ["medium"], defaultReasoningEffort: "medium" }] });
    await chooseSource(source, [a]);
    await vi.waitFor(() => expect(useBatchModel.getState().pendingReads).toBe(0));
    chooseTarget("new");
    chooseEffort("medium");
    await applyBatch([a]);
    expect(api.updateThreadSettings).toHaveBeenCalledWith("a", "thread-a", { model: "new" });
  });
  it("the preview says so for that agent", () => {
    const rows = batchRows([{ ...row("high"), effortNone: undefined } as never], source, "new", new Map([["a", [runtimeModel({ id: "new", model: "new", efforts: [], defaultEffort: "none" })]]]), { choice: "medium", catalogTarget: { supportedReasoningEfforts: ["medium"], defaultReasoningEffort: "medium" } });
    expect(rows[0]).toMatchObject({ effortSent: null, effortNone: true, effortFallback: false });
  });
  it("a list arriving while earlier agents are sent constrains an agent not sent yet", async () => {
    let resolveList!: (x: unknown[]) => void, release!: () => void;
    const pendingList = new Promise<unknown[]>((r) => (resolveList = r)), gate = new Promise<void>((r) => (release = r));
    api.listModels.mockImplementation(((id: string) => (id === "d" ? pendingList : Promise.resolve([{ id: "new", model: "new", efforts: ["medium", "high"], defaultEffort: "medium" }]))) as never);
    api.profileModels.mockResolvedValue({ models: [{ id: "new", supportedReasoningEfforts: ["medium", "high"], defaultReasoningEffort: "medium" }] });
    api.updateThreadSettings.mockImplementation((async (id?: string) => { if (id !== "d") await gate; }) as never);
    const rows = ["a", "b", "c", "d"].map((id) => row("high", id));
    openBatchModel({ hostId: "h", label: "scope" });
    await chooseSource(source, rows);
    expect(useBatchModel.getState().pendingReads).toBe(1); // 应用 stays disabled while d's list is read
    chooseTarget("new");
    chooseEffort("medium");
    const task = applyBatch(rows);
    expect(api.updateThreadSettings).toHaveBeenCalledTimes(3);
    resolveList([{ id: "new", model: "new", efforts: ["low", "high"], defaultEffort: "high" }]);
    await vi.waitFor(() => expect(useBatchModel.getState().runtimeModels.get("d")).toBeDefined());
    expect(useBatchModel.getState().pendingReads).toBe(0);
    release();
    await task;
    expect(api.updateThreadSettings).toHaveBeenCalledWith("d", "thread-d", { model: "new", effort: "high" });
    api.updateThreadSettings.mockImplementation(async () => {});
  });
  it("a list arriving after the preview but before the click counts", async () => {
    let resolve!: (x: unknown[]) => void;
    api.listModels.mockReturnValue(new Promise<unknown[]>((r) => (resolve = r)));
    api.profileModels.mockResolvedValue({ models: [{ id: "new", supportedReasoningEfforts: ["medium", "high"], defaultReasoningEffort: "medium" }] });
    const a = row("high");
    openBatchModel({ hostId: "h", label: "scope" });
    await chooseSource(source, [a]);
    chooseTarget("new");
    chooseEffort("medium");
    resolve([{ id: "new", model: "new", efforts: ["low", "high"], defaultEffort: "high" }]);
    await vi.waitFor(() => expect(useBatchModel.getState().runtimeModels.get("a")).toBeDefined());
    await applyBatch([a]);
    expect(api.updateThreadSettings).toHaveBeenCalledWith("a", "thread-a", { model: "new", effort: "high" });
  });
  it("a failed list read stays unknown: the catalog decides, and the read no longer counts as pending", async () => {
    api.listModels.mockRejectedValue(new Error("model/list unavailable"));
    api.profileModels.mockResolvedValue({ models: [{ id: "new", supportedReasoningEfforts: ["medium"], defaultReasoningEffort: "medium" }] });
    const a = row("high");
    openBatchModel({ hostId: "h", label: "scope" });
    await chooseSource(source, [a]);
    await vi.waitFor(() => expect(useBatchModel.getState().pendingReads).toBe(0));
    chooseTarget("new");
    chooseEffort("medium");
    await applyBatch([a]);
    expect(useBatchModel.getState().runtimeModels.get("a")).toBeUndefined();
    expect(api.updateThreadSettings).toHaveBeenCalledWith("a", "thread-a", { model: "new", effort: "medium" });
    expect(useBatchModel.getState().results).toEqual([{ id: "a", ok: true, when: "now" }]);
  });
});
