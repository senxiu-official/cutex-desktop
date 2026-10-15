import { describe, expect, it } from "vitest";
import type { OutdatedRuntimeAgent, RuntimePackageRun, RuntimePackageRunEvent, RuntimePackageRunItem, RuntimePackageSummary, RuntimePackagesView, UpdateStatus } from "../src/shared/ipc";
import { aboutAttention, agentPackages, agentRuntimeState, applyRunEvent, applyRunUpdate, asRunEvent, idleCount, itemNote, itemOutcome, noteworthyItems, packageLabel, revertTarget } from "../src/renderer/src/lib/runtimePackages";

const pkg = (over: Partial<RuntimePackageSummary> = {}): RuntimePackageSummary => ({
  manifest: "/m.json", nativePath: "/n", nativeVersion: "0.160.0-r50", nativeRelease: "r50", facadePath: "/f", facadeRelease: "r209", readable: true, ...over,
});

const agent = (name: string, over: Partial<OutdatedRuntimeAgent> = {}): OutdatedRuntimeAgent => ({
  cutexSessionId: `cutex.${name}`, name, contractVersion: 4, current: pkg({ nativeRelease: "r49", facadeRelease: "r205" }), runtimeStatus: "offline",
  online: false, busy: false, busyReason: null, activeTurnId: null, threadStatus: null, ...over,
});

const item = (name: string, over: Partial<RuntimePackageRunItem> = {}): RuntimePackageRunItem => ({
  cutexSessionId: `cutex.${name}`, name, state: "pending", step: null, code: null, reason: null, wasOnline: null, backOnline: null,
  previousRuntimeVersion: null, targetRuntimeVersion: null, previousFacadeRelease: null, targetFacadeRelease: null, actionId: null,
  committedAt: null, previousContract: null, targetContract: null, ...over,
});

const run = (runId: string, over: Partial<RuntimePackageRun> = {}): RuntimePackageRun => ({
  runId, kind: "upgrade", revertOf: null, revertedBy: [], state: "running", startedAt: "2026-10-08T10:00:00Z", finishedAt: null,
  selected: pkg(), counts: { total: 1, pending: 0, moved: 1, skipped: 0, failed: 0 }, currentAgentId: null, items: [], ...over,
});

const view = (over: Partial<RuntimePackagesView> = {}): RuntimePackagesView => ({ hostId: "workstation", selected: pkg(), selectedError: null, agents: [], activeRun: null, lastRun: null, ...over });

const status = (state: UpdateStatus["state"], latest: UpdateStatus["latest"] = null): UpdateStatus => ({ state, current: null, latest });

describe("packageLabel", () => {
  it("prints the runtime with its cutex facade, falling back to the version or one side", () => {
    expect(packageLabel(pkg())).toBe("运行时 r50（cutex r209）");
    expect(packageLabel(pkg({ nativeRelease: null }))).toBe("运行时 0.160.0-r50（cutex r209）");
    expect(packageLabel(pkg({ facadeRelease: null }))).toBe("运行时 r50");
    expect(packageLabel(pkg({ nativeRelease: null, nativeVersion: null }))).toBe("cutex r209");
    expect(packageLabel(pkg({ nativeRelease: null, nativeVersion: null, facadeRelease: null }))).toBeNull();
    expect(packageLabel(null)).toBeNull();
  });

  it("labels an agent's pinned → selected pair, unreadable pins as null", () => {
    expect(agentPackages(agent("a"), pkg())).toEqual({ current: "运行时 r49（cutex r205）", target: "运行时 r50（cutex r209）" });
    expect(agentPackages(agent("a", { current: pkg({ readable: false }) }), null)).toEqual({ current: null, target: null });
  });
});

describe("agent state and counts", () => {
  it("busy wins, then online / offline", () => {
    expect(agentRuntimeState({ busy: true, online: false })).toBe("busy");
    expect(agentRuntimeState({ busy: false, online: true })).toBe("online");
    expect(agentRuntimeState({ busy: false, online: false })).toBe("offline");
    expect(idleCount([agent("a"), agent("b", { busy: true, online: true }), agent("c", { online: true })])).toBe(2);
  });
});

describe("aboutAttention", () => {
  it("is on for outdated agents or a desktop update", () => {
    expect(aboutAttention(0, null)).toBe(false);
    expect(aboutAttention(0, status("idle"))).toBe(false);
    expect(aboutAttention(3, null)).toBe(true);
    expect(aboutAttention(0, status("available", { commit: "x", committedAt: "", subject: "s", count: 2 }))).toBe(true);
    expect(aboutAttention(0, status("error"))).toBe(false);
  });
});

describe("applyRunUpdate", () => {
  it("tracks a running run, then moves it to lastRun when it finishes", () => {
    const r1 = run("rpu-1");
    const a = applyRunUpdate(view(), r1);
    expect(a).toMatchObject({ finished: false, view: { activeRun: r1, lastRun: null } });
    const done = { ...r1, state: "completed" as const, finishedAt: "2026-10-08T10:05:00Z" };
    const b = applyRunUpdate(a.view, done);
    expect(b).toMatchObject({ finished: true, view: { activeRun: null, lastRun: done } });
  });

  it("ignores an older run's update while a newer one runs; keeps the newer lastRun", () => {
    const active = run("rpu-2", { startedAt: "2026-10-08T11:00:00Z" });
    const stale = run("rpu-1", { startedAt: "2026-10-08T10:00:00Z", state: "completed", finishedAt: "2026-10-08T10:05:00Z" });
    expect(applyRunUpdate(view({ activeRun: active }), stale)).toEqual({ view: view({ activeRun: active }), finished: false });
    const newer = run("rpu-3", { state: "completed", finishedAt: "2026-10-08T12:00:00Z" });
    expect(applyRunUpdate(view({ lastRun: newer }), stale).view.lastRun).toBe(newer);
  });
});

const event = (r: RuntimePackageRun, over: Partial<RuntimePackageRunEvent> = {}): RuntimePackageRunEvent => ({
  runId: r.runId, kind: r.kind, status: r.state, revertOf: r.revertOf, startedAt: r.startedAt, finishedAt: r.finishedAt,
  currentAgentId: r.currentAgentId, counts: r.counts, ...over,
});

describe("applyRunEvent", () => {
  const counts = { total: 2, pending: 2, moved: 0, skipped: 0, failed: 0 };
  const active = run("rpu-1", { counts, items: [item("a"), item("b")] });

  it("merges the header and the changed item by agent id into the active run", () => {
    const step = item("b", { state: "running", step: "apply" });
    const r = applyRunEvent(view({ activeRun: active }), event(active, { currentAgentId: "cutex.b", item: step }));
    expect(r.kind).toBe("applied");
    if (r.kind !== "applied") return;
    expect(r.finished).toBe(false);
    expect(r.view.activeRun?.currentAgentId).toBe("cutex.b");
    expect(r.view.activeRun?.items).toEqual([item("a"), step]);
    expect(r.view.activeRun?.selected).toEqual(active.selected);
  });

  it("a header-only finish moves the run to lastRun with its items", () => {
    const done = { total: 2, pending: 0, moved: 2, skipped: 0, failed: 0 };
    const r = applyRunEvent(view({ activeRun: active }), event(active, { status: "completed", finishedAt: "2026-10-08T10:05:00Z", counts: done }));
    expect(r).toMatchObject({ kind: "applied", finished: true, view: { activeRun: null, lastRun: { runId: "rpu-1", state: "completed", counts: done, items: active.items } } });
  });

  it("asks for the full run when the run or the item is unknown; ignores older runs", () => {
    expect(applyRunEvent(view(), event(run("rpu-9")))).toEqual({ kind: "fetch", runId: "rpu-9" });
    expect(applyRunEvent(view({ activeRun: active }), event(active, { item: item("z") }))).toEqual({ kind: "fetch", runId: "rpu-1" });
    const newer = run("rpu-2", { startedAt: "2026-10-08T11:00:00Z" });
    expect(applyRunEvent(view({ activeRun: newer }), event(active))).toEqual({ kind: "stale" });
  });

  it("updates the cached lastRun (a late event for the finished run)", () => {
    const last = run("rpu-1", { state: "completed", finishedAt: "2026-10-08T10:05:00Z", items: [item("a", { state: "moved" })] });
    const r = applyRunEvent(view({ lastRun: last }), event(last, { item: item("a", { state: "moved", backOnline: true }) }));
    expect(r.kind === "applied" && r.view.lastRun?.items[0]?.backOnline).toBe(true);
  });
});

describe("asRunEvent", () => {
  it("accepts the daemon's shape, drops anything else", () => {
    const e = event(run("rpu-1"), { item: item("a") });
    expect(asRunEvent(e)).toBe(e);
    expect(asRunEvent({ run: run("rpu-1") })).toBeNull();
    expect(asRunEvent({ ...e, item: { name: "a" } })).toBeNull();
    expect(asRunEvent(null)).toBeNull();
  });
});

describe("itemOutcome", () => {
  it("maps states, codes and the not-back-online case", () => {
    expect(itemOutcome(item("a"))).toEqual({ kind: "pending" });
    expect(itemOutcome(item("a", { state: "running", step: "apply" }))).toEqual({ kind: "running", step: "apply" });
    expect(itemOutcome(item("a", { state: "moved", wasOnline: true, backOnline: true }))).toEqual({ kind: "moved" });
    expect(itemOutcome(item("a", { state: "moved", wasOnline: true, backOnline: false, code: "onlineFailed", reason: "timeout" }))).toEqual({ kind: "movedOffline", reason: "timeout" });
    expect(itemOutcome(item("a", { state: "skipped", code: "busy" }))).toEqual({ kind: "skipped", code: "busy", reason: null });
    expect(itemOutcome(item("a", { state: "failed", code: "applyFailed", reason: "boom" }))).toEqual({ kind: "failed", code: "applyFailed", reason: "boom" });
    expect(itemOutcome(item("a", { state: "failed" }))).toMatchObject({ code: "unknown" });
  });

  it("lists everything but plain moves under a finished run", () => {
    const r = run("rpu-1", {
      items: [item("a", { state: "moved" }), item("b", { state: "skipped", code: "busy" }), item("c", { state: "moved", backOnline: false, code: "onlineFailed" }), item("d", { state: "failed", code: "x" })],
    });
    expect(noteworthyItems(r).map((i) => i.name)).toEqual(["b", "c", "d"]);
  });
});

describe("itemNote", () => {
  it("explains the known raw reasons and repairs; others stay raw", () => {
    expect(itemNote(item("a", { state: "failed", code: "reviewRefused", reason: "owner_action_required: runtime package upgrade requires offline/no claim" }))).toBe("staleClaim");
    expect(itemNote(item("a", { state: "failed", code: "staleClaim", reason: "runtime claim remains: runtime pid 7" }))).toBe("staleClaim");
    expect(itemNote(item("a", { state: "failed", code: "staleClaim", reason: "recorded runtime pid 124128 is running (possibly a reused PID); the claim was left in place" }))).toBe("stalePid");
    expect(itemNote(item("a", { state: "failed", code: "reviewRefused", reason: "owner_action_required: current runtime package is unavailable: selected frontend executable unavailable (os error 3)" }))).toBe("packageMissing");
    expect(itemNote(item("a", { state: "moved", repair: true, reason: "repair: the pinned runtime package is missing (x)" }))).toBe("repaired");
    expect(itemNote(item("a", { state: "failed", code: "applyFailed", reason: "disk full" }))).toBeNull();
  });

  it("a repaired item is its own outcome and listed under the run", () => {
    const repaired = item("a", { state: "moved", repair: true, backOnline: null });
    expect(itemOutcome(repaired)).toEqual({ kind: "repaired", backOnline: null });
    expect(noteworthyItems(run("rpu-1", { items: [repaired, item("b", { state: "moved" })] })).map((i) => i.name)).toEqual(["a"]);
  });
});

describe("revertTarget", () => {
  const finished = run("rpu-1", { state: "completed", finishedAt: "2026-10-08T10:05:00Z", counts: { total: 2, pending: 0, moved: 2, skipped: 0, failed: 0 } });
  const left = (runId: string, agentIds: string[]) => ({ runId, agentIds });

  it("follows cutex's revertable: on the upgrade run, with the agents left", () => {
    expect(revertTarget(view({ lastRun: finished, revertable: left("rpu-1", ["cutex.a", "cutex.b"]) }))).toEqual({ runId: "rpu-1", agents: 2, shownOn: "rpu-1" });
    expect(revertTarget(view({ lastRun: { ...finished, state: "interrupted" }, revertable: left("rpu-1", ["cutex.a"]) }))?.agents).toBe(1);
  });

  it("retries the rest from a revert run that did not move everything back", () => {
    const revert = run("rpu-2", { kind: "revert", revertOf: "rpu-1", state: "completed", finishedAt: "2026-10-08T10:09:00Z" });
    expect(revertTarget(view({ lastRun: revert, revertable: left("rpu-1", ["cutex.b"]) }))).toEqual({ runId: "rpu-1", agents: 1, shownOn: "rpu-2" });
  });

  it("hidden when nothing is left, for another run, or while a run is active", () => {
    expect(revertTarget(null)).toBeNull();
    expect(revertTarget(view({ lastRun: finished, revertable: null }))).toBeNull();
    expect(revertTarget(view({ lastRun: finished, revertable: left("rpu-1", []) }))).toBeNull();
    expect(revertTarget(view({ lastRun: { ...finished, kind: "revert", revertOf: "rpu-0" }, revertable: left("rpu-1", ["cutex.a"]) }))).toBeNull();
    expect(revertTarget(view({ lastRun: finished, activeRun: run("rpu-3"), revertable: left("rpu-1", ["cutex.a"]) }))).toBeNull();
  });

  it("older daemons (no revertable): a finished upgrade run with moves and no revert", () => {
    expect(revertTarget(view({ lastRun: finished }))).toEqual({ runId: "rpu-1", agents: 2, shownOn: "rpu-1" });
    expect(revertTarget(view({ lastRun: { ...finished, kind: "revert" } }))).toBeNull();
    expect(revertTarget(view({ lastRun: { ...finished, revertedBy: ["rpu-2"] } }))).toBeNull();
    expect(revertTarget(view({ lastRun: { ...finished, counts: { ...finished.counts, moved: 0 } } }))).toBeNull();
  });
});
