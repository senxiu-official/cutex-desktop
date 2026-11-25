// An old agent whose saved model / effort is no longer offered (shared/pinnedModel, Z5), main side: cutex's typed
// 409 refusals cross IPC as a fixed-shape wire message (no daemon text), other errors keep their text; the defaults
// allowlist takes a null reasoningEffort (remove a saved effort) but still no null model.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ feeds: [] as any[], host: vi.fn(), sessions: vi.fn(), projects: vi.fn(), project: vi.fn(), hostSessions: vi.fn(), capabilities: vi.fn(), request: vi.fn(), cutex: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", async original => ({
  ...await original<typeof import("@cutex-desktop/cutex-client")>(),
  CutexClient: class {
    dispose = vi.fn();
    constructor(public endpoint: unknown, public options: unknown) {}
    host = f.host; sessions = f.sessions; projects = f.projects; project = f.project;
    hostSessions = f.hostSessions; capabilities = f.capabilities; request = f.request; cutex = f.cutex;
  },
  EventFeed: class {
    start = vi.fn(); stop = vi.fn(); reconnectNow = vi.fn();
    constructor(public client: unknown, public handlers: any, public options: any) { f.feeds.push(this); }
  },
}));
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { DaemonService } from "../src/main/daemon";
import { launchSelectionPatch, pinnedModelBlock, pinnedModelWire, PINNED_MODEL_UNAVAILABLE_CODE, PINNED_MODEL_UPGRADE_CODE } from "../src/shared/pinnedModel";
import { checkDefaultsPatch } from "../src/shared/sessionDefaults";

describe("wire", () => {
  it("round-trips both refusals through an IPC error, keeps only checked fields, and ignores other codes", () => {
    const wire = pinnedModelWire({ code: PINNED_MODEL_UNAVAILABLE_CODE, details: { model: "gpt-6.1", reasoningEffort: "minimal", reason: "effortUnavailable", offeredReasoningEfforts: ["low", "medium", "bad\nvalue", 7], secret: "D:/x" } })!;
    expect(wire).not.toContain("secret");
    const ipc = new Error(`Error invoking remote method 'cutex-desktop:invoke': Error: ${wire}`);
    expect(pinnedModelBlock(ipc)).toEqual({ kind: "unavailable", model: "gpt-6.1", effort: "minimal", reason: "effortUnavailable", offeredEfforts: ["low", "medium"] });
    expect(pinnedModelBlock(wire)).toEqual(pinnedModelBlock(ipc));
    expect(pinnedModelBlock(pinnedModelWire({ code: PINNED_MODEL_UNAVAILABLE_CODE, details: { model: "old", reasoningEffort: null, reason: "modelUnavailable" } }))).toEqual({ kind: "unavailable", model: "old", effort: null, reason: "modelUnavailable", offeredEfforts: [] });
    expect(pinnedModelBlock(pinnedModelWire({ code: PINNED_MODEL_UPGRADE_CODE, details: { requiredCapability: "offlineLaunchSelection" } }))).toEqual({ kind: "upgradeRequired" });
    expect(pinnedModelWire({ code: "runtime_start_failed" })).toBeNull();
    expect(pinnedModelBlock(new Error("model gpt-6.1 is unavailable"))).toBeNull();
    expect(pinnedModelBlock("pinned_model_blocked:{not json")).toBeNull();
  });
  it("builds the defaults patch: undefined effort keeps the saved one, null removes it", () => {
    expect(launchSelectionPatch({ model: "gpt-6.2" })).toEqual({ model: "gpt-6.2" });
    expect(launchSelectionPatch({ model: "gpt-6.2", effort: null })).toEqual({ model: "gpt-6.2", reasoningEffort: null });
    expect(launchSelectionPatch({ model: null, effort: "medium" })).toEqual({ reasoningEffort: "medium" });
  });
  it("lets a null reasoningEffort through the defaults allowlist, never a null model", () => {
    expect(() => checkDefaultsPatch({ patch: { reasoningEffort: null }, expectedRevision: 3 })).not.toThrow();
    expect(() => checkDefaultsPatch({ patch: { model: "gpt-6.2", reasoningEffort: null } })).not.toThrow();
    expect(() => checkDefaultsPatch({ patch: { model: null } })).toThrow();
    expect(() => checkDefaultsPatch({ patch: { memoryInjection: null } })).toThrow();
  });
});

describe("main", () => {
  const settle = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
  let service: DaemonService;
  beforeEach(async () => {
    vi.useFakeTimers(); f.feeds.length = 0;
    for (const value of Object.values(f)) if (typeof value === "function") value.mockReset();
    f.host.mockResolvedValue({ hostId: "h" });
    f.sessions.mockResolvedValue({ sessions: [], management: null });
    f.projects.mockResolvedValue({ projects: [] });
    f.hostSessions.mockResolvedValue({ data: [], nextCursor: null });
    f.capabilities.mockResolvedValue({ featureList: [], userAccess: { isOwner: true } });
    service = new DaemonService(vi.fn());
    service.useEndpoint({ baseUrl: "http://test.invalid", token: "token" }, { remote: true });
    await settle();
  });
  afterEach(() => { service.stop(); vi.useRealTimers(); });

  it("turns a typed start refusal into the wire message (from a start and from a save), and leaves other errors as they are", async () => {
    f.cutex.mockRejectedValueOnce(new CutexApiError(409, PINNED_MODEL_UNAVAILABLE_CODE, "Model gpt-5.1 at D:/secret is unavailable", false, { model: "gpt-5.1", reasoningEffort: "high", reason: "modelUnavailable", offeredReasoningEfforts: [] }));
    const start = await service.sessionAction("s1", "cutex/runtime/online", { openVisibleTerminal: false }).catch((e: Error) => e);
    expect(String(start)).not.toContain("secret");
    expect(pinnedModelBlock(start)).toMatchObject({ kind: "unavailable", model: "gpt-5.1", reason: "modelUnavailable" });
    f.cutex.mockRejectedValueOnce(new CutexApiError(409, PINNED_MODEL_UPGRADE_CODE, "Update this agent's pinned Claude runtime", false, { requiredCapability: "offlineLaunchSelection" }));
    const save = await service.sessionAction("s1", "cutex/session/defaults/update", { patch: { reasoningEffort: null }, expectedRevision: 2 }).catch((e: Error) => e);
    expect(pinnedModelBlock(save)).toEqual({ kind: "upgradeRequired" });
    // One HTTP attempt for a save (no transport retry); other actions keep the client's default.
    expect(f.cutex).toHaveBeenLastCalledWith("s1", "cutex/session/defaults/update", { patch: { reasoningEffort: null }, expectedRevision: 2 }, { retryable: false });
    expect(f.cutex.mock.calls[0]).toEqual(["s1", "cutex/runtime/online", { openVisibleTerminal: false }]);
    f.cutex.mockRejectedValueOnce(new CutexApiError(502, "runtime_start_failed", "native exited"));
    const other = await service.sessionAction("s1", "cutex/runtime/online", {}).catch((e: Error) => e);
    expect(pinnedModelBlock(other)).toBeNull();
    expect(String(other)).toContain("native exited");
  });
});
