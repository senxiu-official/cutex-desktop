// 项目看板 — when main reads a host for the board (no Electron imports; tests drive it with fake timers).
// Only while the board is shown: a host event pokes its host (debounced, at most one read per host per minGap,
// never two at once), plus a slow safety read of every host. Hidden / minimised / closed = no timers and no new
// requests: each read gets a live() check that turns false when the window goes away, and the read stops before its
// next request. A read still in flight when the window comes back is not started twice: the host's slot (running,
// last start) survives hide → show, and the fresh read waits for it.

export interface BoardScheduleOptions {
  /** One read of a host. `live()` turns false once the board is hidden (or shown again later): stop before the next
   *  request and do not store what came back. */
  read(hostId: string, live: () => boolean): Promise<void>;
  hosts(): string[];
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Wait after an event before reading (events come in bursts). */
  debounceMs?: number;
  /** At most one read of a host per this long. */
  minGapMs?: number;
  /** Every host is read at least this often while shown. */
  safetyMs?: number;
}

interface HostSlot { timer: unknown; running: boolean; again: boolean; soon: boolean; lastAt: number }

export class BoardSchedule {
  private active = false;
  /** Bumped on every hide and show: reads started before it are no longer live. */
  private generation = 0;
  private slots = new Map<string, HostSlot>();
  private safety: unknown = null;
  private readonly debounceMs: number;
  private readonly minGapMs: number;
  private readonly safetyMs: number;

  constructor(private readonly o: BoardScheduleOptions) {
    // cutex P6 contract: debounce hints for 5 s (cacheTtlSeconds 5), safety poll every 60 s (refreshAfterSeconds 60),
    // none while hidden.
    this.debounceMs = o.debounceMs ?? 5_000;
    this.minGapMs = o.minGapMs ?? 10_000;
    this.safetyMs = o.safetyMs ?? 60_000;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Shown → read every host (as soon as its gap and any unfinished read allow) and keep reading; hidden → stop. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.generation += 1;
    if (!on) {
      // Timers go; running / lastAt stay, so showing again cannot start a second read of a host or skip its gap.
      for (const slot of this.slots.values()) {
        if (slot.timer !== null) this.o.clearTimer(slot.timer);
        slot.timer = null;
        slot.again = false;
        slot.soon = false;
      }
      if (this.safety !== null) this.o.clearTimer(this.safety);
      this.safety = null;
      return;
    }
    for (const h of this.o.hosts()) this.soon(h);
    this.armSafety();
  }

  /** Something changed on this host (an event, a (re)connect). */
  poke(hostId: string): void {
    if (!this.active) return;
    const slot = this.slot(hostId);
    if (slot.running) {
      slot.again = true;
      return;
    }
    if (slot.timer !== null) return; // already scheduled
    this.schedule(hostId, slot, this.o.now() + this.debounceMs);
  }

  /** Read now (the window's 刷新, a connect), still one read at a time per host. */
  readNow(hostId?: string): void {
    if (!this.active) return;
    for (const h of hostId ? [hostId] : this.o.hosts()) {
      const slot = this.slot(h);
      if (slot.timer !== null) {
        this.o.clearTimer(slot.timer);
        slot.timer = null;
      }
      this.run(h);
    }
  }

  /** Read as soon as allowed: after the unfinished read (if any) and no earlier than the host's gap. */
  private soon(hostId: string): void {
    const slot = this.slot(hostId);
    if (slot.running) {
      slot.again = true;
      slot.soon = true;
      return;
    }
    if (slot.lastAt && this.o.now() < slot.lastAt + this.minGapMs) this.schedule(hostId, slot, this.o.now());
    else this.run(hostId);
  }

  private schedule(hostId: string, slot: HostSlot, earliest: number): void {
    if (slot.timer !== null) this.o.clearTimer(slot.timer);
    const at = Math.max(earliest, slot.lastAt + this.minGapMs);
    slot.timer = this.o.setTimer(() => {
      slot.timer = null;
      this.run(hostId);
    }, Math.max(0, at - this.o.now()));
  }

  private slot(hostId: string): HostSlot {
    let s = this.slots.get(hostId);
    if (!s) {
      s = { timer: null, running: false, again: false, soon: false, lastAt: 0 };
      this.slots.set(hostId, s);
    }
    return s;
  }

  private run(hostId: string): void {
    if (!this.active) return;
    const slot = this.slot(hostId);
    if (slot.running) {
      slot.again = true;
      return;
    }
    slot.running = true;
    slot.again = false;
    slot.soon = false;
    slot.lastAt = this.o.now();
    const generation = this.generation;
    const live = () => this.active && this.generation === generation;
    void this.o
      .read(hostId, live)
      .catch(() => undefined)
      .finally(() => {
        slot.running = false;
        if (!this.active || !slot.again) return;
        if (slot.soon) {
          slot.again = slot.soon = false;
          this.schedule(hostId, slot, this.o.now());
        } else this.poke(hostId);
      });
  }

  private armSafety(): void {
    this.safety = this.o.setTimer(() => {
      this.safety = null;
      if (!this.active) return;
      for (const h of this.o.hosts()) this.poke(h);
      this.armSafety();
    }, this.safetyMs);
  }
}

/** Host feed methods that can change what the board shows (everything else — output deltas etc. — is ignored). */
export function boardRelevantEvent(method: string | null | undefined): boolean {
  if (!method) return false;
  return /^cutex\/(ask|asks|delegation|ownerNotify|approvals|services|session|sessions|agent|agentManagement|project|projectEvents|runtime|turn)\//.test(method);
}

// ---------- placement ----------

export interface BoardRect { x: number; y: number; width: number; height: number }
export interface BoardDisplay { id: number; workArea: BoardRect; primary: boolean }

const overlap = (a: BoardRect, b: BoardRect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * Where the board opens: its remembered bounds when at least a third of them is on a display that is still there;
 * else on a secondary display (a portrait one first: the board is for the second screen), else the primary one,
 * at the default size inside the work area.
 */
export function placeBoard(saved: BoardRect | null, displays: readonly BoardDisplay[], size: { width: number; height: number }): BoardRect {
  if (saved && displays.some((d) => overlap(saved, d.workArea) >= (saved.width * saved.height) / 3)) return saved;
  const secondary = displays.filter((d) => !d.primary);
  const pick = secondary.find((d) => d.workArea.height > d.workArea.width) ?? secondary[0] ?? displays.find((d) => d.primary) ?? displays[0];
  const area = pick?.workArea ?? { x: 0, y: 0, width: size.width, height: size.height };
  const width = Math.min(size.width, area.width), height = Math.min(Math.max(size.height, Math.round(area.height * 0.9)), area.height);
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
}
