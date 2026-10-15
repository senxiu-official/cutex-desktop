import { describe, expect, it } from "vitest";
import { applyEvent, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { newPendingSteer, recordedSteers, resolveChecked, settlePendingSteers } from "../src/renderer/src/lib/pendingSteers";
import { composerKeyAction, strategyFor, type ComposerKeyContext } from "../src/renderer/src/lib/sendKeys";
import { collaborationModeOf, seedThreadSettings } from "../src/renderer/src/lib/threadSettings";
import { toolLiveness } from "../src/renderer/src/lib/workGroups";

const running = () => timelineFromThreadRead({ thread: { id: "th", turns: [{ id: "t1", status: "inProgress", items: [{ type: "userMessage", id: "u1", content: [{ type: "text", text: "start" }] }] }] } });
const native = (method: string, params: unknown) => ({ source: "app_server", native: { kind: "notification", message: { method, params } } }) as never;
const userItem = (id: string, text: string, turnId = "t1") => native("item/completed", { turnId, item: { type: "userMessage", id, content: [{ type: "text", text, text_elements: [] }] } });
const ended = (status: string, turnId = "t1") => native("turn/completed", { turn: { id: turnId, status } });

const tagged = (id: string, text: string, clientId: string, turnId = "t1") => native("item/completed", { turnId, item: { type: "userMessage", id, clientId, content: [{ type: "text", text, text_elements: [] }] } });

describe("steer settlement (docs/investigation-steer-planmode.md, bug 1)", () => {
  it("a steer recorded before the turn ends leaves the panel", () => {
    const tl = running();
    const p = newPendingSteer(tl, "c1", "STEER-LATE code word latefox", 0, "t1");
    applyEvent(tl, tagged("u2", "STEER-LATE code word latefox", "c1"));
    applyEvent(tl, ended("completed"));
    expect(settlePendingSteers([p], tl)).toEqual({ pending: [], lost: [] });
  });
  it("matches by clientId even when the text differs or it landed in another turn", () => {
    const tl = running();
    const p = newPendingSteer(tl, "c1", "hello", 0, "t1");
    applyEvent(tl, native("turn/started", { turn: { id: "t2" } }));
    applyEvent(tl, tagged("u9", "hello (normalised by the native)", "c1", "t2"));
    expect(recordedSteers([p], tl)).toEqual(new Set(["c1"]));
  });
  it("an identical text with another clientId does not count", () => {
    const tl = running();
    const p = newPendingSteer(tl, "c1", "go", 0, "t1");
    applyEvent(tl, tagged("u2", "go", "someone-else"));
    expect(recordedSteers([p], tl).size).toBe(0);
  });
  it("an interrupted turn without the item reports it lost and keeps it as checking (native clear_pending)", () => {
    const tl = running();
    const p = newPendingSteer(tl, "c1", "STEER-INTR code word intrfox", 0, "t1");
    expect(settlePendingSteers([p], tl).pending).toEqual([p]);
    applyEvent(tl, ended("interrupted"));
    const s = settlePendingSteers([p], tl);
    expect(s.lost.map((x) => x.id)).toEqual(["c1"]);
    expect(s.pending).toEqual([{ ...p, state: "checking" }]);
    // reported once: a checking steer is not lost again
    expect(settlePendingSteers(s.pending, tl).lost).toEqual([]);
  });
  it("text fallback (no clientId echo): only the unrecorded one of two identical steers is lost", () => {
    const tl = running();
    const a = newPendingSteer(tl, "a", "go", 0, "t1");
    const b = newPendingSteer(tl, "b", "go", 0, "t1");
    applyEvent(tl, userItem("u2", "go"));
    applyEvent(tl, ended("interrupted"));
    const s = settlePendingSteers([a, b], tl);
    expect(s.pending.map((p) => p.id)).toEqual(["b"]);
    expect(s.lost.map((p) => p.id)).toEqual(["b"]);
  });
  it("history re-check: recorded ones go, the rest become undelivered", () => {
    const tl = running();
    const list = [newPendingSteer(tl, "a", "x", 0, "t1"), newPendingSteer(tl, "b", "y", 0, "t1"), newPendingSteer(tl, "c", "z", 0, "t1")].map((p) => ({ ...p, state: "checking" as const }));
    const out = resolveChecked(list, new Set(["a", "b"]), new Set(["a"]), "undelivered");
    expect(out.map((p) => [p.id, p.state])).toEqual([["b", "undelivered"], ["c", "checking"]]);
  });
  it("keeps the same array while nothing changes", () => {
    const tl = running();
    const pending = [newPendingSteer(tl, "a", "x", 0, null)];
    expect(settlePendingSteers(pending, tl).pending).toBe(pending);
  });
});

describe("send shortcuts", () => {
  const ctx = (over: Partial<ComposerKeyContext> = {}): ComposerKeyContext => ({ busy: true, hasContent: true, pendingSteers: 0, collapsedSelection: true, ...over });
  const key = (k: string, ctrl = false, shift = false) => ({ key: k, ctrl, shift });
  it("queueFirst keeps today's mapping", () => {
    expect(composerKeyAction("queueFirst", key("Enter"), ctx())).toBe("send");
    expect(composerKeyAction("queueFirst", key("Enter", true), ctx())).toBe("steer");
    expect(composerKeyAction("queueFirst", key("Enter", true, true), ctx())).toBe("interruptSend");
    expect(composerKeyAction("queueFirst", key("Enter", false, true), ctx())).toBeNull();
    expect(composerKeyAction("queueFirst", key("Tab"), ctx())).toBeNull();
    expect(composerKeyAction("queueFirst", key("Escape"), ctx({ pendingSteers: 2 }))).toBe("interrupt");
  });
  it("cli: Enter steers, Tab queues, Esc sends waiting steers", () => {
    expect(composerKeyAction("cli", key("Enter"), ctx())).toBe("steer");
    expect(composerKeyAction("cli", key("Tab"), ctx())).toBe("queue");
    expect(composerKeyAction("cli", key("Tab"), ctx({ busy: false }))).toBeNull();
    expect(composerKeyAction("cli", key("Tab"), ctx({ hasContent: false }))).toBeNull();
    expect(composerKeyAction("cli", key("Escape"), ctx())).toBe("interrupt");
    expect(composerKeyAction("cli", key("Escape"), ctx({ pendingSteers: 1 }))).toBe("interruptSendSteers");
    expect(composerKeyAction("cli", key("Escape"), ctx({ busy: false, pendingSteers: 1 }))).toBeNull();
    expect(composerKeyAction("cli", key("Escape"), ctx({ collapsedSelection: false }))).toBeNull();
  });
  it("idle always starts a turn; busy maps to cutex strategies", () => {
    for (const a of ["send", "steer", "queue", "interruptSend"] as const) expect(strategyFor(a, false)).toBe("auto");
    expect(strategyFor("send", true)).toBe("queue");
    expect(strategyFor("queue", true)).toBe("queue");
    expect(strategyFor("steer", true)).toBe("auto");
    expect(strategyFor("interruptSend", true)).toBe("interrupt");
  });
});

describe("collaboration mode seeding (bug 2)", () => {
  const plan = { mode: "plan", settings: { model: "m", reasoning_effort: "medium", developer_instructions: null } };
  it("fills the mode cutex's thread/resume snapshot leaves out", () => {
    const resumed = { model: "deepseek-flash", effort: "max" };
    expect(seedThreadSettings(resumed, plan)).toEqual({ ...resumed, collaborationMode: plan });
    expect(seedThreadSettings(resumed, null)).toBe(resumed);
  });
  it("a snapshot that carries a mode wins", () => {
    const s = { model: "m", collaborationMode: { mode: "default", settings: null } };
    expect(seedThreadSettings(s, plan)).toBe(s);
    expect(collaborationModeOf(s)).toEqual({ mode: "default", settings: null });
    expect(collaborationModeOf({ model: "m" })).toBeNull();
    expect(seedThreadSettings(null, plan)).toBeNull();
  });
});

describe("tool rows after an interrupt", () => {
  const cmd = { type: "commandExecution", id: "call_1", status: "inProgress" };
  it("running / background / interrupted", () => {
    expect(toolLiveness(cmd, true, [])).toBe("running");
    expect(toolLiveness(cmd, false, ["call_1"])).toBe("background");
    expect(toolLiveness(cmd, false, [])).toBe("interrupted");
    expect(toolLiveness({ ...cmd, status: "completed" }, false, ["call_1"])).toBeNull();
  });
});
