// Mock cutex runtime package upgrade (`runtime-package-upgrade`) for the renderer preview: six
// explicit-launch agents behind the selected bundle (native r50 + r209), an upgrade run that steps
// through them on timers and emits `cutex/runtimePackages/runUpdated` deltas like cutex (run header +
// the changed item; GET runs/{id} serves the full run) (Mari is busy → skipped,
// Kaji's review is refused → failed, Rei is moved but does not come back online), and a revert run.
// `?rtp=current`: every agent already current (the quiet one-liner).
import type { OutdatedRuntimeAgent, RuntimePackageRun, RuntimePackageRunEvent, RuntimePackageRunItem, RuntimePackageRunResult, RuntimePackageStep, RuntimePackageSummary, RuntimePackagesView } from "../../../../shared/ipc";
import type { ModuleMock } from "../../dev/mockTypes";

type Emit = (method: string, params: Record<string, unknown>) => void;

const ALL_CURRENT = typeof location !== "undefined" && new URLSearchParams(location.search).get("rtp") === "current";
const STEP_MS = 700;

function pkg(native: number, facade: number, facadeDir = `r${facade}-desktop`): RuntimePackageSummary {
  return {
    manifest: `/home/sam/.cutex/runtime/bundles/native-r${native}-facade-r${facade}.json`,
    nativePath: `/mnt/data/Projects/Cutex/cute-codex/.local/releases/r${native}/codex`,
    nativeVersion: `0.160.0-r${native}`,
    nativeRelease: `r${native}`,
    facadePath: `/mnt/data/Projects/Cutex/cutex/.local/releases/${facadeDir}/cutex-mcp`,
    facadeRelease: `r${facade}`,
    readable: true,
  };
}

const SELECTED = pkg(50, 209, "r209-desktop-20261008");

function agent(name: string, current: RuntimePackageSummary, state: "online" | "offline" | "busy"): OutdatedRuntimeAgent {
  return {
    cutexSessionId: `cutex.${name.toLowerCase()}-7f3a`,
    name,
    contractVersion: 4,
    current,
    runtimeStatus: state === "offline" ? "offline" : "online",
    online: state !== "offline",
    busy: state === "busy",
    busyReason: state === "busy" ? "activeTurn" : null,
    activeTurnId: state === "busy" ? "turn-91c2" : null,
    threadStatus: state === "busy" ? "active" : "idle",
  };
}

let agents: OutdatedRuntimeAgent[] = ALL_CURRENT
  ? []
  : [
      agent("Beta", pkg(49, 205), "online"),
      agent("Kaji", pkg(48, 202), "offline"),
      agent("Mari", pkg(49, 207), "busy"),
      agent("Misato", pkg(49, 207), "offline"),
      agent("Rei", pkg(50, 208, "r208-desktop-20261008"), "online"),
      { ...agent("Shinji", { ...pkg(47, 191), missing: ["D:\\Apps\\cutex\\cutex-20260916-r91\\codex-app-server.exe", "D:\\Apps\\cutex\\cutex-20260916-r91\\codex.exe"] }, "offline"), repair: true },
    ];
/** Agents moved by the last upgrade (restored by a revert). */
const movedAgents = new Map<string, OutdatedRuntimeAgent>();
const runs: RuntimePackageRun[] = [];
let activeRun: RuntimePackageRun | null = null;

const refusal = (code: string, message: string): RuntimePackageRunResult => ({ ok: false, error: { code, message } });

function item(a: OutdatedRuntimeAgent): RuntimePackageRunItem {
  return {
    cutexSessionId: a.cutexSessionId, name: a.name, state: "pending", step: null, code: null, reason: null,
    wasOnline: null, backOnline: null, previousRuntimeVersion: null, targetRuntimeVersion: null, previousFacadeRelease: null,
    targetFacadeRelease: null, actionId: null, committedAt: null, previousContract: null, targetContract: null,
  };
}

function counts(run: RuntimePackageRun): RuntimePackageRun["counts"] {
  const n = (s: RuntimePackageRunItem["state"]) => run.items.filter((i) => i.state === s).length;
  return { total: run.items.length, pending: n("pending"), moved: n("moved"), skipped: n("skipped"), failed: n("failed") };
}

function newRun(kind: "upgrade" | "revert", items: RuntimePackageRunItem[], revertOf: string | null): RuntimePackageRun {
  const run: RuntimePackageRun = {
    runId: `rpu-${crypto.randomUUID()}`, kind, revertOf, revertedBy: [], state: "running", startedAt: new Date().toISOString(), finishedAt: null,
    selected: structuredClone(SELECTED), counts: { total: 0, pending: 0, moved: 0, skipped: 0, failed: 0 }, currentAgentId: null, items,
  };
  run.counts = counts(run);
  return run;
}

/** cutex's event shape: the header, plus the one changed item when there is one. */
function runEvent(run: RuntimePackageRun, item?: RuntimePackageRunItem): RuntimePackageRunEvent {
  const { runId, kind, state: status, revertOf, startedAt, finishedAt, currentAgentId, counts } = run;
  return structuredClone({ runId, kind, status, revertOf, startedAt, finishedAt, currentAgentId, counts, ...(item ? { item } : {}) });
}

/** Plays a run: per item, the steps on timers, emitting runUpdated after every change. */
function play(run: RuntimePackageRun, emit: Emit, plan: (it: RuntimePackageRunItem) => { steps: RuntimePackageStep[]; finish(it: RuntimePackageRunItem): void }) {
  let sent = run.items.map((i) => JSON.stringify(i));
  const send = () => {
    run.counts = counts(run);
    const changed = run.items.filter((i, n) => JSON.stringify(i) !== sent[n]);
    sent = run.items.map((i) => JSON.stringify(i));
    if (changed.length === 0) emit("cutex/runtimePackages/runUpdated", { ...runEvent(run) });
    for (const i of changed) emit("cutex/runtimePackages/runUpdated", { ...runEvent(run, i) });
  };
  const queue: (() => void)[] = [];
  for (const it of run.items) {
    const p = plan(it);
    for (const step of p.steps) {
      queue.push(() => {
        it.state = "running";
        it.step = step;
        run.currentAgentId = it.cutexSessionId;
      });
    }
    queue.push(() => {
      it.step = null;
      p.finish(it);
      run.currentAgentId = null;
    });
  }
  queue.push(() => {
    run.state = "completed";
    run.finishedAt = new Date().toISOString();
    activeRun = null;
    runs.unshift(run);
  });
  send();
  const tick = () => {
    const next = queue.shift();
    if (!next) return;
    next();
    send();
    if (queue.length) setTimeout(tick, STEP_MS);
  };
  setTimeout(tick, STEP_MS);
}

function startUpgrade(emit: Emit): RuntimePackageRunResult {
  if (activeRun) return refusal("run_in_progress", `run ${activeRun.runId} is in progress`);
  if (agents.length === 0) return refusal("nothing_to_upgrade", "no requested agent is outdated");
  const run = newRun("upgrade", agents.map(item), null);
  activeRun = run;
  const byId = new Map(agents.map((a) => [a.cutexSessionId, a]));
  play(run, emit, (it) => {
    const a = byId.get(it.cutexSessionId)!;
    if (a.busy) return { steps: [], finish: (i) => Object.assign(i, { state: "skipped", code: "busy", reason: "active turn turn-91c2" }) };
    // Misato kept the claim of an exited runtime: cleared first. Shinji's package was deleted: a repair.
    const steps: RuntimePackageStep[] = a.online ? ["offline", "review", "apply", "online"] : a.name === "Misato" ? ["reconcile", "review", "apply"] : ["review", "apply"];
    if (a.repair) {
      return {
        steps,
        finish: (i) => {
          Object.assign(i, {
            state: "moved", wasOnline: false, backOnline: null, repair: true,
            reason: `repair: the pinned runtime package is missing (${(a.current.missing ?? []).join(", ")}); moved to the selected package, nothing to revert to`,
            previousRuntimeVersion: a.current.nativeVersion, targetRuntimeVersion: SELECTED.nativeVersion,
            previousFacadeRelease: a.current.facadeRelease, targetFacadeRelease: SELECTED.facadeRelease,
            actionId: `${run.runId}-${run.items.indexOf(i)}`, committedAt: new Date().toISOString(),
            previousContract: { bundle: a.current.manifest }, targetContract: { bundle: SELECTED.manifest },
          });
          agents = agents.filter((x) => x.cutexSessionId !== a.cutexSessionId);
        },
      };
    }
    if (a.name === "Kaji") {
      return {
        steps: ["review"],
        finish: (i) => Object.assign(i, { state: "failed", code: "reviewRefused", reason: "runtime package review refused: contract v3 pins facade r202 whose cutex-mcp manifest lacks the delegation tools; relaunch the agent once to migrate it to contract v4" }),
      };
    }
    return {
      steps,
      finish: (i) => {
        const backOnline = a.name === "Rei" ? false : a.online ? true : null;
        Object.assign(i, {
          state: "moved", wasOnline: a.online, backOnline, code: backOnline === false ? "onlineFailed" : null,
          reason: backOnline === false ? "runtime did not report online within 120 s (app-server exited: missing CODEX_HOME/config.toml)" : null,
          previousRuntimeVersion: a.current.nativeVersion, targetRuntimeVersion: SELECTED.nativeVersion,
          previousFacadeRelease: a.current.facadeRelease, targetFacadeRelease: SELECTED.facadeRelease,
          actionId: `${run.runId}-${run.items.indexOf(i)}`, committedAt: new Date().toISOString(),
          previousContract: { bundle: a.current.manifest }, targetContract: { bundle: SELECTED.manifest },
        });
        agents = agents.filter((x) => x.cutexSessionId !== a.cutexSessionId);
        movedAgents.set(a.cutexSessionId, a);
      },
    };
  });
  return { ok: true, run: structuredClone(run) };
}

function startRevert(runId: string, emit: Emit): RuntimePackageRunResult {
  if (activeRun) return refusal("run_in_progress", `run ${activeRun.runId} is in progress`);
  const target = runs.find((r) => r.runId === runId);
  if (!target) return refusal("run_not_found", `no run ${runId}`);
  if (target.kind !== "upgrade") return refusal("invalid_request", "a revert run cannot be reverted");
  const left = new Set(notReverted(target));
  const moved = target.items.filter((i) => left.has(i.cutexSessionId));
  if (moved.length === 0 && target.revertedBy.length) return refusal("already_reverted", "every matching moved agent was already reverted");
  if (moved.length === 0) return refusal("nothing_to_revert", "no moved item to revert");
  const run = newRun("revert", moved.map((m) => ({ ...item(movedAgents.get(m.cutexSessionId)!), name: m.name })), runId);
  target.revertedBy.push(run.runId);
  activeRun = run;
  play(run, emit, (it) => {
    const a = movedAgents.get(it.cutexSessionId)!;
    const wasOnline = a.online && a.name !== "Rei";
    return {
      steps: wasOnline ? ["offline", "revert", "online"] : ["revert"],
      finish: (i) => {
        Object.assign(i, {
          state: "moved", wasOnline, backOnline: wasOnline ? true : null,
          previousRuntimeVersion: SELECTED.nativeVersion, targetRuntimeVersion: a.current.nativeVersion,
          previousFacadeRelease: SELECTED.facadeRelease, targetFacadeRelease: a.current.facadeRelease, committedAt: new Date().toISOString(),
        });
        movedAgents.delete(a.cutexSessionId);
        agents = [...agents, a].sort((x, y) => x.name.localeCompare(y.name));
      },
    };
  });
  return { ok: true, run: structuredClone(run) };
}

/** Moved agents of upgrade run `target` that no revert run of it moved back yet. */
function notReverted(target: RuntimePackageRun): string[] {
  const back = new Set(runs.filter((r) => r.revertOf === target.runId).flatMap((r) => r.items.filter((i) => i.state === "moved").map((i) => i.cutexSessionId)));
  return target.items.filter((i) => i.state === "moved" && !i.repair && !back.has(i.cutexSessionId)).map((i) => i.cutexSessionId);
}

/** cutex's `revertable`: the newest finished upgrade run while it has agents left to move back. */
function revertable(): { runId: string; agentIds: string[] } | null {
  const upgrade = runs.find((r) => r.kind === "upgrade");
  const agentIds = upgrade ? notReverted(upgrade) : [];
  return upgrade && agentIds.length ? { runId: upgrade.runId, agentIds } : null;
}

const delay = () => new Promise((r) => setTimeout(r, 150));

function mockRuntimePackageApi(emit: Emit) {
  return {
    async runtimePackages(): Promise<RuntimePackagesView | null> {
      await delay();
      return structuredClone({ hostId: "host-a", selected: SELECTED, selectedError: null, agents, activeRun, lastRun: runs[0] ?? null, revertable: revertable() });
    },
    async runtimePackageRun(runId: string): Promise<RuntimePackageRun | null> {
      await delay();
      const run = activeRun?.runId === runId ? activeRun : runs.find((r) => r.runId === runId);
      return run ? structuredClone(run) : null;
    },
    async startRuntimePackageRun(): Promise<RuntimePackageRunResult> {
      await delay();
      return startUpgrade(emit);
    },
    async revertRuntimePackageRun(runId: string): Promise<RuntimePackageRunResult> {
      await delay();
      return startRevert(runId, emit);
    },
  };
}

export const mock: ModuleMock = { api: (core) => mockRuntimePackageApi((method, params) => core.emitHost(method, params)) };
