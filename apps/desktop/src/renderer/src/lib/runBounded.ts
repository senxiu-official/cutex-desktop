// Batch work over cutex calls that have no batch endpoint (archived agents, the 项目 table): one call per item, a few
// at a time; every item settles, so a batch never stops halfway and each failure keeps its reason.

/** Items in flight at once in a batch of single calls. */
export const BATCH_CONCURRENCY = 3;

/** Bounded-concurrency run of `work` over `items`; every item settles (never stops halfway); results in input order. */
export async function runBounded<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>, onSettled?: (done: number) => void): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await work(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
      onSettled?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
