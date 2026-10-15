import { describe, expect, it } from "vitest";
import type { OwnerNotification, OwnerNotifySettings } from "@cutex-desktop/protocol";
import { applyAlertRecord, asRecord, isAlerting, isPending, mergeRecords, ownerNotifyPatch, previewText, reconcileAlerts, recordOfEvent, sanitizeOwnerNotifyPatch, toggleChannel, wantsBigAlert, wantsDesktopNotification } from "../src/shared/ownerNotify";
import { notePresentation, noteTurnOf, pendingByAgent, placeOwnerNotes, ownerNoteActions } from "../src/renderer/src/lib/ownerNotify";
import { needsYouByAgent } from "../src/renderer/src/lib/agentAttention";
import { alertStrings, chimeNotes, pickFirst, refsLine, timeLabel } from "../src/renderer/src/ownerAlert/model";

const rec = (id: string, over: Partial<OwnerNotification> = {}): OwnerNotification => ({
  notificationId: id,
  agentId: "eva",
  agentName: "Eva",
  text: "hello",
  level: "info",
  requestedLevel: "info",
  downgraded: null,
  muted: false,
  channels: ["desktop"],
  needsReply: false,
  delegation: null,
  job: null,
  turnId: null,
  state: "open",
  createdAt: "2026-10-08T10:00:00.000Z",
  acknowledgedAt: null,
  reply: null,
  closedAt: null,
  ...over,
});

const settings = (): OwnerNotifySettings => ({
  delivery: { info: ["desktop"], attention: ["desktop", "phone"], urgent: ["desktop", "phone", "bigAlert"] },
  deliveryDefault: { info: ["desktop"], attention: ["desktop", "phone"], urgent: ["desktop", "phone", "bigAlert"] },
  bigAlertSound: true,
  toolAudience: "ownerFacing",
  rateLimit: { perHour: 12, urgentPerHour: 3 },
  agentOverrides: { a: "mute" },
  phonePaired: false,
});

describe("owner notify predicates", () => {
  it("pending: needs-reply until answered / dismissed; else open with a channel", () => {
    expect(isPending(rec("1", { needsReply: true, state: "acknowledged", channels: [] }))).toBe(true);
    expect(isPending(rec("1", { needsReply: true, state: "answered" }))).toBe(false);
    expect(isPending(rec("1", { state: "open" }))).toBe(true);
    expect(isPending(rec("1", { state: "acknowledged" }))).toBe(false);
    expect(isPending(rec("1", { state: "open", channels: [], muted: true }))).toBe(false);
  });
  it("alerting / big alert / desktop", () => {
    expect(isAlerting(rec("1"))).toBe(true);
    expect(isAlerting(rec("1", { state: "acknowledged" }))).toBe(false);
    expect(wantsBigAlert(rec("1", { channels: ["bigAlert"] }))).toBe(true);
    expect(wantsBigAlert(rec("1", { channels: ["bigAlert"], state: "acknowledged" }))).toBe(false);
    expect(wantsDesktopNotification(rec("1", { channels: ["phone"] }))).toBe(false);
  });
  it("merge keeps the later state", () => {
    const a = mergeRecords({}, [rec("1", { state: "acknowledged" })]);
    const b = mergeRecords(a, [rec("1", { state: "open" })]);
    expect(b).toBe(a);
    const c = mergeRecords(a, [rec("1", { state: "answered" }), { junk: true }]);
    expect(c["1"]!.state).toBe("answered");
  });
  it("parses events defensively", () => {
    expect(recordOfEvent("cutex/ownerNotify/created", { notification: rec("1") })?.notificationId).toBe("1");
    expect(recordOfEvent("cutex/other", { notification: rec("1") })).toBeNull();
    expect(asRecord({ notificationId: "x", agentId: "a", text: "t", level: "loud", state: "open" })).toBeNull();
    expect(asRecord({ notificationId: "x", agentId: "a", text: "t", level: "info", state: "open", channels: ["desktop", "fax"] })?.channels).toEqual(["desktop"]);
  });
  it("preview collapses whitespace and cuts", () => {
    expect(previewText("a\n\n b", 10)).toBe("a b");
    expect(previewText("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("timeline placement", () => {
  const turns = [
    { id: "t1", startedAt: Date.parse("2026-10-08T09:00:00Z") / 1000 },
    { id: "t2", startedAt: Date.parse("2026-10-08T09:30:00Z") / 1000 },
    { id: "t3", startedAt: Date.parse("2026-10-08T11:00:00Z") / 1000 },
  ];
  const rows = ["t1", "t1", "t2", "t2", "t3"];
  it("by turnId: after the last row of that turn", () => {
    const p = placeOwnerNotes([rec("1", { turnId: "t2" })], rows, turns, { olderHistory: false });
    expect(p.after.get(3)?.map((r) => r.notificationId)).toEqual(["1"]);
  });
  it("by createdAt when the turn is unknown", () => {
    const p = placeOwnerNotes([rec("1", { turnId: "nope", createdAt: "2026-10-08T10:00:00Z" })], rows, turns, { olderHistory: false });
    expect(p.after.get(3)?.length).toBe(1);
  });
  it("older than every turn: head only without older history", () => {
    const old = rec("1", { createdAt: "2026-10-08T08:00:00Z" });
    expect(placeOwnerNotes([old], rows, turns, { olderHistory: false }).head).toHaveLength(1);
    expect(placeOwnerNotes([old], rows, turns, { olderHistory: true }).head).toHaveLength(0);
  });
  it("hidden turn is left out; a just-started newest turn goes last", () => {
    const p = placeOwnerNotes([rec("1", { turnId: "t1" }), rec("2", { turnId: "t3" })], ["t2", "t2"], turns, { olderHistory: true });
    expect([...p.after.values()].flat().map((r) => r.notificationId)).toEqual(["2"]);
    expect(p.after.get(1)?.[0]?.notificationId).toBe("2");
  });
  it("noteTurnOf", () => {
    expect(noteTurnOf(rec("1", { turnId: "t1" }), turns)).toBe("t1");
    expect(noteTurnOf(rec("1", { createdAt: "2026-10-08T12:00:00Z" }), turns)).toBe("t3");
  });
});

describe("needs and notifications", () => {
  it("needsYouByAgent maps pending records to ownerMessage / ownerReply", () => {
    const needs = needsYouByAgent({ ownerNotes: [rec("1"), rec("2", { needsReply: true, state: "acknowledged" }), rec("3", { state: "acknowledged" }), rec("4", { agentId: "mika", needsReply: true })] });
    expect(needs.get("eva")).toMatchObject({ count: 2, reasons: ["ownerMessage", "ownerReply"], notificationIds: ["1", "2"] });
    expect(needs.get("mika")?.reasons).toEqual(["ownerReply"]);
    expect(pendingByAgent([rec("1"), rec("3", { state: "dismissed" })]).get("eva")).toHaveLength(1);
  });
  it("device methods of a new record: cutex actions, else the channels; none when not alerting", () => {
    expect(ownerNoteActions(rec("1"))).toEqual(rec("1").channels);
    expect(ownerNoteActions(rec("1", { channels: ["phone"], actions: ["needsYou", "mark", "desktop", "sound"] }))).toEqual(["needsYou", "mark", "desktop", "sound"]);
    expect(ownerNoteActions(rec("1", { state: "dismissed" }))).toEqual([]);
  });
});

describe("settings patch", () => {
  it("only what changed", () => {
    const s = settings();
    expect(ownerNotifyPatch(s, { bigAlertSound: true })).toBeNull();
    expect(ownerNotifyPatch(s, { delivery: { info: toggleChannel(s.delivery.info, "bigAlert", true) } })).toEqual({ delivery: { info: ["desktop", "bigAlert"] } });
    expect(ownerNotifyPatch(s, { rateLimit: { perHour: 5000 } })).toEqual({ rateLimit: { perHour: 1000 } });
    expect(ownerNotifyPatch(s, { toolAudience: "none" })).toEqual({ toolAudience: "none" });
  });
  it("overrides: whole map, removed keys as null", () => {
    expect(ownerNotifyPatch(settings(), { agentOverrides: { b: "force" } })).toEqual({ agentOverrides: { a: null, b: "force" } });
    expect(ownerNotifyPatch(settings(), { agentOverrides: { a: "mute" } })).toBeNull();
  });
  it("toggleChannel keeps canonical order", () => {
    expect(toggleChannel(["bigAlert"], "desktop", true)).toEqual(["desktop", "bigAlert"]);
    expect(toggleChannel(["desktop", "phone"], "phone", false)).toEqual(["desktop"]);
  });
  it("sanitize drops unknown fields and values", () => {
    expect(sanitizeOwnerNotifyPatch({ phonePaired: true, delivery: { info: ["desktop", "fax"] }, toolAudience: "all", agentOverrides: { x: "mute", y: "loud", z: null } })).toEqual({ delivery: { info: ["desktop"] }, agentOverrides: { x: "mute", z: null } });
  });
});

describe("big alert", () => {
  it("applyAlertRecord adds open bigAlert records and drops the rest", () => {
    const a = applyAlertRecord([], rec("1", { channels: ["bigAlert"], createdAt: "2026-10-08T10:00:01Z" }));
    const b = applyAlertRecord(a, rec("0", { channels: ["bigAlert"], createdAt: "2026-10-08T10:00:00Z" }));
    expect(b.map((x) => x.notificationId)).toEqual(["0", "1"]);
    expect(applyAlertRecord(b, rec("1", { channels: ["bigAlert"], state: "acknowledged" })).map((x) => x.notificationId)).toEqual(["0"]);
    expect(applyAlertRecord([], rec("2", { channels: ["desktop"] }))).toEqual([]);
  });
  it("reconcile keeps demo alerts and replaces the rest", () => {
    const demo = { ...applyAlertRecord([], rec("d", { channels: ["bigAlert"] }))[0]!, demo: true };
    const stale = applyAlertRecord([], rec("s", { channels: ["bigAlert"] }))[0]!;
    const next = reconcileAlerts([demo, stale], [rec("n", { channels: ["bigAlert"] }), rec("q", { channels: ["desktop"] })]);
    expect(next.map((x) => x.notificationId).sort()).toEqual(["d", "n"]);
  });
  it("page model", () => {
    const now = Date.parse("2026-10-08T10:30:00Z");
    expect(timeLabel("2026-10-08T10:29:40Z", now, "en")).toBe("just now");
    expect(timeLabel("2026-10-08T10:25:00Z", now, "zh-CN")).toBe("5 分钟前");
    expect(refsLine({ delegation: "ask-1", job: "job-2" }, alertStrings("en"))).toBe("Delegation ask-1 · Job job-2");
    expect(refsLine({ delegation: null, job: null }, alertStrings("en"))).toBeNull();
    expect(chimeNotes(true)).toHaveLength(4);
    expect(pickFirst([{ level: "urgent" as const, id: 1 }, { level: "info" as const, id: 2 }, { level: "urgent" as const, id: 3 }]).id).toBe(3);
  });
});

describe("timeline presentation (quiet pass)", () => {
  it("a card only while the note asks for a decision", () => {
    expect(notePresentation(rec("a", { level: "urgent", state: "open" }))).toBe("card");
    expect(notePresentation(rec("b", { level: "urgent", state: "acknowledged" }))).toBe("row");
    expect(notePresentation(rec("c", { level: "info", needsReply: true, state: "open" }))).toBe("card");
    expect(notePresentation(rec("d", { level: "info", needsReply: true, state: "acknowledged" }))).toBe("card");
    expect(notePresentation(rec("e", { level: "info", needsReply: true, state: "answered" }))).toBe("row");
    expect(notePresentation(rec("f", { level: "attention", state: "open" }))).toBe("row");
    expect(notePresentation(rec("g", { level: "info", state: "open" }))).toBe("row");
    expect(notePresentation(rec("h", { level: "attention", needsReply: true, state: "open", origin: "system" }))).toBe("row");
  });
});
