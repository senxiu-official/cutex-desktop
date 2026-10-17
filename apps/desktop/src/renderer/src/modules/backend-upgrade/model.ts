// Pure helpers of 后端更新 (cutex backend-upgrade): what the host needs attention for, the run's step
// list, refusal / phase wording keys. No React, no store: unit-tested (test/backendUpgrade.test.ts).
import { isUpgradeCancellable, isUpgradeServicesDown, isUpgradeTerminal, UPGRADE_RUNTIME_CHANGES, type UpgradeApplyRequest, type UpgradeEvent, type UpgradeMode, type UpgradePackageRun, type UpgradePhase, type UpgradeRefusal, type UpgradeRun, type UpgradeRuntimeChange, type UpgradeStatus } from "../../../../shared/backendUpgrade";

/** What the nav dot / page header calls out on a host. */
export type UpgradeAttention = "none" | "available" | "staged" | "running" | "needsOwner";

/**
 * The host's upgrade state worth a dot: a run that needs the owner, a run in progress, a staged
 * release ready to apply, or an available one. An unmanaged host (cannot be upgraded here) is "none".
 */
export function upgradeAttention(status: UpgradeStatus | null | undefined, event?: UpgradeEvent | null): UpgradeAttention {
  const phase = event?.run?.phase ?? status?.run?.phase ?? null;
  if (phase === "needs-owner") return "needsOwner";
  if (!status?.managed) return "none";
  if (phase && !isUpgradeTerminal(phase)) return "running";
  if (status.staged && status.staged.release !== status.installed?.release) return "staged";
  if (status.available && status.available.release !== status.installed?.release) return "available";
  return "none";
}

/** The run is still going (not terminal). */
export function runActive(run: UpgradeRun | null | undefined): boolean {
  return !!run && !isUpgradeTerminal(run.phase);
}

/** `stopped`: where a cancelled / deferred run ended (nothing changed). */
export type StepState = "done" | "current" | "pending" | "failed" | "stopped";

export interface RunStep {
  phase: UpgradePhase;
  state: StepState;
  /** When this step was entered (the last entry of it on the timeline). */
  at: string | null;
  detail: string | null;
}

/** Phases a run goes through, in order (cutex src/upgrade/runner.rs). */
export function runPhases(run: Pick<UpgradeRun, "kind" | "mode" | "packageRun" | "timeline">): UpgradePhase[] {
  const during = run.kind === "apply" && run.mode === "full" && run.packageRun === "during";
  const seen = new Set(run.timeline.map((e) => e.phase));
  const phases: UpgradePhase[] =
    run.kind === "rollback"
      ? ["waiting-idle", "stopping", "backing-up", "swapping", "starting", ...(seen.has("waiting-ready") ? (["waiting-ready"] as const) : []), "verifying"]
      : ["waiting-idle", ...(during || seen.has("quiescing") ? (["quiescing"] as const) : []), "stopping", "backing-up", "swapping", "starting", "waiting-ready", ...(during || seen.has("package-run") ? (["package-run", "restoring-online"] as const) : []), "verifying"];
  return phases;
}

/** The ordered steps with their state; a failure marks the last step the run reached, a run in progress its current one. */
export function runSteps(run: UpgradeRun): RunStep[] {
  const phases = runPhases(run);
  const last = new Map<UpgradePhase, { at: string; detail: string | null }>();
  for (const e of run.timeline) last.set(e.phase, { at: e.at, detail: e.detail ?? null });
  // The furthest step reached (by order), from the timeline and the current phase.
  let reached = -1;
  phases.forEach((p, i) => {
    if (last.has(p) || run.phase === p) reached = Math.max(reached, i);
  });
  const terminal = isUpgradeTerminal(run.phase);
  // A run in progress can go back (quiescing → waiting-idle when an agent got busy again, cutex
  // runner.rs): the current step is where it is now, not the furthest one it ever reached.
  if (!terminal) {
    let cur = phases.indexOf(run.phase);
    if (cur < 0) {
      for (let k = run.timeline.length - 1; k >= 0 && cur < 0; k--) cur = phases.indexOf(run.timeline[k]!.phase);
    }
    if (cur >= 0 || run.phase === "queued") reached = cur;
  }
  const committed = run.phase === "committed";
  const bad = terminal && !committed && run.phase !== "cancelled" && run.phase !== "deferred";
  return phases.map((phase, i) => {
    const entry = last.get(phase) ?? null;
    let state: StepState;
    if (committed) state = "done";
    else if (i < reached) state = "done";
    else if (i === reached) state = terminal ? (bad ? "failed" : "stopped") : "current";
    else state = "pending";
    // A rollback (rolling-back) is not a step of its own: the step it left is the failed one.
    if (run.phase === "rolling-back" && i === reached) state = "failed";
    return { phase, state, at: entry?.at ?? null, detail: entry?.detail ?? null };
  });
}

/** Cancel is offered: a cancellable phase and not already requested. */
export function canCancel(run: UpgradeRun | null | undefined): boolean {
  return !!run && isUpgradeCancellable(run.phase) && !run.cancelRequested;
}

/** The services are restarting (the connection drops: expected). */
export function servicesDown(run: { phase: string } | null | undefined): boolean {
  return isUpgradeServicesDown(run?.phase);
}

/** i18n key suffix of a refusal (`backend-upgrade.refusal.<suffix>`), or null = show code + message. */
export function refusalKey(refusal: Pick<UpgradeRefusal, "code" | "reason">): string | null {
  if (refusal.code === "upgrade_blocked") {
    const reason = refusal.reason ?? "";
    return ["unmanaged_install", "run_in_progress", "stage_in_progress", "preflight_failed", "below_floor", "one_way"].includes(reason) ? `blocked.${reason}` : "blocked.other";
  }
  const known = ["one_way_unconfirmed", "not_staged", "nothing_available", "downgrade_refused", "no_rollback_target", "no_run", "not_cancellable", "source_not_editable", "run_not_found", "no_trusted_keys", "signature_invalid", "upgrade_unavailable", "invalid_request", "owner_required"];
  return known.includes(refusal.code) ? refusal.code : null;
}

/** "42 s", "3 min 05 s", "1 h 02 min". */
export function formatDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** Seconds since an ISO time (null when unparsable). */
export function secondsSince(iso: string | null | undefined, now: number): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null;
}

/** Unix seconds of an ISO time (for lib/time formatWhen), or null. */
export function unixOf(iso: string | null | undefined): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

/** The whole minutes of a seconds value for the max-wait field (rounded up so a value never shrinks to 0). */
export const minutesOf = (secs: number): number => Math.ceil(Math.max(0, secs) / 60);

/** The check interval choices (hours; 0 = off), with the current value kept when it is something else. */
export function intervalChoices(current: number): number[] {
  const base = [0, 1, 6, 12, 24, 72, 168];
  return base.includes(current) ? base : [...base, current].sort((a, b) => a - b);
}

/** A check interval in words (hours; 0 = off): 每小时 / 每 6 小时 / 每天 / 每 3 天 / 每周. Returns the key + vars. */
export function intervalWords(hours: number): { key: "backend-upgrade.settings.intervalOff" | "backend-upgrade.settings.intervalHourly" | "backend-upgrade.settings.intervalHours" | "backend-upgrade.settings.intervalDaily" | "backend-upgrade.settings.intervalDays" | "backend-upgrade.settings.intervalWeekly" | "backend-upgrade.settings.intervalWeeks"; n?: number } {
  if (hours <= 0) return { key: "backend-upgrade.settings.intervalOff" };
  if (hours % 168 === 0) return hours === 168 ? { key: "backend-upgrade.settings.intervalWeekly" } : { key: "backend-upgrade.settings.intervalWeeks", n: hours / 168 };
  if (hours % 24 === 0) return hours === 24 ? { key: "backend-upgrade.settings.intervalDaily" } : { key: "backend-upgrade.settings.intervalDays", n: hours / 24 };
  return hours === 1 ? { key: "backend-upgrade.settings.intervalHourly" } : { key: "backend-upgrade.settings.intervalHours", n: hours };
}

/**
 * The apply body. `waitMin` / `packageRun` null = not edited on the page: left out so cutex uses its
 * current settings (a value copied from the settings on mount would go stale). The package run only
 * matters for a full-mode apply; `confirmOneWay` names the release for a one-way one.
 */
export function applyRequest(o: { release: string; forceFull: boolean; effectiveMode: UpgradeMode; waitMin: number | null; packageRun: UpgradePackageRun | null; oneWay: boolean }): UpgradeApplyRequest {
  return {
    release: o.release,
    ...(o.forceFull ? { mode: "full" as const } : {}),
    ...(o.waitMin !== null ? { maxWaitSecs: Math.min(24 * 3600, o.waitMin * 60) } : {}),
    ...(o.effectiveMode === "full" && o.packageRun !== null ? { packageRun: o.packageRun } : {}),
    ...(o.oneWay ? { confirmOneWay: o.release } : {}),
  };
}

/** How long a finished run stays as a note at the top of the page (then: 更新历史 only). */
export const RECENT_RUN_MS = 24 * 3600 * 1000;

/**
 * Where the current / last run shows at the top of the page: `card` = the run with its steps (still
 * going, or it needs the owner); `note` = a finished run within a day, as one dismissable outcome line
 * (its steps live in 更新历史); null = nothing (older, or the owner dismissed this run's note).
 */
export function runDisplay(run: UpgradeRun | null | undefined, now: number, dismissedRunId: string | null): "card" | "note" | null {
  if (!run) return null;
  if (runActive(run) || run.phase === "needs-owner") return "card";
  if (dismissedRunId === run.runId) return null;
  const end = Date.parse(run.finishedAt ?? run.createdAt);
  return Number.isFinite(end) && now - end < RECENT_RUN_MS ? "note" : null;
}

/**
 * The native runtime version a full update of `release` brings, from the staged / available release's
 * manifest facts (`nativeVersion`); null = none, or not known (cutex's run records do not say: once
 * the release is installed, staged / available are cleared).
 */
export function releaseNative(status: Pick<UpgradeStatus, "staged" | "available">, release: string | null | undefined): string | null {
  if (!release) return null;
  if (status.staged?.release === release && status.staged.nativeVersion) return status.staged.nativeVersion;
  if (status.available?.release === release && status.available.nativeVersion) return status.available.nativeVersion;
  return null;
}

/**
 * The mode wording (`backend-upgrade.mode.*` one-liner / `backend-upgrade.impact.*` sentence): a full
 * update says "new native runtime" only when the manifest brings one; otherwise (the runtime package /
 * tools for new agents change, idle agents move over) the package wording.
 */
export function modeKeys(mode: UpgradeMode, native: string | null): { mode: "backend-upgrade.mode.reload" | "backend-upgrade.mode.full" | "backend-upgrade.mode.fullPackage"; impact: "backend-upgrade.impact.reload" | "backend-upgrade.impact.full" | "backend-upgrade.impact.fullPackage" } {
  if (mode !== "full") return { mode: "backend-upgrade.mode.reload", impact: "backend-upgrade.impact.reload" };
  return native ? { mode: "backend-upgrade.mode.full", impact: "backend-upgrade.impact.full" } : { mode: "backend-upgrade.mode.fullPackage", impact: "backend-upgrade.impact.fullPackage" };
}

/** What a run does to the runtime new agents get, and whether cutex recorded it. */
export interface RunRuntime {
  change: UpgradeRuntimeChange;
  /** The native the target release carries (recorded, or the manifest guess). */
  native: string | null;
  /** The native new agents got before (recorded only). */
  previous: string | null;
  /** From the run record (cutex `upgrade-run-native`); false = guessed from the mode + manifest facts. */
  recorded: boolean;
}

/**
 * A run's runtime change: cutex's own record (`runtimeChange`, capability upgrade-run-native) when the
 * run has one; otherwise (older cutex, records from before the field) the guess from the mode and the
 * staged / available manifest's native (`guessNative`, model releaseNative), as modeKeys words it.
 */
export function runRuntime(run: Pick<UpgradeRun, "mode" | "runtimeChange" | "nativeVersion" | "previousNativeVersion">, guessNative: string | null): RunRuntime {
  const recorded = run.runtimeChange;
  if (recorded && UPGRADE_RUNTIME_CHANGES.includes(recorded)) return { change: recorded, native: run.nativeVersion ?? null, previous: run.previousNativeVersion ?? null, recorded: true };
  return { change: run.mode !== "full" ? "none" : guessNative ? "native" : "package", native: guessNative, previous: null, recorded: false };
}

/**
 * The "what new agents get" line of a finished run (note, history): only from cutex's record — a guess
 * after the fact would be wrong (staged / available are cleared once the release is installed).
 */
export function runtimeLine(runtime: RunRuntime): { key: "backend-upgrade.runtime.native" | "backend-upgrade.runtime.nativeFrom" | "backend-upgrade.runtime.package"; vars: Record<string, string> } | null {
  if (!runtime.recorded) return null;
  if (runtime.change === "package") return { key: "backend-upgrade.runtime.package", vars: {} };
  if (runtime.change !== "native" || !runtime.native) return null;
  return runtime.previous && runtime.previous !== runtime.native
    ? { key: "backend-upgrade.runtime.nativeFrom", vars: { from: runtime.previous, to: runtime.native } }
    : { key: "backend-upgrade.runtime.native", vars: { version: runtime.native } };
}

/** modeKeys for a run: from its runtime change (recorded or guessed). */
export function runModeKeys(runtime: RunRuntime): ReturnType<typeof modeKeys> {
  return modeKeys(runtime.change === "none" ? "reload" : "full", runtime.change === "native" ? (runtime.native ?? "native") : null);
}
