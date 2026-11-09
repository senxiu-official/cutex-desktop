// One git status read at a time per workspace (host + scope), shared by every view of it: the
// workspace watch (lib/workspaceView.ts) and a column's own header chip. A slow `git/status` and a
// stream of changes (watch batches, an agent's edits, turn ends) once started a read every 300 ms
// until the host's connection limit was full; now changes during a read ask for exactly one more.
import type { GitStatus } from "../../../shared/ipc";

export type GitStatusResult = { ok: true; status: GitStatus } | { ok: false; error: unknown };

/** Changes close together coalesce into one read this long after the first. */
export const GIT_STATUS_DEBOUNCE_MS = 300;
/** At most one read starts per this interval per workspace (an agent's turn streams many changes). */
export const GIT_STATUS_MIN_INTERVAL_MS = 2000;

export class GitStatusFlight {
  private inFlight = false;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private lastStart = -Infinity;
  private last: GitStatusResult | null = null;
  private readonly listeners = new Set<(result: GitStatusResult) => void>();

  constructor(
    private readonly read: () => Promise<GitStatus>,
    private readonly onIdle: () => void = () => {},
  ) {}

  /** Get every result from now on (and the last one, if a read finished while others watched). */
  subscribe(listener: (result: GitStatusResult) => void): () => void {
    this.listeners.add(listener);
    if (this.last) listener(this.last);
    return () => {
      if (!this.listeners.delete(listener) || this.listeners.size) return;
      // Nobody watches: no rerun. A read in flight finishes first, so a view that comes back
      // meanwhile joins it instead of starting a second one.
      this.dirty = false;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (!this.inFlight) this.idle();
    };
  }

  /** A first read for a view that just opened: now, unless one is running or due anyway. */
  ensure(): void {
    if (!this.inFlight && !this.timer) this.request(0);
  }

  /**
   * Something changed: read after `delayMs` (later ones join it), never sooner than the interval after
   * the last start; during a read, once more after it.
   */
  request(delayMs = GIT_STATUS_DEBOUNCE_MS): void {
    if (!this.listeners.size) return;
    if (this.inFlight) {
      this.dirty = true;
      return;
    }
    const now = Date.now();
    const at = Math.max(now + delayMs, this.lastStart + GIT_STATUS_MIN_INTERVAL_MS);
    if (this.timer) {
      if (at >= this.timerAt) return;
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (at <= now) return this.start();
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.start();
    }, at - now);
  }

  private start(): void {
    this.inFlight = true;
    this.dirty = false;
    this.lastStart = Date.now();
    const done = (result: GitStatusResult) => {
      this.inFlight = false;
      if (!this.listeners.size) return this.idle();
      this.last = result;
      for (const listener of [...this.listeners]) listener(result);
      if (this.dirty) {
        this.dirty = false;
        this.request(0);
      }
    };
    let reading: Promise<GitStatus>;
    try {
      reading = this.read();
    } catch (error) {
      reading = Promise.reject(error);
    }
    reading.then((status) => done({ ok: true, status }), (error: unknown) => done({ ok: false, error }));
  }

  private idle(): void {
    this.last = null;
    this.onIdle();
  }
}

const flights = new Map<string, GitStatusFlight>();

/** The shared reader of `key` (`hostKey(host, scopeKey(scope))`); it goes away when nobody watches. */
export function gitStatusFlight(key: string, read: () => Promise<GitStatus>): GitStatusFlight {
  let flight = flights.get(key);
  if (!flight) {
    const created = new GitStatusFlight(read, () => {
      if (flights.get(key) === created) flights.delete(key);
    });
    flights.set(key, created);
    flight = created;
  }
  return flight;
}
