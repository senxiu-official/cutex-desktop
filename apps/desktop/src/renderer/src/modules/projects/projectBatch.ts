// 项目 table batch actions (owner 2026-11-25). cutex has no batch endpoint yet (r295 adds
// `project-lifecycle-batch-v1`): each project is one call on its own host, BATCH_CONCURRENCY at a time (lib/runBounded);
// every item settles with its own result, a failure never stops the others or undoes what went through.
//
// What a write proves (shared/projectBatchOutcome, decided in main): a refusal is `failed`; a lost reply is `unknown`,
// never a failure to retry blindly. So every batch first reads each involved host's state again (one explicit sidebar
// read per host, also after an earlier `unknown`), and decides from the snapshot that read returned, never from what
// the store holds: a project already where the batch would take it is `skipped`, and a host whose read did not return a
// snapshot gets no write. After the writes each host is read once more the same way, and an `unknown` archive /
// restore that read shows applied becomes `done`. With r295's endpoint, 409 `request_outcome_unknown` means the same: refresh.
//
// - 归档 / 恢复: the project mutation `archive` / `restore` against the revision just read (as the 设置 tab's 归档项目,
//   without its 「同时归档主管」: the Director and members stay as they are).
// - 暂停 / 恢复成员 (whole project, `project-run-control-v1`): the project's run control alone (not the delegation
//   snapshot's session lists), then pause every member after its current 回合 (scope all) or lift that pause. A pause
//   cutex took but members still finishing their 回合 is `settling`, not done. Only a pause of every member counts as
//   already paused: a members-only pause (the Director still running) gets the whole-project pause where cutex allows it.
//
// The batch lives here, not in the table: leaving the page (a project, 新建项目) keeps it running, its results and its
// guard; coming back shows them, and a second batch cannot start before the first settles. Across windows main holds
// the one lease (main/projectBatchLease): a window whose batch would overlap another's is told so and sends nothing.
import { useSyncExternalStore } from "react";
import type { ProjectSummary } from "@cutex-desktop/protocol";
import { useApp } from "../../store";
import { api } from "../../bridge";
import { hostApi } from "../../lib/hostLists";
import type { SidebarSnapshot } from "../../../../shared/ipc";
import { BATCH_CONCURRENCY, runBounded } from "../../lib/runBounded";
import type { ProjectBatchLeaseRequest, ProjectBatchLeaseResult, WriteOutcome } from "../../../../shared/projectBatchOutcome";
import type { ProjectFacts } from "./projectTable";

export type BatchKind = "archive" | "restore" | "pause" | "resume";

export interface BatchItemResult {
  key: string;
  name: string;
  /**
   * done: applied; settling: taken, still taking effect (members finishing their 回合); skipped: nothing to do (already
   * archived / paused …); unknown: sent, outcome not known (read again before another write); failed: refused or not sent.
   */
  status: "done" | "settling" | "skipped" | "unknown" | "failed";
  error?: string;
}

export interface ProjectBatch {
  kind: BatchKind;
  /** The projects in it (keys), in order. */
  keys: readonly string[];
  total: number;
  done: number;
  /** null while it runs. */
  results: readonly BatchItemResult[] | null;
}

/** Another window's batch held main's lease when this one was asked for (kind null: main did not answer). */
export type BatchElsewhere = { kind: BatchKind | null; total: number | null };

let current: ProjectBatch | null = null;
let elsewhere: BatchElsewhere | null = null;
const listeners = new Set<() => void>();
function set(next: ProjectBatch | null) {
  current = next;
  for (const l of listeners) l();
}
function setElsewhere(next: BatchElsewhere | null) {
  elsewhere = next;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export function useProjectBatch(): ProjectBatch | null {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
/** The last batch refused because another window's was running (null: none, or the notice was closed). */
export function useProjectBatchElsewhere(): BatchElsewhere | null {
  return useSyncExternalStore(subscribe, () => elsewhere, () => elsewhere);
}
export function dismissProjectBatchElsewhere(): void {
  setElsewhere(null);
}
export function projectBatchRunning(): boolean {
  return !!current && current.results === null;
}
/** Closes the last batch's results (not while it runs). */
export function dismissProjectBatch(): void {
  if (!projectBatchRunning()) set(null);
}
/** What to keep selected and in view after a batch: what failed or whose outcome is unknown. */
export function batchRetryKeys(batch: ProjectBatch | null): string[] {
  return batch?.results ? batch.results.filter((r) => r.status === "failed" || r.status === "unknown").map((r) => r.key) : [];
}
/** Tests. */
export function resetProjectBatch(): void {
  elsewhere = null;
  set(null);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Status = BatchItemResult["status"];
class Settled extends Error {
  constructor(readonly status: Status, message?: string) {
    super(message ?? status);
  }
}

/** The project in a snapshot just read: where it is (active / archived) and its revision. */
function readProject(snapshot: SidebarSnapshot | undefined, id: string): { project: ProjectSummary; archived: boolean } | null {
  const projects = snapshot?.projects;
  const active = projects?.projects.find((x) => x.project_id === id);
  if (active) return { project: active, archived: false };
  const archived = projects?.archived_projects?.find((x) => x.project_id === id);
  return archived ? { project: archived, archived: true } : null;
}

const fromOutcome = (o: WriteOutcome): Status => {
  if (o.outcome === "refused") throw new Settled("failed", o.code);
  return o.outcome;
};

async function one(kind: BatchKind, p: ProjectFacts, read: ReadonlyMap<string, SidebarSnapshot>): Promise<Status> {
  const host = hostApi(p.hostId);
  if (kind === "archive" || kind === "restore") {
    // No write on a host whose state was not just read (an earlier unknown may have gone through).
    const snapshot = read.get(p.hostId);
    if (!snapshot) throw new Settled("failed", "state_unread");
    const now = readProject(snapshot, p.id);
    if (!now) throw new Settled("failed", "project_not_found");
    if (now.archived === (kind === "archive")) return "skipped";
    let outcome: WriteOutcome;
    try {
      outcome = await host.projectLifecycle(p.id, { authorityEpoch: now.project.authority_epoch, projectRevision: now.project.project_revision ?? 0 }, kind);
    } catch {
      return "unknown"; // the call may have reached the host (a reply lost on the way back)
    }
    return fromOutcome(outcome);
  }
  const control = await host.projectBatchRunControl(p.id); // a read: a failure here wrote nothing
  if (kind === "pause") {
    // Already paused only when every member is (a members-only pause leaves the Director running).
    if ((control.phase === "paused" || control.phase === "pausing") && control.scope === "all") return "skipped";
    if (!control.allowedActions.pauseAll) throw new Settled("failed", "pause_not_allowed");
  } else {
    if (!control.pauseId || control.phase === "running") return "skipped";
    if (!control.allowedActions.resume) throw new Settled("failed", "resume_not_allowed");
  }
  const action = kind === "pause"
    ? { kind, actionId: crypto.randomUUID(), mode: "afterTurn" as const, scope: "all" as const, expectedEpoch: control.epoch }
    : { kind, actionId: crypto.randomUUID(), pauseId: control.pauseId!, expectedEpoch: control.epoch };
  let outcome: WriteOutcome;
  try {
    outcome = await host.projectBatchControl(p.id, action);
  } catch {
    return "unknown";
  }
  return fromOutcome(outcome);
}

/**
 * Reads each host's sidebar once, explicitly: the snapshots returned, by host (a host whose read failed is missing).
 * Not the store's refresh: that one swallows a failed read and keeps what it had, which is not a fresh read.
 */
async function readHosts(hostIds: readonly string[]): Promise<Map<string, SidebarSnapshot>> {
  const read = await Promise.all(hostIds.map((h) => hostApi(h).sidebar().then((s) => (s && typeof s === "object" ? s : null), () => null)));
  return new Map(hostIds.flatMap((h, i) => (read[i] ? [[h, read[i]!] as const] : [])));
}

const LEASE_RENEW_MS = 20_000;
async function lease(request: ProjectBatchLeaseRequest): Promise<ProjectBatchLeaseResult | null> {
  try { return await api.projectBatchLease(request); } catch { return null; }
}

/**
 * Runs `kind` over `list`; null when a batch is still running (one at a time). Progress and results are in the store
 * (useProjectBatch) as well as returned.
 */
export async function startProjectBatch(kind: BatchKind, list: readonly ProjectFacts[]): Promise<readonly BatchItemResult[] | null> {
  if (projectBatchRunning() || !list.length) return null;
  const batch: ProjectBatch = { kind, keys: list.map((p) => p.key), total: list.length, done: 0, results: null };
  set(batch); // this window's guard, before the first await
  setElsewhere(null);
  // Main's lease: one batch across every window. Not granted (another window's batch, or main not answering): nothing sent.
  const granted = await lease({ op: "begin", kind, total: list.length });
  if (!granted?.ok) {
    set(null);
    setElsewhere(granted && !granted.ok && granted.busy ? granted.busy : { kind: null, total: null });
    return null;
  }
  const token = granted.token;
  const renew = setInterval(() => void lease({ op: "renew", token }), LEASE_RENEW_MS);
  let results: BatchItemResult[];
  try {
    const hosts = [...new Set(list.map((p) => p.hostId))];
    const before = await readHosts(hosts);
    const settled = await runBounded(list, BATCH_CONCURRENCY, (p) => one(kind, p, before), (done) => set({ ...batch, done }));
    const after = await readHosts(hosts);
    results = settled.map((r, i): BatchItemResult => {
      const p = list[i]!;
      if (r.status === "rejected") return { key: p.key, name: p.name, status: r.reason instanceof Settled ? r.reason.status : "failed", error: errorText(r.reason) };
      // A lost reply the read just made shows applied (a host whose read failed proves nothing: it stays unknown).
      if (r.value === "unknown" && (kind === "archive" || kind === "restore") && readProject(after.get(p.hostId), p.id)?.archived === (kind === "archive")) return { key: p.key, name: p.name, status: "done" };
      return { key: p.key, name: p.name, status: r.value };
    });
    // The sidebar shows the new state (its own refresh; the decisions above never use it).
    for (const h of hosts) void useApp.getState().refreshHostSidebar(h).catch(() => {});
  } catch (e) {
    // Never leave the guard on: whatever was under way is unknown.
    results = list.map((p) => ({ key: p.key, name: p.name, status: "unknown", error: errorText(e) }));
  } finally {
    clearInterval(renew);
    void lease({ op: "end", token });
  }
  set({ ...batch, done: list.length, results });
  return results;
}
