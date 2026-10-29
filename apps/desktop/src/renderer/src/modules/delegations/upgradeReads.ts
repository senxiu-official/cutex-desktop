/** Serialize multi-route snapshots per host/project. A burst queues only one trailing refresh. */
interface ReadQueue { next: (() => Promise<void>) | null; waiting: (() => void)[] }
const queues = new Map<string, ReadQueue>();
export function queueUpgradeRead(key: string, task: () => Promise<void>): Promise<void> {
  const existing = queues.get(key);
  if (existing) {
    existing.next = task;
    return new Promise(resolve => existing.waiting.push(resolve));
  }
  const queue: ReadQueue = { next: task, waiting: [] };
  queues.set(key, queue);
  return (async () => {
    try {
      while (queue.next) {
        const next = queue.next;
        queue.next = null;
        await next();
      }
    } finally {
      queues.delete(key);
      for (const resolve of queue.waiting) resolve();
    }
  })();
}
