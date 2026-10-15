// Runtime package upgrade (cutex `runtime-package-upgrade`): explicit-launch agents pin a runtime
// bundle (native app-server + cutex-mcp facade) and fall behind the selected one with every
// release. Pure helpers for Settings → 运行时 (components/settings/RuntimePackagesSection) and its red
// dot; the store is lib/runtimePackageStore.
import type { OutdatedRuntimeAgent, RuntimePackageRun, RuntimePackageRunEvent, RuntimePackageRunItem, RuntimePackageStep, RuntimePackageSummary, RuntimePackagesView, UpdateStatus } from "../../../shared/ipc";
import { updateButtonVisible } from "../../../shared/update";
import { translate } from "../i18n";

export const RUNTIME_PACKAGES_FEATURE = "runtime-package-upgrade";
/** Host event (session `cutex.host`): the run header + the changed item (RuntimePackageRunEvent) on start,
 *  every item step / state change, and finish. */
export const RUN_UPDATED_METHOD = "cutex/runtimePackages/runUpdated";

/** 「运行时 r50（cutex r209）」: the native release and the cutex-mcp facade it was bundled with, the
 *  parts that are known; null when nothing is (unreadable manifest). */
export function packageLabel(p: RuntimePackageSummary | null | undefined): string | null {
  if (!p) return null;
  const native = p.nativeRelease ?? p.nativeVersion;
  const facade = p.facadeRelease;
  if (!native && !facade) return null;
  if (!native) return translate("runtimePackages.label.facade", { facade: facade! });
  return facade ? translate("runtimePackages.label.both", { native, facade }) : translate("runtimePackages.label.native", { native });
}

export type AgentRuntimeState = "busy" | "offline" | "online";

/** 忙 wins over 离线 (an offline agent with an active turn is still not upgradeable). */
export function agentRuntimeState(agent: Pick<OutdatedRuntimeAgent, "busy" | "online">): AgentRuntimeState {
  if (agent.busy) return "busy";
  return agent.online ? "online" : "offline";
}

/** Agents a run would try now (not busy). */
export function idleCount(agents: readonly OutdatedRuntimeAgent[]): number {
  return agents.filter((a) => !a.busy).length;
}

/** The red dot on 关于 / 设置: outdated agents on the connected host, or a desktop update. */
export function aboutAttention(outdated: number, update: UpdateStatus | null): boolean {
  return outdated > 0 || updateButtonVisible(update);
}

/**
 * Fold a `runUpdated` event into the cached list. A running run becomes `activeRun`; a finished one
 * becomes `lastRun` (the caller then refetches the list: the agents moved). Stale events (an older
 * run than the active one) are ignored.
 */
export function applyRunUpdate(view: RuntimePackagesView, run: RuntimePackageRun): { view: RuntimePackagesView; finished: boolean } {
  const active = view.activeRun;
  if (active && active.runId !== run.runId && run.startedAt < active.startedAt) return { view, finished: false };
  if (run.state === "running") return { view: { ...view, activeRun: run }, finished: false };
  const lastRun = !view.lastRun || view.lastRun.runId === run.runId || (run.finishedAt ?? run.startedAt) >= (view.lastRun.finishedAt ?? view.lastRun.startedAt) ? run : view.lastRun;
  const activeRun = active && active.runId !== run.runId ? active : null;
  return { view: { ...view, activeRun, lastRun }, finished: true };
}

/** `run` with an event's header fields and (when present) its item merged in by agent id. */
function mergeRunEvent(run: RuntimePackageRun, event: RuntimePackageRunEvent): RuntimePackageRun {
  const { item } = event;
  const items = item ? run.items.map((i) => (i.cutexSessionId === item.cutexSessionId ? item : i)) : run.items;
  return {
    ...run,
    state: event.status,
    revertOf: event.revertOf,
    startedAt: event.startedAt,
    finishedAt: event.finishedAt,
    currentAgentId: event.currentAgentId,
    counts: event.counts,
    items,
  };
}

export type RunEventResult =
  | { kind: "applied"; view: RuntimePackagesView; finished: boolean }
  /** Not applicable to the cached view (a run not seen yet, or an item it does not list): fetch the full run. */
  | { kind: "fetch"; runId: string }
  /** An older run than the active one: ignore. */
  | { kind: "stale" };

/**
 * Fold a `runUpdated` delta into the cached list: merge the header and the item (by agent id) into
 * the cached copy of that run (active or last), then hand it to applyRunUpdate. A run the view does
 * not hold (started elsewhere, or a missed start) or an item it does not list asks for a fetch.
 */
export function applyRunEvent(view: RuntimePackagesView, event: RuntimePackageRunEvent): RunEventResult {
  const active = view.activeRun;
  if (active && active.runId !== event.runId && event.startedAt < active.startedAt) return { kind: "stale" };
  const cached = active?.runId === event.runId ? active : view.lastRun?.runId === event.runId ? view.lastRun : null;
  if (!cached) return { kind: "fetch", runId: event.runId };
  if (event.item && !cached.items.some((i) => i.cutexSessionId === event.item!.cutexSessionId)) return { kind: "fetch", runId: event.runId };
  return { kind: "applied", ...applyRunUpdate(view, mergeRunEvent(cached, event)) };
}

/** A well-formed `runUpdated` params object (the daemon's shape; anything else is dropped). */
export function asRunEvent(params: unknown): RuntimePackageRunEvent | null {
  if (!params || typeof params !== "object") return null;
  const p = params as Partial<RuntimePackageRunEvent>;
  if (typeof p.runId !== "string" || typeof p.status !== "string" || typeof p.startedAt !== "string" || !p.counts || typeof p.counts !== "object") return null;
  if (p.item !== undefined && (!p.item || typeof p.item.cutexSessionId !== "string")) return null;
  return p as RuntimePackageRunEvent;
}

export type ItemOutcome =
  | { kind: "pending" }
  /** Moved as a repair: the pinned package no longer existed (not revertable). */
  | { kind: "repaired"; backOnline: boolean | null }
  | { kind: "running"; step: RuntimePackageStep | null }
  | { kind: "moved" }
  /** Moved, but it was online before and did not come back (code onlineFailed). */
  | { kind: "movedOffline"; reason: string | null }
  | { kind: "skipped"; code: string; reason: string | null }
  | { kind: "failed"; code: string; reason: string | null };

export function itemOutcome(item: RuntimePackageRunItem): ItemOutcome {
  switch (item.state) {
    case "pending":
      return { kind: "pending" };
    case "running":
      return { kind: "running", step: item.step };
    case "moved":
      if (item.repair) return { kind: "repaired", backOnline: item.backOnline };
      return item.backOnline === false || item.code === "onlineFailed" ? { kind: "movedOffline", reason: item.reason } : { kind: "moved" };
    case "skipped":
      return { kind: "skipped", code: item.code ?? "unknown", reason: item.reason };
    default:
      return { kind: "failed", code: item.code ?? "unknown", reason: item.reason };
  }
}

/**
 * A short explanation for an item's raw cutex reason, when it is one of the known cases (the raw
 * reason stays available as detail): a leftover runtime claim of an exited process, a recorded PID
 * that is in use (left alone), pinned runtime files that were deleted, or a repair.
 */
export type ItemNote = "staleClaim" | "stalePid" | "packageMissing" | "repaired";

export function itemNote(item: Pick<RuntimePackageRunItem, "state" | "code" | "reason" | "repair">): ItemNote | null {
  const reason = item.reason ?? "";
  if (item.repair && item.state === "moved") return "repaired";
  if (item.code === "staleClaim") return /\bis running\b/.test(reason) ? "stalePid" : "staleClaim";
  if (reason.includes("offline/no claim")) return "staleClaim";
  if (reason.includes("current runtime package is unavailable")) return "packageMissing";
  return null;
}

/** Items worth listing under a finished run's summary: everything that did not simply move. */
export function noteworthyItems(run: RuntimePackageRun): RuntimePackageRunItem[] {
  return run.items.filter((i) => itemOutcome(i).kind !== "moved");
}

/**
 * What 撤销这次升级 reverts, shown on the last run's block: the upgrade run cutex reports as
 * `revertable` (its agents not moved back yet) when that is the last run, or the upgrade a last
 * revert run did not finish moving back (retry the rest). Null when nothing is left, or while a run
 * is active. Older daemons without `revertable`: a finished upgrade run with moves and no revert.
 */
export function revertTarget(view: RuntimePackagesView | null): { runId: string; agents: number; shownOn: string } | null {
  const run = view?.lastRun;
  if (!run || view.activeRun || run.state === "running") return null;
  if (view.revertable === undefined) {
    if (run.kind !== "upgrade" || run.counts.moved === 0 || run.revertedBy.length > 0) return null;
    return { runId: run.runId, agents: run.counts.moved, shownOn: run.runId };
  }
  const target = view.revertable;
  if (!target || target.agentIds.length === 0) return null;
  const onRun = run.kind === "upgrade" ? run.runId : run.revertOf;
  if (onRun !== target.runId) return null;
  return { runId: target.runId, agents: target.agentIds.length, shownOn: run.runId };
}

/** The pinned → selected label pair for one agent row. */
export function agentPackages(agent: OutdatedRuntimeAgent, selected: RuntimePackageSummary | null): { current: string | null; target: string | null } {
  return { current: agent.current.readable ? packageLabel(agent.current) : null, target: packageLabel(selected) };
}
