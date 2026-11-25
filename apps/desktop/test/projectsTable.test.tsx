// @vitest-environment jsdom
// 项目 page, 「全部项目」 (owner 2026-11-25, option B): the rows' figures from the app's own data (cutex's figures where
// the host has project-table-summary-v1, only while it is reachable), partial totals, filters / sort / Shift range, the
// 更多 tab split, 最近打开 across windows, the batch calls (bounded, one result per project, a lost reply is unknown and
// the state is read before another write, a pause still settling is not done, one batch at a time, kept when the page is
// left; explicit host reads, never the store's cached sidebar; one batch across windows through main's lease) and the table's batch bar (an in-place second click to archive; 移到主机 and an unsupported pause disabled with
// the reason; failed rows stay selected and in view whatever the filter; filters locked while a batch runs).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@cutex-desktop/protocol";
import type { AgentRow } from "../src/renderer/src/lib/sidebar";
import type { ProjectFacts, HostRows, ProjectFilter } from "../src/renderer/src/modules/projects/projectTable";

const fx = vi.hoisted(() => ({
  features: new Map<string, Set<string>>(),
  sidebars: new Map<string, any>(),
  api: new Map<string, any>(),
  refresh: vi.fn(async (_hostId: string) => {}),
  // The explicit sidebar read (hostApi(h).sidebar()); by default what fx.sidebars holds.
  read: vi.fn(async (hostId: string): Promise<any> => undefined),
  lease: vi.fn(async (_r: any): Promise<any> => ({ ok: true, token: "t1" })),
  open: vi.fn(),
  scope: { focus: "local", hostsInScope: [{ id: "local" }, { id: "ws" }], showHostMarks: false, host: (id: string) => ({ id, label: id === "ws" ? "workstation" : "EVA" }) },
}));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: unknown) => unknown) => select({ hosts: null, byHost: {}, features: new Set() }), { getState: () => ({ refreshHostSidebar: fx.refresh }) }),
  featuresOf: (_: unknown, hostId: string) => fx.features.get(hostId) ?? new Set(),
  sidebarOf: (_: unknown, hostId: string) => fx.sidebars.get(hostId) ?? null,
}));
vi.mock("../src/renderer/src/lib/hostLists", () => ({ hostApi: (id: string) => ({ sidebar: () => fx.read(id), ...fx.api.get(id) }) }));
vi.mock("../src/renderer/src/bridge", () => ({ api: { projectBatchLease: (r: unknown) => fx.lease(r) } }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostScope: () => fx.scope }));
vi.mock("../src/renderer/src/lib/projectIconSync", () => ({ useProjectIcons: () => ({}) }));
vi.mock("../src/renderer/src/components/EntityIcon", () => ({ EntityIcon: () => null }));
vi.mock("../src/renderer/src/components/HostMark", () => ({ HostMark: ({ host }: { host: { label: string } }) => h("span", { "data-host-chip": host.label }, host.label) }));
vi.mock("../src/renderer/src/lib/sizeFlags", () => ({ widthAtLeast: () => () => true, useSizeFlags: () => [() => {}, { wide: true }] }));
vi.mock("../src/renderer/src/lib/sidebarView", () => ({ relativeTime: () => "5m" }));
vi.mock("../src/renderer/src/modules/projects/projectNav", () => ({ openProject: fx.open }));
vi.mock("../src/renderer/src/i18n", async () => {
  const { zhCN } = await import("../src/renderer/src/modules/projects/i18n");
  const tr = (key: string, vars: Record<string, unknown> = {}): string => String((zhCN as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? ""));
  return { useI18n: () => ({ locale: "zh-CN", t: tr }) };
});
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  EmptyState: ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => h("div", { "data-empty": "" }, children, action),
  Button: (props: object) => h("button", { type: "button", ...props }),
  TextLink: ({ children, onClick }: { children: React.ReactNode; onClick(): void }) => h("button", { "data-link": "", onClick }, children),
  TextInput: ({ value, onChange, label, disabled }: { value: string; onChange(v: string): void; label?: string; disabled?: boolean }) => h("input", { "aria-label": label, value, disabled, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }),
  Select: ({ value, options, onChange, label, disabled }: { value: string; options: { value: string; label: string }[]; onChange(v: string): void; label?: string; disabled?: boolean }) =>
    h("select", { "aria-label": label, value, disabled, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, options.map((o) => h("option", { key: o.value, value: o.value }, o.label))),
}));
vi.mock("../src/renderer/src/lib/armedConfirm", async () => {
  const { useState } = await import("react");
  return { ARMED_FORM_BUTTON: "border-danger-solid bg-danger-solid", useArmed: () => useState(false) };
});

const table = await import("../src/renderer/src/modules/projects/projectTable");
const recent = await import("../src/renderer/src/modules/projects/recentProjects");
const batchMod = await import("../src/renderer/src/modules/projects/projectBatch");
const { startProjectBatch, resetProjectBatch, projectBatchRunning } = batchMod;
const { AllProjects } = await import("../src/renderer/src/modules/projects/AllProjects");
const { writeErrorOutcome, controlOutcome } = await import("../src/shared/projectBatchOutcome");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = (id: string, over: Partial<ProjectSummary> & Record<string, unknown> = {}): ProjectSummary =>
  ({ project_id: id, authority_epoch: 1, project_revision: 4, director_cutex_session_id: `${id}-dir`, workspace_root: `/srv/${id}`, presentation: { display_name: id, badge_label: id.slice(0, 1), color: "blue" }, active_member_count: 3, lifecycle: "active", ...over }) as ProjectSummary;
const row = (id: string, status: AgentRow["status"], lastActivity: number, name = id) => ({ id, key: `k:${id}`, name, status, lastActivity }) as unknown as AgentRow;
const rows = (over: Partial<HostRows> = {}): HostRows => ({ known: true, reachable: true, byProject: new Map(), needsYou: () => false, summaryFields: false, ...over });
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe("projectFacts", () => {
  const p = project("a");
  const byProject = new Map([["a", { online: [row("a-dir", "running", 300, "Alice"), row("m1", "idle", 500), row("m2", "unknown", 100)], offline: [row("m3", "offline", 900)] }]]);
  it("counts online members, 需要你 and the latest activity from the host's rows, members from the same rows", () => {
    const f = table.projectFacts("local", "local:a", p, false, rows({ byProject, needsYou: (r) => r.id === "m1" }));
    expect(f).toMatchObject({ online: 2, needsYou: 1, lastActivity: 900, directorName: "Alice", root: "/srv/a", members: 4 });
    // cutex says 9; the 4 rows are what the 2 online are counted from.
    expect(table.projectFacts("local", "local:a", project("a", { active_member_count: 9 }), false, rows({ byProject }))).toMatchObject({ online: 2, members: 4 });
  });
  it("shows unknown (null) for a host without rows, and no online / 需要你 for an archived project", () => {
    expect(table.projectFacts("ws", "ws:a", p, false, rows({ known: false, byProject }))).toMatchObject({ online: null, needsYou: null, lastActivity: null, members: 3 });
    expect(table.projectFacts("local", "local:a", p, true, rows({ byProject }))).toMatchObject({ online: null, needsYou: null, lastActivity: 900 });
  });
  it("prefers cutex's own figures behind the capability while the host is reachable, with a denominator never below them", () => {
    const own = project("a", { online_member_count: 7, last_activity_at: "2026-11-25T01:00:00Z" });
    expect(table.projectFacts("ws", "ws:a", own, false, rows({ known: false, summaryFields: true }))).toMatchObject({ online: 7, members: 7, lastActivity: Date.parse("2026-11-25T01:00:00Z") });
    expect(table.projectFacts("ws", "ws:a", own, false, rows({ known: false }))).toMatchObject({ online: null, lastActivity: null });
    // An unreachable host's cached figures are history: unknown.
    expect(table.projectFacts("ws", "ws:a", own, false, rows({ known: false, reachable: false, summaryFields: true }))).toMatchObject({ online: null, lastActivity: null });
    expect(table.projectFacts("ws", "ws:a", project("a", { online_member_count: null, last_activity_at: null }), false, rows({ known: false, summaryFields: true }))).toMatchObject({ online: null, lastActivity: null });
  });
});

const f = (id: string, over: Partial<ProjectFacts> = {}): ProjectFacts =>
  ({ key: `h:${id}`, hostId: "h", id, name: id, directorId: "d", directorName: "Alice", root: `/srv/${id}`, members: 2, online: 1, needsYou: 0, lastActivity: 10, archived: false, project: project(id), ...over });

describe("filters, sort, totals and tabs", () => {
  const list = [f("beta", { lastActivity: 30, online: 0 }), f("alpha", { lastActivity: null, needsYou: 2, directorId: null, directorName: null }), f("gamma", { hostId: "ws", key: "ws:gamma", lastActivity: 20, online: null, needsYou: null, members: 5 }), f("old", { archived: true })];
  const shown = (filter: Partial<ProjectFilter>) => list.filter((p) => table.matchesProject(p, { ...table.EMPTY_PROJECT_FILTER, ...filter })).map((p) => p.id);
  it("lists archived projects only under 已归档 and filters by host, status and text (Director, directory)", () => {
    expect(shown({})).toEqual(["beta", "alpha", "gamma"]);
    expect(shown({ status: "archived" })).toEqual(["old"]);
    expect(shown({ host: "ws" })).toEqual(["gamma"]);
    expect(shown({ status: "needsYou" })).toEqual(["alpha"]);
    expect(shown({ status: "noDirector" })).toEqual(["alpha"]);
    expect(shown({ status: "online" })).toEqual(["alpha"]);
    expect(shown({ text: "alice" })).toEqual(["beta", "gamma"]);
    expect(shown({ text: "/srv/gam" })).toEqual(["gamma"]);
    expect(table.isFiltered(table.EMPTY_PROJECT_FILTER)).toBe(false);
  });
  it("sorts with unknown figures last and ties by name", () => {
    const active = list.filter((p) => !p.archived);
    expect(table.sortProjects(active, "activity", "en").map((p) => p.id)).toEqual(["beta", "gamma", "alpha"]);
    expect(table.sortProjects(active, "name", "en").map((p) => p.id)).toEqual(["alpha", "beta", "gamma"]);
    expect(table.sortProjects(active, "online", "en").map((p) => p.id)).toEqual(["alpha", "beta", "gamma"]);
  });
  it("totals leave unknown projects out of both online and its denominator, and say how many", () => {
    expect(table.rangeKeys(["a", "b", "c", "d"], "d", "b")).toEqual(["b", "c", "d"]);
    expect(table.projectTotals(list.slice(0, 3))).toEqual({ projects: 3, hosts: 2, online: 1, onlineMembers: 4, onlineUnknown: 1, needsYou: 2, needsPartial: true });
    expect(table.projectTotals(list.slice(0, 2))).toMatchObject({ onlineUnknown: 0, needsPartial: false });
    expect(table.projectTotals([f("x", { online: null, needsYou: null })])).toMatchObject({ online: null, needsYou: null, onlineUnknown: 1 });
  });
  it("keeps the 7 main tabs in the row and the rest under 更多", () => {
    const tabs = ["overview", "project-view", "agents", "tasks", "artifacts", "delegation-tree", "services", "memory", "users", "settings"].map((tab) => ({ tab }));
    const { main, more } = table.splitProjectTabs(tabs);
    expect(main.map((x) => x.tab)).toEqual(["overview", "agents", "tasks", "artifacts", "services", "memory", "settings"]);
    expect(more.map((x) => x.tab)).toEqual(["project-view", "delegation-tree", "users"]);
  });
});

describe("最近打开", () => {
  beforeEach(() => recent.resetRecentProjects());
  it("keeps the newest first, without duplicates, up to the limit", () => {
    for (let i = 0; i < recent.RECENT_PROJECTS_MAX + 2; i++) recent.noteProjectOpened(`h:${i}`);
    recent.noteProjectOpened("h:3");
    const list = recent.recentProjects();
    expect(list[0]).toBe("h:3");
    expect(list).toHaveLength(recent.RECENT_PROJECTS_MAX);
    expect(new Set(list).size).toBe(list.length);
  });
  it("adds to what another window stored instead of overwriting it, and follows its storage events", () => {
    recent.noteProjectOpened("h:mine");
    // Another window writes its own list.
    localStorage.setItem("cutex-desktop.projects.recent", JSON.stringify(["h:theirs", "h:mine"]));
    window.dispatchEvent(new StorageEvent("storage", { key: "cutex-desktop.projects.recent" }));
    expect(recent.recentProjects()).toEqual(["h:theirs", "h:mine"]);
    localStorage.setItem("cutex-desktop.projects.recent", JSON.stringify(["h:later", "h:theirs", "h:mine"]));
    recent.noteProjectOpened("h:new"); // no event yet: the write still starts from what is stored
    expect(JSON.parse(localStorage.getItem("cutex-desktop.projects.recent")!)).toEqual(["h:new", "h:later", "h:theirs", "h:mine"]);
  });
});

describe("what a write proves (main)", () => {
  const api = (status: number, code: string) => Object.assign(new Error(`${code}: x`), { name: "CutexApiError", status, code });
  it("is a refusal only when the host answered so; a lost reply or cutex's outcome-unknown is unknown", () => {
    expect(writeErrorOutcome(api(409, "project_revision_conflict"))).toEqual({ outcome: "refused", code: "project_revision_conflict" });
    expect(writeErrorOutcome(api(409, "request_outcome_unknown"))).toEqual({ outcome: "unknown", code: "request_outcome_unknown" });
    expect(writeErrorOutcome(api(503, "persistence_unavailable")).outcome).toBe("unknown");
    expect(writeErrorOutcome(api(500, "internal")).outcome).toBe("unknown");
    expect(writeErrorOutcome(Object.assign(new Error("cutex management API unreachable at x"), { name: "CutexUnreachableError" })).outcome).toBe("unknown");
    expect(writeErrorOutcome(new Error("unsupported delegation feature")).outcome).toBe("refused");
    // An unstructured reply (the client's http_<status>: a proxy, an unrecognised answer) proves nothing, 4xx included.
    expect(writeErrorOutcome(api(404, "http_404"))).toEqual({ outcome: "unknown", code: "http_404" });
    expect(writeErrorOutcome(api(403, "http_403")).outcome).toBe("unknown");
    expect(writeErrorOutcome(api(407, "http_407")).outcome).toBe("unknown");
  });
  it("reads a pause receipt as the shared validator does: completed + committed is done, pending + partial settling, the rest unknown", () => {
    const receipt = (over: Record<string, unknown>) => ({ receipt: { schema: "cutex.delegation-operation.v1", actionId: "a1", operationId: "op", operation: "project.pause", requestDigest: "a".repeat(64), revision: 1, status: "completed", effectState: "committed", outcomeUnknown: false, updatedAt: "2026-11-25T00:00:00Z", ...over } }) as never;
    expect(controlOutcome(receipt({}), "a1", "project.pause")).toEqual({ outcome: "done" });
    expect(controlOutcome(receipt({ status: "pending", effectState: "partial" }), "a1", "project.pause")).toEqual({ outcome: "settling" });
    // The shared validator calls these unknown: so does the table.
    expect(controlOutcome(receipt({ status: "completed", effectState: "partial" }), "a1", "project.pause")).toEqual({ outcome: "unknown" });
    expect(controlOutcome(receipt({ status: "pending" }), "a1", "project.pause")).toEqual({ outcome: "unknown" });
    expect(controlOutcome(receipt({ status: "pending", effectState: "none" }), "a1", "project.pause")).toEqual({ outcome: "unknown" });
    expect(controlOutcome(receipt({ outcomeUnknown: true }), "a1", "project.pause").outcome).toBe("unknown");
    expect(controlOutcome(receipt({ actionId: "other" }), "a1", "project.pause").outcome).toBe("unknown");
    expect(controlOutcome(receipt({ effectState: "none" }), "a1", "project.pause").outcome).toBe("refused");
  });
});

const facts = (id: string, hostId = "local"): ProjectFacts => table.projectFacts(hostId, `${hostId}:${id}`, project(id), false, rows({ byProject: new Map([[id, { online: [row(`${id}-dir`, "idle", 100)], offline: [] }]]) }));
const sidebarWith = (active: ProjectSummary[], archived: ProjectSummary[] = []) => ({ projects: { projects: active, archived_projects: archived } });

describe("project batch", () => {
  beforeEach(() => {
    fx.api.clear(); fx.sidebars.clear(); fx.refresh.mockReset().mockResolvedValue(undefined); resetProjectBatch();
    fx.read.mockReset().mockImplementation(async (h: string) => { const s = fx.sidebars.get(h); if (!s) throw new Error("unread"); return s; });
    fx.lease.mockReset().mockImplementation(async (r: { op: string; token?: string }) => ({ ok: true, token: r.token ?? "t1" }));
  });
  it("archives against the revision just read, 3 at a time, one result each; a refusal stops nothing", async () => {
    let live = 0, peak = 0;
    const lifecycle = vi.fn(async (id: string) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return id === "p2" ? { outcome: "refused", code: "project_revision_conflict" } : { outcome: "done" }; });
    fx.api.set("local", { projectLifecycle: lifecycle }); fx.api.set("ws", { projectLifecycle: lifecycle });
    fx.sidebars.set("local", sidebarWith([project("p0", { project_revision: 9 }), ...[1, 2, 3].map((i) => project(`p${i}`))]));
    fx.sidebars.set("ws", sidebarWith([project("p4")]));
    const out = await startProjectBatch("archive", [0, 1, 2, 3, 4].map((i) => facts(`p${i}`, i === 4 ? "ws" : "local")));
    expect(peak).toBeLessThanOrEqual(3);
    expect(out!.map((r) => r.status)).toEqual(["done", "done", "failed", "done", "done"]);
    expect(out![2]!.error).toBe("project_revision_conflict");
    expect(lifecycle).toHaveBeenCalledWith("p0", { authorityEpoch: 1, projectRevision: 9 }, "archive");
    // One explicit read per host before the writes and one after; the store's sidebar refreshed once, for display.
    expect(fx.read.mock.calls.map((c) => c[0]).sort()).toEqual(["local", "local", "ws", "ws"]);
    expect(fx.refresh.mock.calls.map((c) => c[0]).sort()).toEqual(["local", "ws"]);
    // Main's lease, taken before and given back after.
    expect(fx.lease.mock.calls.map((c) => c[0].op)).toEqual(["begin", "end"]);
  });
  it("treats a lost reply as unknown, settles it from the state read after, and reads before writing again", async () => {
    // p0: the host archived it but the reply was lost; p1: lost and not applied; p2: the IPC call itself threw.
    const lifecycle = vi.fn(async (id: string) => {
      if (id === "p0") fx.sidebars.set("local", sidebarWith([project("p1"), project("p2")], [project("p0", { project_revision: 5 })]));
      if (id === "p2") throw new Error("Error invoking remote method: connection replaced");
      return { outcome: "unknown" };
    });
    fx.api.set("local", { projectLifecycle: lifecycle });
    fx.sidebars.set("local", sidebarWith([project("p0"), project("p1"), project("p2")]));
    const first = await startProjectBatch("archive", ["p0", "p1", "p2"].map((id) => facts(id)));
    expect(first!.map((r) => r.status)).toEqual(["done", "unknown", "unknown"]);
    expect(batchMod.batchRetryKeys({ kind: "archive", keys: [], total: 3, done: 3, results: first! })).toEqual(["local:p1", "local:p2"]);
    // p1 went through after all (seen on the next read): no second write for it.
    lifecycle.mockClear();
    fx.sidebars.set("local", sidebarWith([project("p2")], [project("p0"), project("p1")]));
    const second = await startProjectBatch("archive", ["p1", "p2"].map((id) => facts(id)));
    expect(second!.map((r) => r.status)).toEqual(["skipped", "unknown"]);
    expect(lifecycle.mock.calls.map((c) => c[0])).toEqual(["p2"]);
    // A host that cannot be read gets no write.
    lifecycle.mockClear();
    fx.read.mockRejectedValueOnce(new Error("offline"));
    const third = await startProjectBatch("archive", [facts("p2")]);
    expect(third!.map((r) => [r.status, r.error])).toEqual([["failed", "state_unread"]]);
    expect(lifecycle).not.toHaveBeenCalled();
  });
  it("never decides from the store's cached sidebar: a read that returns no snapshot writes nothing, and a failed read after keeps unknown", async () => {
    const lifecycle = vi.fn(async () => ({ outcome: "unknown" }));
    fx.api.set("local", { projectLifecycle: lifecycle });
    // The store's refresh resolves (as the production one does when its read fails) and the store still holds a sidebar.
    fx.sidebars.set("local", sidebarWith([project("p0")]));
    fx.read.mockResolvedValueOnce(undefined);
    const first = await startProjectBatch("archive", [facts("p0")]);
    expect(first!.map((r) => [r.status, r.error])).toEqual([["failed", "state_unread"]]);
    expect(lifecycle).not.toHaveBeenCalled();
    // Read before: fine; the write's reply is lost; the read after fails while the cached state shows it archived.
    fx.read.mockImplementationOnce(async () => sidebarWith([project("p0")])).mockImplementationOnce(async () => { throw new Error("offline"); });
    fx.sidebars.set("local", sidebarWith([], [project("p0")]));
    const second = await startProjectBatch("archive", [facts("p0")]);
    expect(lifecycle).toHaveBeenCalledOnce();
    expect(second!.map((r) => r.status)).toEqual(["unknown"]);
  });
  it("sends nothing while another window's batch holds main's lease, and says so", async () => {
    const lifecycle = vi.fn(async () => ({ outcome: "done" }));
    fx.api.set("local", { projectLifecycle: lifecycle });
    fx.sidebars.set("local", sidebarWith([project("p0")]));
    fx.lease.mockResolvedValueOnce({ ok: false, busy: { kind: "pause", total: 4 } });
    expect(await startProjectBatch("archive", [facts("p0")])).toBeNull();
    expect(projectBatchRunning()).toBe(false);
    expect(fx.read).not.toHaveBeenCalled();
    expect(lifecycle).not.toHaveBeenCalled();
    // Main not answering is not a grant either.
    fx.lease.mockRejectedValueOnce(new Error("starting up"));
    expect(await startProjectBatch("archive", [facts("p0")])).toBeNull();
    expect(lifecycle).not.toHaveBeenCalled();
    // Free again: it runs.
    expect((await startProjectBatch("archive", [facts("p0")]))!.map((r) => r.status)).toEqual(["done"]);
  });
  it("pauses from the narrow run-control read, skips a paused project, and reports a pause still settling apart from done", async () => {
    const control = (phase: string) => ({ epoch: 3, phase, scope: "all", pauseId: phase === "paused" ? "pz" : null, allowedActions: { pause: true, pauseAll: true, resume: phase === "paused" } });
    const controls: Record<string, unknown> = { a: control("running"), b: control("paused"), c: control("running"), d: control("running") };
    const action = vi.fn(async (id: string) => (id === "c" ? { outcome: "settling" } : id === "d" ? { outcome: "unknown" } : { outcome: "done" }));
    const snapshot = vi.fn();
    fx.api.set("local", { projectBatchRunControl: async (id: string) => controls[id], projectBatchControl: action, delegationUpgradeSnapshot: snapshot });
    const out = await startProjectBatch("pause", ["a", "b", "c", "d"].map((id) => facts(id)));
    expect(out!.map((r) => r.status)).toEqual(["done", "skipped", "settling", "unknown"]);
    expect(action).toHaveBeenCalledWith("a", expect.objectContaining({ kind: "pause", mode: "afterTurn", scope: "all", expectedEpoch: 3 }));
    expect(snapshot).not.toHaveBeenCalled();
    expect(fx.refresh.mock.calls.map((c) => c[0])).toEqual(["local"]);
    const resumed = await startProjectBatch("resume", ["a", "b"].map((id) => facts(id)));
    expect(resumed!.map((r) => r.status)).toEqual(["skipped", "done"]);
    expect(action).toHaveBeenLastCalledWith("b", expect.objectContaining({ kind: "resume", pauseId: "pz", expectedEpoch: 3 }));
  });
  it("skips only a pause of every member: a members-only pause gets the whole-project pause where allowed", async () => {
    const control = (scope: string, pauseAll: boolean) => ({ epoch: 4, phase: "paused", scope, pauseId: "pm", allowedActions: { pause: false, pauseAll, resume: true } });
    const controls: Record<string, unknown> = { all: control("all", false), members: control("members", true), stuck: control("members", false) };
    const action = vi.fn(async () => ({ outcome: "settling" }));
    fx.api.set("local", { projectBatchRunControl: async (id: string) => controls[id], projectBatchControl: action });
    const out = await startProjectBatch("pause", ["all", "members", "stuck"].map((id) => facts(id)));
    expect(out!.map((r) => [r.status, r.error ?? null])).toEqual([["skipped", null], ["settling", null], ["failed", "pause_not_allowed"]]);
    expect(action).toHaveBeenCalledExactlyOnceWith("members", expect.objectContaining({ kind: "pause", scope: "all", expectedEpoch: 4 }));
  });
  it("runs one batch at a time", async () => {
    const gate = deferred<{ outcome: "done" }>();
    fx.api.set("local", { projectLifecycle: vi.fn(() => gate.promise) });
    fx.sidebars.set("local", sidebarWith([project("a"), project("b")]));
    const first = startProjectBatch("archive", [facts("a")]);
    await vi.waitFor(() => expect(fx.api.get("local").projectLifecycle).toHaveBeenCalled());
    expect(projectBatchRunning()).toBe(true);
    expect(await startProjectBatch("archive", [facts("b")])).toBeNull();
    gate.resolve({ outcome: "done" });
    expect((await first)!.map((r) => r.status)).toEqual(["done"]);
    expect(projectBatchRunning()).toBe(false);
  });
});

describe("AllProjects", () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); fx.features.clear(); fx.open.mockClear(); fx.api.clear(); fx.sidebars.clear(); fx.refresh.mockReset().mockResolvedValue(undefined); resetProjectBatch();
    fx.read.mockReset().mockImplementation(async (h: string) => { const s = fx.sidebars.get(h); if (!s) throw new Error("unread"); return s; });
    fx.lease.mockReset().mockImplementation(async (r: { op: string; token?: string }) => ({ ok: true, token: r.token ?? "t1" }));
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const mount = async (list: readonly ProjectFacts[], newProject = vi.fn()) => { await act(async () => root.render(h(AllProjects, { facts: list, newProject }))); return newProject; };
  const unmount = async () => { await act(async () => root.render(h("div"))); };
  const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) ?? null;
  const rowKeys = () => [...host.querySelectorAll("[data-projects-row]")].map((x) => x.getAttribute("data-projects-row"));
  const checked = () => [...host.querySelectorAll("[data-projects-row]")].filter((x) => x.querySelector('[role="checkbox"]')?.getAttribute("aria-checked") === "true").map((x) => x.getAttribute("data-projects-row"));
  const typeSearch = async (text: string) => {
    const input = host.querySelector("[data-projects-filters] input") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const archiveAll = async () => {
    await click(host.querySelectorAll('[role="checkbox"]')[0]!); // 全选
    await click(button("归档所选"));
    await click(host.querySelector('[data-projects-armed="archive"]'));
  };

  it("shows each project with its host chip and figures, and opens it", async () => {
    await mount([facts("alpha"), facts("beta", "ws")]);
    expect(rowKeys()).toHaveLength(2);
    expect([...host.querySelectorAll("[data-host-chip]")].map((x) => x.textContent).sort()).toEqual(["EVA", "workstation"]);
    expect(host.querySelector("[data-projects-figures]")?.textContent).toContain("2 个项目");
    await click(host.querySelector('[data-projects-open="ws:beta"]'));
    expect(fx.open).toHaveBeenCalledWith("beta", undefined, "ws");
  });

  it("marks the online total partial when a project's figures are unknown", async () => {
    const unknown = { ...facts("gamma", "ws"), online: null, needsYou: null };
    await mount([facts("alpha"), unknown]);
    const figures = host.querySelector("[data-projects-figures]")?.textContent ?? "";
    expect(figures).toContain("1 / 1 个成员在线（1 个项目读不到）");
  });

  it("archives the selection only after a second click, and disables 移到主机 and an unsupported pause with the reason", async () => {
    const calls: string[] = [];
    fx.api.set("local", { projectLifecycle: vi.fn(async (id: string) => { calls.push(id); return { outcome: "done" }; }) });
    fx.sidebars.set("local", sidebarWith([project("alpha"), project("beta")]));
    await mount([facts("alpha"), facts("beta")]);
    await click(host.querySelectorAll('[role="checkbox"]')[0]!);
    expect(host.querySelector("[data-projects-batch]")?.textContent).toContain("已选 2 个 · 2 个成员");
    expect(button("移到主机")?.disabled).toBe(true);
    expect(button("移到主机")?.getAttribute("title")).toBe("cutex 还不能把项目移到另一台主机");
    expect(button("暂停成员")?.disabled).toBe(true);
    expect(button("暂停成员")?.getAttribute("title")).toContain("还不能暂停整个项目");
    await click(button("归档所选"));
    expect(calls).toEqual([]);
    const armed = host.querySelector('[data-projects-armed="archive"]');
    expect(armed?.textContent).toBe("再左键点击一次归档 2 个");
    await click(armed);
    await vi.waitFor(() => expect(host.querySelector('[data-projects-progress="done"]')).not.toBeNull());
    expect(calls.sort()).toEqual(["alpha", "beta"]);
  });

  it("enables the whole-project pause where every picked host has run control", async () => {
    fx.features.set("local", new Set([table.PROJECT_RUN_CONTROL_FEATURE]));
    await mount([facts("alpha")]);
    await click(host.querySelectorAll('[role="checkbox"]')[1]!);
    expect(button("暂停成员")?.disabled).toBe(false);
  });

  it("keeps a batch running and its guard when the page is left, and shows it on return", async () => {
    const gate = deferred<{ outcome: "done" }>();
    fx.api.set("local", { projectLifecycle: vi.fn(() => gate.promise) });
    fx.sidebars.set("local", sidebarWith([project("alpha"), project("beta")]));
    await mount([facts("alpha"), facts("beta")]);
    await archiveAll();
    await vi.waitFor(() => expect(fx.api.get("local").projectLifecycle).toHaveBeenCalled());
    await unmount(); // opened a project / 新建项目
    await mount([facts("alpha"), facts("beta")]);
    expect(host.querySelector('[data-projects-progress="running"]')).not.toBeNull();
    // No second batch: the bar is locked, and so are the filters.
    expect(button("归档所选")?.disabled).toBe(true);
    expect((host.querySelector("[data-projects-filters] input") as HTMLInputElement).disabled).toBe(true);
    await act(async () => { gate.resolve({ outcome: "done" }); });
    await vi.waitFor(() => expect(host.querySelector('[data-projects-progress="done"]')).not.toBeNull());
    expect(fx.api.get("local").projectLifecycle).toHaveBeenCalledTimes(2);
  });

  it("keeps what failed or is unknown selected and in view after a partial failure, whatever the filter", async () => {
    fx.api.set("local", { projectLifecycle: vi.fn(async (id: string) => (id === "alpha" ? { outcome: "refused", code: "project_revision_conflict" } : id === "beta" ? { outcome: "unknown" } : { outcome: "done" })) });
    fx.sidebars.set("local", sidebarWith([project("alpha"), project("beta"), project("gamma")]));
    await mount([facts("alpha"), facts("beta"), facts("gamma")]);
    await archiveAll();
    await vi.waitFor(() => expect(host.querySelector('[data-projects-progress="done"]')).not.toBeNull());
    expect(host.querySelector("[data-projects-unknown]")?.textContent).toContain("再操作前会先重新读取");
    expect(checked().sort()).toEqual(["local:alpha", "local:beta"]);
    await typeSearch("gamma");
    expect(rowKeys().sort()).toEqual(["local:alpha", "local:beta", "local:gamma"]);
    expect(checked().sort()).toEqual(["local:alpha", "local:beta"]);
    // Left and back: still selected.
    await unmount();
    await mount([facts("alpha"), facts("beta"), facts("gamma")]);
    expect(checked().sort()).toEqual(["local:alpha", "local:beta"]);
    // Closing the results lets the filter rule again.
    await click(button("关闭"));
    await typeSearch("gamma");
    expect(rowKeys()).toEqual(["local:gamma"]);
  });

  it("tells the owner when another window's batch is running and nothing was sent", async () => {
    const lifecycle = vi.fn(async () => ({ outcome: "done" }));
    fx.api.set("local", { projectLifecycle: lifecycle });
    fx.sidebars.set("local", sidebarWith([project("alpha")]));
    fx.lease.mockResolvedValueOnce({ ok: false, busy: { kind: "archive", total: 3 } });
    await mount([facts("alpha")]);
    await archiveAll();
    await vi.waitFor(() => expect(host.querySelector('[data-projects-elsewhere="archive"]')).not.toBeNull());
    expect(host.querySelector("[data-projects-elsewhere]")?.textContent).toContain("另一个窗口正在归档 3 个项目");
    expect(lifecycle).not.toHaveBeenCalled();
    expect(button("归档所选")?.disabled).toBe(false);
    await click(button("关闭"));
    expect(host.querySelector("[data-projects-elsewhere]")).toBeNull();
  });

  it("offers 新建项目 when there is no project", async () => {
    const create = await mount([]);
    const empty = host.querySelector("[data-projects-empty]");
    expect(empty).not.toBeNull();
    await click(empty!.querySelector("button"));
    expect(create).toHaveBeenCalled();
  });
});

describe("English counted strings", () => {
  it("never reads 「1 projects」 / 「1 members」: every counted key has a singular where it needs one", async () => {
    const { en } = await import("../src/renderer/src/modules/projects/i18n.en");
    const catalog = en as Record<string, string>;
    const offenders: string[] = [];
    for (const [key, text] of Object.entries(catalog)) {
      if (key.endsWith(".one") || !text.includes("{n}")) continue;
      const used = catalog[`${key}.one`] ?? text;
      const one = used.replace(/\{n\}/g, "1").replace(/\{(\w+)\}/g, "2");
      // 「1 needs you」 is a verb, not a plural.
      if (/\b1 (?!of\b|needs\b)[a-z]+s\b/.test(one) || /\bof 1 [a-z]+s\b/.test(one)) offenders.push(`${key}: ${one}`);
    }
    expect(offenders).toEqual([]);
  });
});
