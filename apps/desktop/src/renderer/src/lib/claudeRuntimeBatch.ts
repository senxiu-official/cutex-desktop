// Desktop-side half of Settings → 运行时 → 升级空闲的. cutex's runtime-package run owns Codex
// app-server bundles; Claude pins use the separate claude-runtime-repin API. This module makes the
// latter look like the same per-agent run without changing either wire contract.
import type { SessionResource } from "@cutex-desktop/protocol";
import type { OutdatedRuntimeAgent, RuntimePackageRun, RuntimePackageRunItem, RuntimePackageSummary, SidebarSnapshot } from "../../../shared/ipc";
import {
  CLAUDE_REPIN_FEATURE,
  SESSION_CLAUDE_RUNTIME_FEATURE,
  repinOffer,
  sessionRepinOffer,
  type ClaudeRepinResult,
  type ClaudeRuntimeView,
} from "../../../shared/claudeRepin";
import { isOwnerFeatures } from "../../../shared/users";
import { runtimeOf } from "./agentList";
import { isHostBusyActionPending } from "./hostBusyActions";

export interface OutdatedClaudeRuntimeAgent {
  cutexSessionId: string;
  name: string;
  current: string;
  target: string;
  runtimeStatus: string;
  online: boolean;
  busy: boolean;
  busyReason: "activeTurn" | "threadActive" | null;
  activeTurnId: string | null;
  threadStatus: string | null;
  runtimeGeneration: number | null;
}

export interface ClaudeRuntimeBatch {
  /** The cutex runtime-package run started by the same click; null for a Claude-only batch. */
  nativeRunId: string | null;
  run: RuntimePackageRun;
}

export interface ClaudeRuntimeBatchApi {
  claudeRuntime(sessionId: string): Promise<ClaudeRuntimeView>;
  repinClaudeRuntime(sessionId: string, target: string): Promise<ClaudeRepinResult>;
  /** Must delegate to store.sessionAction bound to the batch's original host (not raw daemon IPC). */
  sessionAction(sessionId: string, method: "cutex/runtime/offline" | "cutex/runtime/online", params: Record<string, unknown>): Promise<unknown>;
}

export function combinedRuntimeCounts(native: readonly Pick<OutdatedRuntimeAgent, "busy">[], claude: readonly Pick<OutdatedClaudeRuntimeAgent, "busy">[]): { outdated: number; idle: number } {
  return { outdated: native.length + claude.length, idle: native.filter((agent) => !agent.busy).length + claude.filter((agent) => !agent.busy).length };
}

function threadStatusType(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}

/** The same idle rule as cutex runtime-package-upgrade (`AgentSnapshot::busy_reason`). */
export function claudeBusyReason(session: Pick<SessionResource, "runtime">): "activeTurn" | "threadActive" | null {
  if (session.runtime.activeTurnId) return "activeTurn";
  const status = threadStatusType(session.runtime.threadStatus);
  const idle = status === null || status === "idle" || status === "notLoaded";
  return session.runtime.status !== "offline" && !idle ? "threadActive" : null;
}

/** Claude agents whose pin is older than the host-selected claude-rN and is not already pending. */
export function outdatedClaudeRuntimeAgents(features: ReadonlySet<string>, sidebar: SidebarSnapshot | null | undefined): OutdatedClaudeRuntimeAgent[] {
  if (!sidebar || !features.has(CLAUDE_REPIN_FEATURE) || !features.has(SESSION_CLAUDE_RUNTIME_FEATURE) || !isOwnerFeatures(features)) return [];
  const host = sidebar.claudeRuntime;
  if (!host) return [];
  return sidebar.active.flatMap((session) => {
    if (session.lifecycle === "retired" || runtimeOf(session) !== "claude") return [];
    const offer = sessionRepinOffer(session.runtime.claudeRuntime, host);
    if (!offer) return [];
    const busyReason = claudeBusyReason(session);
    return [{
      cutexSessionId: session.cutexSessionId,
      name: session.displayName,
      current: offer.from,
      target: offer.to,
      runtimeStatus: session.runtime.status,
      online: session.runtime.status !== "offline",
      busy: busyReason !== null,
      busyReason,
      activeTurnId: session.runtime.activeTurnId,
      threadStatus: threadStatusType(session.runtime.threadStatus),
      runtimeGeneration: typeof session.runtime.runtimeGeneration === "number" ? session.runtime.runtimeGeneration : null,
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function item(agent: OutdatedClaudeRuntimeAgent): RuntimePackageRunItem {
  const busyReason = agent.busyReason === "activeTurn" && agent.activeTurnId
    ? `a turn is running (${agent.activeTurnId}); retry later`
    : agent.busyReason === "threadActive"
      ? `the thread is not idle (${agent.threadStatus ?? "unknown"}); retry later`
      : null;
  return {
    cutexSessionId: agent.cutexSessionId,
    name: agent.name,
    state: agent.busy ? "skipped" : "pending",
    step: null,
    code: agent.busy ? "busy" : null,
    reason: busyReason,
    wasOnline: agent.online,
    backOnline: null,
    previousRuntimeVersion: agent.current,
    targetRuntimeVersion: agent.target,
    previousFacadeRelease: null,
    targetFacadeRelease: null,
    actionId: null,
    committedAt: null,
    previousContract: null,
    targetContract: null,
  };
}

export function runtimeRunCounts(items: readonly RuntimePackageRunItem[]): RuntimePackageRun["counts"] {
  const count = (state: RuntimePackageRunItem["state"]) => items.filter((entry) => entry.state === state).length;
  return { total: items.length, pending: count("pending"), moved: count("moved"), skipped: count("skipped"), failed: count("failed") };
}

function selectedClaudeRuntime(target: string): RuntimePackageSummary {
  return {
    manifest: null,
    nativePath: null,
    nativeVersion: target,
    nativeRelease: target,
    facadePath: null,
    facadeRelease: null,
    readable: true,
  };
}

export function createClaudeRuntimeBatch(agents: readonly OutdatedClaudeRuntimeAgent[], nativeRunId: string | null, now = new Date().toISOString()): ClaudeRuntimeBatch {
  const items = agents.map(item);
  const target = agents[0]?.target ?? "claude-runtime";
  const run: RuntimePackageRun = {
    runId: `desktop-claude-${globalThis.crypto?.randomUUID?.() ?? now.replace(/\W/g, "")}`,
    kind: "upgrade",
    revertOf: null,
    revertedBy: [],
    state: items.some((entry) => entry.state === "pending") ? "running" : "completed",
    startedAt: now,
    finishedAt: items.some((entry) => entry.state === "pending") ? null : now,
    selected: selectedClaudeRuntime(target),
    counts: runtimeRunCounts(items),
    currentAgentId: null,
    items,
  };
  return { nativeRunId, run };
}

function replaceItem(batch: ClaudeRuntimeBatch, id: string, patch: Partial<RuntimePackageRunItem>): ClaudeRuntimeBatch {
  const items = batch.run.items.map((entry) => entry.cutexSessionId === id ? { ...entry, ...patch } : entry);
  return { ...batch, run: { ...batch.run, items, counts: runtimeRunCounts(items) } };
}

/** Run every non-busy Claude item in order and publish immutable snapshots for Zustand. */
export async function runClaudeRuntimeBatch(
  initial: ClaudeRuntimeBatch,
  api: ClaudeRuntimeBatchApi,
  onUpdate: (batch: ClaudeRuntimeBatch) => void,
  onRuntime?: (view: ClaudeRuntimeView) => void,
  refreshAgent?: (sessionId: string) => Promise<OutdatedClaudeRuntimeAgent | null>,
): Promise<ClaudeRuntimeBatch> {
  let batch = initial;
  for (const pending of initial.run.items.filter((entry) => entry.state === "pending")) {
    const id = pending.cutexSessionId;
    batch = replaceItem(batch, id, { state: "running", step: "review" });
    batch = { ...batch, run: { ...batch.run, currentAgentId: id } };
    onUpdate(batch);
    try {
      const fresh = refreshAgent ? await refreshAgent(id) : null;
      if (fresh?.busy) {
        const busy = item(fresh);
        batch = replaceItem(batch, id, { state: "skipped", step: null, code: "busy", reason: busy.reason });
        batch = { ...batch, run: { ...batch.run, currentAgentId: null } };
        onUpdate(batch);
        continue;
      }
      if (fresh && fresh.target !== pending.targetRuntimeVersion) {
        batch = replaceItem(batch, id, { state: "failed", step: null, code: "selectedChanged", reason: `the selected Claude runtime changed from ${pending.targetRuntimeVersion ?? "unknown"} to ${fresh.target}` });
        batch = { ...batch, run: { ...batch.run, currentAgentId: null } };
        onUpdate(batch);
        continue;
      }
      const view = await api.claudeRuntime(id);
      onRuntime?.(view);
      const offer = repinOffer(view);
      if (!offer) {
        const current = view.pending?.release ?? view.current.release;
        batch = current === pending.targetRuntimeVersion
          ? replaceItem(batch, id, { state: "skipped", step: null, code: "alreadyCurrent", reason: null })
          : replaceItem(batch, id, { state: "failed", step: null, code: "notEligible", reason: view.selectedError ?? "the Claude runtime is no longer upgradeable" });
      } else if (offer.to !== pending.targetRuntimeVersion) {
        batch = replaceItem(batch, id, { state: "failed", step: null, code: "selectedChanged", reason: `the selected Claude runtime changed from ${pending.targetRuntimeVersion ?? "unknown"} to ${offer.to}` });
      } else if (offer.refusal !== null) {
        batch = replaceItem(batch, id, { state: "failed", step: null, code: "claudeRepinRefused", reason: offer.refusal || "cutex refused the Claude runtime change" });
      } else {
        const wasOnline = fresh?.online ?? pending.wasOnline;
        let stopped = false;
        if (wasOnline) {
          batch = replaceItem(batch, id, { state: "running", step: "offline", wasOnline: true });
          onUpdate(batch);
          try {
            await api.sessionAction(id, "cutex/runtime/offline", {
              ...(fresh?.runtimeGeneration === null || fresh?.runtimeGeneration === undefined ? {} : { expectedRuntimeGeneration: fresh.runtimeGeneration }),
              reason: "desktop runtime package run",
            });
            stopped = true;
          } catch (error) {
            let reason = error instanceof Error ? error.message : String(error);
            try {
              await api.sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false, reason: "desktop runtime package run rollback" });
            } catch (onlineError) {
              if (!isHostBusyActionPending(onlineError)) reason += `; back online failed: ${onlineError instanceof Error ? onlineError.message : String(onlineError)}`;
            }
            batch = replaceItem(batch, id, { state: "failed", step: null, code: "offlineFailed", reason });
          }
        }
        if (wasOnline && !stopped) {
          // The stop failed, so the pin must not be changed. The existing runtime remains untouched.
          batch = { ...batch, run: { ...batch.run, currentAgentId: null } };
          onUpdate(batch);
          continue;
        }
        batch = replaceItem(batch, id, { state: "running", step: "apply" });
        onUpdate(batch);
        let result: ClaudeRepinResult;
        try {
          result = await api.repinClaudeRuntime(id, offer.to);
        } catch (error) {
          let reason = error instanceof Error ? error.message : String(error);
          if (wasOnline) {
            try {
              await api.sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false, reason: "desktop runtime package run rollback" });
            } catch (onlineError) {
              if (!isHostBusyActionPending(onlineError)) reason += `; back online failed: ${onlineError instanceof Error ? onlineError.message : String(onlineError)}`;
            }
          }
          batch = replaceItem(batch, id, { state: "failed", step: null, code: "claudeRepinFailed", reason });
          batch = { ...batch, run: { ...batch.run, currentAgentId: null } };
          onUpdate(batch);
          continue;
        }
        if (!result.ok) {
          let reason = result.error.message;
          if (wasOnline) {
            try {
              await api.sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false, reason: "desktop runtime package run rollback" });
            } catch (error) {
              if (!isHostBusyActionPending(error)) reason += `; back online failed: ${error instanceof Error ? error.message : String(error)}`;
            }
          }
          batch = replaceItem(batch, id, { state: "failed", step: null, code: result.error.code || "claudeRepinRefused", reason });
        } else {
          onRuntime?.(result.done.runtime);
          const done = result.done.result;
          let backOnline: boolean | null = null;
          let doneReason = done.outcome === "deferred" && wasOnline ? null : done.reason;
          if (wasOnline) {
            batch = replaceItem(batch, id, { state: "running", step: "online" });
            onUpdate(batch);
            try {
              const online = await api.sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false, reason: "desktop runtime package run" });
              const status = (online as { status?: unknown } | null)?.status;
              backOnline = typeof status !== "string" || status === "online" || status === "starting";
              if (!backOnline) doneReason = [doneReason, `back online failed: ${status}`].filter(Boolean).join("; ");
            } catch (error) {
              backOnline = isHostBusyActionPending(error) ? null : false;
              if (!isHostBusyActionPending(error)) doneReason = [doneReason, `back online failed: ${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join("; ");
            }
          }
          if (done.outcome === "applied" || done.outcome === "deferred") {
            batch = replaceItem(batch, id, {
              state: "moved",
              step: null,
              code: null,
              reason: doneReason,
              backOnline,
              previousRuntimeVersion: done.previous,
              targetRuntimeVersion: done.target,
              committedAt: new Date().toISOString(),
            });
          } else if (done.outcome === "unchanged") {
            batch = replaceItem(batch, id, { state: "skipped", step: null, code: "alreadyCurrent", reason: doneReason, backOnline });
          } else {
            batch = replaceItem(batch, id, { state: "failed", step: null, code: "claudeRepinRefused", reason: doneReason ?? "cutex skipped the Claude runtime change", backOnline });
          }
        }
      }
    } catch (error) {
      batch = replaceItem(batch, id, isHostBusyActionPending(error)
        ? { state: "skipped", step: null, code: "hostBusy", reason: null, backOnline: null }
        : { state: "failed", step: null, code: "claudeRepinFailed", reason: error instanceof Error ? error.message : String(error) });
    }
    batch = { ...batch, run: { ...batch.run, currentAgentId: null } };
    onUpdate(batch);
  }
  const finishedAt = new Date().toISOString();
  batch = { ...batch, run: { ...batch.run, state: "completed", currentAgentId: null, finishedAt } };
  onUpdate(batch);
  return batch;
}

/** One visual run/result list for the native cutex run and this click's Claude repins. */
export function combineRuntimeRuns(native: RuntimePackageRun | null | undefined, claude: ClaudeRuntimeBatch | null | undefined): RuntimePackageRun | null {
  if (!native) return claude?.run ?? null;
  if (!claude || claude.nativeRunId !== native.runId) return native;
  const items = [...native.items, ...claude.run.items];
  const running = native.state === "running" || claude.run.state === "running";
  const interrupted = native.state === "interrupted" || claude.run.state === "interrupted";
  return {
    ...native,
    state: running ? "running" : interrupted ? "interrupted" : "completed",
    startedAt: native.startedAt < claude.run.startedAt ? native.startedAt : claude.run.startedAt,
    finishedAt: running ? null : [native.finishedAt, claude.run.finishedAt].filter((value): value is string => !!value).sort().at(-1) ?? null,
    counts: runtimeRunCounts(items),
    currentAgentId: native.currentAgentId ?? claude.run.currentAgentId,
    items,
  };
}

export function displayedRuntimeRuns(
  native: { activeRun: RuntimePackageRun | null; lastRun: RuntimePackageRun | null },
  claude: ClaudeRuntimeBatch | null | undefined,
): { active: RuntimePackageRun | null; last: RuntimePackageRun | null } {
  if (native.activeRun) return { active: combineRuntimeRuns(native.activeRun, claude), last: native.lastRun };
  if (claude?.run.state === "running") {
    const finishedNative = claude.nativeRunId === native.lastRun?.runId ? native.lastRun : null;
    return { active: combineRuntimeRuns(finishedNative, claude), last: finishedNative ? null : native.lastRun };
  }
  const newerNativeAfterClaudeOnly = claude?.nativeRunId === null && native.lastRun
    && native.lastRun.startedAt > (claude.run.finishedAt ?? claude.run.startedAt);
  if (claude && !newerNativeAfterClaudeOnly && (claude.nativeRunId === null || claude.nativeRunId === native.lastRun?.runId)) {
    return { active: null, last: combineRuntimeRuns(claude.nativeRunId ? native.lastRun : null, claude) };
  }
  return { active: null, last: native.lastRun };
}
