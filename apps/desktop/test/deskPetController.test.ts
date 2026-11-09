// The desk pet module's running part: token reports move it and nothing runs at rest, today's tokens from the ledger plus
// live reports, the waiting mark, rising icons, exact counts, a hidden pet still counts, stop on abort, follow only while asked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeskPetView } from "../src/shared/deskPet";
import { bubbleRect, DESK_PET_DEFAULTS, fanPoints, overheadRect, stageBounds, DESK_PET_OVERHEAD, DESK_PET_STAGE_SIDE, DESK_PET_STAGE_TOP } from "../src/shared/deskPet";
import type { OwnerWaitingItem } from "../src/renderer/src/lib/ownerWaiting";

const pet = {
  start: vi.fn(),
  stop: vi.fn(async () => {}),
  tick: vi.fn(async (_t: Record<string, unknown>) => {}),
  follow: vi.fn(async () => {}),
  onState: vi.fn((l: (v: DeskPetView) => void) => {
    stateListener = l;
    return () => {};
  }),
  onOpenSettings: vi.fn(() => () => {}),
};
let stateListener: (v: DeskPetView) => void = () => {};
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { deskPet: pet } }));
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key }));
const families: Record<string, "claude" | "openai" | "other"> = { a: "claude", b: "openai", c: "other" };
vi.mock("../src/renderer/src/lib/agentLook", () => ({ agentFamilyNow: (id: string) => families[id] ?? null }));
type Hosts = { active: string; hosts: { id: string; conn?: { epoch: string } }[] };
let storeState: { selectedId: string | null; sidebar: unknown; byHost: unknown; hosts: Hosts } = { selectedId: "a", sidebar: {}, byHost: {}, hosts: { active: "local", hosts: [{ id: "local", conn: { epoch: "e1" } }] } };
const storeListeners = new Set<(s: typeof storeState, prev: typeof storeState) => void>();
vi.mock("../src/renderer/src/store", () => ({
  useApp: {
    getState: () => storeState,
    subscribe: (l: (s: typeof storeState, prev: typeof storeState) => void) => {
      storeListeners.add(l);
      return () => storeListeners.delete(l);
    },
  },
}));

const { activateDeskPet, currentView } = await import("../src/renderer/src/modules/desk-pet/controller");

const viewOf = (settings: Partial<DeskPetView["settings"]> = {}): DeskPetView => ({ running: true, settings: { ...DESK_PET_DEFAULTS, ...settings }, characters: [], current: "placeholder", problems: [], artDir: "", placement: "full", shape: true });
const ticks = <K extends string>(key: K) => pet.tick.mock.calls.flatMap((c) => (c[0][key] !== undefined ? [c[0][key]] : []));
const ledger = (cutex: { input: number; cachedInput: number; output: number }) => ({ totals: { input: 0, cachedInput: 0, output: 0 }, rows: [{ key: { source: "cutex" }, ...cutex }, { key: { source: "claude-code" }, input: 9e9, cachedInput: 0, output: 0 }] });

function activate(saved: unknown = null, more: Record<string, unknown> = {}) {
  const prefs = new Map<string, unknown>([["counts", saved], ...Object.entries(more)]);
  let emit: (e: { kind: "ownerMessage" | "command" | "tool"; hostId: string; agentId?: string }) => void = () => {};
  let usage: (e: { hostId: string; agentId: string; tokens: number }) => void = () => {};
  let waiting: (items: readonly OwnerWaitingItem[]) => void = () => {};
  const usageCalls: { hostId: string; query: unknown }[] = [];
  let answer: unknown = ledger({ input: 1000, cachedInput: 400, output: 100 });
  const controller = new AbortController();
  const ctx = {
    signal: controller.signal,
    prefs: { get: (k: string, d: unknown) => prefs.get(k) ?? d, set: (k: string, v: unknown) => prefs.set(k, v) },
    services: {
      activity: {
        subscribe: (l: typeof emit) => { emit = l; return () => {}; },
        subscribeUsage: (l: typeof usage) => { usage = l; return () => {}; },
        subscribeOwnerWaiting: (l: typeof waiting) => { waiting = l; l([]); return () => {}; },
      },
      daemonFor: (hostId: string) => ({ usage: async (query: unknown) => { usageCalls.push({ hostId, query }); return answer; } }),
      ui: { openSettings: vi.fn() },
    },
  };
  activateDeskPet(ctx as never);
  return {
    prefs, ctx, usageCalls,
    setAnswer: (a: unknown) => (answer = a),
    emit: (kind: "ownerMessage" | "command" | "tool", agentId = "x") => emit({ kind, hostId: "local", ...(kind === "ownerMessage" ? {} : { agentId }) }),
    report: (tokens: number, agentId = "a", hostId = "local") => usage({ hostId, agentId, tokens }),
    waiting: (items: Partial<OwnerWaitingItem>[]) => waiting(items.map((i) => ({ hostId: "local", agentId: "a", key: "k", onScreen: false, ...i }))),
    abort: () => controller.abort(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.clearAllMocks();
  storeListeners.clear();
  storeState = { selectedId: "a", sidebar: {}, byHost: {}, hosts: { active: "local", hosts: [{ id: "local", conn: { epoch: "e1" } }] } };
  pet.start.mockImplementation(async () => viewOf());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Only the midnight timer is left. */
const AT_REST_TIMERS = 1;

describe("desk pet controller", () => {
  it("a token report moves it at a bounded pace, and it stops within about 15 s with no timer but midnight's", async () => {
    const m = activate();
    await vi.advanceTimersByTimeAsync(0);
    m.report(1500);
    await vi.advanceTimersByTimeAsync(5000);
    const early = ticks("pose").length;
    expect(early).toBeGreaterThan(5);
    expect(early).toBeLessThan(40);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(ticks("pose").at(-1)).toBe("both");
    expect(vi.getTimerCount()).toBe(AT_REST_TIMERS);
    m.abort();
  });

  it("reports close together move it faster than one", async () => {
    const one = activate();
    await vi.advanceTimersByTimeAsync(0);
    one.report(1500);
    await vi.advanceTimersByTimeAsync(3000);
    const slow = ticks("pose").length;
    one.abort();
    await vi.advanceTimersByTimeAsync(20_000);
    pet.tick.mockClear();
    const many = activate();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 6; i++) many.report(1500, `agent-${i}`);
    await vi.advanceTimersByTimeAsync(3000);
    expect(ticks("pose").length).toBeGreaterThan(slow * 1.5);
    many.abort();
  });

  it("the number is today's ledger (cutex rows only, non-cached) plus live reports; a new connection asks again", async () => {
    const m = activate();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.usageCalls).toHaveLength(1);
    expect(m.usageCalls[0]!.query).toMatchObject({ groupBy: ["source"] });
    expect(ticks("total").at(-1)).toBe(700);
    m.report(50);
    expect(ticks("total").at(-1)).toBe(750);
    m.setAnswer(ledger({ input: 2000, cachedInput: 400, output: 100 }));
    const prev = storeState;
    storeState = { ...prev, hosts: { active: "local", hosts: [{ id: "local", conn: { epoch: "e2" } }] } };
    for (const l of storeListeners) l(storeState, prev);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.usageCalls).toHaveLength(2);
    // While it moves, the number rides on the next pose.
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks("total").at(-1)).toBe(1700);
    expect(pet.tick.mock.calls.find((c) => c[0].total === 1700)?.[0].pose).toBeDefined();
    m.abort();
  });

  it("asks the ledger again on a report after an hour, not before", async () => {
    const m = activate();
    await vi.advanceTimersByTimeAsync(0);
    m.report(10);
    expect(m.usageCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    m.report(10);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.usageCalls).toHaveLength(2);
    m.abort();
  });

  it("tool calls move it only for an agent that has not reported usage; counts stay exact", async () => {
    const m = activate();
    await vi.advanceTimersByTimeAsync(0);
    m.report(0, "x");
    await vi.advanceTimersByTimeAsync(30_000);
    pet.tick.mockClear();
    for (let i = 0; i < 20; i++) m.emit("tool", "x");
    await vi.advanceTimersByTimeAsync(2000);
    expect(ticks("pose")).toHaveLength(0);
    for (let i = 0; i < 3; i++) m.emit("command", "y");
    await vi.advanceTimersByTimeAsync(2000);
    expect(ticks("pose").length).toBeGreaterThan(0);
    expect(m.prefs.get("counts")).toMatchObject({ tool: 20, command: 3 });
    m.abort();
  });

  it("a hidden pet still counts and does not move", async () => {
    pet.start.mockImplementation(async () => viewOf({ hidden: true, tokenIcons: true }));
    const m = activate();
    await vi.advanceTimersByTimeAsync(0);
    m.emit("command");
    m.report(5000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(m.prefs.get("counts")).toMatchObject({ command: 1 });
    expect(ticks("pose")).toHaveLength(0);
    expect(ticks("icon")).toHaveLength(0);
    expect(ticks("total").at(-1)).toBe(5700);
    m.abort();
  });

  it("only the open conversation's agent moves it when asked", async () => {
    pet.start.mockImplementation(async () => viewOf({ currentOnly: true }));
    const m = activate();
    await vi.advanceTimersByTimeAsync(0);
    m.report(5000, "b");
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks("pose")).toHaveLength(0);
    m.report(5000, "a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks("pose").length).toBeGreaterThan(0);
    m.abort();
  });

  it("the waiting mark: up until the agent has been on screen, again for a new item, off by setting", async () => {
    const m = activate();
    await vi.advanceTimersByTimeAsync(0);
    m.waiting([{ key: "q1" }]);
    expect(ticks("mark").at(-1)).toBe(true);
    m.waiting([{ key: "q1", onScreen: true }]);
    expect(ticks("mark").at(-1)).toBe(false);
    m.waiting([{ key: "q1" }]);
    expect(ticks("mark").at(-1)).toBe(false);
    m.waiting([{ key: "q1" }, { key: "q2", agentId: "b" }]);
    expect(ticks("mark").at(-1)).toBe(true);
    stateListener(viewOf({ waitingMark: false }));
    expect(ticks("mark").at(-1)).toBe(false);
    m.abort();
  });

  it("icons rise only with the setting, by family, at most one per 0.4 s", async () => {
    pet.start.mockImplementation(async () => viewOf({ tokenIcons: true }));
    const m = activate();
    await vi.advanceTimersByTimeAsync(0);
    m.report(100, "a");
    m.report(100, "b");
    await vi.advanceTimersByTimeAsync(500);
    m.report(100, "b");
    await vi.advanceTimersByTimeAsync(500);
    m.report(100, "c");
    m.report(0, "a");
    expect(ticks("icon")).toEqual(["claude", "gpt", "coin"]);
    m.abort();
  });

  it("restores the saved count, keeps a pending one on abort, says stop", async () => {
    const m = activate({ ownerMessage: 5, command: 0, tool: 0 });
    await vi.advanceTimersByTimeAsync(0);
    m.emit("ownerMessage");
    m.abort();
    expect(m.prefs.get("counts")).toMatchObject({ ownerMessage: 6 });
    expect(pet.stop).toHaveBeenCalledTimes(1);
    expect(currentView()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a format 2 pet works off a pool of today's tokens instead of tapping: credited once, read down at the set speed, then rest with nothing free", async () => {
    const art = { max: 3, deck: [{ cover: "green", kind: "book", units: 1 }] };
    pet.start.mockImplementation(async () => ({ ...viewOf(), scenes: true, current: "reader", characters: [{ id: "reader", name: "R", family: null, source: "pack", pixel: false, format: 2, books: art }] }));
    const m = activate(null, { poolConfig: { tokensPerBook: 10_000, tokensPerMinute: 10_000 } });
    await vi.advanceTimersByTimeAsync(0);
    const books = () => ticks("books") as { active: { id: string } | null; pile: unknown[] }[];
    // The ledger's non-cached input + output (700) is the first book, in hand at once.
    expect(ticks("work").at(-1)).toBe(true);
    expect(books().at(-1)).toMatchObject({ active: { id: "book-1" }, pile: [] });
    // 25k more: book-1 is read on, three new books land on the pile; never more items than the pile holds.
    m.report(25_000);
    expect(books().at(-1)!.pile).toHaveLength(3);
    expect(ticks("pose")).toEqual([]);
    // 25.7k at 10k a minute: about 2.6 minutes, one timer per book end, then rest.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ticks("work").at(-1)).toBe(true);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(ticks("work").at(-1)).toBe(false);
    expect(books().at(-1)).toEqual({ active: null, pile: [] });
    expect(new Set(books().map((b) => b.active?.id).filter(Boolean)).size).toBe(4);
    expect(ticks("pose")).toEqual([]);
    expect(m.prefs.get("pool")).toMatchObject({ done: 4, active: null, pile: [], below: 0 });
    // Nothing free: no refill timer, no book later.
    expect(vi.getTimerCount()).toBe(AT_REST_TIMERS);
    const seen = books().length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(books().length).toBe(seen);
    m.abort();
  });

  it("a hidden format 2 pet still credits its pool but does not work it off", async () => {
    const art = { max: 3, deck: [{ cover: "green", kind: "book", units: 1 }] };
    pet.start.mockImplementation(async () => ({ ...viewOf({ hidden: true }), scenes: true, current: "reader", characters: [{ id: "reader", name: "R", family: null, source: "pack", pixel: false, format: 2, books: art }] }));
    const m = activate(null, { poolConfig: { tokensPerBook: 10_000, tokensPerMinute: 10_000 } });
    await vi.advanceTimersByTimeAsync(0);
    m.report(5000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ticks("work").filter(Boolean)).toEqual([]);
    m.abort();
    expect(m.prefs.get("pool")).toMatchObject({ done: 0, pile: [{ tokens: 5700 }] });
  });

  it("watches the conversation only while following, and maps the family name", async () => {
    const m = activate();
    await vi.advanceTimersByTimeAsync(0);
    const hostsWatch = storeListeners.size;
    expect(pet.follow).not.toHaveBeenCalled();
    stateListener(viewOf({ followModel: true }));
    expect(storeListeners.size).toBe(hostsWatch + 1);
    expect(pet.follow).toHaveBeenLastCalledWith("claude");
    const prev = storeState;
    storeState = { ...prev, selectedId: "b" };
    for (const l of storeListeners) l(storeState, prev);
    expect(pet.follow).toHaveBeenLastCalledWith("gpt");
    const prev2 = storeState;
    storeState = { ...prev2, selectedId: "c" };
    for (const l of storeListeners) l(storeState, prev2);
    expect(pet.follow).toHaveBeenLastCalledWith(null);
    pet.follow.mockClear();
    for (const l of storeListeners) l({ ...storeState }, storeState);
    expect(pet.follow).not.toHaveBeenCalled();
    stateListener(viewOf({ followModel: false }));
    expect(storeListeners.size).toBe(hostsWatch);
    m.abort();
  });
});

describe("the window's room", () => {
  const size = { width: 164, height: 188 };
  it("holds room on every side of the pet", () => {
    expect(stageBounds({ x: 500, y: 400 }, size)).toEqual({ x: 500 - DESK_PET_STAGE_SIDE, y: 400 - DESK_PET_STAGE_TOP, width: 164 + 2 * DESK_PET_STAGE_SIDE, height: 188 + 2 * DESK_PET_STAGE_TOP });
  });

  it("the bubble's rect stays in the room, clear of the pet and its count", () => {
    const room = stageBounds({ x: 0, y: 0 }, size);
    for (const below of [false, true]) {
      const r = bubbleRect(size, below);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(room.width);
      expect(r.y + r.height).toBeLessThanOrEqual(room.height);
      expect(below ? r.y >= DESK_PET_STAGE_TOP + size.height : r.y + r.height <= DESK_PET_STAGE_TOP).toBe(true);
    }
  });

  it.each([[96, 64], [164, 188], [640, 640]])("the room over the head sits inside the room, above the pet, centred (%i wide)", (width, height) => {
    const room = stageBounds({ x: 0, y: 0 }, { width, height });
    const r = overheadRect({ width });
    expect(r).toMatchObject(DESK_PET_OVERHEAD);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.height).toBe(DESK_PET_STAGE_TOP);
    expect(r.x + r.width / 2).toBeCloseTo(room.width / 2, 0);
  });

  it.each([[80, 80], [160, 160], [320, 320], [120, 320]])("the fan stays inside for a %i×%i pet", (w, h) => {
    for (const below of [false, true]) {
      for (const p of fanPoints(7, w, h, below)) {
        expect(Math.abs(p.x) + 16).toBeLessThanOrEqual(w / 2 + DESK_PET_STAGE_SIDE);
        expect(Math.abs(p.y) + 16).toBeLessThanOrEqual(h / 2 + DESK_PET_STAGE_TOP);
        expect(below ? p.y : -p.y).toBeGreaterThan(0);
      }
    }
    expect(fanPoints(7, w, h, false)[3]!.x).toBe(0);
  });
});
