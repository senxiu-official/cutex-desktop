// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RuntimePrunePlan, RuntimePruneVersion } from "../src/shared/runtimes";
const env = vi.hoisted(() => ({ host: "a", enabled: true, get: vi.fn(), post: vi.fn(), runtimes: vi.fn(), components: vi.fn(), calls: [] as string[] }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: (host: string) => ({ runtimePrunePlan: () => { env.calls.push(`GET:${host}`); return env.get(host); }, cancelRuntimePrunePlan: () => { env.calls.push(`CANCEL:${host}`); }, pruneRuntimes: (ids: string[]) => { env.calls.push(`POST:${host}`); return env.post(host, ids); } }) }));
vi.mock("../src/renderer/src/lib/useArchivedAgents", () => ({ useArchivedAgents: () => {} }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ hosts: { active: env.host }, daemon: { kind: "connected" }, features: new Set(env.enabled ? ["runtime-prune-v1"] : []), byHost: { a: { daemon: { kind: "connected" }, features: new Set(["runtime-prune-v1"]) }, b: { daemon: { kind: "connected" }, features: new Set(["runtime-prune-v1"]) } } }) } }));
vi.mock("../src/renderer/src/lib/runtimesStore", () => ({ refreshRuntimes: (host: string) => env.runtimes(host) }));
vi.mock("../src/renderer/src/lib/componentStore", () => ({ loadComponents: (host: string) => env.components(host) }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostData: () => ({ daemon: { kind: "connected" }, features: env.enabled ? CAPS : NO_CAPS }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => env.host }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: object) => key + (vars ? JSON.stringify(vars) : "") }) }));
const CAPS = new Set(["runtime-prune-v1"]);
const NO_CAPS = new Set<string>();
const { useRuntimePruneStore, refreshRuntimePrune, pruneRuntimeVersions, RUNTIME_PRUNE_PLAN_WAIT_MS } = await import("../src/renderer/src/lib/runtimePruneStore");
const { RUNTIME_PRUNE_PLAN_TIMEOUT } = await import("../src/shared/runtimes");
const { captureHostAction, fireHostReset } = await import("../src/renderer/src/lib/hostSwitch");
const { RuntimeGroup } = await import("../src/renderer/src/components/RuntimeVersions");
const version = (id: string, extra: Partial<RuntimePruneVersion> = {}): RuntimePruneVersion => ({ id, kind: "native", release: `release-${id}`, bytes: 1024, canPrune: true, blockedReasons: [], ...extra });
const plan = (...versions: RuntimePruneVersion[]): RuntimePrunePlan => ({ versions });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  fireHostReset("a"); fireHostReset("b"); env.host = "a"; env.enabled = true; env.calls = []; vi.clearAllMocks();
  env.get.mockResolvedValue(plan(version("one"))); env.post.mockResolvedValue({ freedBytes: 1024, results: [{ id: "one", status: "deleted", freedBytes: 1024 }] });
  env.runtimes.mockResolvedValue(undefined); env.components.mockResolvedValue(undefined);
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); });
async function render() { await act(async () => root.render(h(RuntimeGroup, { kind: "native", title: "native", list: [] }))); }
const btn = (key: string) => [...node.querySelectorAll("button")].find(b => b.textContent?.startsWith(key))!;

// EVA 2026-11-15: the plan read never answered; the panel said 清理（0） and 正在检查清理计划… for as long as it was open.
it("while the plan loads the action reads 正在检查… and is disabled, never 清理（0）", async () => {
  const a = deferred<RuntimePrunePlan>(); env.get.mockReturnValue(a.promise);
  await render();
  const action = btn("runtimes.prune.checking");
  expect(action.textContent).toBe("runtimes.prune.checking"); expect(action.disabled).toBe(true);
  expect(node.textContent).not.toContain("runtimes.prune.action");
  await act(async () => { a.resolve(plan(version("one"))); await a.promise; });
  expect(btn("runtimes.prune.action").textContent).toBe('runtimes.prune.action{"n":1}');
});
it("gives up after ~20 s: 暂时读不出 · 重试, main's request is dropped, and 重试 reads again", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const late = deferred<RuntimePrunePlan>(); env.get.mockReturnValueOnce(late.promise).mockResolvedValue(plan(version("one")));
    await render();
    expect(RUNTIME_PRUNE_PLAN_WAIT_MS).toBe(20_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(19_999); });
    expect(node.querySelector("[data-prune-timeout]")).toBeNull(); expect(env.calls).not.toContain("CANCEL:a");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(node.querySelector("[data-prune-timeout]")!.textContent).toBe("runtimes.prune.timeout");
    expect(env.calls).toContain("CANCEL:a");
    expect(btn("runtimes.prune.action")).toBeUndefined(); expect(btn("runtimes.prune.checking")).toBeUndefined();
    expect(node.querySelector("[role=alert]")).toBeNull();
    // A late answer to the abandoned read changes nothing.
    await act(async () => { late.resolve(plan(version("late"))); await late.promise; });
    expect(useRuntimePruneStore.getState().byHost.a?.plan).toBeNull();
    await act(async () => btn("runtimes.prune.retry").click());
    expect(env.get).toHaveBeenCalledTimes(2);
    expect(node.querySelector("[data-prune-timeout]")).toBeNull();
    expect(btn("runtimes.prune.action").textContent).toBe('runtimes.prune.action{"n":1}');
  } finally { vi.useRealTimers(); }
});
it("main's own timeout reads as 暂时读不出, not as a failed cleanup", async () => {
  env.get.mockRejectedValue(new Error(`Error invoking remote method 'daemon': Error: ${RUNTIME_PRUNE_PLAN_TIMEOUT}`));
  await render();
  expect(node.querySelector("[data-prune-timeout]")).not.toBeNull();
  expect(node.querySelector("[role=alert]")).toBeNull();
});
it("closing the panel drops a read still waiting, so it holds no slot; reopening reads again", async () => {
  const a = deferred<RuntimePrunePlan>(); env.get.mockReturnValueOnce(a.promise).mockResolvedValue(plan(version("one")));
  // Two groups (cute-codex and Claude) share one read: closing one keeps it.
  const groups = (...kinds: ("native" | "claude")[]) => act(async () => root.render(h("div", null, ...kinds.map(kind => h(RuntimeGroup, { key: kind, kind, title: kind, list: [] })))));
  await groups("native", "claude");
  expect(env.get).toHaveBeenCalledTimes(1);
  await groups("native");
  expect(env.calls).not.toContain("CANCEL:a");
  await act(async () => root.render(h("div")));
  expect(env.calls).toContain("CANCEL:a");
  expect(useRuntimePruneStore.getState().byHost.a?.loading).toBe(false);
  await act(async () => { a.resolve(plan(version("late"))); await a.promise; });
  expect(useRuntimePruneStore.getState().byHost.a?.plan).toBeNull();
  await render();
  expect(env.get).toHaveBeenCalledTimes(2);
  expect(btn("runtimes.prune.action").textContent).toBe('runtimes.prune.action{"n":1}');
});
// cutex B1 (2026-11-15): directories whose size was not computed come as bytes 0 + bytesEstimated.
it("an uncomputed size reads 未计算, never 0 B, and totals that include one say 至少 / 大小未计算", async () => {
  env.get.mockResolvedValue(plan(version("known"), version("dir", { release: "claude-r0", bytes: 0, bytesEstimated: true })));
  await render();
  const planRows = [...node.querySelectorAll("details li")].map(li => li.textContent);
  expect(planRows.find(r => r!.includes("claude-r0"))).toContain("runtimes.prune.sizeUnknown");
  expect(node.textContent).not.toContain("0 B");
  await act(async () => btn("runtimes.prune.action").click());
  const confirm = node.querySelector("[data-prune-confirm]")!;
  expect(confirm.querySelector("p")!.textContent).toMatch(/runtimes\.prune\.atLeast.*1\.0 KiB/);
  expect([...confirm.querySelectorAll("li")].map(li => li.textContent)).toEqual(["release-known · 1.0 KiB", "claude-r0 · runtimes.prune.sizeUnknown"]);
  await act(async () => btn("runtimes.prune.cancel").click());
  // Only uncomputed sizes: no number at all.
  await act(async () => [...node.querySelectorAll<HTMLButtonElement>("details button")].find(b => b.closest("li")!.textContent!.includes("claude-r0"))!.click());
  expect(node.querySelector("[data-prune-confirm] p")!.textContent).toContain("runtimes.prune.totalUnknown");
  // The POST result's freed bytes stay exact.
  env.post.mockResolvedValue({ freedBytes: 4096, results: [{ id: "dir", status: "deleted", freedBytes: 4096 }] });
  await act(async () => btn("runtimes.prune.delete").click());
  expect(node.textContent).toContain('runtimes.prune.freed{"size":"4.0 KiB"}');
});
it("keeps old hosts read-only", async () => {
  env.enabled = false; await render(); expect(env.get).not.toHaveBeenCalled(); expect(node.querySelector("[data-runtime-cleanup]")).toBeNull();
});
it("deduplicates host reads, isolates late replies and fences connection replacements", async () => {
  const a = deferred<RuntimePrunePlan>(); env.get.mockImplementation((id: string) => id === "a" ? a.promise : Promise.resolve(plan(version("b"))));
  const first = refreshRuntimePrune("a"); expect(refreshRuntimePrune("a")).toBe(first);
  env.host = "b"; await refreshRuntimePrune("b"); fireHostReset("a"); a.resolve(plan(version("old"))); await first;
  expect(useRuntimePruneStore.getState().byHost.a).toBeUndefined();
  expect(useRuntimePruneStore.getState().byHost.b?.plan?.versions[0]?.id).toBe("b");
});
it("shows backend protection reasons and confirms exact versions and total bytes inline", async () => {
  env.get.mockResolvedValue(plan(version("one"), version("two"), version("protected", { canPrune: false, blockedReasons: ["inspection_failed", "rollback"] })));
  await render(); expect(btn("runtimes.prune.action").textContent).toContain('"n":2');
  expect(node.textContent).toContain("runtimes.prune.inspection_failed");
  await act(async () => btn("runtimes.prune.action").click());
  const confirm = node.querySelector("[data-prune-confirm]")!;
  expect(confirm.textContent).toContain("release-one"); expect(confirm.textContent).toContain("release-two"); expect(confirm.textContent).toContain("2.0 KiB"); expect(confirm.textContent).not.toContain("release-protected");
  expect(env.post).not.toHaveBeenCalled();
  await act(async () => btn("runtimes.prune.cancel").click()); expect(node.querySelector("[data-prune-confirm]")).toBeNull();
});
it("per-version deletion uses inline confirmation and never displays opaque IDs", async () => {
  env.get.mockResolvedValue(plan(version("opaque/path-token", { release: "r52" })));
  await render(); expect(node.textContent).not.toContain("opaque/path-token");
  await act(async () => btn("runtimes.prune.delete").click());
  expect(node.querySelector("[data-prune-confirm]")?.textContent).toContain("r52");
  await act(async () => btn("runtimes.prune.delete").click());
  expect(env.post).toHaveBeenCalledWith("a", ["opaque/path-token"]);
});
it("limits each confirmation to 100 versions", async () => {
  env.get.mockResolvedValue(plan(...Array.from({ length: 101 }, (_, i) => version(String(i))))); await render();
  await act(async () => btn("runtimes.prune.action").click()); expect(node.querySelectorAll("[data-prune-confirm] li")).toHaveLength(100);
});
it("clears confirmation on target switch and rejects a superseded plan", async () => {
  await render(); await act(async () => btn("runtimes.prune.action").click()); env.host = "b"; await render();
  expect(node.querySelector("[data-prune-confirm]")).toBeNull(); expect(env.post).not.toHaveBeenCalled();
  const old = useRuntimePruneStore.getState().byHost.b!.plan!;
  env.get.mockResolvedValue(plan(version("one")));
  await act(async () => refreshRuntimePrune("b")); await pruneRuntimeVersions("b", old, ["one"], captureHostAction("b")); expect(env.post).not.toHaveBeenCalled();
});
it("locks duplicate actions through refusals and refreshes both installed lists", async () => {
  await render(); const old = useRuntimePruneStore.getState().byHost.a!.plan!;
  const post = deferred<{ freedBytes: number; results: { id: string; status: "refused"; freedBytes: number; reason: string }[] }>();
  env.post.mockReturnValue(post.promise); const refreshed = deferred<RuntimePrunePlan>(); env.get.mockReturnValue(refreshed.promise);
  let pending!: Promise<void>;
  await act(async () => { pending = pruneRuntimeVersions("a", old, ["one"], captureHostAction("a")); });
  expect(btn("runtimes.prune.pending").disabled).toBe(true);
  await pruneRuntimeVersions("a", old, ["one"], captureHostAction("a")); expect(env.post).toHaveBeenCalledTimes(1);
  await act(async () => { post.resolve({ freedBytes: 0, results: [{ id: "one", status: "refused", freedBytes: 0, reason: "running" }] }); await Promise.resolve(); });
  expect(useRuntimePruneStore.getState().byHost.a?.pending).toBe(true);
  await act(async () => { refreshed.resolve(plan(version("one", { canPrune: false, blockedReasons: ["running"] }))); await pending; });
  expect(node.textContent).toContain("runtimes.prune.refused"); expect(node.textContent).toContain("runtimes.prune.running");
  expect(env.runtimes).toHaveBeenCalledWith("a"); expect(env.components).toHaveBeenCalledWith("a"); expect(useRuntimePruneStore.getState().byHost.a?.pending).toBe(false);
});
it("rejects reset confirmations and discards an old POST on a replacement connection", async () => {
  await refreshRuntimePrune("a"); const old = useRuntimePruneStore.getState().byHost.a!.plan!, current = captureHostAction("a");
  fireHostReset("a"); await pruneRuntimeVersions("a", old, ["one"], current); expect(env.post).not.toHaveBeenCalled();
  await refreshRuntimePrune("a"); const next = useRuntimePruneStore.getState().byHost.a!.plan!; const post = deferred<never>(); env.post.mockReturnValue(post.promise);
  const request = pruneRuntimeVersions("a", next, ["one"], captureHostAction("a")); fireHostReset("a");
  post.resolve({ freedBytes: 1, results: [] } as never); await request;
  expect(useRuntimePruneStore.getState().byHost.a).toBeUndefined(); expect(env.runtimes).not.toHaveBeenCalled();
});
it("refreshes after uncertain failure and invalidates plans after read failure", async () => {
  await refreshRuntimePrune("a"); const old = useRuntimePruneStore.getState().byHost.a!.plan!;
  env.post.mockRejectedValue(new Error("uncertain")); env.get.mockRejectedValue(new Error("offline"));
  await pruneRuntimeVersions("a", old, ["one"], captureHostAction("a"));
  expect(env.post).toHaveBeenCalledTimes(1); expect(env.runtimes).toHaveBeenCalledWith("a");
  expect(useRuntimePruneStore.getState().byHost.a).toMatchObject({ plan: null, loading: false, pending: false });
});

it("merges plan-only Claude versions and retains both opaque IDs for bulk cleanup", async () => {
  env.get.mockResolvedValue(plan(version("legacy-copy", { kind: "claude", release: "claude-r10", bytes: 1024 }), version("component-copy", { kind: "claude", release: "claude-r10", bytes: 2048 })));
  await act(async () => root.render(h(RuntimeGroup, { kind: "claude", title: "Claude", list: [] })));
  const unused = node.querySelector("[data-unused-runtimes]")!;
  expect(unused.querySelectorAll("li")).toHaveLength(1); expect(unused.textContent).toContain("claude-r10"); expect(unused.textContent).toContain('"n":0');
  await act(async () => btn("runtimes.prune.action").click());
  expect(node.querySelectorAll("[data-prune-confirm] li")).toHaveLength(2); expect(node.querySelector("[data-prune-confirm]")?.textContent).toContain("3.0 KiB");
  await act(async () => btn("runtimes.prune.delete").click());
  expect(env.post).toHaveBeenCalledWith("a", ["legacy-copy", "component-copy"]);
});
it("retains a POST failure message after a successful plan refresh", async () => {
  await refreshRuntimePrune("a"); const old = useRuntimePruneStore.getState().byHost.a!.plan!;
  env.post.mockRejectedValue(new Error("uncertain"));
  await pruneRuntimeVersions("a", old, ["one"], captureHostAction("a"));
  expect(useRuntimePruneStore.getState().byHost.a).toMatchObject({ error: "Error: uncertain", pending: false });
});

it.each(["dsh", "kimi"] as const)("sends only the %s kind's IDs from the shared presentation", async kind => {
  env.get.mockResolvedValue(plan(version("native"), version(`${kind}-opaque`, { kind, release: `${kind}-r1` })));
  await act(async () => root.render(h(RuntimeGroup, { kind, hostId: "a", title: kind, list: [] })));
  await act(async () => btn("runtimes.prune.action").click());
  expect(node.querySelectorAll("[data-prune-confirm] li")).toHaveLength(1);
  await act(async () => btn("runtimes.prune.delete").click());
  expect(env.post).toHaveBeenCalledWith("a", [`${kind}-opaque`]);
});

it("does not derive deletion authority from the display pin count", async () => {
  env.get.mockResolvedValue(plan(version("safe", { release: "r2" }), version("protected", { release: "r1", canPrune: false, blockedReasons: ["rollback"] })));
  const raw = (release: string, agentCount: number) => ({ release, agentCount, agents: [], version: null, sha256Prefix: null, path: null, selected: false, missing: false });
  await act(async () => root.render(h(RuntimeGroup, { kind: "native", title: "native", list: [raw("r2", 99), raw("r1", 0)] })));
  await act(async () => btn("runtimes.prune.action").click());
  expect(node.querySelector("[data-prune-confirm]")?.textContent).toContain("r2");
  expect(node.querySelector("[data-prune-confirm]")?.textContent).not.toContain("r1");
  await act(async () => btn("runtimes.prune.delete").click());
  expect(env.post).toHaveBeenCalledWith("a", ["safe"]);
});

it("keeps mixed deletion outcomes and maps unknown reasons without exposing opaque handles", async () => {
  env.get.mockResolvedValue(plan(version("opaque-deleted", { release: "r3" }), version("opaque-refused", { release: "r2" }), version("opaque-failed", { release: "r1" })));
  env.post.mockResolvedValue({ freedBytes: 1024, results: [
    { id: "opaque-deleted", status: "deleted", freedBytes: 1024 },
    { id: "opaque-refused", status: "refused", freedBytes: 0, reason: "pinned" },
    { id: "opaque-failed", status: "failed", freedBytes: 0, reason: "future_reason" },
  ] });
  await render(); await act(async () => btn("runtimes.prune.action").click());
  await act(async () => btn("runtimes.prune.delete").click());
  for (const key of ["deleted", "refused", "failed", "pinned", "unknown"]) expect(node.textContent).toContain(`runtimes.prune.${key}`);
  expect(node.textContent).not.toContain("opaque-"); expect(node.textContent).toContain("1.0 KiB");
});

it("uses a neutral summary on prune hosts and exposes actual inspection refusal beside the disabled bulk action", async () => {
  env.get.mockResolvedValue(plan(
    version("rollback", { canPrune: false, blockedReasons: ["rollback"] }),
    version("uninspectable", { canPrune: false, blockedReasons: ["inspection_failed"] }),
  ));
  await render();
  const summary = node.querySelector("[data-unused-runtimes] > summary")!;
  expect(summary.textContent).toBe('runtimes.unreferenced{"n":2}');
  expect(summary.textContent).not.toContain("runtimes.unused");
  const bulk = btn("runtimes.prune.action");
  expect(bulk.disabled).toBe(true);
  const reason = node.querySelector("[data-prune-inspection-blocked]")!;
  expect(reason.textContent).toBe("runtimes.prune.inspection_failed");
  expect(reason.closest("details")).toBeNull();
  expect(reason.parentElement).toBe(bulk.parentElement);
  expect(env.post).not.toHaveBeenCalled();
});

it.each([
  [plan(version("rollback", { canPrune: false, blockedReasons: ["rollback"] }))],
  [plan(version("safe"), version("blocked", { canPrune: false, blockedReasons: ["inspection_failed"] }))],
  [plan(version("other-kind", { kind: "claude", canPrune: false, blockedReasons: ["inspection_failed"] }))],
])("does not add an inspection warning without an actual blocked, zero-candidate group", async fixture => {
  env.get.mockResolvedValue(fixture);
  await render();
  expect(node.querySelector("[data-prune-inspection-blocked]")).toBeNull();
});
