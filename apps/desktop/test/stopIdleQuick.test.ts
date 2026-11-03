// Design 031 (owner 2026-10-23): taking idle agents offline from a menu is medium risk — the row counts first,
// arms in place (「下线 N 个？再点一次」), acts on the second click, and a toast offers 撤销. Only the clear
// 会停的 set goes: cautions, pinned and blocked ones stay out. Owner 2026-10-25: one submenu (下线空闲的… ›) with
// this 30-minute row and 选择… (the dialog).
import { beforeEach, expect, it, vi } from "vitest";
import type { IdleAgent, IdleRuntimes, StopIdleRequest } from "../src/shared/stopIdle";

const fx = vi.hoisted(() => ({
  listing: null as IdleRuntimes | null,
  pinned: new Set<string>(),
  asked: [] as { minIdleSecs: number; projectId?: string }[],
  stopped: [] as StopIdleRequest[],
  actions: [] as [string, string][],
  start: null as null | ((id: string, host: string) => Promise<void>),
  toasts: [] as { text: string; undo?: () => void }[],
}));
vi.mock("../src/renderer/src/store", () => ({
  featuresOf: () => new Set(["stop-idle-agents"]),
  pinnedOn: () => fx.pinned,
  hostApi: () => ({
    idleRuntimes: async (q: { minIdleSecs: number; projectId?: string }) => (fx.asked.push(q), fx.listing),
    stopIdle: async (body: StopIdleRequest) => (fx.stopped.push(body), { mode: body.mode, dryRun: false, results: body.sessionIds.map((id, i) => (i === 0 ? { cutexSessionId: id, result: "skipped", reasons: ["activeTurn"] } : { cutexSessionId: id, result: "stopped" })) }),
  }),
  useApp: { getState: () => ({ hosts: { active: "other", hosts: [{ id: "local", label: "HOST-A" }] }, notify: () => {}, sessionAction: async (id: string, method: string, _params: unknown, host: string) => { fx.actions.push([id, method]); await fx.start?.(id, host); } }) },
}));
vi.mock("../src/renderer/src/lib/shelves", () => ({ showShelfToast: (text: string, undo?: () => void) => void fx.toasts.push({ text, undo }) }));
const lib = await import("../src/renderer/src/lib/stopIdle");
const { selectStep } = await import("../src/renderer/src/lib/contextMenu");
const t = (k: string, v?: Record<string, unknown>) => (v ? `${k}(${Object.values(v).join(",")})` : k);

const agent = (id: string, verdict: IdleAgent["verdict"], reasons: IdleAgent["reasons"] = []): IdleAgent => ({ cutexSessionId: id, name: id, projectId: "p1", runtime: "codex", idleSince: null, idleSecs: 5000, verdict, reasons });
type Row = { label: string; prepare?: () => Promise<{ armed: string } | { empty: string }>; onSelect(): void | Promise<void>; submenu?: Row[] };
const rows = (scope: Parameters<typeof lib.stopIdleMenuEntries>[0]) => (lib.stopIdleMenuEntries(scope, t as never) as Row[])[0]!.submenu!;

beforeEach(() => {
  fx.pinned = new Set();
  fx.asked = [];
  fx.stopped = [];
  fx.actions = [];
  fx.start = null;
  fx.toasts = [];
  fx.listing = { now: "", minIdleSecs: 1800, projectId: "p1", agents: [agent("a", "stoppable"), agent("b", "stoppable"), agent("c", "caution", ["awaitingDelegations"]), agent("d", "blocked", ["activeTurn"]), agent("e", "stoppable")] };
  fx.pinned = new Set(["e"]);
});

it("the project menu: count → arm in place → second click stops only the clear set → toast with 撤销 brings them back", async () => {
  const [direct] = rows({ hostId: "local", projectId: "p1", label: "Waveline" });
  // The row counts first: pinned (e), caution (c) and blocked (d) stay out.
  expect(selectStep(direct as never, null)).toBe("arm");
  expect(await direct!.prepare!()).toEqual({ armed: "stopIdle.armedProject(2)" });
  expect(fx.asked).toEqual([{ minIdleSecs: 1800, projectId: "p1" }]);
  expect(fx.stopped).toEqual([]);
  // The second click.
  await direct!.onSelect();
  expect(fx.stopped).toHaveLength(1);
  expect(fx.stopped[0]).toMatchObject({ sessionIds: ["a", "b"], minIdleSecs: 1800, mode: "wakeable" });
  // a was skipped by cutex (started work), b stopped.
  expect(fx.toasts.map((x) => x.text)).toEqual(["stopIdle.toastSkipped(1,1)"]);
  fx.toasts[0]!.undo!();
  await vi.waitFor(() => expect(fx.actions).toEqual([["b", "cutex/runtime/online"]]));
});

it("nothing idle: the row says so and stops nothing", async () => {
  fx.listing = { now: "", minIdleSecs: 1800, projectId: null, agents: [agent("d", "blocked", ["activeTurn"])] };
  const [direct] = rows({ hostId: "local", label: "HOST-A" });
  expect(await direct!.prepare!()).toEqual({ empty: "stopIdle.quickNone" });
  expect(fx.stopped).toEqual([]);
});

it("undo starts sequentially on the stopped host and continues when an individual start fails", async () => {
  let release!: () => void;
  const hosts: string[] = [];
  fx.start = async (id, host) => {
    hosts.push(host);
    if (id === "b") {
      await new Promise<void>(resolve => { release = resolve; });
      throw new Error("start failed");
    }
  };
  await lib.stopQuick({ hostId: "original", label: "Original" }, 1800, ["a", "b", "c"], t as never);
  fx.toasts[0]!.undo!();
  await vi.waitFor(() => expect(fx.actions).toEqual([["b", "cutex/runtime/online"]]));
  release();
  await vi.waitFor(() => expect(fx.actions).toEqual([["b", "cutex/runtime/online"], ["c", "cutex/runtime/online"]]));
  await vi.waitFor(() => expect(fx.toasts.at(-1)?.text).toBe("stopIdle.undone(1)"));
  expect(hosts).toEqual(["original", "original"]);
});

it("host entry: the same in-place row, no project filter; then 选择… (the dialog)", async () => {
  const host = rows({ hostId: "local", label: "HOST-A" });
  await host[0]!.prepare!();
  expect(fx.asked).toEqual([{ minIdleSecs: 1800 }]);
  expect(host.map((r) => r.label)).toEqual(["stopIdle.quickHost", "stopIdle.review"]);
  expect(rows({ hostId: "local", projectId: "p1", label: "W" }).map((r) => r.label)).toEqual(["stopIdle.quickProject", "stopIdle.review"]);
  expect(rows({ hostId: "local", independent: true, label: "I" }).map((r) => r.label)).toEqual(["stopIdle.quickIndependent", "stopIdle.review"]);
});
