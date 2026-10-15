// The queue panel as turn cards (cutex admission-order): 「下个工具边界」 while a turn runs (inserts,
// wakes past / still in their wait), 「队列」 by turn (本回合结束后 / 马上开始, numbered turns, paused
// divider, 还有 K 轮), only owner turns draggable, timing as symbols with their words as labels.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdmissionCurrentTurn, AdmissionItem, AdmissionNextStep, QueueItem } from "@cutex-desktop/protocol";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.n !== undefined ? `${key}(${vars.n})` : key) }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign(() => false, { getState: () => ({}) }), selectedFeatures: () => new Set(), agentHost: () => "local", queueItemText: (item: QueueItem) => (item.input as { text: string }[]).map((p) => p.text).join("") }));
import { QueuePanel } from "../src/renderer/src/components/QueuePanel";
import { turnGroups } from "../src/renderer/src/lib/admissionOrder";
import { setQueueView } from "../src/renderer/src/lib/queueView";

const at = "2026-10-12T00:00:00Z";
const queued = (queueId: string): QueueItem => ({ queueId, clientUserMessageId: `cm-${queueId}`, origin: { kind: "other", clientId: "desktop" } as never, input: [{ type: "text", text: `msg-${queueId}` }], position: 0, revision: 1, state: "queued", createdAt: at, updatedAt: at });
const owner = (id: string, position: number, state: AdmissionItem["state"] = "waiting"): AdmissionItem => ({ kind: "owner", id, position, enqueuedAt: at, state });
const soon = new Date(Date.now() + 90_000).toISOString();
const NEXT: AdmissionNextStep[] = [
  { id: "wake", deliveryKind: "tell", label: "note", enqueuedAt: new Date(Date.now() - 30_000).toISOString(), timing: "afterTurn", nextStepAt: soon },
  { id: "answer", deliveryKind: "answer", label: "result", enqueuedAt: at, timing: "nextStep" },
  { id: "alarm", deliveryKind: "alarm", label: "check", enqueuedAt: at, timing: "afterTurn" },
];

function render(opts: { items: AdmissionItem[]; queue: QueueItem[]; running: boolean; currentTurn?: AdmissionCurrentTurn | null; steers?: boolean; pausedIds?: string[]; nextStep?: AdmissionNextStep[]; strips?: boolean; ownerYielded?: boolean; onYield?: () => void }) {
  const { turns, nextStep } = turnGroups({ revision: 1, items: opts.items, nextStep: opts.nextStep ?? NEXT }, opts.queue, {});
  const held = opts.queue.filter((q) => opts.pausedIds?.includes(q.queueId));
  return renderToStaticMarkup(
    createElement(QueuePanel, {
      steers: opts.steers ? [{ id: "s1", text: "steer-text", imageCount: 0, state: "pending" } as never] : [],
      outbox: { onRetry() {}, onEdit() {}, onDiscard() {} },
      onInterruptSendSteers() {},
      onDismissSteer() {},
      paused: { steers: [], items: held, count: held.length },
      onResumePaused() {},
      onRestorePaused() {},
      onClearPaused() {},
      items: opts.queue,
      canEdit: true,
      onEdit() {},
      onDelete() {},
      stripEnabled: opts.strips ?? false,
      ordered: { turns, nextStep, running: opts.running, runningSince: opts.running ? Date.now() - 60_000 : null, currentTurn: opts.currentTurn ?? (opts.running ? { kind: "owner" } : null), mayPass: true, onMove() {}, onInsert() {}, ownerYielded: opts.ownerYielded, onYield: opts.onYield, sessionId: "s", actions: createElement("button", null, "pause-asks") },
    }),
  );
}
const between = (html: string, from: string, to?: string) => html.slice(html.indexOf(from), to ? html.indexOf(to) : undefined);
/** Rendered with 「还有 N 项」 expanded (lib/queueView, agent "s"). */
function expanded<T>(fn: () => T): T {
  setQueueView("s", { expanded: true });
  try {
    return fn();
  } finally {
    setQueueView("s", { expanded: false });
  }
}

describe("turn cards", () => {
  const items = [owner("A", 1), { kind: "ask", id: "B", position: 2, enqueuedAt: at, state: "waiting", hold: "targetBusy", includedNotes: [{ label: "tell-1" }] } as AdmissionItem, owner("c", 3)];

  it("running: one card with a header line; inserts and next-step / waiting wakes at the boundary, alarms after the turn", () => {
    const folded = render({ items, queue: [queued("A"), queued("c")], running: true, steers: true });
    // 7 rows: the 3 boundary rows (always full) fill the 2 shown; the rest folds.
    expect(folded).toContain('data-testid="queue-header"');
    expect(folded).toContain("queue.header.title");
    expect(folded).toMatch(/data-testid="queue-count"[^>]*>7</);
    expect(folded).toContain("queue.turn.moreItems(4)");
    expect(between(folded, 'data-testid="admission-queue"')).not.toContain("msg-A");
    // The queue actions (暂停委托) sit in the header line.
    expect(between(folded, 'data-testid="queue-header"', 'data-testid="turn-frame"')).toContain("pause-asks");
    const html = expanded(() => render({ items, queue: [queued("A"), queued("c")], running: true, steers: true }));
    expect(html.match(/data-testid="turn-frame"/g)).toHaveLength(1);
    const boundary = between(html, 'data-testid="boundary-card"', 'data-testid="admission-queue"');
    expect(html).toContain('role="group" aria-label="queue.turn.stripBoundary · queue.turn.runningFor"');
    expect(boundary).toContain("steer-text");
    expect(boundary).toContain('aria-label="queue.turn.inserting"');
    expect(boundary).toContain('data-testid="timing-wait"');
    expect(boundary).toMatch(/aria-label="queue\.turn\.waitInsert\((89|90)\)"/);
    expect(boundary).toContain('aria-label="queue.turn.nextStep"');
    expect(boundary).toContain('data-testid="boundary-interrupt-send"');
    expect(boundary).not.toContain("check");
    const queue = between(html, 'data-testid="admission-queue"');
    expect(html).toContain('aria-label="queue.turn.queue(3)"');
    expect(queue).toContain('data-testid="group-after-turn"');
    expect(queue).toContain('aria-label="queue.turn.afterTurn"');
    expect(queue).toContain("msg-A");
    expect(queue).toContain("msg-c");
    expect(queue).toContain("queue.turn.less");
    // Section names are tooltips, not visible rows; timing is quiet words (the sentence is the label).
    for (const key of ["queue.turn.stripBoundary", "queue.turn.queue(3)", "queue.turn.nextStep", "queue.turn.afterTurn"]) expect(html).not.toContain(`>${key}<`);
    for (const key of ["queue.meta.nextStep", "queue.meta.afterTurn", "queue.meta.countdown"]) expect(html).toContain(`>${key}`);
    // Kind icons instead of kind words; the text is the label.
    expect(html).toContain('aria-label="queue.delivery.alarm"');
    expect(html).not.toContain(">queue.delivery.alarm<");
  });

  it("numbered turns in the rail, only owner turns draggable, included tells as a +N chip", () => {
    const html = render({ items, queue: [queued("A"), queued("c")], running: false, nextStep: [] });
    const order = ['data-testid="turn-group-owner"', 'data-testid="turn-group-ask"', "msg-c"].map((x) => html.indexOf(x));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/data-testid="queue-drag-grip"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="queue-included-chip"');
    expect(html).toContain("tell-1");
    expect(html).toMatch(/\+(<!-- -->)?1</);
    expect(html).not.toContain('data-testid="queue-included-note"');
  });

  it("a delegation's turn: the boundary section is labelled with it", () => {
    const html = render({ items, queue: [queued("A"), queued("c")], running: true, currentTurn: { kind: "ask", askId: "ask-9" } });
    expect(html).toContain('aria-label="queue.turn.stripBoundary · queue.turn.askTurn"');
  });

  it("a ride-along-started turn: waiting ride-alongs join the owner's next turn (随第 N 轮), the ones at the step do not", () => {
    const html = expanded(() => render({ items, queue: [queued("A"), queued("c")], running: true, currentTurn: { kind: "delivery" } }));
    expect(html.match(/data-testid="timing-follows"/g)?.length).toBe(2); // the waiting wake + the alarm
    expect(html).toContain("queue.turn.follows(1)");
    expect(html).toContain("queue.turn.waitInsertFollows");
    // An owner turn or a paused owner queue: the usual timing.
    expect(render({ items, queue: [queued("A"), queued("c")], running: true })).not.toContain("timing-follows");
    expect(render({ items: [owner("A", 1, "paused")], queue: [queued("A")], running: true, currentTurn: { kind: "delivery" }, pausedIds: ["A"] })).not.toContain("timing-follows");
  });

  it("让它先走: a button with cutex support; after yielding the waiting ride-alongs show 先于第 N 轮", () => {
    const offer = expanded(() => render({ items, queue: [queued("A"), queued("c")], running: true, currentTurn: { kind: "delivery" }, onYield() {} }));
    expect(offer).toMatch(/<button[^>]*data-testid="timing-follows"/);
    expect(offer).toContain("queue.turn.yield");
    const yielded = expanded(() => render({ items, queue: [queued("A"), queued("c")], running: true, currentTurn: { kind: "delivery" }, ownerYielded: true, onYield() {} }));
    expect(yielded).not.toContain("timing-follows");
    expect(yielded.match(/data-testid="timing-first"/g)?.length).toBe(2);
    expect(yielded).not.toContain("queue.turn.waitInsertFollows");
  });

  it("a running turn with nothing queued: no empty tray", () => {
    expect(render({ items: [], queue: [], running: true, nextStep: [] })).toBe("");
  });

  it("idle: no boundary card; every ride-along item starts the next turn, without timing symbols", () => {
    const html = expanded(() => render({ items, queue: [queued("A"), queued("c")], running: false }));
    expect(html).not.toContain('data-testid="boundary-card"');
    const group = between(html, 'data-testid="group-starts-now"', 'data-testid="turn-group-owner"');
    for (const label of ["note", "result", "check"]) expect(group).toContain(label);
    expect(group).not.toContain('data-testid="timing-');
  });

  it("idle: a ride-along enqueued just now waits before 马上开始 shows (no flash while its turn starts)", () => {
    const fresh = [{ id: "fresh-alarm", deliveryKind: "alarm", label: "wake up", enqueuedAt: new Date().toISOString(), timing: "afterTurn" }] as AdmissionNextStep[];
    const html = render({ items, queue: [queued("A"), queued("c")], running: false, nextStep: fresh });
    expect(html).not.toContain("wake up");
    expect(html).not.toContain('data-testid="group-starts-now"');
  });

  it("paused: the divider (with 继续) goes before the first paused turn; no paused section without undelivered steers", () => {
    const html = render({ items: [owner("A", 1, "paused"), owner("c", 2, "paused")], queue: [queued("A"), queued("c")], running: false, pausedIds: ["A", "c"], nextStep: [] });
    expect(html).not.toContain('data-testid="paused-section"');
    expect(html.indexOf('data-testid="queue-paused-divider"')).toBeLessThan(html.indexOf("msg-A"));
    expect(between(html, 'data-testid="queue-paused-divider"', "msg-A")).toContain("paused.resume");
  });

  it("up to 3 rows all show; past that the first 2 and 还有 N 项 (expanded remembered per agent)", () => {
    const three = ["a", "b", "c"];
    const all = render({ items: three.map((id, i) => owner(id, i + 1)), queue: three.map(queued), running: false, nextStep: [] });
    expect(all.match(/data-testid="turn-group-owner"/g)).toHaveLength(3);
    expect(all).not.toContain('data-testid="queue-more"');
    const ids = ["a", "b", "c", "d", "e", "f"];
    const html = render({ items: ids.map((id, i) => owner(id, i + 1)), queue: ids.map(queued), running: false, nextStep: [] });
    expect(html.match(/data-testid="turn-group-owner"/g)).toHaveLength(2);
    expect(html).toContain("queue.turn.moreItems(4)");
    expect(html).not.toContain("msg-c");
    const open = expanded(() => render({ items: ids.map((id, i) => owner(id, i + 1)), queue: ids.map(queued), running: false, nextStep: [] }));
    expect(open.match(/data-testid="turn-group-owner"/g)).toHaveLength(6);
    expect(open).toContain("queue.turn.less");
  });

  it("the card collapses to its header line (per agent); owner rows: an icon, actions on hover / focus only", () => {
    const html = render({ items: [owner("A", 1)], queue: [queued("A")], running: false, nextStep: [] });
    expect(html).toContain('aria-label="queue.delivery.owner"');
    expect(html).toMatch(/data-testid="queue-item-actions"[^>]*/);
    // No room until hover / focus (clipped, still reachable with Tab), in the meta's place.
    expect(html).toMatch(/class="[^"]*max-w-0[^"]*opacity-0[^"]*group-hover\/row:opacity-100[^"]*focus-within:opacity-100[^"]*" data-testid="queue-item-actions"/);
    expect(html).toContain('aria-expanded="true"');
    setQueueView("s", { collapsed: true });
    try {
      const collapsed = render({ items: [owner("A", 1)], queue: [queued("A")], running: false, nextStep: [] });
      expect(collapsed).toContain('data-testid="queue-header"');
      expect(collapsed).toContain('aria-expanded="false"');
      expect(collapsed).not.toContain("msg-A");
      expect(collapsed).toMatch(/data-testid="queue-count"[^>]*>1</);
    } finally {
      setQueueView("s", { collapsed: false });
    }
  });

  it("one row anatomy: owner inserts / sends carry a kind icon, no ↳ / ⏎ text glyphs, trimmed one-line text", () => {
    const html = expanded(() => render({ items: [owner("A", 1)], queue: [queued("A")], running: true, steers: true, nextStep: [] }));
    expect(html).not.toMatch(/[↳⏎]/);
    // The steer: ↳ as its muted kind icon, 下一步 as its meta (the full sentence in the tooltip), no end symbol.
    const steer = between(html, 'data-testid="boundary-steer"', 'data-testid="admission-queue"');
    expect(steer).toContain('aria-label="queue.turn.inserting"');
    expect(steer).toMatch(/title="queue.deliverNextStep" data-testid="steer-delivery-note">queue.meta.nextStep</);
    expect(steer).not.toContain('data-testid="timing-insert"');
    expect(html).toContain('aria-label="queue.delivery.owner"');
  });

  it("ride-along rows: sender + first line (admission-ridealong-detail), a peer icon, and never a lone kind word on an older cutex", () => {
    const rich: AdmissionNextStep[] = [
      { id: "t", deliveryKind: "tell", label: "please review the diff", from: "Reviewer", preview: "please review the diff", enqueuedAt: at, timing: "afterTurn" },
      { id: "p", deliveryKind: "tell", label: "see the log", from: "worker@alpha", fromHost: "alpha", preview: "see the log", enqueuedAt: at, timing: "afterTurn" },
    ];
    const html = render({ items: [], queue: [], running: true, nextStep: rich });
    expect(html).toMatch(/data-testid="ride-along-from"[^>]*>Reviewer</);
    expect(html).toMatch(/data-testid="ride-along-text"[^>]*>please review the diff</);
    expect(html).toContain('data-kind="peer"');
    expect(html).toContain('aria-label="queue.delivery.peer"');
    expect(html).toContain("worker@alpha");
    const legacy: AdmissionNextStep[] = [
      { id: "b", deliveryKind: "bus", label: "Bus delivery", enqueuedAt: at, timing: "afterTurn" },
      { id: "a", deliveryKind: "alarm", label: "Alarm", enqueuedAt: at, timing: "afterTurn" },
    ];
    const old = render({ items: [], queue: [], running: true, nextStep: legacy });
    expect(old).not.toContain("Bus delivery");
    expect(old.match(/data-testid="ride-along-fallback"/g)).toHaveLength(2);
    // kind · when (no sender known): more than the kind word.
    expect(between(old, 'data-testid="ride-along-fallback"')).toMatch(/queue\.delivery\.bus<\/span><span class="text-subtle"> · /);
  });
  it("section strips on hover: the section name per rail, only with the setting; never a fold row when all fits", () => {
    const on = expanded(() => render({ items, queue: [queued("A"), queued("c")], running: true, strips: true }));
    expect(on).toMatch(/data-testid="rail-strip"[^>]*>queue\.turn\.stripBoundary · queue\.turn\.runningFor</);
    expect(on).toMatch(/data-testid="rail-strip"[^>]*>queue\.turn\.afterTurn</);
    expect(on).toMatch(/data-testid="rail-strip"[^>]*>queue\.turn\.queue\(3\)</);
    expect(on).toContain("pointer-events-none");
    expect(on).not.toContain('data-testid="rail-strip-forced"');
    const off = render({ items, queue: [queued("A"), queued("c")], running: true });
    expect(off).not.toContain('data-testid="rail-strip"');
    const fits = render({ items: [owner("A", 1)], queue: [queued("A")], running: false, nextStep: [] });
    expect(fits).not.toContain('data-testid="queue-more"');
  });
});
