// Test helpers for the input-ledger model (used by the *.test.ts files next to it only).

import type { InputRecord, SessionDelivery } from "@cutex-desktop/protocol";

export const T0 = Date.parse("2026-11-01T10:00:00.000Z");

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function record(inputId: string, patch: Partial<InputRecord> = {}): InputRecord {
  return {
    inputId,
    cutexSessionId: "cutex.s1",
    kind: "owner",
    sender: { kind: "owner", id: "owner", name: "Owner", host: null, cutexSessionId: null },
    intent: { strategy: "auto", deliveryMode: null, timing: "afterTurn" },
    preview: inputId,
    createdAt: iso(T0),
    state: "received",
    reason: null,
    since: iso(T0),
    deadline: null,
    stage: null,
    surface: "timeline",
    order: null,
    turnId: null,
    timelineItemId: null,
    runtimeGeneration: 1,
    attempt: 1,
    supersededBy: null,
    batchId: null,
    askId: null,
    remote: null,
    stalled: null,
    actions: [],
    error: null,
    evidence: null,
    details: {},
    rev: 1,
    stateRevision: 1,
    updatedAt: iso(T0),
    ...patch,
  };
}

export function delivery(state: SessionDelivery["state"], stateRevision: number, patch: Partial<SessionDelivery> = {}): SessionDelivery {
  return {
    state,
    reason: null,
    turn: null,
    lease: null,
    runtimeConnected: state !== "offline" && state !== "disconnected",
    runtimeGeneration: 1,
    heldCount: 0,
    heldUntil: null,
    stateRevision,
    observedAt: iso(T0 + stateRevision),
    ...patch,
  };
}

/** mulberry32: a small seeded PRNG (no fast-check in the repo). */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }
  /** Remove and return a random element. */
  take<T>(items: T[]): T {
    const i = this.int(items.length);
    const [item] = items.splice(i, 1);
    return item!;
  }
}
