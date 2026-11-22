// A button whose click starts a request shows that it is waiting (owner 2026-11-18, press-feedback audit: a refresh
// looked like nothing happened). components/settings/Form RefreshButton and the board window's ↻ use it.
import { useCallback, useEffect, useRef, useState } from "react";

/** Whether a click handler's result is a request still running (a promise). */
export const isThenable = (x: unknown): x is PromiseLike<unknown> => !!x && typeof (x as { then?: unknown }).then === "function";

/**
 * The pending state of a button whose click starts a request (owner 2026-11-18: a refresh looked like nothing happened):
 * `run` calls the handler; while the promise it returns runs, `pending` is true and further clicks are ignored. The
 * button stays focusable (no `disabled`: the keyboard focus would drop to the page). The old data stays readable.
 *
 * `key`: what the button acts on now (e.g. host + Profile). The waiting is per key (cross-review 2026-11-18): when the same
 * button turns to another target while a request for the old one runs (the composer switched Profile), it is not shown
 * as waiting and its click is not swallowed; only a repeat for a target already waiting is.
 */
export function usePending(key = ""): { pending: boolean; run(handler: () => unknown): void } {
  const [, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);
  const busy = useRef(new Set<string>());
  const current = useRef(key);
  current.current = key;
  const run = useCallback((handler: () => unknown) => {
    const target = current.current;
    if (busy.current.has(target)) return;
    const result = handler();
    if (!isThenable(result)) return;
    busy.current.add(target);
    setTick((n) => n + 1);
    const done = () => {
      busy.current.delete(target);
      if (alive.current) setTick((n) => n + 1);
    };
    result.then(done, done);
  }, []);
  return { pending: busy.current.has(key), run };
}
