// Host data of 服务通知: the target host's services, one service's settings (optimistic, with retry) and the
// history pages. Every call goes to the Settings target host through main (lib/targetHost daemonApiOf);
// nothing here logs titles or bodies.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServiceView } from "../../../../shared/ipc";
import type { ServiceNotificationConfiguration, ServiceNotificationEntry, ServiceNotificationRetention, ServiceNotificationSettings } from "../../../../shared/serviceNotifications";
import { daemonApiOf } from "../../lib/targetHost";
import { historyCap, mergeHistory } from "./model";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The host's registered services (archived ones left out): integrations (WhatsApp) first, then by name. */
export function useHostServices(hostId: string, focus: string): { services: ServiceView[] | null; error: string | null; reload(): void } {
  const [state, setState] = useState<{ hostId: string; services: ServiceView[] | null; error: string | null }>({ hostId, services: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    daemonApiOf(hostId, focus)
      .services()
      .then(
        (list) => live && setState({ hostId, services: list.services.filter((s) => !s.archived).sort((a, b) => Number(b.runtime === "integration") - Number(a.runtime === "integration") || (a.displayName || a.slug).localeCompare(b.displayName || b.slug)), error: null }),
        (e: unknown) => live && setState({ hostId, services: null, error: errorText(e) }),
      );
    return () => {
      live = false;
    };
  }, [hostId, focus, tick]);
  const mine = state.hostId === hostId ? state : { services: null, error: null };
  return { services: mine.services, error: mine.error, reload: () => setTick((n) => n + 1) };
}

export interface ServiceSettingsState {
  config: ServiceNotificationConfiguration | null;
  /** The settings shown: the one being saved while it is on its way, else the host's. */
  shown: ServiceNotificationSettings | null;
  saving: boolean;
  loadError: string | null;
  /** A save failed: the host's earlier value is shown again; `retry` sends the refused one once more. */
  saveError: string | null;
  save(next: ServiceNotificationSettings): void;
  retry(): void;
  reload(): void;
}

export function useServiceSettings(hostId: string, focus: string, slug: string | null): ServiceSettingsState {
  const [config, setConfig] = useState<ServiceNotificationConfiguration | null>(null);
  const [pending, setPending] = useState<ServiceNotificationSettings | null>(null);
  const [failed, setFailed] = useState<{ value: ServiceNotificationSettings; error: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = `${hostId}\u0000${slug ?? ""}`;
  const current = useRef(key);
  current.current = key;
  // Writes go one after another (each answer is the whole configuration).
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    setConfig(null);
    setPending(null);
    setFailed(null);
    setLoadError(null);
    if (!slug) return;
    let live = true;
    daemonApiOf(hostId, focus)
      .serviceNotificationSettings(slug)
      .then(
        (c) => live && setConfig(c),
        (e: unknown) => live && setLoadError(errorText(e)),
      );
    return () => {
      live = false;
    };
  }, [hostId, focus, slug, tick]);

  const save = useCallback(
    (next: ServiceNotificationSettings) => {
      if (!slug) return;
      const mine = key;
      setPending(next);
      setFailed(null);
      const run = queue.current.then(() => daemonApiOf(hostId, focus).setServiceNotificationSettings(slug, next));
      queue.current = run.catch(() => {});
      run.then(
        (c) => {
          if (current.current !== mine) return;
          setConfig(c);
          setPending((p) => (p === next ? null : p));
        },
        (e: unknown) => {
          if (current.current !== mine) return;
          setPending((p) => (p === next ? null : p));
          setFailed({ value: next, error: errorText(e) });
        },
      );
    },
    [hostId, focus, slug, key],
  );

  return {
    config,
    shown: pending ?? config?.settings ?? null,
    saving: pending !== null,
    loadError,
    saveError: failed?.error ?? null,
    save,
    retry: () => failed && save(failed.value),
    reload: () => setTick((n) => n + 1),
  };
}

export interface HistoryState {
  entries: ServiceNotificationEntry[] | null;
  error: string | null;
  loading: boolean;
  more: boolean;
  /** What the host keeps (null: an older host that does not say). */
  retention: ServiceNotificationRetention | null;
  /** Paging stopped at the host's bound (everything it keeps is shown). */
  atBound: boolean;
  loadMore(): void;
  reload(): void;
}

/** History of one service (`slug`) or every service (null), newest first; `limit` per page. */
export function useHistory(hostId: string, focus: string, slug: string | null, limit: number, enabled = true): HistoryState {
  const [entries, setEntries] = useState<ServiceNotificationEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [retention, setRetention] = useState<ServiceNotificationRetention | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const gen = useRef(0);

  const fetchPage = useCallback(
    (before: number | null, append: boolean) => {
      const mine = ++gen.current;
      setLoading(true);
      setError(null);
      daemonApiOf(hostId, focus)
        .serviceNotificationHistory({ ...(slug ? { service: slug } : {}), ...(before !== null ? { before } : {}), limit })
        .then(
          (page) => {
            if (gen.current !== mine) return;
            setEntries((cur) => (append && cur ? mergeHistory(cur, page.notifications) : mergeHistory([], page.notifications)));
            setNext(page.nextBefore ?? null);
            if (page.retention) setRetention(page.retention);
            setLoading(false);
          },
          (e: unknown) => {
            if (gen.current !== mine) return;
            setError(errorText(e));
            setLoading(false);
          },
        );
    },
    [hostId, focus, slug, limit],
  );

  useEffect(() => {
    setEntries(null);
    setNext(null);
    if (enabled) fetchPage(null, false);
    return () => {
      gen.current++;
    };
  }, [fetchPage, enabled, tick]);

  const atBound = next !== null && (entries?.length ?? 0) >= historyCap(retention, slug);
  const more = next !== null && !atBound;
  return {
    entries,
    error,
    loading,
    more,
    retention,
    atBound,
    loadMore: () => more && !loading && fetchPage(next, true),
    reload: () => setTick((n) => n + 1),
  };
}
