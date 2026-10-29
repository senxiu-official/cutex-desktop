// Shared clocks (perf §9): one timer per period for every component showing a live time (running elapsed times,
// "N 分钟前" labels, the project view), instead of one `setInterval` per mounted row. All of a period's readers
// update in the same task, so React renders them in one commit; the page wakes once per period, not once per
// row at scattered phases.

type Reader = (now: number) => void;
const clocks = new Map<number, { timer: ReturnType<typeof setInterval>; readers: Set<Reader> }>();

/** Calls `reader(Date.now())` every `ms` (all readers of one period on one timer) until the returned stop. */
export function subscribeTick(ms: number, reader: Reader): () => void {
  let clock = clocks.get(ms);
  if (!clock) {
    const readers = new Set<Reader>();
    const timer = setInterval(() => {
      const now = Date.now();
      for (const r of [...readers]) r(now);
    }, ms);
    clocks.set(ms, (clock = { timer, readers }));
  }
  clock.readers.add(reader);
  const own = clock;
  return () => {
    own.readers.delete(reader);
    if (own.readers.size === 0 && clocks.get(ms) === own) {
      clearInterval(own.timer);
      clocks.delete(ms);
    }
  };
}
