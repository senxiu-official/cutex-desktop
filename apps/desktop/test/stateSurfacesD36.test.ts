// State surfaces WP-D3 / WP-D6 (d36): W14 owner-notice state word, W5 alarm message target, S10 needs-owner
// "I've handled it", S11 runtime start deadline, W13 archive words, S12 unconfirmed sub-agents and local 结束跟进,
// N13 Claude task stop outcome.
import { afterEach, describe, expect, it } from "vitest";
import { ownerNotifyStateWord } from "../src/renderer/src/lib/ownerNotifyStateLabel";
import { alarmMessageTarget } from "../src/renderer/src/modules/alarms/model";
import { needsOwnerHandled } from "../src/renderer/src/modules/backend-upgrade/handled";
import { runDisplay } from "../src/renderer/src/modules/backend-upgrade/model";
import { abandonRuntimeStart, beginRuntimeStart, noteRuntimeStarting, resetRuntimeStarts, runtimeStartSince, runtimeStartView, START_DEADLINE_MS, startPhase } from "../src/renderer/src/lib/runtimeStart";
import { archiveWord, splitArchivedOptions } from "../src/renderer/src/lib/archiveWords";
import { activeSubAgents, unconfirmedSubAgents } from "../src/renderer/src/lib/subagents";
import { timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { endLocalFollowUp, MAX_ENTRIES, localFollowUpEnded, pruneFollowUps, resetLocalFollowUps, subagentFollowUpKey, terminalFollowUpKey } from "../src/renderer/src/lib/localFollowUp";
import { claudeStopOutcome, recordStopOutcome, stopOutcomeOf } from "../src/renderer/src/lib/claudeTaskStop";
import type { UpgradeRun } from "../src/shared/backendUpgrade";

describe("W14 owner notice state word", () => {
  const note = (over: object) => ({ state: "acknowledged", needsReply: true, origin: "agent", ...over }) as never;
  it("an acknowledged notice that waits for a reply reads awaitingReply; everything else its state", () => {
    expect(ownerNotifyStateWord(note({}))).toBe("awaitingReply");
    expect(ownerNotifyStateWord(note({ needsReply: false }))).toBe("acknowledged");
    expect(ownerNotifyStateWord(note({ origin: "system" }))).toBe("acknowledged"); // a system notice can't be replied to
    expect(ownerNotifyStateWord(note({ state: "open" }))).toBe("open");
    expect(ownerNotifyStateWord(note({ state: "answered" }))).toBe("answered");
    expect(ownerNotifyStateWord(note({ state: "dismissed" }))).toBe("dismissed");
  });
});

describe("W5 alarm message target", () => {
  it("the turn that read it, else its row, else nothing known", () => {
    expect(alarmMessageTarget({ turnId: "turn-9" })).toEqual({ kind: "turn", turnId: "turn-9" });
    expect(alarmMessageTarget({ turnId: null })).toEqual({ kind: "row" });
    expect(alarmMessageTarget(undefined)).toEqual({ kind: "none" });
  });
});

describe("S10 needs-owner 我已处理，收起", () => {
  const run = (over: Partial<UpgradeRun> = {}) => ({ runId: "upg-1", phase: "needs-owner", createdAt: new Date().toISOString(), finishedAt: null, ...over }) as UpgradeRun;
  it("hides only the run the owner marked; a later run that needs the owner shows again", () => {
    expect(needsOwnerHandled(run(), "upg-1")).toBe(true);
    expect(needsOwnerHandled(run({ runId: "upg-2" }), "upg-1")).toBe(false);
    expect(needsOwnerHandled(run(), null)).toBe(false);
    expect(needsOwnerHandled(run({ phase: "committed" }), "upg-1")).toBe(false); // only a needs-owner run
    expect(needsOwnerHandled(null, "upg-1")).toBe(false);
    // The run itself is untouched: model runDisplay still calls it a card.
    expect(runDisplay(run(), Date.now(), null)).toBe("card");
  });
});

describe("S11 runtime start deadline", () => {
  afterEach(() => resetRuntimeStarts());

  it("starting until the deadline, then unconfirmed", () => {
    expect(startPhase(null, 0)).toBeNull();
    expect(startPhase(1000, 1000 + START_DEADLINE_MS - 1)).toBe("starting");
    expect(startPhase(1000, 1000 + START_DEADLINE_MS)).toBe("unconfirmed");
  });

  it("a second start while one is in flight does not renew the deadline; the mark goes when all ended", () => {
    const end1 = beginRuntimeStart("h", "a", 100);
    const end2 = beginRuntimeStart("h", "a", 5000);
    expect(runtimeStartSince("h", "a")).toBe(100);
    end1();
    expect(runtimeStartSince("h", "a")).toBe(100);
    end2();
    expect(runtimeStartSince("h", "a")).toBeNull();
    // A new start after that is a new run.
    const end3 = beginRuntimeStart("h", "a", 9000);
    expect(runtimeStartSince("h", "a")).toBe(9000);
    end3();
  });

  it("abandoning (停止 after 启动未确认) forgets the start; a late end changes nothing", () => {
    const end = beginRuntimeStart("h", "a", 100);
    abandonRuntimeStart("h", "a");
    expect(runtimeStartSince("h", "a")).toBeNull();
    const next = beginRuntimeStart("h", "a", 200);
    end(); // the abandoned run's end must not clear the new one
    expect(runtimeStartSince("h", "a")).toBe(200);
    next();
  });

  it("a cutex-reported starting is timed from when first seen, per generation", () => {
    expect(noteRuntimeStarting("h", "a", "starting", 3, 100)).toBe(100);
    expect(noteRuntimeStarting("h", "a", "starting", 3, 900)).toBe(100);
    expect(noteRuntimeStarting("h", "a", "starting", 4, 1000)).toBe(1000);
    expect(noteRuntimeStarting("h", "a", "online", 4, 1100)).toBeNull();
    expect(noteRuntimeStarting("h", "a", "starting", 4, 1200)).toBe(1200);
  });

  it("runtimeStartView: our start (any status but online) or cutex's starting; nothing when online", () => {
    const end = beginRuntimeStart("h", "a", 0);
    expect(runtimeStartView("h", "a", { status: "offline", runtimeGeneration: 1 }, 10)).toEqual({ phase: "starting", since: 0 });
    expect(runtimeStartView("h", "a", { status: "offline", runtimeGeneration: 1 }, START_DEADLINE_MS)).toEqual({ phase: "unconfirmed", since: 0 });
    expect(runtimeStartView("h", "a", { status: "online", runtimeGeneration: 2 }, START_DEADLINE_MS)).toBeNull();
    end();
    expect(runtimeStartView("h", "b", { status: "offline", runtimeGeneration: 1 }, 10)).toBeNull();
    expect(runtimeStartView("h", "b", { status: "starting", runtimeGeneration: 1 }, 10)).toEqual({ phase: "starting", since: 10 });
    expect(runtimeStartView("h", "b", { status: "starting", runtimeGeneration: 1 }, 10 + START_DEADLINE_MS)).toEqual({ phase: "unconfirmed", since: 10 });
  });
});

describe("W13 archive words", () => {
  it("restorable vs permanently retired; plain archived without the projection", () => {
    expect(archiveWord({ lifecycle: "active" } as never)).toBeNull();
    expect(archiveWord({ lifecycle: "retired", archiveKind: "soft", restorable: true } as never)).toBe("restorable");
    expect(archiveWord({ lifecycle: "retired", archiveKind: "permanent", restorable: false } as never)).toBe("permanent");
    expect(archiveWord({ lifecycle: "retired" } as never)).toBe("archived");
    expect(archiveWord({ lifecycle: "retired", archiveKind: "unknown", restorable: true } as never)).toBe("restorable");
    expect(archiveWord({ lifecycle: "retired", archiveKind: "soft", restorable: false } as never)).toBe("archived");
  });

  it("splits the picker's 已归档 group, keeps it last (restorable, plain, permanent) and relabels a top row's detail", () => {
    const labels = { archived: "已归档", restorable: "已归档（可恢复）", permanent: "已永久退休" };
    const words: Record<string, "restorable" | "permanent" | "archived"> = { p1: "permanent", r1: "restorable", r2: "restorable", top: "permanent" };
    const out = splitArchivedOptions(
      [
        { value: "top", label: "Top", group: "当前", detail: "已归档" },
        { value: "x", label: "X", group: "独立" },
        { value: "p1", label: "P1", group: "已归档" },
        { value: "r1", label: "R1", group: "已归档 · Workstation" },
        { value: "old", label: "Old", group: "已归档" },
        { value: "r2", label: "R2", group: "已归档" },
      ],
      labels,
      (v) => words[v] ?? (v === "old" ? "archived" : null),
    );
    expect(out.map((o) => [o.value, o.group, o.detail ?? null])).toEqual([
      ["top", "当前", "已永久退休"],
      ["x", "独立", null],
      ["r1", "已归档（可恢复） · Workstation", null],
      ["r2", "已归档（可恢复）", null],
      ["old", "已归档", null],
      ["p1", "已永久退休", null],
    ]);
  });
});

describe("S12 sub-agents of a disconnected agent", () => {
  const PARENT = "00000000-0000-7000-8000-000000000001";
  const A = "00000000-0000-7000-8000-00000000000a";
  const B = "00000000-0000-7000-8000-00000000000b";
  const spawn = (id: string) => ({ type: "collabAgentToolCall", id: `call-${id}`, tool: "spawnAgent", status: "completed", senderThreadId: PARENT, receiverThreadIds: [id], prompt: "task", agentsStates: { [id]: { status: "pendingInit", message: null } } });
  const timeline = timelineFromThreadRead({ thread: { id: PARENT, turns: [{ id: "t1", status: "completed", items: [spawn(A), spawn(B)] }] } });

  it("only those last heard working (their own events), and only while the parent is offline", () => {
    const live = { [A]: "running" };
    expect(unconfirmedSubAgents(timeline, false, live).map((a) => a.threadId)).toEqual([A]); // B: a call-time snapshot only
    expect(unconfirmedSubAgents(timeline, true, live)).toEqual([]);
    expect(unconfirmedSubAgents(timeline, false, { [A]: "completed" })).toEqual([]);
    expect(activeSubAgents(timeline, false, live)).toEqual([]); // the working list stays empty offline
  });
});

describe("S12 local 结束跟进", () => {
  afterEach(() => resetLocalFollowUps());
  it("keys name host, agent and item (a terminal also its runtime generation)", () => {
    expect(subagentFollowUpKey("h", "a", "t")).not.toBe(subagentFollowUpKey("h2", "a", "t"));
    expect(terminalFollowUpKey("h", "a", 1, "p1")).not.toBe(terminalFollowUpKey("h", "a", 2, "p1"));
    expect(subagentFollowUpKey("h", "a", "p1")).not.toBe(terminalFollowUpKey("h", "a", 0, "p1"));
  });
  it("ended items stay ended; only past the cap do the oldest go (never by age)", () => {
    endLocalFollowUp([subagentFollowUpKey("h", "a", "t")], 1000);
    expect(localFollowUpEnded()[subagentFollowUpKey("h", "a", "t")]).toBe(1000);
    const kept = { old: 1, mid: 2, new: 3 };
    expect(pruneFollowUps(kept)).toBe(kept);
    expect(pruneFollowUps(kept, 2)).toEqual({ mid: 2, new: 3 });
    expect(MAX_ENTRIES).toBeGreaterThanOrEqual(1000);
  });
});

describe("N13 Claude background task stop outcome", () => {
  it("accepted / refused (with why) from the answer; anything else unknown", () => {
    expect(claudeStopOutcome({ threadId: "t", taskId: "k", outcome: "accepted", reason: null, stopRequested: true, terminalConfirmed: false })).toEqual({ outcome: "accepted", reason: null });
    expect(claudeStopOutcome({ outcome: "refused", reason: " already finished " })).toEqual({ outcome: "refused", reason: "already finished" });
    expect(claudeStopOutcome({ outcome: "unknown", reason: "timeout" })).toEqual({ outcome: "unknown", reason: "timeout" });
    expect(claudeStopOutcome(undefined)).toEqual({ outcome: "unknown", reason: null }); // today's bridge answers nothing
    expect(claudeStopOutcome({ outcome: "stopped" })).toEqual({ outcome: "unknown", reason: null });
  });
  it("is kept per agent and task", () => {
    recordStopOutcome("a", "claude:x:task:1", { outcome: "accepted", reason: null });
    expect(stopOutcomeOf("a", "claude:x:task:1")?.outcome).toBe("accepted");
    expect(stopOutcomeOf("b", "claude:x:task:1")).toBeNull();
  });
});
