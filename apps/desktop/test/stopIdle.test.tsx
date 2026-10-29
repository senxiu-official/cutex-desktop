// @vitest-environment jsdom
// Design 031: stop idle agents. cutex classifies (GET /v2/runtimes/idle); the desktop shows the verdicts,
// adds only the device-local pin as a caution, sends the owner's ticks and can bring the stopped back.
// Refined (owner 2026-10-25): one dialog for any scope (the entry decides the first, a dropdown changes it); the idle
// time only pre-ticks (cutex is asked with 0, any listed agent can be ticked; custom 0 = all); rows grouped by project;
// 🔒 only-the-owner-can-start explained once under 下线; the never-stopped folded into 未列入; one menu submenu.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { IdleAgent, IdleRuntimes, StopIdleRequest } from "../src/shared/stopIdle";

const fx = vi.hoisted(() => ({
  features: new Set<string>(["stop-idle-agents"]),
  pinned: new Set<string>(),
  listing: null as IdleRuntimes | null,
  stopped: [] as StopIdleRequest[],
  actions: [] as [string, string][],
  idleCalls: [] as { minIdleSecs: number; projectId?: string }[],
}));
vi.mock("../src/renderer/src/store", () => ({
  featuresOf: () => fx.features,
  pinnedOn: () => fx.pinned,
  sidebarOf: () => ({ projects: { projects: [{ project_id: "p1", presentation: { display_name: "Waveline" } }] } }),
  hostApi: () => ({
    idleRuntimes: vi.fn(async (q: { minIdleSecs: number; projectId?: string }) => (fx.idleCalls.push(q), fx.listing)),
    stopIdle: vi.fn(async (body: StopIdleRequest) => {
      fx.stopped.push(body);
      return { mode: body.mode, dryRun: false, results: body.sessionIds.map((id, i) => (i === 0 ? { cutexSessionId: id, result: "skipped", reasons: ["activeTurn"] } : { cutexSessionId: id, result: "stopped", reasons: [] })) };
    }),
  }),
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), {
    getState: () => ({ hosts: { active: "local", hosts: [{ id: "local", label: "HOST-A" }] }, sessionAction: async (id: string, method: string) => void fx.actions.push([id, method]) }),
  }),
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k}(${Object.values(v).join(",")})` : k) }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lib = await import("../src/renderer/src/lib/stopIdle");
const { StopIdleDialog } = await import("../src/renderer/src/components/StopIdleDialog");
const t = (k: string) => k;

const agent = (id: string, verdict: IdleAgent["verdict"], idleSecs: number, reasons: IdleAgent["reasons"] = [], projectId: string | null = "p1"): IdleAgent => ({
  cutexSessionId: id, name: id, projectId, runtime: "codex", idleSince: null, idleSecs, verdict, reasons,
});

beforeEach(() => {
  fx.features = new Set(["stop-idle-agents"]);
  fx.pinned = new Set();
  fx.stopped = [];
  fx.actions = [];
  lib.closeStopIdle();
});

// Owner 2026-10-24: never the Director, never an agent waiting on its own delegations — blocked here, whatever cutex says.
it("the Director and an agent awaiting its delegations can never be ticked", () => {
  const rows = lib.idleRows([agent("d", "caution", 100, ["director"], null), agent("w", "stoppable", 100, ["awaitingDelegations"]), agent("ok", "stoppable", 100)], {}, new Set());
  expect(rows.map((r) => [r.cutexSessionId, r.verdict, r.preselect, r.selectable])).toEqual([
    ["ok", "stoppable", true, true],
    ["d", "blocked", false, false],
    ["w", "blocked", false, false],
  ]);
  expect(lib.blockingReasons(rows[1]!)).toEqual(["director"]);
});

it("rows: a pinned stoppable agent is a caution, blocked rows cannot be ticked, independent scope filters", () => {
  fx.pinned = new Set(["b"]);
  const rows = lib.idleRows([agent("a", "stoppable", 3600), agent("b", "stoppable", 7200), agent("c", "blocked", 9000, ["activeTurn"]), agent("d", "caution", 100, ["director"], null)], {}, fx.pinned);
  expect(rows.map((r) => [r.cutexSessionId, r.verdict, r.preselect, r.selectable])).toEqual([
    ["a", "stoppable", true, true],
    ["b", "caution", false, true],
    ["c", "blocked", false, false],
    ["d", "blocked", false, false],
  ]);
  expect(rows[1]!.reasons).toEqual(["pinned"]);
  expect(lib.idleRows([agent("a", "stoppable", 1), agent("d", "stoppable", 1, [], null)], { independent: true }, new Set()).map((r) => r.cutexSessionId)).toEqual(["d"]);
});


it("the menu: one submenu (下线空闲的…) with the quick 30-minute row and 选择…, only with the capability", () => {
  fx.features = new Set();
  expect(lib.stopIdleMenuEntries({ hostId: "local", label: "HOST-A" }, t)).toEqual([]);
  expect(lib.hostStopIdleEntries(t)).toEqual([]);
  fx.features = new Set(["stop-idle-agents"]);
  const entries = lib.stopIdleMenuEntries({ hostId: "local", label: "HOST-A" }, t) as { label: string; submenu?: { label: string }[] }[];
  expect(entries.map((e) => e.label)).toEqual(["stopIdle.menu"]);
  expect(entries[0]!.submenu!.map((s) => s.label)).toEqual(["stopIdle.quickHost", "stopIdle.review"]);
  const project = lib.stopIdleMenuEntries({ hostId: "local", projectId: "p1", label: "W" }, t) as { submenu?: { label: string }[] }[];
  expect(project[0]!.submenu!.map((s) => s.label)).toEqual(["stopIdle.quickProject", "stopIdle.review"]);
  expect(lib.hostStopIdleEntries(t).at(-1)).toBe("separator");
});

it("custom idle time: whole numbers of minutes / hours / days, 0 = all", () => {
  expect(lib.customIdleSecs("0", "m")).toBe(0);
  expect(lib.customIdleSecs("0", "d")).toBe(0);
  expect(lib.customIdleSecs("45", "m")).toBe(2700);
  expect(lib.customIdleSecs("-1", "m")).toBeNull();
  expect(lib.customIdleSecs("", "m")).toBeNull();
});

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(h(StopIdleDialog)));
  return {
    host,
    rows: () => [...host.querySelectorAll<HTMLElement>("[data-testid=stop-idle-row]")],
    ticked: () => [...host.querySelectorAll<HTMLElement>("[data-testid=stop-idle-row]")].filter((r) => r.querySelector("[role=checkbox]")!.getAttribute("aria-checked") === "true").map((r) => r.querySelector("[role=checkbox]")!.getAttribute("aria-label")),
    confirm: () => host.querySelector<HTMLButtonElement>("[data-testid=stop-idle-confirm]")!,
    done: () => {
      act(() => root.unmount());
      host.remove();
      lib.closeStopIdle();
    },
  };
}

it("lists with 0, ticks the stoppable, folds the blocked into 未列入, takes the ticked offline with 0 and the mode, 撤销 brings them back", async () => {
  fx.idleCalls.length = 0;
  fx.listing = { now: "", minIdleSecs: 0, projectId: null, agents: [agent("a", "stoppable", 3600), agent("b", "stoppable", 5000), agent("c", "caution", 4000, ["awaitingDelegations"]), agent("x", "blocked", 9999, ["ownerQueue"])] };
  const d = mount();
  await act(async () => lib.openStopIdle({ hostId: "local", label: "HOST-A" }));
  expect(fx.idleCalls).toEqual([{ minIdleSecs: 0 }]);
  expect(d.rows().map((r) => r.getAttribute("data-verdict"))).toEqual(["stoppable", "stoppable"]);
  const skipped = d.host.querySelector("[data-testid=stop-idle-skipped]")!;
  expect(skipped.querySelector("summary")!.textContent).toBe("stopIdle.notListed(2)stopIdle.reason.ownerQueue 1 · stopIdle.reason.awaitingDelegations 1");
  expect(d.confirm().textContent).toBe("stopIdle.confirmWakeable(2)");
  // Blocked ones cannot be ticked, whatever is clicked.
  act(() => lib.toggleIdleRow("c"));
  act(() => lib.setIdleTicks(["x"], true));
  act(() => lib.setStopIdleMode("stopped"));
  expect(d.confirm().textContent).toBe("stopIdle.confirmStopped(2)");
  await act(async () => d.confirm().click());
  expect(fx.stopped[0]).toMatchObject({ sessionIds: ["b", "a"], minIdleSecs: 0, mode: "stopped" });
  const result = d.host.querySelector("[data-testid=stop-idle-result]")!.textContent;
  expect(result).toContain("stopIdle.doneStopped(1)");
  expect(result).toContain("stopIdle.reason.activeTurn");
  await act(async () => d.host.querySelector<HTMLButtonElement>("[data-testid=stop-idle-undo]")!.click());
  expect(fx.actions).toEqual([["a", "cutex/runtime/online"]]);
  d.done();
});

it("the idle time only pre-ticks: shorter ones are listed and can be ticked; the owner's ticks survive a new time; 按空闲时间重选 forgets them", async () => {
  fx.idleCalls.length = 0;
  fx.listing = { now: "", minIdleSecs: 0, projectId: "p1", agents: [agent("long", "stoppable", 7200), agent("short", "stoppable", 300), agent("unknown", "stoppable", null as never)] };
  const d = mount();
  await act(async () => lib.openStopIdle({ hostId: "local", projectId: "p1", label: "Waveline" }));
  expect(fx.idleCalls).toEqual([{ minIdleSecs: 0, projectId: "p1" }]);
  expect(d.ticked()).toEqual(["long"]);
  expect(d.rows().filter((r) => r.hasAttribute("data-under")).length).toBe(2);
  // Tick the 5-minute one by hand (a click on its box).
  act(() => d.rows()[1]!.querySelector<HTMLButtonElement>("[role=checkbox]")!.click());
  expect(d.ticked()).toEqual(["long", "short"]);
  // 3 hours: long is no longer pre-ticked, short stays (ticked by hand); no new listing.
  const chips = () => [...d.host.querySelectorAll<HTMLButtonElement>("[data-testid=stop-idle-threshold] button")];
  act(() => chips()[3]!.click());
  expect(fx.idleCalls).toHaveLength(1);
  expect(d.ticked()).toEqual(["short"]);
  // 全部 (0): every stoppable one, unknown idle time too.
  act(() => chips()[0]!.click());
  expect(d.ticked()).toEqual(["long", "short", "unknown"]);
  // A custom 0 is the same; 30 minutes and 重选 forget the hand tick.
  const custom = d.host.querySelector<HTMLInputElement>("[data-testid=stop-idle-custom]")!;
  act(() => lib.setIdleThreshold(1800));
  act(() => lib.resetIdleTicks());
  expect(d.ticked()).toEqual(["long"]);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(custom, "0");
    custom.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(lib.useStopIdle.getState().minIdleSecs).toBe(0);
  expect(d.ticked()).toEqual(["long", "short", "unknown"]);
  d.done();
});

it("one dialog for any scope: the dropdown lists 所有项目 / each project / 独立 and keeps the time and the owner's ticks", async () => {
  fx.idleCalls.length = 0;
  fx.listing = { now: "", minIdleSecs: 0, projectId: null, agents: [agent("a", "stoppable", 7200), agent("b", "stoppable", 60), agent("i", "stoppable", 7200, [], null)] };
  const d = mount();
  await act(async () => lib.openStopIdle({ hostId: "local", projectId: "p1", label: "Waveline" }));
  const select = () => d.host.querySelector<HTMLSelectElement>("[data-testid=stop-idle-scope]")!;
  expect([...select().options].map((o) => [o.value, o.textContent])).toEqual([["all", "stopIdle.scope.all"], ["p:p1", "Waveline"], ["independent", "stopIdle.scope.independent"]]);
  expect(select().value).toBe("p:p1");
  act(() => lib.toggleIdleRow("b"));
  await act(async () => {
    select().value = "all";
    select().dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(fx.idleCalls).toEqual([{ minIdleSecs: 0, projectId: "p1" }, { minIdleSecs: 0 }]);
  expect(select().value).toBe("all");
  // All projects: a group per project (independent last) with a box ticking the whole group.
  const groups = () => [...d.host.querySelectorAll<HTMLElement>("[data-testid=stop-idle-group]")];
  expect(groups().map((g) => g.getAttribute("data-project"))).toEqual(["p1", ""]);
  expect(d.ticked()).toEqual(["a", "b", "i"]);
  const box = groups()[0]!.querySelector<HTMLButtonElement>("h3 [role=checkbox]")!;
  expect(box.getAttribute("aria-checked")).toBe("true");
  act(() => box.click());
  expect(d.ticked()).toEqual(["i"]);
  act(() => d.rows()[0]!.querySelector<HTMLButtonElement>("[role=checkbox]")!.click());
  expect(groups()[0]!.querySelector("h3 [role=checkbox]")!.getAttribute("aria-checked")).toBe("mixed");
  // The independent scope: only agents without a project, no group headers.
  await act(async () => {
    select().value = "independent";
    select().dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(d.rows().map((r) => r.querySelector("[role=checkbox]")!.getAttribute("aria-label"))).toEqual(["i"]);
  expect(d.host.querySelector("h3")).toBeNull();
  d.done();
});

it("only-the-owner-can-start agents: a lock on the row, said once under 下线, ticked as usual", async () => {
  fx.listing = { now: "", minIdleSecs: 0, projectId: "p1", agents: [agent("a", "stoppable", 7200, ["ownerStartOnly"]), agent("b", "stoppable", 7200, ["ownsServices"])] };
  const d = mount();
  await act(async () => lib.openStopIdle({ hostId: "local", projectId: "p1", label: "Waveline" }));
  expect(d.ticked()).toEqual(["a", "b"]);
  expect(d.rows()[0]!.querySelector("[data-stop-idle-lock]")).not.toBeNull();
  // No repeated reason text on the rows.
  expect(d.rows()[0]!.textContent).not.toContain("stopIdle.reason.ownerStartOnly");
  expect(d.host.querySelector("[data-testid=stop-idle-start-only]")!.textContent).toBe("stopIdle.startOnlySome(1)");
  act(() => lib.toggleIdleRow("b"));
  expect(d.host.querySelector("[data-testid=stop-idle-start-only]")!.textContent).toBe("stopIdle.startOnlyAll");
  act(() => lib.toggleIdleRow("a"));
  expect(d.host.querySelector("[data-testid=stop-idle-start-only]")).toBeNull();
  d.done();
});
