import { describe, expect, it } from "vitest";
import type { UpgradeRun, UpgradeStatus } from "../src/shared/backendUpgrade";
import { applyRequest, canCancel, formatDuration, intervalChoices, intervalWords, minutesOf, refusalKey, runPhases, runSteps, upgradeAttention } from "../src/renderer/src/modules/backend-upgrade/model";
import { OWNER_ONLY_CAPABILITIES } from "../src/shared/users";

const SETTINGS = { channel: "release" as const, source: "https://example.invalid", checkIntervalHours: 6, autoStage: true, autoApply: false, packageRun: "after" as const, packageRunBatch: 5, maxWaitSecs: 3600 };

function status(over: Partial<UpgradeStatus> = {}): UpgradeStatus {
  return { managed: true, serviceManager: "systemd", build: {}, installed: { release: "r240" }, installedReleases: ["r240"], settings: SETTINGS, trustedKeys: ["0123456789ABCDEF"], ...over };
}

function run(over: Partial<UpgradeRun> = {}): UpgradeRun {
  return { runId: "upg-000000000001", kind: "apply", fromRelease: "r240", toRelease: "r241", mode: "reload", class: "rollback-safe", phase: "queued", createdAt: "2026-10-15T00:00:00Z", maxWaitSecs: 3600, packageRun: "after", timeline: [], ...over };
}

const at = (phase: UpgradeRun["phase"], i: number) => ({ phase, at: `2026-10-15T00:00:${String(i).padStart(2, "0")}Z` });

describe("backend upgrade attention (nav dot)", () => {
  it("is quiet on an unmanaged or up-to-date host", () => {
    expect(upgradeAttention(undefined)).toBe("none");
    expect(upgradeAttention(status({ managed: false, available: { release: "r241", sequence: 241, tag: "t", manifestSha256: "x", class: "reload-safe", mode: "reload" } }))).toBe("none");
    expect(upgradeAttention(status())).toBe("none");
  });

  it("calls out available, staged, a running run and needs-owner (also from the event)", () => {
    const available = { release: "r241", sequence: 241, tag: "t", manifestSha256: "x", class: "reload-safe" as const, mode: "reload" as const };
    expect(upgradeAttention(status({ available }))).toBe("available");
    expect(upgradeAttention(status({ available, staged: { release: "r241", sequence: 241, stagedAt: "", manifestSha256: "x", preflightOk: true } }))).toBe("staged");
    expect(upgradeAttention(status({ run: run({ phase: "waiting-idle" }) }))).toBe("running");
    expect(upgradeAttention(status({ run: run({ phase: "committed" }) }))).toBe("none");
    expect(upgradeAttention(status({ managed: false, run: run({ phase: "needs-owner" }) }))).toBe("needsOwner");
    expect(upgradeAttention(status(), { reason: "state", hostId: "h", run: { runId: "upg-000000000001", kind: "apply", phase: "stopping", fromRelease: "r240", toRelease: "r241", servicesDown: true }, available: null, staged: null })).toBe("running");
  });
});

describe("backend upgrade run steps", () => {
  it("lists the phases of reload, full + during and rollback runs", () => {
    expect(runPhases(run())).toEqual(["waiting-idle", "stopping", "backing-up", "swapping", "starting", "waiting-ready", "verifying"]);
    expect(runPhases(run({ mode: "full", packageRun: "during" }))).toEqual(["waiting-idle", "quiescing", "stopping", "backing-up", "swapping", "starting", "waiting-ready", "package-run", "restoring-online", "verifying"]);
    expect(runPhases(run({ kind: "rollback" }))).toEqual(["waiting-idle", "stopping", "backing-up", "swapping", "starting", "verifying"]);
  });

  it("shows the current phase as current after the run went back (quiescing → waiting-idle)", () => {
    const steps = runSteps(run({ mode: "full", packageRun: "during", phase: "waiting-idle", timeline: [at("waiting-idle", 1), at("quiescing", 2), at("waiting-idle", 3)] }));
    expect(steps.map((s) => [s.phase, s.state]).slice(0, 3)).toEqual([
      ["waiting-idle", "current"],
      ["quiescing", "pending"],
      ["stopping", "pending"],
    ]);
    // rolling-back is no step: the one it left (last on the timeline) is the failed one.
    const rb = runSteps(run({ phase: "rolling-back", timeline: [at("waiting-idle", 1), at("stopping", 2), at("backing-up", 3), at("swapping", 4), at("rolling-back", 5)] }));
    expect(rb.map((s) => s.state)).toEqual(["done", "done", "done", "failed", "pending", "pending", "pending"]);
  });

  it("marks done / current / pending while it runs", () => {
    const steps = runSteps(run({ phase: "backing-up", timeline: [at("queued", 0), at("waiting-idle", 1), at("stopping", 2), at("backing-up", 3)] }));
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current", "pending", "pending", "pending", "pending"]);
    expect(steps[2]!.at).toBe("2026-10-15T00:00:03Z");
  });

  it("marks the step a failed run reached; a deferred one stops neutral; a committed one is all done", () => {
    const failed = runSteps(run({ phase: "rolled-back", timeline: [at("waiting-idle", 1), at("stopping", 2), at("backing-up", 3), at("swapping", 4), at("starting", 5), at("waiting-ready", 6), at("verifying", 7), at("rolling-back", 8), at("rolled-back", 9)] }));
    expect(failed.at(-1)!.state).toBe("failed");
    const deferred = runSteps(run({ phase: "deferred", timeline: [at("waiting-idle", 1), at("deferred", 2)] }));
    expect(deferred.map((s) => s.state)).toEqual(["stopped", "pending", "pending", "pending", "pending", "pending", "pending"]);
    expect(runSteps(run({ phase: "committed" })).every((s) => s.state === "done")).toBe(true);
  });

  it("offers cancel only before anything changed", () => {
    expect(canCancel(run({ phase: "waiting-idle" }))).toBe(true);
    expect(canCancel(run({ phase: "waiting-idle", cancelRequested: true }))).toBe(false);
    expect(canCancel(run({ phase: "stopping" }))).toBe(false);
    expect(canCancel(null)).toBe(false);
  });
});

describe("backend upgrade wording helpers", () => {
  it("maps refusals to keys", () => {
    expect(refusalKey({ code: "upgrade_blocked", reason: "unmanaged_install" })).toBe("blocked.unmanaged_install");
    expect(refusalKey({ code: "upgrade_blocked", reason: "new_reason" })).toBe("blocked.other");
    expect(refusalKey({ code: "one_way_unconfirmed" })).toBe("one_way_unconfirmed");
    expect(refusalKey({ code: "something_new" })).toBeNull();
  });

  it("formats durations, minutes and interval choices", () => {
    expect(formatDuration(7400)).toBe("7 s");
    expect(formatDuration(185_000)).toBe("3 min 05 s");
    expect(formatDuration(3_720_000)).toBe("1 h 02 min");
    expect(formatDuration(null)).toBeNull();
    expect(minutesOf(3600)).toBe(60);
    expect(minutesOf(61)).toBe(2);
    expect(intervalChoices(6)).toEqual([0, 1, 6, 12, 24, 72, 168]);
    expect(intervalChoices(48)).toEqual([0, 1, 6, 12, 24, 48, 72, 168]);
  });

  it("words check intervals as hours / days / weeks", () => {
    expect(intervalWords(0)).toEqual({ key: "backend-upgrade.settings.intervalOff" });
    expect(intervalWords(1)).toEqual({ key: "backend-upgrade.settings.intervalHourly" });
    expect(intervalWords(6)).toEqual({ key: "backend-upgrade.settings.intervalHours", n: 6 });
    expect(intervalWords(24)).toEqual({ key: "backend-upgrade.settings.intervalDaily" });
    expect(intervalWords(72)).toEqual({ key: "backend-upgrade.settings.intervalDays", n: 3 });
    expect(intervalWords(168)).toEqual({ key: "backend-upgrade.settings.intervalWeekly" });
    expect(intervalWords(336)).toEqual({ key: "backend-upgrade.settings.intervalWeeks", n: 2 });
  });

  it("treats backend-upgrade as owner-only", () => {
    expect(OWNER_ONLY_CAPABILITIES).toContain("backend-upgrade");
  });
});

describe("backend upgrade apply body", () => {
  it("sends max wait / package run only when edited, the one-way confirmation when needed", () => {
    expect(applyRequest({ release: "r241", forceFull: false, effectiveMode: "full", waitMin: null, packageRun: null, oneWay: false })).toEqual({ release: "r241" });
    expect(applyRequest({ release: "r241", forceFull: true, effectiveMode: "full", waitMin: 5, packageRun: "during", oneWay: true })).toEqual({ release: "r241", mode: "full", maxWaitSecs: 300, packageRun: "during", confirmOneWay: "r241" });
    expect(applyRequest({ release: "r241", forceFull: false, effectiveMode: "reload", waitMin: 0, packageRun: "during", oneWay: false })).toEqual({ release: "r241", maxWaitSecs: 0 });
  });
});
