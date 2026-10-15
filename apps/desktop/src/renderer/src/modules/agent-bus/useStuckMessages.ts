// State of the stuck-message list: loaded when the section opens, when the host or the age filter
// changes, and after every discard (the list always shows what cutex says now). Mounted only while
// the settings page is open, so nothing polls in the background.
import { useCallback, useEffect, useRef, useState } from "react";
import type { StuckBusMessage, StuckBusView } from "../../../../shared/ipc";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { useHostData } from "../../lib/useHostScope";
import { bulkTargets, DEFAULT_MIN_AGE, discardAll, discardOutcome, discardRequest, emptySummary, failure, isMinAgeChoice, type BulkSummary } from "./stuck";

const KEY = "cutex-desktop.stuckBusMinAge";

function loadMinAge(): number {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return isMinAgeChoice(stored) ? stored : DEFAULT_MIN_AGE;
  } catch {
    return DEFAULT_MIN_AGE;
  }
}

export interface StuckMessagesState {
  view: StuckBusView | null;
  loading: boolean;
  /** Last load error. */
  error: string | null;
  minAge: number;
  setMinAge(secs: number): void;
  /** Ids being discarded one by one right now. */
  busy: ReadonlySet<string>;
  /** 全部丢弃 in progress. */
  bulk: { done: number; total: number } | null;
  /** What the last discard (or 全部丢弃) did; null before one or after dismissing. */
  summary: (BulkSummary & { bulk: boolean }) | null;
  dismissSummary(): void;
  refresh(): Promise<void>;
  discardOne(message: StuckBusMessage): Promise<void>;
  /** Every listed message that is not a Task / Job / control message. */
  discardEverything(): Promise<void>;
}

export function useStuckMessages(): StuckMessagesState {
  // The page's target host (Settings → a host page), not always the focus host.
  const hostId = useTargetHostId();
  const api = useTargetApi();
  const connected = useHostData(hostId)?.daemon.kind === "connected";
  const [minAge, setMinAgeState] = useState(loadMinAge);
  const [view, setView] = useState<StuckBusView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<StuckMessagesState["summary"]>(null);
  // Which load / host the answer belongs to: a late reply from before a host switch or a newer load is dropped.
  const loadSeq = useRef(0);
  const scope = useRef({ hostId, minAge, api });
  scope.current = { hostId, minAge, api };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const next = await scope.current.api.stuckBusMessages(scope.current.minAge);
      if (!alive.current || seq !== loadSeq.current) return;
      setView(next ?? { messages: [], total: 0, liveQueueAvailable: true, liveQueueError: null, minAgeSecs: scope.current.minAge });
      setError(null);
    } catch (e) {
      if (!alive.current || seq !== loadSeq.current) return;
      setError(failure(e).message);
    } finally {
      if (alive.current && seq === loadSeq.current) setLoading(false);
    }
  }, []);

  // A host switch starts from nothing.
  useEffect(() => {
    setView(null);
    setSummary(null);
    setError(null);
    setBusy(new Set());
    setBulk(null);
  }, [hostId]);

  // First load, a host switch, a reconnect, a new age filter.
  useEffect(() => {
    if (connected) void refresh();
    return () => {
      loadSeq.current += 1;
    };
  }, [hostId, connected, minAge, refresh]);

  const setMinAge = useCallback((secs: number) => {
    setMinAgeState(secs);
    try {
      localStorage.setItem(KEY, JSON.stringify(secs));
    } catch {
      // not persisted
    }
  }, []);

  const discardOne = useCallback(
    async (message: StuckBusMessage) => {
      const { hostId: startedOn, api: hostApi } = scope.current;
      setBusy((b) => new Set(b).add(message.messageId));
      const done = emptySummary();
      try {
        const outcome = discardOutcome(await hostApi.discardStuckBusMessage(discardRequest(message)));
        if (outcome.kind === "discarded") {
          done.discarded = 1;
          if (outcome.liveWithdrawError) done.liveWarnings = 1;
        } else if (outcome.kind === "gone") done.gone = 1;
        else done.failed.push({ messageId: message.messageId, code: outcome.code, message: outcome.message });
      } catch (e) {
        done.failed.push({ messageId: message.messageId, ...failure(e) });
      }
      if (!alive.current || scope.current.hostId !== startedOn) return;
      setBusy((b) => {
        const next = new Set(b);
        next.delete(message.messageId);
        return next;
      });
      setSummary({ ...done, bulk: false });
      await refresh();
    },
    [refresh],
  );

  const discardEverything = useCallback(async () => {
    if (!view) return;
    const targets = bulkTargets(view.messages);
    if (targets.length === 0) return;
    const { hostId: startedOn, api: hostApi } = scope.current;
    setSummary(null);
    setBulk({ done: 0, total: targets.length });
    const result = await discardAll(
      targets,
      (request) => hostApi.discardStuckBusMessage(request),
      (done, total) => {
        if (alive.current && scope.current.hostId === startedOn) setBulk({ done, total });
      },
    );
    if (!alive.current || scope.current.hostId !== startedOn) return;
    setBulk(null);
    setSummary({ ...result, bulk: true });
    await refresh();
  }, [view, refresh]);

  return { view, loading, error, minAge, setMinAge, busy, bulk, summary, dismissSummary: () => setSummary(null), refresh, discardOne, discardEverything };
}
