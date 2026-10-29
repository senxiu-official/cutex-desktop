/** One read at a time, with one dirty bit for changes received during a read. The first event waits
 * 300 ms; subsequent starts are at least 1 s apart. Anchoring timers to the first pending event
 * bounds its wait to 1 s when idle (an active read must finish first), even under continuous events. */
export function delegationRefresh(run: () => Promise<void>) {
  const delay = 300;
  const minInterval = 1000;
  let lastStart = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let dirty = false;
  let disposed = false;
  let pending: Promise<void> | undefined;
  let settle: (() => void) | undefined;

  function finish() {
    pending = undefined;
    settle?.();
    settle = undefined;
  }
  function schedule(immediate: boolean) {
    if (active || timer !== undefined || disposed) return;
    const wait = Math.max(immediate ? 0 : delay, lastStart + minInterval - Date.now());
    if (wait <= 0) void flush();
    else timer = setTimeout(() => { timer = undefined; void flush(); }, wait);
  }
  async function flush() {
    active = true;
    dirty = false;
    lastStart = Date.now();
    try { await run(); }
    catch {
      // Refreshes are best effort: settle callers even on failure, without an unhandled rejection
      // from the timer's void flush(). A dirty bit still gets its trailing read; otherwise retry
      // only on the next request. The reader retains its last successful state on transient errors.
    }
    finally {
      active = false;
      if (!disposed && dirty) schedule(false);
      else finish();
    }
  }
  return {
    request(immediate = false): Promise<void> {
      if (disposed) return Promise.resolve();
      pending ??= new Promise<void>((resolve) => { settle = resolve; });
      const result = pending;
      dirty = true;
      schedule(immediate);
      return result;
    },
    dispose() {
      disposed = true;
      dirty = false;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      finish();
    },
  };
}
