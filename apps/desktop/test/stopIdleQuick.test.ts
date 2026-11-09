// Design 031 (owner 2026-10-23): taking idle agents offline from a menu is medium risk — the row counts first,
// arms in place (「下线 N 个？再点一次」), acts on the second click, and a toast offers 撤销. Only the clear
// 会停的 set goes: cautions, pinned and blocked ones stay out. Owner 2026-11-06: 下线空闲的… › scope (本项目 / 独立,
// its folder, the host) › idle time (30 分钟 / 1 小时 / 3 小时 / 1 天 / 所有空闲的), each with its count, then 选择….
import { beforeEach, expect, it, vi } from "vitest";
import type { IdleAgent, IdleRuntimes, StopIdleRequest } from "../src/shared/stopIdle";

const fx = vi.hoisted(() => ({
  agents: {} as Record<string, IdleAgent[]>,
  features: {} as Record<string, string[]>,
  pinned: new Set<string>(),
  asked: [] as { host: string; minIdleSecs: number; projectId?: string }[],
  stopped: [] as { host: string; body: StopIdleRequest }[],
  skip: new Set<string>(),
  actions: [] as [string, string, string][],
  start: null as null | ((id: string, host: string) => Promise<void>),
  toasts: [] as { text: string; undo?: () => void }[],
}));
vi.mock("../src/renderer/src/store", () => ({
  featuresOf: (_: unknown, host: string) => new Set(fx.features[host] ?? ["stop-idle-agents"]),
  pinnedOn: () => fx.pinned,
  sidebarOf: () => null,
  hostApi: (host: string) => ({
    // As cutex: the project filter, and too-recent agents blocked at the asked idle time.
    idleRuntimes: async (q: { minIdleSecs: number; projectId?: string }): Promise<IdleRuntimes> => {
      fx.asked.push({ host, ...q });
      const agents = (fx.agents[host] ?? [])
        .filter((a) => !q.projectId || a.projectId === q.projectId)
        .map((a) => (q.minIdleSecs > 0 && (a.idleSecs ?? 0) < q.minIdleSecs ? { ...a, verdict: "blocked" as const, reasons: [...a.reasons, "tooRecent" as const] } : a));
      return { now: "", minIdleSecs: q.minIdleSecs, projectId: q.projectId ?? null, agents };
    },
    stopIdle: async (body: StopIdleRequest) => (fx.stopped.push({ host, body }), { mode: body.mode, dryRun: false, results: body.sessionIds.map((id) => (fx.skip.has(id) ? { cutexSessionId: id, result: "skipped", reasons: ["activeTurn"] } : { cutexSessionId: id, result: "stopped" })) }),
  }),
  useApp: { getState: () => ({ hosts: { active: "local", hosts: [{ id: "local", label: "HOST-A" }] }, notify: () => {}, sessionAction: async (id: string, method: string, _params: unknown, host: string) => { fx.actions.push([host, id, method]); await fx.start?.(id, host); } }) },
}));
vi.mock("../src/renderer/src/lib/shelves", () => ({ showShelfToast: (text: string, undo?: () => void) => void fx.toasts.push({ text, undo }) }));
const lib = await import("../src/renderer/src/lib/stopIdle");
const { selectStep } = await import("../src/renderer/src/lib/contextMenu");
const { hostKey } = await import("../src/renderer/src/lib/hostKeys");
const t = (k: string, v?: Record<string, unknown>) => (v ? `${k}(${Object.values(v).join(",")})` : k);

const H = 3600;
const agent = (id: string, projectId: string | null, idleSecs: number | null, verdict: IdleAgent["verdict"] = "stoppable", reasons: IdleAgent["reasons"] = []): IdleAgent => ({ cutexSessionId: id, name: id, projectId, runtime: "codex", idleSince: null, idleSecs, verdict, reasons });
type Row = { label: string; hint?: string; info?: string; disabled?: boolean; prepare?: () => Promise<{ armed: string } | { empty: string }>; onSelect(): void | Promise<void>; submenu?: Row[] | (() => Promise<(Row | "separator")[]>) };
/** The 下线空闲的… submenu, opened. */
async function open(scopes: Parameters<typeof lib.stopIdleMenuEntries>[0]): Promise<(Row | "separator")[]> {
  const [entry] = lib.stopIdleMenuEntries(scopes, t as never) as Row[];
  return (entry!.submenu as () => Promise<(Row | "separator")[]>)();
}
const actions = (entries: readonly (Row | "separator")[]) => entries.filter((e): e is Row => e !== "separator");
const byLabel = (entries: readonly (Row | "separator")[], re: RegExp) => actions(entries).find((r) => re.test(r.label))!;
const counts = (entries: readonly (Row | "separator")[]) => actions(entries).filter((r) => r.hint !== undefined).map((r) => [r.label.replace(/\(.*$/, ""), r.hint]);
const stoppedOn = () => fx.stopped.map((s) => [s.host, s.body.sessionIds, s.body.minIdleSecs, s.body.mode]);

beforeEach(() => {
  fx.features = {};
  fx.pinned = new Set(["e"]);
  fx.asked = [];
  fx.stopped = [];
  fx.skip = new Set();
  fx.actions = [];
  fx.start = null;
  fx.toasts = [];
  fx.agents = {
    local: [
      agent("a", "p1", 1.5 * H),
      agent("b", "p1", 0.6 * H),
      agent("c", "p1", 30 * H, "caution", ["awaitingDelegations"]),
      agent("d", "p1", 30 * H, "blocked", ["activeTurn"]),
      agent("e", "p1", 30 * H), // pinned
      agent("h", "p1", 30 * H, "caution", ["director"]),
      agent("i", "p1", 30 * H, "blocked", ["ownerQueue"]),
      agent("j", "p1", null),
      agent("f", "p2", 25 * H),
      agent("g", null, 0.2 * H),
    ],
    remote: [agent("r1", "p9", 1.2 * H), agent("r2", null, 28 * H), agent("r3", "p8", 28 * H), agent("r4", "p9", 28 * H, "blocked", ["pendingRequest"])],
  };
});

it("project header: scopes 本项目 / its folder / the host, each with the count it would take offline at any idle time", async () => {
  const folder = lib.folderIdleScope("生活", [hostKey("local", "p1"), hostKey("local", "p2")]);
  const menu = await open([lib.projectIdleScope("local", "p1", "Waveline"), folder, lib.hostIdleScope("local", "HOST-A")]);
  // Working, waiting, pinned, the Director and agents awaiting delegations never count: a, b, j in p1; + f in the folder; + g on the host.
  expect(counts(menu)).toEqual([["stopIdle.scopeProject", "3"], ["stopIdle.scopeFolder", "4"], ["stopIdle.scopeHost", "5"]]);
  expect(actions(menu).map((r) => r.label)).toEqual(["stopIdle.scopeProject(Waveline)", "stopIdle.scopeFolder(生活)", "stopIdle.scopeHost(HOST-A)", "stopIdle.review"]);
  expect(menu.at(-2)).toBe("separator");
  // Each scope › its idle times with their counts.
  const durations = (re: RegExp) => counts(byLabel(menu, re).submenu as Row[]).map(([, n]) => n);
  expect(durations(/scopeProject/)).toEqual(["2", "1", "0", "0", "3"]);
  expect(durations(/scopeFolder/)).toEqual(["3", "2", "1", "1", "4"]);
  expect(durations(/scopeHost/)).toEqual(["3", "2", "1", "1", "5"]);
  expect((byLabel(menu, /scopeProject/).submenu as Row[]).map((r) => r.label)).toEqual(["stopIdle.idleOver(stopIdle.preset.30m)", "stopIdle.idleOver(stopIdle.preset.1h)", "stopIdle.idleOver(stopIdle.preset.3h)", "stopIdle.idleOver(stopIdle.preset.1d)", "stopIdle.idleAny"]);
  // Counted from one listing per host at 0, nothing stopped yet.
  expect(fx.asked.every((q) => q.minIdleSecs === 0)).toBe(true);
  expect(fx.stopped).toEqual([]);
});

it("an idle time: says what it does, counts again at that time, arms in place, the second click stops only that set; 撤销 brings them back", async () => {
  const menu = await open(lib.projectIdleScope("local", "p1", "Waveline"));
  // One scope: the idle times stand directly in the submenu, then 选择….
  expect(actions(menu).map((r) => r.label).at(-1)).toBe("stopIdle.review");
  const hour = byLabel(menu, /preset\.1h/);
  expect(hour.info).toBe("stopIdle.rowInfo(Waveline,stopIdle.preset.1h,1)");
  expect(byLabel(menu, /idleAny/).info).toBe("stopIdle.rowInfoAny(Waveline,,3)");
  fx.asked = [];
  expect(selectStep(hour as never, null)).toBe("arm");
  expect(await hour.prepare!()).toEqual({ armed: "stopIdle.armedScope(Waveline,1)" });
  expect(fx.asked).toEqual([{ host: "local", minIdleSecs: 3600, projectId: "p1" }]);
  expect(fx.stopped).toEqual([]);
  await hour.onSelect();
  expect(stoppedOn()).toEqual([["local", ["a"], 3600, "wakeable"]]);
  expect(fx.toasts.map((x) => x.text)).toEqual(["stopIdle.done(1)"]);
  fx.toasts[0]!.undo!();
  await vi.waitFor(() => expect(fx.actions).toEqual([["local", "a", "cutex/runtime/online"]]));
});

it("busy, waiting, pinned, Director and delegation-waiting agents are never taken: 所有空闲的 on the host", async () => {
  const any = byLabel(await open(lib.hostIdleScope("local", "HOST-A")), /idleAny/);
  await any.prepare!();
  await any.onSelect();
  expect(stoppedOn()).toEqual([["local", ["f", "a", "b", "g", "j"], 0, "wakeable"]]);
  expect(fx.asked.at(-1)).toEqual({ host: "local", minIdleSecs: 0 });
});

it("per idle time: the set shrinks with the time (cutex's own tooRecent at that time)", async () => {
  const menu = await open(lib.hostIdleScope("local", "HOST-A"));
  const ids = async (re: RegExp) => {
    fx.stopped = [];
    const row = byLabel(menu, re);
    await row.prepare!();
    await row.onSelect();
    return fx.stopped.flatMap((s) => s.body.sessionIds);
  };
  expect(await ids(/preset\.30m/)).toEqual(["f", "a", "b"]);
  expect(await ids(/preset\.1h/)).toEqual(["f", "a"]);
  expect(await ids(/preset\.3h/)).toEqual(["f"]);
  expect(await ids(/preset\.1d/)).toEqual(["f"]);
});

it("independent agents: only those without a project", async () => {
  const menu = await open(lib.projectIdleScope("local", null, "独立"));
  expect(counts(menu).map(([, n]) => n)).toEqual(["0", "0", "0", "0", "1"]);
  const any = byLabel(menu, /idleAny/);
  expect(await any.prepare!()).toEqual({ armed: "stopIdle.armedScope(独立,1)" });
  await any.onSelect();
  expect(stoppedOn()).toEqual([["local", ["g"], 0, "wakeable"]]);
});

it("a folder over two hosts: each host stops its own agents (same cutex action), one toast, 撤销 on each host", async () => {
  const folder = lib.folderIdleScope("生活", [hostKey("local", "p2"), hostKey("remote", "p9"), hostKey("remote", "__independent__")]);
  expect(folder.targets.map((x) => [x.hostId, [...x.projects!]])).toEqual([["local", ["p2"]], ["remote", ["p9", null]]]);
  const menu = await open(folder);
  // No 选择…: the dialog shows one host.
  expect(actions(menu).map((r) => r.label)).not.toContain("stopIdle.review");
  expect(counts(menu).map(([, n]) => n)).toEqual(["3", "3", "2", "2", "3"]);
  const hour = byLabel(menu, /preset\.1h/);
  expect(await hour.prepare!()).toEqual({ armed: "stopIdle.armedScope(生活,3)" });
  fx.skip = new Set(["r2"]);
  await hour.onSelect();
  expect(stoppedOn()).toEqual([["local", ["f"], 3600, "wakeable"], ["remote", ["r2", "r1"], 3600, "wakeable"]]);
  expect(fx.toasts.map((x) => x.text)).toEqual(["stopIdle.toastSkipped(2,1)"]);
  fx.toasts[0]!.undo!();
  await vi.waitFor(() => expect(fx.actions).toEqual([["local", "f", "cutex/runtime/online"], ["remote", "r1", "cutex/runtime/online"]]));
  await vi.waitFor(() => expect(fx.toasts.at(-1)?.text).toBe("stopIdle.undone(2)"));
});

it("a host without the capability is left out of a folder; no capable host = no entry", async () => {
  fx.features = { remote: [] };
  const folder = lib.folderIdleScope("生活", [hostKey("local", "p2"), hostKey("remote", "p9")]);
  const menu = await open(folder);
  expect(counts(menu).map(([, n]) => n)).toEqual(["1", "1", "1", "1", "1"]);
  expect(fx.asked.map((q) => q.host)).toEqual(["local"]);
  expect(lib.stopIdleMenuEntries(lib.folderIdleScope("x", [hostKey("remote", "p9")]), t as never)).toEqual([]);
  expect(lib.stopIdleMenuEntries(lib.folderIdleScope("x", []), t as never)).toEqual([]);
});

it("nothing idle at a time: the row is disabled; if it goes before the second look, it says so and stops nothing", async () => {
  const menu = await open(lib.projectIdleScope("local", "p1", "Waveline"));
  expect(byLabel(menu, /preset\.3h/).disabled).toBe(true);
  expect(byLabel(menu, /preset\.30m/).disabled).toBe(false);
  fx.agents.local = [agent("d", "p1", 30 * H, "blocked", ["activeTurn"])];
  expect(await byLabel(menu, /preset\.30m/).prepare!()).toEqual({ empty: "stopIdle.quickNone" });
  expect(fx.stopped).toEqual([]);
});

it("idleCounts: at least that long; 0 counts unknown idle times too", () => {
  expect(lib.idleCounts([{ idleSecs: 2000 }, { idleSecs: 4000 }, { idleSecs: null }], [1800, 3600, 0])).toEqual([2, 1, 3]);
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
  fx.skip = new Set(["a"]);
  await lib.stopQuick([{ hostId: "original", ids: ["a", "b", "c"] }], 1800, t as never);
  fx.toasts[0]!.undo!();
  await vi.waitFor(() => expect(fx.actions).toEqual([["original", "b", "cutex/runtime/online"]]));
  release();
  await vi.waitFor(() => expect(fx.actions).toEqual([["original", "b", "cutex/runtime/online"], ["original", "c", "cutex/runtime/online"]]));
  await vi.waitFor(() => expect(fx.toasts.at(-1)?.text).toBe("stopIdle.undone(1)"));
  expect(hosts).toEqual(["original", "original"]);
});
