// One git status read at a time per workspace (host + scope), shared by every view of it: the
// workspace watch (lib/workspaceView.ts) and a column's own header chip. A slow `git/status` and a
// stream of changes (watch batches, an agent's edits, turn ends) once started a read every 300 ms
// until the host's connection limit was full; now changes during a read ask for exactly one more.
// A transient failure (git_status_busy, read capacity, a dropped connection: lib/transientError.ts) is read
// again by itself after 1, 2, 5, 10, then every 30 s while anyone watches, and changes meanwhile wait at
// least as long; `reload()` reads now (重新加载).
// A result marked `possiblyStale` (files changed during cutex's scan; cutex does not rescan by itself) is shown
// and read once more after GIT_STATUS_STALE_RECHECK_MS, joined with any change meanwhile; a chain of stale
// results rereads only once until a change arrives or a read comes back current.
import type { GitStatus } from "../../../shared/ipc";
import { isTransientError, retryDelay } from "./transientError";

export type GitStatusResult = { ok: true; status: GitStatus } | { ok: false; error: unknown; retrying: boolean };

/** Changes close together coalesce into one read this long after the first. */
export const GIT_STATUS_DEBOUNCE_MS = 300;
/** At most one read starts per this interval per workspace (an agent's turn streams many changes). */
export const GIT_STATUS_MIN_INTERVAL_MS = 2000;
/** A possibly stale result is read again this long after it arrived. */
export const GIT_STATUS_STALE_RECHECK_MS = 1500;

export class GitStatusFlight {
  private inFlight = false;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private lastStart = -Infinity;
  private last: GitStatusResult | null = null;
  /** Transient failures in a row (0 after a read that worked). */
  private failures = 0;
  /** The current stale chain already had its one reread (cleared by a change or a current result). */
  private staleRechecked = false;
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
    if (!this.inFlight && !this.timer) this.schedule(0);
  }

  /**
   * Something changed: read after `delayMs` (later ones join it), never sooner than the interval after
   * the last start; during a read, once more after it.
   */
  request(delayMs = GIT_STATUS_DEBOUNCE_MS): void {
    this.staleRechecked = false;
    this.schedule(delayMs);
  }

  private schedule(delayMs: number): void {
    if (!this.listeners.size) return;
    if (this.inFlight) {
      this.dirty = true;
      return;
    }
    const now = Date.now();
    // While the host keeps answering busy, changes do not read sooner than the next retry would.
    const gap = this.failures ? Math.max(GIT_STATUS_MIN_INTERVAL_MS, retryDelay(this.failures - 1)) : GIT_STATUS_MIN_INTERVAL_MS;
    const at = Math.max(now + delayMs, this.lastStart + gap);
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

  /** 重新加载: read now (after the one in flight, if any), whatever the backoff. */
  reload(): void {
    if (!this.listeners.size) return;
    this.failures = 0;
    this.staleRechecked = false;
    if (this.inFlight) {
      this.dirty = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.start();
  }

  private start(): void {
    this.inFlight = true;
    this.dirty = false;
    this.lastStart = Date.now();
    const done = (result: GitStatusResult) => {
      this.inFlight = false;
      if (!this.listeners.size) return this.idle();
      this.failures = result.ok ? 0 : result.retrying ? this.failures + 1 : 0;
      this.last = result;
      for (const listener of [...this.listeners]) listener(result);
      const stale = result.ok && result.status.possiblyStale === true;
      if (result.ok && !stale) this.staleRechecked = false;
      if (this.dirty || (!result.ok && result.retrying)) {
        this.dirty = false;
        this.schedule(0);
      } else if (stale && !this.staleRechecked) {
        this.staleRechecked = true;
        this.schedule(GIT_STATUS_STALE_RECHECK_MS);
      }
    };
    let reading: Promise<GitStatus>;
    try {
      reading = this.read();
    } catch (error) {
      reading = Promise.reject(error);
    }
    reading.then((status) => done({ ok: true, status }), (error: unknown) => done({ ok: false, error, retrying: isTransientError(error) }));
  }

  private idle(): void {
    this.last = null;
    this.staleRechecked = false;
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
