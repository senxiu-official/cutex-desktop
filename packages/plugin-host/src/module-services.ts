import type { ModuleScope } from "@cutex-desktop/plugin-sdk";

/** Explicit wrappers for trusted adapters. They cannot undo already-issued remote writes. */
export function createModuleServiceScope(scope: ModuleScope) {
  const current = () => !scope.signal.aborted && scope.isCurrent();
  const abortError = () => new DOMException("Module scope is no longer current", "AbortError");
  const check = () => { if (!current()) throw abortError(); };
  function track(dispose: () => void): () => void {
    let disposed = false;
    const once = () => { if (!disposed) { disposed = true; dispose(); } };
    if (!current()) once(); else scope.onDispose(once);
    return once;
  }
  function callback<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
    return (...args) => { if (current()) fn(...args); };
  }
  return {
    isCurrent: current,
    track,
    callback,
    read<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
      return (...args) => { check(); return fn(...args); };
    },
    write<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
      return callback(fn);
    },
    /** Pass scope.signal to the actual transport as well; cancellation here fences delivery. */
    request<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
      return (...args) => new Promise<R>((resolve, reject) => {
        if (!current()) { reject(abortError()); return; }
        const abort = () => { cleanup(); reject(abortError()); };
        const cleanup = () => scope.signal.removeEventListener("abort", abort);
        scope.signal.addEventListener("abort", abort, { once: true });
        // Also observe non-cooperative promises after abort, avoiding unhandled rejections.
        let result: Promise<R>;
        try { result = fn(...args); } catch (error) { cleanup(); reject(error); return; }
        Promise.resolve(result).then(value => {
          cleanup(); if (current()) resolve(value); else reject(abortError());
        }, error => { cleanup(); reject(current() ? error : abortError()); });
      });
    },
    subscribe<A extends unknown[]>(subscribe: (listener: (...args: A) => void) => () => void,
      listener: (...args: A) => void): () => void {
      if (!current()) return () => {};
      // An eager provider may emit before returning its disposer. Defer listener
      // exceptions until that disposer is tracked, so activation rollback can clean up.
      let subscribing = true;
      let failed = false;
      let failure: unknown;
      const guarded = callback((...args: A) => {
        if (!subscribing) { listener(...args); return; }
        try { listener(...args); } catch (error) { failed = true; failure = error; }
      });
      const release = track(subscribe(guarded));
      subscribing = false;
      if (failed) { release(); throw failure; }
      return release;
    },
  };
}

