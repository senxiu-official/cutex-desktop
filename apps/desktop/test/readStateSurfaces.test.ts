// @vitest-environment jsdom
// Design 061 surfaces: the 需要你 rule on hosts with cross-device read state (lib/needItems), when a reply counts as
// seen (lib/readOnSight), the snapshot / event readers (shared/attention) and main's attentionChanged feed.
import { act, createElement as h, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttentionAgent } from "../src/shared/attention";

const env = vi.hoisted(() => ({ reads: [] as unknown[] }));
vi.mock("../src/renderer/src/bridge", () => {
  const daemon = { attentionRead: async (reads: unknown) => (env.reads.push(reads), { ok: true, value: { changed: 1 } }), attentionDismiss: async () => ({ ok: true, value: { changed: 1 } }) };
  return { api: daemon, apiFor: () => daemon, bridge: { on: () => () => {} } };
});

const { needItems, needsYouOf, reasonOfKind } = await import("../src/renderer/src/lib/needItems");
const { endsWithReply, tailShows, useReadOnSight, READ_DWELL_MS } = await import("../src/renderer/src/lib/readOnSight");
const { readAttentionChange, readAttentionSnapshot } = await import("../src/shared/attention");
type HostAttention = import("../src/renderer/src/lib/hostAttention").HostAttention;

const KEY = (c: string) => c.repeat(64);
const TOKEN = `${"a".repeat(32)}/${"b".repeat(32)}`;
const row = (id: string, status = "idle", hostId?: string) =>
  ({ id, name: id, subtitle: "", status, isDirector: false, pinned: false, lastActivity: 0, profile: null, color: null, session: { cutexSessionId: id, runtime: { status: "running", activeTurnId: null, activeTurnObservedAt: null } }, ...(hostId ? { hostId } : {}) }) as never;
const stateOf = (agents: AttentionAgent[]): HostAttention => ({ instanceId: "i", personKey: "p", agents: new Map(agents.map((a) => [a.agentId, a])), needsYouCount: 0 });
const agent = (agentId: string, patch: Partial<AttentionAgent> = {}): AttentionAgent => ({ agentId, unreadTurns: 0, latest: null, running: null, lastTurnStartedAt: null, needs: [], ...patch });

describe("需要你 on a host with cross-device read state", () => {
  const rows = [row("a"), row("b"), row("c", "error"), row("d")];
  const signals = new Map([["a", "needsYou"], ["b", "needsYou"], ["c", "error"], ["d", "idle"]] as const);
  const needs = new Map([["a", { count: 1, reasons: ["confirm" as const], askIds: [] }], ["b", { count: 1, reasons: ["approval" as const], askIds: [] }]]);
  const base = { rows, signals, needs, markOf: () => undefined, focus: "local", dismissals: {} };

  it("lists what the host holds for the person: a dismissed agent goes (its badge is the sidebar's), the × carries the exact keys", () => {
    const state = stateOf([
      agent("a", { needs: [{ kind: "approval", id: "native:7", title: "", at: null, itemKey: KEY("1") }, { kind: "acceptance", id: "ask-9", title: "", at: null, itemKey: KEY("2") }] }),
      agent("b"), // all of b's items were dismissed on some device
      agent("c", { needs: [{ kind: "runtimeError", id: "runtime-error", title: "", at: null, itemKey: KEY("3") }] }),
      agent("d", { needs: [{ kind: "ownerReply", id: "note-1", title: "", at: null, itemKey: KEY("4") }] }),
    ]);
    const items = needItems({ ...base, stateOf: () => state });
    expect(items.map((i) => [i.chip.id, i.chip.signal, i.itemKeys])).toEqual([
      ["a", "needsYou", [KEY("1"), KEY("2")]],
      ["d", "needsYou", [KEY("4")]], // the host says it waits; this device did not see it
      ["c", "error", [KEY("3")]],
    ]);
    expect(items[0]!.need).toEqual({ count: 2, reasons: ["confirm", "acceptance"], askIds: ["ask-9"] });
    expect(items[0]!.chip.count).toBe(2);
    expect(items[1]!.need?.notificationIds).toEqual(["note-1"]);
  });

  it("出错: shown for a runtime error the person has not dismissed or a failed reply unread; neither: gone", () => {
    const failed = stateOf([agent("c", { unreadTurns: 1, latest: { turnId: "t", status: "failed", endedAt: "2026-11-26T00:00:00Z", through: TOKEN } })]);
    expect(needItems({ ...base, rows: [rows[2]!], stateOf: () => failed }).map((i) => [i.chip.signal, i.failedUnread, i.itemKeys])).toEqual([["error", true, []]]);
    expect(needItems({ ...base, rows: [rows[2]!], stateOf: () => stateOf([agent("c")]) })).toEqual([]);
  });

  it("a runtime error the host holds shows as 出错 even where this device sees the agent waiting or idle", () => {
    const state = stateOf([agent("b", { needs: [{ kind: "runtimeError", id: "runtime-error", title: "", at: "2026-11-26T00:00:00Z", itemKey: KEY("6") }] }), agent("d", { needs: [{ kind: "runtimeError", id: "runtime-error", title: "", at: null, itemKey: KEY("7") }] })]);
    const items = needItems({ ...base, rows: [rows[1]!, rows[3]!], stateOf: () => state });
    expect(items.map((i) => [i.chip.id, i.chip.signal, i.itemKeys])).toEqual([["b", "error", [KEY("6")]], ["d", "error", [KEY("7")]]]);
  });

  it("other hosts keep the device-local dismissals", () => {
    const items = needItems({ ...base, stateOf: () => null, dismissals: { [JSON.stringify(["local", "b"])]: { fp: JSON.stringify([["approval"], 1, [], []]), at: 1 } } });
    expect(items.map((i) => i.chip.id)).toEqual(["a", "c"]);
    expect(items.every((i) => i.itemKeys === undefined)).toBe(true);
  });

  it("kind words: a native approval is 待确认, an owner approval 待审批; unknown kinds stay generic", () => {
    expect([reasonOfKind("approval"), reasonOfKind("ownerApproval"), reasonOfKind("question"), reasonOfKind("somethingNew")]).toEqual(["confirm", "approval", "question", "confirm"]);
    expect(needsYouOf([{ kind: "question", id: "native:3", title: "", at: null, itemKey: KEY("5") }]).askIds).toEqual([]);
  });
});

describe("a reply is read once it is seen", () => {
  const view = (turns: { id: string; status: "inProgress" | "completed" | "interrupted" | "failed" }[], patch = {}) => ({ loading: false, resyncing: false, error: null, timeline: { turns: turns.map((t) => ({ ...t, startedAt: null, completedAt: null, entryIds: [] })) }, ...patch });

  it("the view must end with that finished reply (interrupted turns after it are no reply; a running one: not yet)", () => {
    expect(endsWithReply(view([{ id: "t1", status: "completed" }]), "t1")).toBe(true);
    expect(endsWithReply(view([{ id: "t1", status: "failed" }, { id: "t2", status: "interrupted" }]), "t1")).toBe(true);
    expect(endsWithReply(view([{ id: "t1", status: "completed" }, { id: "t2", status: "inProgress" }]), "t1")).toBe(false);
    expect(endsWithReply(view([{ id: "t0", status: "completed" }]), "t1")).toBe(false); // an older page / cache without it
    expect(endsWithReply(view([{ id: "t1", status: "completed" }], { loading: true }), "t1")).toBe(false);
    expect(endsWithReply(undefined, "t1")).toBe(false);
  });

  it("the scroller must be at its end with the reply's rows laid out on screen", () => {
    const el = document.createElement("div");
    el.innerHTML = `<div data-turn-id="t1"></div>`;
    Object.defineProperty(el, "clientHeight", { value: 400 });
    el.getBoundingClientRect = () => ({ top: 0, bottom: 400 }) as DOMRect;
    (el.firstElementChild as HTMLElement).getBoundingClientRect = () => ({ top: 120 }) as DOMRect;
    expect(tailShows(el, "t1", true)).toBe(true);
    expect(tailShows(el, "t1", false)).toBe(false); // scrolled up
    expect(tailShows(el, "t2", true)).toBe(false);
  });

  afterEach(async () => {
    (await import("../src/renderer/src/lib/hostAttention")).resetHostAttention();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the hook sends the read after the reply stayed on screen; not while the window is in the background", async () => {
    vi.useFakeTimers();
    const ha = await import("../src/renderer/src/lib/hostAttention");
    const { apiFor } = await import("../src/renderer/src/bridge");
    Object.assign(apiFor("local"), { attention: async () => ({ ok: true, value: { instanceId: "i", personKey: "p", cursor: { streamId: "s", after: "1" }, agents: [agent("a", { unreadTurns: 1, latest: { turnId: "t1", status: "completed", endedAt: "2026-11-26T00:00:00Z", through: TOKEN } })], unlistedNeeds: [], needsYouCount: 0 } }) });
    ha.syncHostAttention("local", true, "e");
    await vi.advanceTimersByTimeAsync(300);
    let focused = false;
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    const v = view([{ id: "t1", status: "completed" }]);
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      useReadOnSight("local", "a", ref, () => true, v);
      return h("div", { ref }, h("div", { "data-turn-id": "t1" }));
    }
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    const proto = HTMLElement.prototype as unknown as { getBoundingClientRect: () => DOMRect };
    vi.spyOn(proto, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return (this.dataset.turnId ? { top: 50 } : { top: 0, bottom: 400 }) as DOMRect; });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    act(() => root.render(h(Probe)));
    await vi.advanceTimersByTimeAsync(READ_DWELL_MS * 2);
    expect(env.reads).toEqual([]);
    focused = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await vi.advanceTimersByTimeAsync(READ_DWELL_MS + 50);
    expect(env.reads).toEqual([[{ agentId: "a", through: TOKEN }]]);
    act(() => root.unmount());
    node.remove();
  });
});

describe("snapshot and event readers", () => {
  it("keep valid entries, drop malformed ones", () => {
    const s = readAttentionSnapshot({
      instanceId: "i", personKey: "p", cursor: { streamId: "s", after: "12" }, needsYouCount: 1,
      agents: [{ agentId: "a", unreadTurns: 3, latest: { turnId: "t", status: "completed", endedAt: "x", through: TOKEN }, needs: [{ kind: "ownerApproval", id: "1", title: "t", at: null, itemKey: KEY("1"), level: "needsYou" }, { kind: "bad", itemKey: "nope" }] }, { agentId: "" }],
      unlistedNeeds: [{ agentId: "z", needs: [] }],
    });
    expect(s?.agents).toEqual([{ agentId: "a", unreadTurns: 3, latest: { turnId: "t", status: "completed", endedAt: "x", through: TOKEN }, running: null, lastTurnStartedAt: null, needs: [{ kind: "ownerApproval", id: "1", title: "t", at: null, itemKey: KEY("1") }] }]);
    const withTurns = readAttentionSnapshot({ instanceId: "i", personKey: "p", cursor: { streamId: "s", after: "1" }, needsYouCount: 0, unlistedNeeds: [], agents: [{ agentId: "a", unreadTurns: 0, latest: null, running: { turnId: "r1", observedAt: "2026-11-26T00:00:00Z" }, lastTurnStartedAt: "2026-11-26T00:00:00Z", needs: [] }, { agentId: "b", unreadTurns: 0, latest: null, running: { turnId: 3 }, needs: [] }] });
    expect(withTurns?.agents.map((a) => [a.running, a.lastTurnStartedAt])).toEqual([[{ turnId: "r1", observedAt: "2026-11-26T00:00:00Z" }, "2026-11-26T00:00:00Z"], [null, null]]);
    expect(s?.unlistedNeeds).toEqual([]);
    expect(readAttentionSnapshot({ instanceId: "i", personKey: "p", cursor: { streamId: "s", after: "x" } })).toBeNull();
    expect(readAttentionChange({ agentIds: ["a", 3] })).toEqual({ agentIds: ["a"] });
    expect(readAttentionChange({ resync: true })).toEqual({ resync: true });
    expect(readAttentionChange({})).toBeNull();
  });
});

describe("main's attentionChanged feed", () => {
  const sse = (frames: string) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frames)); c.close(); } }), { headers: { "content-type": "text/event-stream" } });

  it("forwards only attentionChanged, resumes after the last id, and turns an expired cursor into one resync", async () => {
    const { AttentionFeed } = await import("../src/main/attentionFeed");
    const { CutexApiError } = await import("@cutex-desktop/cutex-client");
    const asked: unknown[] = [];
    let call = 0;
    const client = {
      summaryEvents: async (o: { after?: string; streamId?: string }) => {
        asked.push({ after: o.after, streamId: o.streamId });
        if (call++ === 0) return sse(`id: 5\nevent: cutex/summary/agentChanged\ndata: {}\n\nid: 6\nevent: cutex/summary/attentionChanged\ndata: {"agentIds":["a"]}\n\n`);
        throw new CutexApiError(409, "cursor_expired", "gone");
      },
    };
    const seen: unknown[] = [];
    const status: boolean[] = [];
    const feed = new AttentionFeed(client as never, (c) => seen.push(c), (s) => status.push(s.live));
    vi.useFakeTimers();
    feed.follow({ streamId: "s", after: "4" });
    await vi.advanceTimersByTimeAsync(1_500);
    feed.stop();
    vi.useRealTimers();
    expect(asked).toEqual([{ after: "4", streamId: "s" }, { after: "6", streamId: "s" }]);
    expect(seen).toEqual([{ agentIds: ["a"] }, { resync: true }]);
    expect(status).toEqual([true, false]); // live while streaming; not once the stream ended / was refused
  });
});
