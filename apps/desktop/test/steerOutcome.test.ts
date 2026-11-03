// A queue-tray 插话 whose outcome cutex does not know (owner 2026-10-26: the row showed
// 「结果待确认 · request_outcome_unknown: the cutex operation completed far en…」): classified as
// outcomeUnknown, resolved from cutex's own state (lib/steerOutcome), worded plainly.
import { describe, expect, it } from "vitest";
import type { QueueItem } from "@cutex-desktop/protocol";
import { queueSteerErrorKind, queueSteerRawDetail, parseQueueSteerError, queueSteerErrorMessage } from "../src/shared/queueSteer";
import { rawErrorText, steerOutcome } from "../src/renderer/src/lib/legacyDelivery/steerOutcome";
import { timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { emptyTimeline } from "../src/renderer/src/lib/timeline";
import type { PendingSteer } from "../src/renderer/src/lib/legacyDelivery/pendingSteers";
import { queueActionNotice, queueSteerNotice } from "../src/renderer/src/lib/queueSteer";
import { queueInsertLabel, type QueueInsertFeedback } from "../src/renderer/src/lib/queueInsertFeedback";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { enAU } from "../src/renderer/src/i18n/en-AU";

const RAW_MESSAGE = "request_outcome_unknown: the cutex operation completed far enough that its durable outcome is unknown";
const zh = (key: string) => (zhCN as Record<string, string>)[key]!;

describe("classification", () => {
  it("request_outcome_unknown and any resyncRequired answer are an unknown outcome", () => {
    expect(queueSteerErrorKind("request_outcome_unknown", { resyncRequired: true, originalCode: "outcome_unknown" })).toBe("outcomeUnknown");
    expect(queueSteerErrorKind("request_outcome_unknown", undefined)).toBe("outcomeUnknown");
    expect(queueSteerErrorKind("outcome_unknown", {})).toBe("outcomeUnknown");
    expect(queueSteerErrorKind("session_runtime_changed", { resyncRequired: true })).toBe("outcomeUnknown");
    expect(queueSteerErrorKind("persistence_failed", { resyncRequired: false })).toBe("unrecognized");
    // Explicit uncertainty takes precedence over even a known pre-send-looking code.
    expect(queueSteerErrorKind("turn_conflict", { resyncRequired: true })).toBe("outcomeUnknown");
  });

  it("carries the backend's words (with the original code) for 详情, one line", () => {
    const raw = queueSteerRawDetail(RAW_MESSAGE, { resyncRequired: true, originalCode: "outcome_unknown" });
    expect(raw).toBe(`${RAW_MESSAGE} (originalCode: outcome_unknown)`);
    expect(queueSteerRawDetail("outcome_unknown: lost\n  reply", { originalCode: "outcome_unknown" })).toBe("outcome_unknown: lost reply");
    const wrapped = `Error invoking remote method 'daemon:queuePromote': Error: ${queueSteerErrorMessage("outcomeUnknown", raw)}`;
    expect(parseQueueSteerError(wrapped)).toEqual({ kind: "outcomeUnknown", detail: raw });
    expect(rawErrorText(`Error invoking remote method 'daemon:submit': Error: connect ECONNREFUSED`)).toBe("connect ECONNREFUSED");
  });
});

describe("reconcile decision (lib/steerOutcome)", () => {
  const read = (items: unknown[], status = "inProgress") => timelineFromThreadRead({ thread: { id: "th", turns: [{ id: "t1", status, items }] } });
  const user = (id: string, text: string, clientId?: string) => ({ type: "userMessage", id, content: [{ type: "text", text }], ...(clientId ? { clientId } : {}) });
  const probe: PendingSteer = { id: "cm-u", text: "second part", imageCount: 0, turnId: "t1", baseline: 0, usersBefore: 0, state: "waiting" };
  const queued = (clientUserMessageId: string, queueId = "q-x"): QueueItem => ({ queueId, clientUserMessageId, origin: { kind: "other", clientId: "desktop" } as never, input: [], position: 0, revision: 1, state: "queued", createdAt: "", updatedAt: "" });

  it("landed by clientUserMessageId in any timeline (live or re-read)", () => {
    expect(steerOutcome(probe, { timelines: [emptyTimeline(), read([user("u1", "second part", "cm-u")])], queue: [] })).toBe("landed");
  });

  it("landed inside a merged user message with an earlier steer of the same turn", () => {
    const first: PendingSteer = { ...probe, id: "s-first", text: "first part" };
    const merged = read([user("u9", "first part\n\nsecond part", "runtime-id")]);
    expect(steerOutcome(probe, { timelines: [merged], others: [first], queue: [] })).toBe("landed");
    // Alone it is no merge: one steer's text inside someone else's message proves nothing.
    expect(steerOutcome(probe, { timelines: [merged], queue: [] })).toBe("unsure");
  });

  it("queued when cutex's queue lists the same id or queue item; history wins over the queue", () => {
    expect(steerOutcome(probe, { timelines: [read([])], queue: [queued("cm-u")] })).toBe("queued");
    expect(steerOutcome(probe, { timelines: [read([])], queue: [queued("other", "q-u")], queueId: "q-u" })).toBe("queued");
    expect(steerOutcome(probe, { timelines: [read([user("u1", "x", "cm-u")])], queue: [queued("cm-u")] })).toBe("landed");
  });

  it("unsure while cutex lists it with an unresolved send (delivery sending / unknown)", () => {
    expect(steerOutcome(probe, { timelines: [read([])], queue: [{ ...queued("cm-u"), delivery: "unknown" } as never] })).toBe("unsure");
    expect(steerOutcome(probe, { timelines: [read([])], queue: [{ ...queued("cm-u"), delivery: "sending" } as never] })).toBe("unsure");
  });

  it("unsure when neither, or nothing could be read", () => {
    expect(steerOutcome(probe, { timelines: [read([user("u1", "something else", "cm-other")])], queue: [queued("cm-other")] })).toBe("unsure");
    expect(steerOutcome(probe, { timelines: [], queue: null })).toBe("unsure");
  });
});

describe("plain wording", () => {
  const f = (over: Partial<QueueInsertFeedback>): QueueInsertFeedback => ({ token: {}, item: { clientUserMessageId: "cm" } as QueueItem, state: "unknown", ...over });
  const CODE = /request_outcome_unknown|outcome_unknown|resync|[a-z]+_[a-z]+/;

  it("the unknown row reads as plain words in zh-CN / en / en-AU, never a code", () => {
    for (const cat of [zhCN, en, enAU] as Record<string, string>[]) {
      for (const key of [queueInsertLabel(f({ checking: true })), queueInsertLabel(f({ checking: false })), "queue.insert.unsureHint", "queue.insert.resend", "queue.insert.markDelivered", "queue.insert.details", "queue.steer.outcomeUnknown", "queue.merge.failed", "queue.actionFailed"]) {
        expect(cat[key], key).toBeTruthy();
        expect(cat[key]).not.toMatch(CODE);
      }
    }
    expect(zh(queueInsertLabel(f({ checking: false })))).toBe("不确定这条插话有没有插进去");
    expect(zh("queue.insert.unsureHint")).toContain("「再发一次」");
    expect(zh("queue.insert.unsureHint")).toContain("「已送达」");
  });

  it("notices never quote the backend: native refusals and raw action errors become plain words", () => {
    const t = (key: string) => zh(key);
    expect(queueSteerNotice("queue_steer_refused:runtimeRefused cannot steer a review turn", t)).toBe(zh("queue.steer.runtimeRefusedPlain"));
    expect(queueSteerNotice(`queue_steer_refused:outcomeUnknown ${RAW_MESSAGE}`, t)).toBe(zh("queue.steer.outcomeUnknown"));
    expect(queueActionNotice(new Error("Error invoking remote method 'daemon:queueRemove': Error: queue_item_not_found: gone"), t)).toBe(zh("queue.actionFailed"));
    expect(queueActionNotice(new Error("queue_item_not_found: gone"), t)).toBe(zh("queue.actionFailed"));
    // The store's own worded notice passes as it is.
    expect(queueActionNotice(new Error(zh("queue.steer.joinChanged")), t)).toBe(zh("queue.steer.joinChanged"));
  });
});
