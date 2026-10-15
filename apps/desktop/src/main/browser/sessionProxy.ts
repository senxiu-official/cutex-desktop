/** One queue per actual Electron Session, shared by base policy and every window's
 * N2 controller. No Electron runtime dependency and no default-session mutation.
 * A rejected predecessor never poisons later cleanup. An idle queue invokes work
 * synchronously, preserving installation's before-first-await denial ordering.
 */
const queues = new WeakMap<object, Promise<unknown>>();

export function queueBrowserSessionProxy<T>(session: object, work: () => T | Promise<T>): Promise<T> {
  const previous = queues.get(session);
  let resolve!: (result: T | PromiseLike<T>) => void, reject!: (error: unknown) => void;
  const next = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // Publish before invoking work: a synchronous/reentrant enqueue must see us.
  queues.set(session, next);
  const clear = () => { if (queues.get(session) === next) queues.delete(session); };
  void next.then(clear, clear);
  const run = () => { try { resolve(work()); } catch (error) { reject(error); } };
  if (previous) void previous.then(run, run); else run();
  return next;
}
