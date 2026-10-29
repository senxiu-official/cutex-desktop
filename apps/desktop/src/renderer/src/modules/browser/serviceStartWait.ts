// A service tab whose service is not answering yet (owner 2026-10-25: a pinned service right after a cutex
// restart or an idle stop showed 「打不开」 and opened fine a moment later). While the refusal is one a reload
// fixes because the service is still coming up, the tab says 「正在启动」 and reloads by itself (each reload
// goes through cutex's ticket flow with `start: true`) until the page answers; after SERVICE_WAIT_LIMIT_MS it
// stops and says so, with 重新加载. A refusal a wait cannot fix (crash loop, start failed, not found) shows at once.
import { useEffect, useRef, useState } from "react";

/** cutex's codes for a service that is (re)starting or briefly busy: worth waiting for. */
export const SERVICE_WAIT_CODES: ReadonlySet<string> = new Set(["upstream_unreachable", "service_unavailable", "service_stopped", "services_store_unavailable", "proxy_busy"]);
export const SERVICE_WAIT_EVERY_MS = 2_000;
export const SERVICE_WAIT_LIMIT_MS = 60_000;
/** The page answered (no refusal) this long: the next refusal starts a new wait. */
const SETTLED_MS = 5_000;

/** Whether a tab on `url` refused with `reason` should wait for its service. */
export function waitsForService(url: string, reason: string | null | undefined): boolean {
  return !!reason && url.startsWith("cutex:service/") && SERVICE_WAIT_CODES.has(reason);
}

export type ServiceWait = { state: "waiting" | "timedOut" | null; restart(): void };

/** `waiting`: the tab shows a refusal worth waiting for now; `retry`: one reload. */
export function useServiceStartWait(waiting: boolean, retry: () => void): ServiceWait {
  const started = useRef<number | null>(null);
  const latest = useRef(retry);
  latest.current = retry;
  const [attempt, setAttempt] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!waiting) {
      if (started.current === null) return;
      const timer = setTimeout(() => {
        started.current = null;
        setTimedOut(false);
      }, SETTLED_MS);
      return () => clearTimeout(timer);
    }
    if (timedOut) return;
    started.current ??= Date.now();
    if (Date.now() - started.current >= SERVICE_WAIT_LIMIT_MS) {
      setTimedOut(true);
      return;
    }
    const timer = setTimeout(() => {
      latest.current();
      setAttempt((n) => n + 1);
    }, SERVICE_WAIT_EVERY_MS);
    return () => clearTimeout(timer);
  }, [waiting, timedOut, attempt]);
  return {
    state: waiting ? (timedOut ? "timedOut" : "waiting") : null,
    restart: () => {
      started.current = null;
      setTimedOut(false);
    },
  };
}
