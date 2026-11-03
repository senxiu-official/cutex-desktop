// State of 待清理's other parts: the shared age filter and the stale-delegation list (cutex
// `GET /v2/asks?state=open`, owner commands cutex/ask/stop | close through lib/delegationStore). Read
// when the section opens, on 刷新 and after each command; mounted only while the page is open.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AskCommandMethod, AskSummary } from "../../../../shared/ipc";
import { delegationCommand } from "../../lib/delegationStore";
import type { ContextOf } from "../../lib/delegations";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { useHostData } from "../../lib/useHostScope";
import { rowsOf } from "../../lib/viewHost";
import { loadMinAge, saveMinAge, staleDelegations } from "./cleanup";

export function useCleanupMinAge(): [number, (secs: number) => void] {
  const [minAge, setMinAge] = useState(loadMinAge);
  const set = useCallback((secs: number) => {
    setMinAge(secs);
    saveMinAge(secs);
  }, []);
  return [minAge, set];
}

/** Display name of an agent of the target host (its sidebar), else the id. */
export function useTargetAgentNames(): (id: string) => string {
  const sidebar = useHostData(useTargetHostId())?.sidebar ?? null;
  return useMemo(() => {
    const names = new Map(rowsOf(sidebar).map((s) => [s.cutexSessionId, s.displayName]));
    return (id: string) => names.get(id) ?? id;
  }, [sidebar]);
}

export interface StaleDelegationsState {
  /** Null until the first read. */
  rows: AskSummary[] | null;
  error: string | null;
  loading: boolean;
  /** askIds with a command in flight. */
  busy: ReadonlySet<string>;
  /** A refused command, by askId (cutex's words). */
  refusals: Readonly<Record<string, string>>;
  /** Target offline etc. (the status words take it into account). */
  ctxOf: ContextOf;
  refresh(): Promise<void>;
  command(d: AskSummary, method: AskCommandMethod, outcome?: "abandoned"): Promise<void>;
}

export function useStaleDelegations(minAge: number, enabled: boolean): StaleDelegationsState {
  const hostId = useTargetHostId();
  const api = useTargetApi();
  const data = useHostData(hostId);
  const connected = data?.daemon.kind === "connected";
  const sidebar = data?.sidebar ?? null;
  const [open, setOpen] = useState<AskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const seq = useRef(0);
  const scope = useRef({ hostId, api });
  scope.current = { hostId, api };

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const rows = await scope.current.api.asks({ state: "open" });
      if (mine !== seq.current) return;
      setOpen(rows ?? []);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOpen(null);
    setError(null);
    setBusy(new Set());
    setRefusals({});
  }, [hostId]);

  useEffect(() => {
    if (connected && enabled) void refresh();
    return () => {
      seq.current += 1;
    };
  }, [hostId, connected, enabled, refresh]);

  const command = useCallback(
    async (d: AskSummary, method: AskCommandMethod, outcome?: "abandoned") => {
      const startedOn = scope.current.hostId;
      setBusy((b) => new Set(b).add(d.askId));
      let refusal: string | null = null;
      try {
        const r = await delegationCommand(startedOn, d, method, outcome);
        if (!r.ok) refusal = r.error.message || r.error.code;
      } catch (e) {
        refusal = e instanceof Error ? e.message : String(e);
      }
      if (scope.current.hostId !== startedOn) return;
      setBusy((b) => {
        const next = new Set(b);
        next.delete(d.askId);
        return next;
      });
      setRefusals((all) => {
        const next = { ...all };
        if (refusal) next[d.askId] = refusal;
        else delete next[d.askId];
        return next;
      });
      await refresh();
    },
    [refresh],
  );

  const ctxOf = useMemo<ContextOf>(() => {
    const status = new Map(rowsOf(sidebar).map((s) => [s.cutexSessionId, s.runtime?.status ?? "offline"]));
    return (d) => {
      const st = status.get(d.target);
      return st !== undefined && st !== "online" ? { targetOffline: true } : {};
    };
  }, [sidebar]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed with each read, not every tick
  const rows = useMemo(() => (open ? staleDelegations(open, minAge, Date.now(), ctxOf) : null), [open, minAge, ctxOf]);
  return { rows, error, loading, busy, refusals, ctxOf, refresh, command };
}
