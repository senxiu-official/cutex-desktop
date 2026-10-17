// Browser-preview data for 后端更新 (cutex backend-upgrade; dev/mockTypes.ts). The shown host is a
// managed install on r240 with r241 available; 下载 stages it (2.5 s), 更新 runs a scripted apply that
// walks every phase (waits for two busy agents first) and emits `cutex/upgrade/updated` on each step;
// 回滚 previews, then runs a rollback the same way. Remote (SSH) mock hosts are hand-deployed
// (managed: false). Not under `?legacy` (the page is hidden there).
//   ?upgrade=unmanaged   the shown host is hand-deployed too
//   ?upgrade=oneway      r241 is one-way (typed confirmation)
//   ?upgrade=needsowner  the apply fails in verify and its rollback needs the owner
//   ?upgrade=deferred    the agents stay busy: the run is deferred
//   ?upgrade=uptodate    nothing available
//   ?upgrade=nokeys      no trusted key (checks fail closed)
//   ?upgrade=justupdated a full update without a native (0.1.0 → 0.1.1) committed a minute ago; idle
//                        agents still move over in batches (followUp) — what a host shows right after
//                        an in-app update
import { BACKEND_UPGRADE_FEATURE, UPGRADE_RUN_NATIVE_FEATURE, isUpgradeTerminal, type HostServiceInfo, type UpgradeApplyRequest, type UpgradePhase, type UpgradeRefusal, type UpgradeResult, type UpgradeRollbackPreview, type UpgradeRun, type UpgradeStatus } from "../../../../shared/backendUpgrade";
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

const MODE = typeof location !== "undefined" ? new URLSearchParams(location.search).get("upgrade") : null;
const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
const clone = <T>(x: T): T => structuredClone(x);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let runSeq = 0x3a1f00;
const runId = () => `upg-${(runSeq++).toString(16).padStart(12, "0")}`;

const SETTINGS = { channel: "release" as const, source: "https://github.com/example-org/cutex/releases/download", checkIntervalHours: 6, autoStage: true, autoApply: false, packageRun: "after" as const, packageRunBatch: 5, maxWaitSecs: 3600 };

function history(): UpgradeRun[] {
  const run = (from: string, to: string, daysAgo: number, phase: UpgradePhase, over: Partial<UpgradeRun> = {}): UpgradeRun => {
    const start = daysAgo * 86400;
    const steps: UpgradePhase[] = phase === "deferred" ? ["queued", "waiting-idle", "deferred"] : ["queued", "waiting-idle", "stopping", "backing-up", "swapping", "starting", "waiting-ready", "verifying", "committed"];
    return {
      runId: runId(),
      kind: "apply",
      fromRelease: from,
      toRelease: to,
      mode: "reload",
      class: "rollback-safe",
      phase,
      createdAt: iso(start),
      finishedAt: iso(start - 600),
      maxWaitSecs: 3600,
      packageRun: "after",
      requestedBy: "management-api",
      waitingFor: [],
      cancelRequested: false,
      timeline: steps.map((p, i) => ({ phase: p, at: iso(start - i * 40), ...(p === "deferred" ? { detail: "2 agents still busy after 3600 s" } : {}) })),
      downtimeMs: phase === "committed" ? 8200 + daysAgo * 300 : null,
      backupDir: phase === "committed" ? `~/.local/share/cutex/upgrade/runs/upg-…/backup` : null,
      error: null,
      needsOwner: null,
      displaced: [],
      ...over,
    };
  };
  return [run("r239", "r240", 3, "committed"), run("r239", "r240", 4, "deferred"), run("r238", "r239", 9, "committed", { mode: "full", packageRunId: "rpu-5c2e1a7d9b30" })];
}

/** A committed full-mode apply without a native (cutex 0.1.0 → 0.1.1, the first public update). */
function justUpdated(): UpgradeStatus {
  const phases: UpgradePhase[] = ["queued", "waiting-idle", "stopping", "backing-up", "swapping", "starting", "waiting-ready", "verifying", "committed"];
  const run: UpgradeRun = {
    runId: runId(),
    kind: "apply",
    fromRelease: "0.1.0",
    toRelease: "0.1.1",
    mode: "full",
    class: "rollback-safe",
    phase: "committed",
    createdAt: iso(90),
    finishedAt: iso(50),
    maxWaitSecs: 3600,
    packageRun: "after",
    requestedBy: "management-api",
    waitingFor: [],
    cancelRequested: false,
    timeline: phases.map((p, i) => ({ phase: p, at: iso(90 - i * 5) })),
    downtimeMs: 9100,
    backupDir: "~/.local/share/cutex/upgrade/runs/upg-…/backup",
    packageRunId: null,
    error: null,
    needsOwner: null,
    displaced: [],
    // upgrade-run-native: full, no native in the manifest → only the runtime package changed.
    nativeVersion: null,
    previousNativeVersion: "0.160.0-r51",
    runtimeChange: "package",
  };
  return {
    managed: true,
    base: "~/.local/share/cutex",
    serviceManager: "systemd",
    build: { version: "0.1.1", release: "0.1.1", commit: "3736d2ee5a1c9b04", builtAt: "2026-10-16T05:12:00Z", profile: "release", channel: "release" },
    installed: { release: "0.1.1", sequence: 2, commit: "3736d2ee5a1c9b04", manifestSha256: "5d1e…" },
    previousRelease: "0.1.0",
    installedReleases: ["0.1.0", "0.1.1"],
    lastCheckAt: iso(120),
    lastCheckError: null,
    available: null,
    staged: null,
    staging: null,
    run,
    followUp: { upgradeRunId: run.runId, startedAt: iso(50), lastBatchAt: iso(40), packageRunIds: ["rpu-1f0c3b2a9d84"], done: false },
    settings: { ...SETTINGS },
    trustedKeys: ["8A3F5C21D0E9B746"],
  };
}

function initial(): UpgradeStatus {
  if (MODE === "justupdated") return justUpdated();
  const managed = MODE !== "unmanaged";
  const oneWay = MODE === "oneway";
  return {
    managed,
    base: managed ? "~/.local/share/cutex" : null,
    serviceManager: managed ? "systemd" : "none",
    build: { version: "0.1.0", release: "r240", commit: "4c7d21e0b9a3f5d6", builtAt: "2026-10-12T09:20:00Z", profile: "release", channel: "release" },
    installed: { release: "r240", sequence: 240, commit: "4c7d21e0b9a3f5d6", manifestSha256: "9f2c…" },
    previousRelease: managed ? "r239" : null,
    installedReleases: managed ? ["r238", "r239", "r240"] : ["r240"],
    lastCheckAt: managed && MODE !== "nokeys" ? iso(40 * 60) : null,
    lastCheckError: MODE === "nokeys" ? { code: "no_trusted_keys", message: "this build trusts no release signing key" } : null,
    available:
      managed && MODE !== "uptodate" && MODE !== "nokeys"
        ? {
            release: "r241",
            sequence: 241,
            tag: "cutex-r241",
            manifestSha256: "c3a9…",
            publishedAt: iso(5 * 3600),
            notes: {
              en: "Faster session list; asks keep their order across restarts; fixes a stuck queue after a provider timeout.",
              "zh-CN": "会话列表更快；委托在重启后保持顺序；修复服务商超时后队列卡住的问题。",
            },
            class: oneWay ? "one-way" : "rollback-safe",
            mode: "reload",
            migrations: oneWay
              ? [{ id: "session-store-v3", class: "one-way", since: "r241", notes: { en: "Session store schema 3: older releases cannot open it.", "zh-CN": "会话库升级到第 3 版：旧版本无法打开。" }, newStores: [] }]
              : [{ id: "asks-order-index", class: "rollback-safe", since: "r241", notes: { en: "New index for ask ordering (moved aside on rollback).", "zh-CN": "新增委托排序索引（回滚时移开）。" }, newStores: ["runtime/asks/order-index.sqlite3"] }],
            belowFloor: null,
            nativeVersion: null,
            claudeRuntime: null,
            capabilitiesRemoved: [],
            desktopMinCommit: null,
          }
        : null,
    staged: null,
    staging: null,
    run: null,
    followUp: null,
    settings: { ...SETTINGS },
    trustedKeys: MODE === "nokeys" ? [] : ["8A3F5C21D0E9B746"],
  };
}

const HOST_INFO: HostServiceInfo = {
  serviceManager: { kind: "systemd", unit: "cutex-management-api.service", managedInstall: true },
  runtimes: {
    native: {
      selected: "r53",
      latest: "r53",
      inUse: [
        { release: "r53", version: "0.162.1-r53", agents: 9, selected: true, missing: false },
        { release: "r52", version: "0.162.1-r52", agents: 3, selected: false, missing: false },
      ],
    },
    claude: { selected: "claude-r12", inUse: [{ release: "claude-r12", version: null, agents: 2, selected: true, missing: false }] },
    unpinnedAgents: 0,
  },
};

const refusal = (status: number, code: string, message: string, extra: Partial<UpgradeRefusal> = {}): { ok: false; error: UpgradeRefusal } => ({ ok: false, error: { code, message, status, ...extra } });
const unmanaged = () => refusal(409, "upgrade_blocked", "this daemon does not run from a managed install (no install.json)", { reason: "unmanaged_install" });
const ok = <T>(value: T): UpgradeResult<T> => ({ ok: true, value });

function world(emitHost: (method: string, params: Record<string, unknown>) => void, managedOverride?: boolean) {
  const state = initial();
  if (managedOverride === false) Object.assign(state, { managed: false, base: null, serviceManager: "none", previousRelease: null, installedReleases: ["r240"], available: null, lastCheckAt: null });
  const past = MODE === "justupdated" && state.run ? [clone(state.run)] : state.managed ? history() : [];
  const emit = (reason: "startup" | "state" = "state") =>
    emitHost("cutex/upgrade/updated", {
      reason,
      hostId: "mock",
      run: state.run ? { runId: state.run.runId, kind: state.run.kind, phase: state.run.phase, fromRelease: state.run.fromRelease, toRelease: state.run.toRelease, servicesDown: ["stopping", "swapping", "starting", "waiting-ready", "rolling-back"].includes(state.run.phase) } : null,
      available: state.available?.release ?? null,
      staged: state.staged?.release ?? null,
      staging: state.staging ?? null,
    });
  const active = () => !!state.run && !isUpgradeTerminal(state.run.phase);
  const enter = (phase: UpgradePhase, detail?: string) => {
    const run = state.run!;
    run.phase = phase;
    run.timeline.push({ phase, at: new Date().toISOString(), ...(detail ? { detail } : {}) });
    if (phase !== "waiting-idle") run.waitingFor = [];
    if (isUpgradeTerminal(phase)) run.finishedAt = new Date().toISOString();
    emit(phase === "waiting-ready" ? "startup" : "state");
  };

  /** Walks the phases; stops when the run was cancelled. */
  async function drive(steps: readonly [UpgradePhase, number, string?][], finish: () => void) {
    for (const [phase, ms, detail] of steps) {
      if (state.run?.phase === "cancelled") return;
      if (state.run?.cancelRequested && ["queued", "waiting-idle", "quiescing"].includes(state.run.phase)) {
        enter("cancelled", "cancelled by the owner");
        past.unshift(clone(state.run));
        return;
      }
      enter(phase, detail);
      if (phase === "waiting-idle") {
        state.run!.waitingFor = [
          { reason: "activeTurn", cutexSessionId: "cutex.builder-1", name: "builder-1", detail: "turn 14" },
          { reason: "threadActive", cutexSessionId: "cutex.reviewer-2", name: "reviewer-2", detail: null },
        ];
        emit();
        if (MODE === "deferred") {
          await sleep(ms);
          enter("deferred", "2 agents still busy after 60 s");
          past.unshift(clone(state.run!));
          return;
        }
        await sleep(ms / 2);
        state.run!.waitingFor = state.run!.waitingFor!.slice(1);
        emit();
        await sleep(ms / 2);
        if (state.run?.cancelRequested) continue;
        state.run!.waitingFor = [];
        emit();
        continue;
      }
      await sleep(ms);
    }
    if (state.run && state.run.phase !== "cancelled") finish();
  }

  const applySteps: [UpgradePhase, number, string?][] = [
    ["queued", 600],
    ["waiting-idle", 7000],
    ["stopping", 1500],
    ["backing-up", 1800, "14 files, 3 SQLite stores"],
    ["swapping", 1000],
    ["starting", 1200],
    ["waiting-ready", 1500],
    ["verifying", 1800],
  ];

  const api = {
    async upgradeStatus() {
      await sleep(150);
      return clone(state);
    },
    async upgradeCheck() {
      await sleep(600);
      if (!state.managed) return unmanaged();
      if (state.trustedKeys.length === 0) return refusal(503, "no_trusted_keys", "this build trusts no release signing key");
      state.lastCheckAt = new Date().toISOString();
      state.lastCheckError = null;
      emit();
      return ok(clone(state));
    },
    async upgradeStage(release?: string | null) {
      await sleep(200);
      if (!state.managed) return unmanaged();
      if (active()) return refusal(409, "upgrade_blocked", "an upgrade run is in progress", { reason: "run_in_progress", runId: state.run!.runId });
      const name = release ?? state.available?.release;
      if (!name) return refusal(409, "nothing_available", "no release is available");
      state.staging = { release: name, state: "running", startedAt: new Date().toISOString() };
      emit();
      setTimeout(() => {
        state.staging = null;
        state.staged = {
          release: name,
          sequence: 241,
          stagedAt: new Date().toISOString(),
          manifestSha256: state.available?.manifestSha256 ?? "c3a9…",
          preflightOk: true,
          preflight: ["version", "selftest", "nativeFiles", "disk", "rollbackTarget"].map((n) => ({ name: n, ok: true, detail: null })),
          nativeVersion: null,
        };
        emit();
      }, 2500);
      return ok({ release: name, state: "running" as const });
    },
    async upgradeApply(request: UpgradeApplyRequest) {
      await sleep(200);
      if (!state.managed) return unmanaged();
      if (active()) return refusal(409, "upgrade_blocked", "an upgrade run is in progress", { reason: "run_in_progress", runId: state.run!.runId });
      const staged = state.staged;
      if (!staged) return refusal(409, "not_staged", "stage a release first");
      const facts = state.available?.release === staged.release ? state.available : null;
      if (facts?.class === "one-way" && request.confirmOneWay !== staged.release) return refusal(409, "one_way_unconfirmed", `${staged.release} is one-way`, { migrations: facts.migrations });
      const from = state.installed!.release;
      const mode = request.mode === "full" || facts?.mode === "full" ? "full" : "reload";
      state.run = {
        runId: runId(),
        kind: "apply",
        fromRelease: from,
        toRelease: staged.release,
        mode,
        class: facts?.class ?? "rollback-safe",
        phase: "queued",
        createdAt: new Date().toISOString(),
        finishedAt: null,
        maxWaitSecs: request.maxWaitSecs ?? state.settings.maxWaitSecs,
        packageRun: request.packageRun ?? state.settings.packageRun,
        confirmOneWay: request.confirmOneWay ?? null,
        requestedBy: "management-api",
        waitingFor: [],
        cancelRequested: false,
        timeline: [],
        downtimeMs: null,
        backupDir: null,
        packageRunId: null,
        error: null,
        needsOwner: null,
        runnerPid: 41872,
        displaced: [],
        // upgrade-run-native, as cutex RuntimeChange::of records it when the run is prepared.
        nativeVersion: staged.nativeVersion ?? null,
        previousNativeVersion: HOST_INFO.runtimes?.native?.selected ?? null,
        runtimeChange: mode === "reload" ? "none" : staged.nativeVersion && staged.nativeVersion !== HOST_INFO.runtimes?.native?.selected ? "native" : "package",
      };
      const run = state.run;
      void drive(applySteps, () => {
        run.backupDir = `~/.local/share/cutex/upgrade/runs/${run.runId}/backup`;
        if (MODE === "needsowner") {
          run.error = { code: "verify_failed", message: "capability workflows missing after the restart" };
          enter("rolling-back", run.error.message);
          setTimeout(() => {
            run.needsOwner = {
              reason: "the rollback could not start the services again (unit cutex-management-api.service failed)",
              commands: ["systemctl --user status cutex-management-api.service", `cutex upgrade rollback --to ${from} --no-follow`, "cutex upgrade status"],
            };
            enter("needs-owner", "rollback start failed");
            past.unshift(clone(run));
          }, 2500);
          return;
        }
        run.downtimeMs = 7400;
        enter("committed", `${from} → ${run.toRelease}`);
        state.previousRelease = from;
        state.installed = { release: run.toRelease, sequence: staged.sequence, commit: "7be0c4a1d29f3e85", manifestSha256: staged.manifestSha256 };
        state.build = { ...state.build, release: run.toRelease, commit: "7be0c4a1d29f3e85", builtAt: new Date().toISOString() };
        if (!state.installedReleases.includes(run.toRelease)) state.installedReleases.push(run.toRelease);
        state.available = null;
        state.staged = null;
        past.unshift(clone(run));
        emit();
      });
      return ok(clone(run));
    },
    async upgradeCancel() {
      await sleep(150);
      if (!state.managed) return unmanaged();
      if (!active()) return refusal(409, "no_run", "no upgrade run is in progress");
      if (!["queued", "waiting-idle", "quiescing"].includes(state.run!.phase)) return refusal(409, "not_cancellable", "the run already changed the host");
      state.run!.cancelRequested = true;
      emit();
      return ok(clone(state.run!));
    },
    async upgradeRollback(request: { to?: string; maxWaitSecs?: number; dryRun?: boolean }) {
      await sleep(300);
      if (!state.managed) return unmanaged();
      const from = state.installed!.release;
      const to = request.to ?? state.previousRelease;
      if (!to) return refusal(409, "no_rollback_target", "no previous release");
      const preview: UpgradeRollbackPreview = {
        from,
        to,
        class: "rollback-safe",
        migrations: from === "r241" ? [{ id: "asks-order-index", class: "rollback-safe", since: "r241", notes: { en: "New index for ask ordering (moved aside on rollback).", "zh-CN": "新增委托排序索引（回滚时移开）。" } }] : [],
        movedAside: from === "r241" ? ["runtime/asks/order-index.sqlite3"] : [],
        selectionBackup: null,
        sessionDataRestored: false,
      };
      if (request.dryRun) return ok({ preview });
      if (active()) return refusal(409, "upgrade_blocked", "an upgrade run is in progress", { reason: "run_in_progress", runId: state.run!.runId });
      state.run = {
        runId: runId(),
        kind: "rollback",
        fromRelease: from,
        toRelease: to,
        mode: "reload",
        class: "rollback-safe",
        phase: "queued",
        createdAt: new Date().toISOString(),
        finishedAt: null,
        maxWaitSecs: request.maxWaitSecs ?? state.settings.maxWaitSecs,
        packageRun: "none",
        requestedBy: "management-api",
        waitingFor: [],
        cancelRequested: false,
        timeline: [],
        downtimeMs: null,
        error: null,
        needsOwner: null,
        displaced: [],
      };
      const run = state.run;
      void drive(
        [
          ["queued", 500],
          ["waiting-idle", 3000],
          ["stopping", 1200],
          ["backing-up", 1200],
          ["swapping", 900],
          ["starting", 1200],
          ["verifying", 1200],
        ],
        () => {
          run.downtimeMs = 5100;
          run.displaced = preview.movedAside.map((p) => `upgrade/runs/${run.runId}/displaced/${p}`);
          enter("committed", `rolled back to ${to}`);
          state.installed = { release: to, sequence: Number(to.slice(1)) || 0, commit: "4c7d21e0b9a3f5d6", manifestSha256: null };
          state.build = { ...state.build, release: to };
          state.previousRelease = state.installedReleases.filter((r) => r < to).at(-1) ?? null;
          past.unshift(clone(run));
          emit();
        },
      );
      return ok({ preview, run: clone(run) });
    },
    async upgradeRuns(limit?: number) {
      await sleep(150);
      const runs = [...(active() ? [state.run!] : []), ...past].slice(0, limit ?? 20);
      return ok(clone(runs));
    },
    async upgradeRun(id: string) {
      const found = state.run?.runId === id ? state.run : past.find((r) => r.runId === id);
      return found ? ok(clone(found)) : refusal(404, "run_not_found", "no upgrade run has this id", { runId: id });
    },
    async patchUpgradeSettings(patch: Record<string, unknown>) {
      await sleep(150);
      if (!state.managed) return unmanaged();
      if ("source" in patch) return refusal(400, "source_not_editable", "set the source on the host");
      Object.assign(state.settings, patch);
      emit();
      return ok(clone(state.settings));
    },
    async hostServiceInfo(): Promise<HostServiceInfo> {
      await sleep(100);
      return state.managed ? clone(HOST_INFO) : { serviceManager: { kind: "none", unit: null, managedInstall: false }, runtimes: clone(HOST_INFO.runtimes) };
    },
  };
  return api;
}

export const mock: ModuleMock = {
  features: { new: [BACKEND_UPGRADE_FEATURE, UPGRADE_RUN_NATIVE_FEATURE] },
  api: (core: MockCore) => world((method, params) => core.emitHost(method, params)),
  // SSH mock hosts: hand-deployed (the read-only page).
  remote: (_hostId, emitHost) => world(emitHost, false),
};
