import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalRecord } from "../../../shared/ipc";
import { NOTIFICATION_PAGES_FEATURE } from "../../../shared/notificationPaging";
import { hostApi } from "./hostLists";
import { onHostReset } from "./hostSwitch";

export const APPROVAL_HISTORY_PAGE_SIZE = 100;
interface HistoryHost {
  hostId: string;
  features: ReadonlySet<string>;
  approvals: ApprovalRecord[] | null;
}
export interface ApprovalHistoryPage {
  value: ApprovalRecord[] | null;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
}
interface Entry extends ApprovalHistoryPage {
  host: HistoryHost;
  paged: boolean;
  restart: boolean;
  seenCursors: Set<string>;
}

class ApprovalHistoryCursorCycle extends Error {
  constructor() { super("Approval history cursor repeated; retry to restart history"); }
}

function needsRestart(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  // Electron may serialize the server code into the message. Other 400/409 errors (for
  // example invalid_filter) are ordinary failures and must retain the current cursor.
  return /\b(?:resync_required|invalid_cursor)\b/i.test(`${e?.code ?? ""} ${e?.message ?? String(error)}`);
}

/** One bounded read per host on entry/refresh. Only an explicit load asks for the next opaque cursor. */
export function usePagedApprovalHistory(hosts: readonly HistoryHost[], scopeKey: string) {
  const entries = useRef(new Map<string, Entry>());
  const [pages, setPages] = useState<Record<string, ApprovalHistoryPage>>({});
  const publish = useCallback(() => {
    setPages(Object.fromEntries([...entries.current].map(([id, entry]) => [id, {
      value: entry.value, nextCursor: entry.nextCursor, loading: entry.loading, error: entry.error,
    }])));
  }, []);

  const load = useCallback(async (hostId: string) => {
    const entry = entries.current.get(hostId);
    if (!entry || entry.loading) return;
    if (entry.value !== null && entry.nextCursor === null && !entry.error) return;
    // A rejected cursor never falls back to the legacy unbounded endpoint. The next user retry
    // makes exactly one fresh first-page request; another rejection remains visible for retry.
    if (entry.restart) {
      entry.value = null;
      entry.nextCursor = null;
      entry.restart = false;
      entry.seenCursors.clear();
    }
    entry.loading = true;
    entry.error = null;
    publish();
    const current = () => entries.current.get(hostId) === entry;
    try {
      const api = hostApi(hostId);
      const requestedCursor = entry.nextCursor;
      const page = entry.paged
        ? await api.approvalsPage("all", { limit: APPROVAL_HISTORY_PAGE_SIZE, ...(requestedCursor !== null ? { cursor: requestedCursor } : {}) })
        : await api.approvals("all").then(approvals => approvals === null ? null : { approvals, nextCursor: null });
      if (!current()) return;
      if (page === null) throw new Error("Approval history unavailable");
      const nextCursor = page.nextCursor ?? null;
      if (nextCursor !== null && (nextCursor === requestedCursor || entry.seenCursors.has(nextCursor))) {
        throw new ApprovalHistoryCursorCycle();
      }
      // Only accepted responses consume a cursor; a transient failure may retry the same read.
      if (requestedCursor !== null) entry.seenCursors.add(requestedCursor);
      const rows = new Map((entry.value ?? []).map(a => [a.approvalId, a]));
      for (const row of page.approvals) rows.set(row.approvalId, row);
      entry.value = [...rows.values()];
      // Page length says nothing about exhaustion (including an empty page).
      entry.nextCursor = nextCursor;
    } catch (error) {
      if (!current()) return;
      entry.error = error instanceof Error ? error.message : String(error);
      entry.restart = entry.paged && (error instanceof ApprovalHistoryCursorCycle || needsRestart(error));
    } finally {
      if (current()) {
        entry.loading = false;
        publish();
      }
    }
  }, [publish]);

  const reset = useCallback((host: HistoryHost) => {
    entries.current.set(host.hostId, {
      host, paged: host.features.has(NOTIFICATION_PAGES_FEATURE), restart: false,
      seenCursors: new Set(),
      value: null, nextCursor: null, loading: false, error: null,
    });
    void load(host.hostId);
  }, [load]);

  // A focus/connection replacement invalidates in-flight requests before their results can publish.
  useEffect(() => {
    entries.current.clear();
    publish();
    return () => { entries.current.clear(); };
  }, [scopeKey, publish]);

  useEffect(() => {
    const wanted = new Set(hosts.map(h => h.hostId));
    for (const id of entries.current.keys()) if (!wanted.has(id)) entries.current.delete(id);
    for (const host of hosts) {
      const old = entries.current.get(host.hostId);
      if (!old || old.host.approvals !== host.approvals || old.paged !== host.features.has(NOTIFICATION_PAGES_FEATURE)) reset(host);
    }
    publish();
  }, [hosts, scopeKey, reset, publish]);

  useEffect(() => onHostReset(hostId => {
    const old = entries.current.get(hostId);
    if (old) reset(old.host);
  }), [reset]);

  const reload = useCallback((hostId: string) => {
    const entry = entries.current.get(hostId);
    if (entry) reset(entry.host);
  }, [reset]);
  return { pages, loadMore: load, reload };
}
