// Pure helpers of 后端更新 (cutex backend-upgrade): what the host needs attention for, the run's step
// list, refusal / phase wording keys. No React, no store: unit-tested (test/backendUpgrade.test.ts).
import { isUpgradeCancellable, isUpgradeServicesDown, isUpgradeTerminal, type UpgradeApplyRequest, type UpgradeEvent, type UpgradeMode, type UpgradePackageRun, type UpgradePhase, type UpgradeRefusal, type UpgradeRun, type UpgradeStatus } from "../../../../shared/backendUpgrade";

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
