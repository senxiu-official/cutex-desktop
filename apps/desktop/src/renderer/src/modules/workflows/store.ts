// 工作流 cache, memory only, focus host: `GET /v2/workflows/runs` (the page's list and the nav badge)
// and the run details the page has open (`GET /v2/workflows/runs/{id}?include=log`). Workflow host
// events and `cutex/approvals/changed` reload what they touch (debounced); a slow safety poll covers
// a missed event while something is open.
import { useEffect } from "react";
import { create } from "zustand";
import { WORKFLOWS_FEATURE, isWorkflowRunOpen, workflowChangeOf, type WorkflowRunSummary, type WorkflowRunView } from "../../../../shared/workflows";
import { bridge } from "../../bridge";
import { featuresOf, useApp } from "../../store";
import { services } from "../app";
import type { AppModuleContext } from "../slots";

interface HostRuns {
  runs: WorkflowRunSummary[];
  loaded: boolean;
  error: string | null;
}

interface WorkflowCache {
  /** hostId → run list. */
  lists: Record<string, HostRuns>;
  /** `${hostId}|${runId}` → detail (with the log). */
  details: Record<string, WorkflowRunView>;
  /** `${hostId}|${runId}` of runs cutex answered 404 for (deleted): no more polling. */
  gone: Record<string, true>;
}

export const useWorkflowCache = create<WorkflowCache>(() => ({ lists: {}, details: {}, gone: {} }));

const LIST_LIMIT = 200;
const POLL_MS = 20_000;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const detailKey = (hostId: string, runId: string) => `${hostId}|${runId}`;

const inflight = new Map<string, Promise<void>>();

function once(key: string, run: () => Promise<void>): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function loadRuns(hostId: string): Promise<void> {
  return once(`list|${hostId}`, async () => {
    try {
      const list = await services.daemonFor(hostId).workflowRuns({ state: "all", limit: LIST_LIMIT });
      useWorkflowCache.setState((s) => ({ lists: { ...s.lists, [hostId]: { runs: list?.runs ?? [], loaded: true, error: null } } }));
    } catch (e) {
      useWorkflowCache.setState((s) => ({ lists: { ...s.lists, [hostId]: { runs: s.lists[hostId]?.runs ?? [], loaded: true, error: errorText(e) } } }));
    }
  });
}

/**
 * The run is gone: cutex 404 `run_not_found` (src/workflows/engine.rs; the dev mock says
 * `workflow_run_not_found`). Through IPC only the message `code: …` survives.
 */
export function isRunGone(e: unknown): boolean {
  const o = e as { status?: unknown; code?: unknown } | null;
  if (o && typeof o === "object" && (o.code === "run_not_found" || o.code === "workflow_run_not_found")) return true;
  const text = e instanceof Error ? e.message : String(e);
  return /^(workflow_)?run_not_found\b/.test(text.trim()) || /\b(workflow_)?run_not_found:/.test(text);
}

export function loadRun(hostId: string, runId: string): Promise<void> {
  const key = detailKey(hostId, runId);
  return once(`run|${key}`, async () => {
    try {
      const run = await services.daemonFor(hostId).workflowRun(runId, ["log"]);
      useWorkflowCache.setState((s) => {
        const gone = { ...s.gone };
        delete gone[key];
        return { details: { ...s.details, [key]: run }, gone };
      });
    } catch (e) {
      // A transient failure (offline, timeout) keeps the shown detail. A deleted run drops it and stops
      // its polling; the list reload removes the row.
      if (!isRunGone(e)) return;
      useWorkflowCache.setState((s) => {
        const details = { ...s.details };
        delete details[key];
        return { details, gone: { ...s.gone, [key]: true } };
      });
    }
  });
}

let timer: ReturnType<typeof setTimeout> | null = null;
const queuedLists = new Set<string>();
const queuedRuns = new Set<string>();

function schedule(hostId: string, runId: string | null) {
  queuedLists.add(hostId);
  if (runId && useWorkflowCache.getState().details[detailKey(hostId, runId)]) queuedRuns.add(detailKey(hostId, runId));
  timer ??= setTimeout(() => {
    timer = null;
    for (const host of queuedLists) void loadRuns(host);
    for (const key of queuedRuns) {
      const bar = key.indexOf("|");
      void loadRun(key.slice(0, bar), key.slice(bar + 1));
    }
    queuedLists.clear();
    queuedRuns.clear();
  }, 250);
}

/** Module activation: follow workflow / approval events of every connected host until the module stops. */
export function startWorkflowSync(ctx: AppModuleContext): void {
  if (typeof bridge?.on !== "function") return;
  const off = bridge.on("hostEvent", ({ hostId, envelope }) => {
    const change = workflowChangeOf(envelope);
    if (change) {
      schedule(hostId, change.runId);
      return;
    }
    if (envelope?.cutex?.method === "cutex/approvals/changed" && useWorkflowCache.getState().lists[hostId]) schedule(hostId, null);
  });
  // The badge needs the focus host's list even before the page opens.
  const focus = useApp.getState().hosts?.active ?? "local";
  if (featuresOf(useApp.getState(), focus).has(WORKFLOWS_FEATURE)) void loadRuns(focus);
  ctx.signal.addEventListener("abort", () => {
    off?.();
    useWorkflowCache.setState({ lists: {}, details: {}, gone: {} });
  });
}

export function useFocusHost(): string {
  return useApp((s) => s.hosts?.active ?? "local");
}

/** The focus host's runs (loaded on mount; slow poll while open). */
export function useRuns(hostId: string): HostRuns {
  const supported = useApp((s) => featuresOf(s, hostId).has(WORKFLOWS_FEATURE));
  const entry = useWorkflowCache((s) => s.lists[hostId]);
  useEffect(() => {
    if (!supported) return;
    void loadRuns(hostId);
    const id = setInterval(() => {
      if (!document.hidden) void loadRuns(hostId);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [hostId, supported]);
  return entry ?? { runs: [], loaded: false, error: null };
}

/** One run's detail while shown; polled faster while the run is open, not at all once it is gone (404). */
export function useRunDetail(hostId: string, runId: string): WorkflowRunView | null {
  return useRunDetailState(hostId, runId).run;
}

export function useRunDetailState(hostId: string, runId: string): { run: WorkflowRunView | null; gone: boolean } {
  const run = useWorkflowCache((s) => s.details[detailKey(hostId, runId)] ?? null);
  const gone = useWorkflowCache((s) => !!s.gone[detailKey(hostId, runId)]);
  const open = run ? isWorkflowRunOpen(run.state) : true;
  useEffect(() => {
    if (gone) return;
    void loadRun(hostId, runId);
    const id = setInterval(() => {
      if (!document.hidden) void loadRun(hostId, runId);
    }, open ? 5_000 : POLL_MS);
    return () => clearInterval(id);
  }, [hostId, runId, open, gone]);
  return { run, gone };
}

/**
 * Nav badge: runs waiting for the owner's approval on the focus host. The module does not restart
 * when the focus host changes (its `requires` holds on any connected host), so the badge reads the
 * new focus host's list itself (once; events keep it current).
 */
export function usePendingCount(): number {
  const hostId = useFocusHost();
  const supported = useApp((s) => featuresOf(s, hostId).has(WORKFLOWS_FEATURE));
  useEffect(() => {
    if (supported && !useWorkflowCache.getState().lists[hostId]) void loadRuns(hostId);
  }, [hostId, supported]);
  return useWorkflowCache((s) => (s.lists[hostId]?.runs ?? []).filter((r) => r.state === "pendingApproval").length);
}
