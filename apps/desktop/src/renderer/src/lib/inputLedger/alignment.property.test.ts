// 054 §5.3: the §2.8 alignment converges to cutex's state whatever the order — events and read results
// shuffled, duplicated and dropped, stale reads delivered late, an epoch change in the middle. Seeded PRNG
// (no fast-check in the repo): a failing seed reproduces with `SEEDS=<n>`.
import { describe, expect, it } from "vitest";
import type { InputListResult, InputRecord, InputState, InputSurface, SessionDelivery } from "@cutex-desktop/protocol";
import { INPUT_STATES, INPUT_SURFACES, SESSION_DELIVERY_STATES } from "@cutex-desktop/protocol";
import {
  applyInputLedgerNotification,
  applyInputLedgerSnapshot,
  emptyInputLedgerSession,
  inputLedgerReconnected,
  inputLedgerStreamReset,
  inputListSnapshot,
  type InputLedgerFetch,
  type InputLedgerSession,
  type InputLedgerSnapshot,
  type InputLedgerStep,
} from "./alignment";
import { delivery as makeDelivery, record as makeRecord, Rng } from "./testkit";

/** The cutex side: one session's ledger. */
class Server {
  epoch = "ep-0";
  head = 0;
  records = new Map<string, InputRecord>();
  delivery: SessionDelivery | null = null;
  private epochs = 0;
  private ids = 0;

  constructor(private rng: Rng) {}

  private event(method: string, params: Record<string, unknown>) {
    return { method, params: { cutexSessionId: "cutex.s1", ledgerEpoch: this.epoch, stateRevision: this.head, ...params } };
  }

  create() {
    this.head += 1;
    const id = `in-${this.ids++}`;
    const rec = makeRecord(id, { rev: 1, stateRevision: this.head, state: "received", surface: this.rng.pick(INPUT_SURFACES) });
    this.records.set(id, rec);
    return this.event("cutex/input/stateChanged", { record: rec });
  }

  update() {
    const ids = [...this.records.keys()];
    if (ids.length === 0) return this.create();
    const prev = this.records.get(this.rng.pick(ids))!;
    this.head += 1;
    const state: InputState = this.rng.pick(INPUT_STATES);
    const surface: InputSurface = this.rng.pick(INPUT_SURFACES);
    const rec: InputRecord = { ...prev, state, surface, attempt: prev.attempt + (this.rng.chance(0.1) ? 1 : 0), rev: prev.rev + 1, stateRevision: this.head };
    this.records.set(rec.inputId, rec);
    return this.event("cutex/input/stateChanged", { record: rec });
  }

  changeDelivery() {
    this.head += 1;
    this.delivery = makeDelivery(this.rng.pick(SESSION_DELIVERY_STATES), this.head);
    return this.event("cutex/session/deliveryChanged", { delivery: this.delivery });
  }

  /** Ledger lost (§2.12): new epoch, records rebuilt from the underlying stores, revisions start over. No events. */
  changeEpoch() {
    this.epoch = `ep-${++this.epochs}`;
    this.head = 0;
    const rebuilt = new Map<string, InputRecord>();
    for (const rec of this.records.values()) {
      this.head += 1;
      rebuilt.set(rec.inputId, { ...rec, rev: 1, stateRevision: this.head });
    }
    this.records = rebuilt;
    if (this.delivery) {
      this.head += 1;
      this.delivery = { ...this.delivery, stateRevision: this.head };
    }
  }

  list(params: { sinceRevision?: number }, resync: boolean): InputListResult {
    const base = { ledgerEpoch: this.epoch, stateRevision: this.head, ...(this.delivery ? { delivery: structuredClone(this.delivery) } : {}) };
    if (params.sinceRevision !== undefined) {
      if (resync || params.sinceRevision > this.head) return { ...base, records: [], complete: false, resyncRequired: true };
      const records = [...this.records.values()].filter(rec => rec.stateRevision > params.sinceRevision!).sort((a, b) => a.stateRevision - b.stateRevision);
      return { ...base, records: structuredClone(records), complete: true };
    }
    return { ...base, records: structuredClone([...this.records.values()]), complete: true };
  }

  /** queue/list `inputs`: unsettled nextUp / pendingNotes only. */
  queueInputs(): InputRecord[] {
    return structuredClone([...this.records.values()].filter(rec => (rec.surface === "nextUp" || rec.surface === "pendingNotes") && !["inContext", "uncertain", "failed", "rejected", "discarded", "superseded"].includes(rec.state)));
  }

  /** input/get of a few ids. */
  getSome(): InputRecord[] {
    return structuredClone([...this.records.values()].filter(() => this.rng.chance(0.4)));
  }
}

type Message =
  | { type: "event"; method: string; params: unknown }
  | { type: "snapshot"; snapshot: InputLedgerSnapshot }
  | { type: "reset" };

interface Stats {
  events: number;
  dropped: number;
  duplicated: number;
  fetches: number;
  staleReads: number;
  epochChanges: number;
}

function simulate(seed: number, stats: Stats): { client: InputLedgerSession; server: Server } {
  const rng = new Rng(seed);
  const server = new Server(rng);
  let client = emptyInputLedgerSession();
  const inbox: Message[] = [];
  const pending: InputLedgerFetch[] = [];
  const ops = 20 + rng.int(60);
  const epochAt = rng.chance(0.4) ? rng.int(ops) : -1;
  const dropRate = rng.pick([0, 0.05, 0.15, 0.3]);
  const dupRate = rng.pick([0, 0.1, 0.25]);

  const take = (step: InputLedgerStep) => {
    client = step.session;
    pending.push(...step.fetches);
    stats.fetches += step.fetches.length;
  };
  const answer = (fetch: InputLedgerFetch) => {
    const result = server.list(fetch.params, rng.chance(0.05));
    inbox.push({ type: "snapshot", snapshot: inputListSnapshot(result, fetch.params, fetch.generation) });
  };
  const deliver = (message: Message) => {
    if (message.type === "event") take(applyInputLedgerNotification(client, message.method, message.params));
    else if (message.type === "snapshot") take(applyInputLedgerSnapshot(client, message.snapshot));
    else take(inputLedgerStreamReset(client));
  };
  const emit = (event: { method: string; params: unknown }) => {
    stats.events += 1;
    if (rng.chance(dropRate)) {
      stats.dropped += 1;
      return;
    }
    inbox.push({ type: "event", ...structuredClone(event) });
    if (rng.chance(dupRate)) {
      stats.duplicated += 1;
      inbox.push({ type: "event", ...structuredClone(event) });
    }
  };
  /** A read the client made on its own (queue/list, input/get, a full list), answered now and delivered whenever. */
  const unsolicited = () => {
    stats.staleReads += 1;
    const generation = client.generation;
    const kind = rng.int(3);
    if (kind === 0) {
      inbox.push({ type: "snapshot", snapshot: { ledgerEpoch: server.epoch, stateRevision: server.head, records: server.queueInputs(), delivery: server.delivery && structuredClone(server.delivery), coverage: { kind: "partial" }, generation } });
    } else if (kind === 1) {
      inbox.push({ type: "snapshot", snapshot: { ledgerEpoch: server.epoch, stateRevision: server.head, records: server.getSome(), coverage: { kind: "partial" }, generation } });
    } else {
      inbox.push({ type: "snapshot", snapshot: inputListSnapshot(server.list({}, false), {}, generation) });
    }
  };

  // Bootstrap read, as the store does when it opens the session.
  take(inputLedgerReconnected(client));
  let done = 0;
  while (done < ops) {
    const roll = rng.next();
    if (roll < 0.35) {
      if (done === epochAt) {
        server.changeEpoch();
        stats.epochChanges += 1;
        if (rng.chance(0.5)) inbox.push({ type: "reset" });
      } else {
        const op = rng.next();
        emit(op < 0.3 ? server.create() : op < 0.85 ? server.update() : server.changeDelivery());
      }
      done += 1;
    } else if (roll < 0.75) {
      if (inbox.length > 0) deliver(rng.take(inbox));
    } else if (roll < 0.9) {
      if (pending.length > 0) answer(rng.take(pending));
    } else {
      unsolicited();
    }
  }
  const drain = () => {
    while (inbox.length > 0 || pending.length > 0) {
      if (pending.length > 0 && (inbox.length === 0 || rng.chance(0.5))) answer(rng.take(pending));
      else deliver(rng.take(inbox));
    }
  };
  drain();
  // Reconnect (054 §2.8 step 4): one incremental read after the stream replay.
  take(inputLedgerReconnected(client));
  drain();
  return { client, server };
}

const SEEDS = Number(process.env.SEEDS ?? 0);

describe("input ledger alignment converges (property, seeded)", () => {
  it("500 random histories: shuffled, duplicated, dropped, stale, epoch change", () => {
    const stats: Stats = { events: 0, dropped: 0, duplicated: 0, fetches: 0, staleReads: 0, epochChanges: 0 };
    const seeds = SEEDS > 0 ? [SEEDS] : Array.from({ length: 500 }, (_, i) => 0x5eed + i * 7919);
    for (const seed of seeds) {
      const { client, server } = simulate(seed, stats);
      const context = `seed ${seed}`;
      expect(client.epoch, context).toBe(server.epoch);
      expect(client.rev, context).toBe(server.head);
      expect(Object.fromEntries(client.records), context).toEqual(Object.fromEntries(server.records));
      expect(client.delivery, context).toEqual(server.delivery);
    }
    // The generator really exercised every path.
    if (SEEDS === 0) {
      expect(stats.dropped).toBeGreaterThan(100);
      expect(stats.duplicated).toBeGreaterThan(100);
      expect(stats.staleReads).toBeGreaterThan(100);
      expect(stats.epochChanges).toBeGreaterThan(50);
    }
  });

  it("without the reconnect read, a dropped last event is the only thing that can be missing", () => {
    // Sanity check of the harness: deliver everything in order with no drops → equal without any fetch answered.
    const rng = new Rng(1);
    const server = new Server(rng);
    let client = emptyInputLedgerSession();
    client = applyInputLedgerSnapshot(client, inputListSnapshot(server.list({}, false), {})).session;
    for (let i = 0; i < 50; i += 1) {
      const event = i % 7 === 0 ? server.changeDelivery() : i % 3 === 0 ? server.create() : server.update();
      const step = applyInputLedgerNotification(client, event.method, event.params);
      expect(step.fetches).toEqual([]);
      client = step.session;
    }
    expect(Object.fromEntries(client.records)).toEqual(Object.fromEntries(server.records));
    expect(client.rev).toBe(server.head);
  });
});
