/** Connection-scoped read memo. Invalidated in-flight replies cannot populate the next revision. */
export class SidebarReadCache<T> {
  private revision = 0;
  private value: { value: T } | undefined;
  private pending: Promise<T> | undefined;

  peek(): T | undefined { return this.value?.value; }

  invalidate(): void {
    this.revision++;
    this.value = undefined;
    this.pending = undefined;
  }

  read(load: () => Promise<T>): Promise<T> {
    if (this.value) return Promise.resolve(this.value.value);
    if (this.pending) return this.pending;
    const revision = this.revision;
    const pending = load().then(value => {
      if (revision === this.revision) this.value = { value };
      return value;
    }).finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  }
}

/** One shared refresh, with at most one follow-up if an event overtook its reads. */
export class SidebarRefresh<T> {
  private revision = 0;
  private pending: Promise<T> | undefined;
  private lastStart = Number.NEGATIVE_INFINITY;
  constructor(private readonly minIntervalMs = 0) {}
  invalidate(): void { this.revision++; }

  private async run(load: () => Promise<T>): Promise<{ value: T; revision: number }> {
    const wait = this.lastStart + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait));
    // Events received while waiting are already covered by the read about to start.
    const revision = this.revision;
    this.lastStart = Date.now();
    return { value: await load(), revision };
  }

  /**
   * `onStale`: changes arrived while this read ran. Its result is still returned at once (a busy host
   * must not keep the list from showing); the caller asks for the follow-up read.
   */
  read(load: () => Promise<T>, onStale?: () => void): Promise<T> {
    if (this.pending) return this.pending;
    const pending = (async () => {
      const first = await this.run(load);
      if (first.revision !== this.revision) onStale?.();
      return first.value;
    })().finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  }
}
