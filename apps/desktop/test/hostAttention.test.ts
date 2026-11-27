// @vitest-environment jsdom
// Cross-device read state (design 061, cutex attention-state-v1): a capable host's snapshot replaces the device-local
// unread marks and 需要你 dismissals; reads send only the exact visible reply's token; dismissals the exact item keys;
// a refused or older host keeps the local records.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionSnapshot } from "../src/shared/attention";

const env = vi.hoisted(() => ({
  snapshot: null as unknown,
  refusal: null as string | null,
  reads: [] as unknown[],
  dismissals: [] as unknown[],
  readAnswer: { ok: true, value: { changed: 1 } } as unknown,
  calls: 0,
}));
vi.mock("../src/renderer/src/bridge", () => {
  const daemon = {
    attention: async () => {
      env.calls++;
      return env.refusal ? { ok: false, code: env.refusal } : { ok: true, value: structuredClone(env.snapshot) };
    },
    attentionRead: async (reads: unknown) => {
      env.reads.push(reads);
      return env.readAnswer;
    },
    attentionDismiss: async (items: unknown) => {
      env.dismissals.push(items);
      return { ok: true, value: { changed: 1 } };
    },
  };
  return { api: daemon, apiFor: () => daemon, bridge: { on: () => () => {} } };
});

const TOKEN = (n: number) => `${"a".repeat(32)}/${String(n).padStart(32, "0")}`;
const KEY = (c: string) => c.repeat(64);
const snap = (patch: Partial<AttentionSnapshot> = {}): AttentionSnapshot => ({
  instanceId: "inst-1",
  personKey: "owner",
  cursor: { streamId: "s", after: "4" },
  agents: [
    { agentId: "a", unreadTurns: 2, running: null, lastTurnStartedAt: null, latest: { turnId: "a-t2", status: "completed", endedAt: "2026-11-26T01:00:00Z", through: TOKEN(2) }, needs: [] },
    { agentId: "b", unreadTurns: 0, running: null, lastTurnStartedAt: null, latest: { turnId: "b-t1", status: "completed", endedAt: "2026-11-26T00:00:00Z", through: TOKEN(1) }, needs: [{ kind: "ownerApproval", id: "ap1", title: "x", at: null, itemKey: KEY("1") }] },
    { agentId: "c", unreadTurns: 1, running: null, lastTurnStartedAt: null, latest: { turnId: "c-t1", status: "failed", endedAt: "2026-11-26T02:00:00Z", through: TOKEN(3) }, needs: [{ kind: "runtimeError", id: "runtime-error", title: "Runtime error", at: null, itemKey: KEY("2") }] },
  ],
  unlistedNeeds: [{ agentId: "z", needs: [{ kind: "ownerMessage", id: "n1", title: "hi", at: null, itemKey: KEY("3") }] }],
  needsYouCount: 3,
  ...patch,
});

const settle = async () => {
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(200);
};

let ha: typeof import("../src/renderer/src/lib/hostAttention");
let tu: typeof import("../src/renderer/src/lib/turnUnread");
let nd: typeof import("../src/renderer/src/lib/needsYouDismiss");

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear();
  env.snapshot = snap();
  env.refusal = null;
  env.reads = [];
  env.dismissals = [];
  env.readAnswer = { ok: true, value: { changed: 1 } };
  env.calls = 0;
  // Device-local records of the host from before (one of another host stays).
  const k = (h: string, id: string) => JSON.stringify([h, id]);
  localStorage.setItem("cutex-desktop.turnMarks", JSON.stringify({ [k("local", "a")]: { at: 1, failed: false, turnId: "old" }, [k("ssh", "q")]: { at: 1, failed: false, turnId: "q1" } }));
  localStorage.setItem("cutex-desktop.needsYouDismissed", JSON.stringify({ [k("local", "b")]: { fp: "x", at: 1 }, [k("ssh", "q")]: { fp: "y", at: 1 } }));
  ha = await import("../src/renderer/src/lib/hostAttention");
  tu = await import("../src/renderer/src/lib/turnUnread");
  nd = await import("../src/renderer/src/lib/needsYouDismiss");
});
afterEach(() => {
  ha.resetHostAttention();
  vi.useRealTimers();
});

describe("a capable host's state replaces the local records", () => {
  it("marks come from the host (count, failed); the host's local marks and dismissals go once (clean start)", async () => {
    ha.syncHostAttention("local", true, "e1");
    await settle();
    expect(ha.attentionOn("local")?.needsYouCount).toBe(3);
    const marks = tu.getTurnMarks();
    expect(marks.a).toEqual({ at: Date.parse("2026-11-26T01:00:00Z"), failed: false, turnId: "a-t2", count: 2 });
    expect(marks.b).toBeUndefined();
    expect(marks.c?.failed).toBe(true);
    expect(tu.unreadCount(marks.a)).toBe(2);
    // Migration: only this host's device-local entries went.
    expect(Object.keys(JSON.parse(localStorage.getItem("cutex-desktop.turnMarks")!))).toEqual([JSON.stringify(["ssh", "q"])]);
    expect(Object.keys(nd.getDismissals())).toEqual([JSON.stringify(["ssh", "q"])]);
  });

  it("nothing is recorded or cleared locally for it: a turn end, opening the agent", async () => {
    ha.syncHostAttention("local", true, "e1");
    await settle();
    tu.recordTurnEndOn("local", "b", { turnId: "b-t2", status: "completed" }, false);
    expect(tu.getTurnMarks().b).toBeUndefined();
    tu.markSeen("a");
    tu.markSeenOn("local", "a");
    expect(tu.getTurnMarks().a?.count).toBe(2);
    expect(env.reads).toEqual([]);
  });

  it("an older host (no capability) keeps the local marks; a refusal falls back to them without retrying a lasting one", async () => {
    ha.syncHostAttention("local", false, "e1");
    expect(tu.getTurnMarks().a?.turnId).toBe("old");
    env.refusal = "attention_person_binding_required";
    ha.syncHostAttention("local", true, "e1");
    await settle();
    expect(ha.attentionOn("local")).toBeNull();
    expect(ha.attentionOffOn("local")).toEqual({ code: "attention_person_binding_required" });
    expect(tu.getTurnMarks().a?.turnId).toBe("old");
    const calls = env.calls;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(env.calls).toBe(calls);
  });

  it("a host still starting (attention_unavailable) is read again later", async () => {
    env.refusal = "attention_unavailable";
    ha.syncHostAttention("local", true, "e1");
    await settle();
    expect(ha.attentionOn("local")).toBeNull();
    env.refusal = null;
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(ha.attentionOn("local")).not.toBeNull();
  });

  it("re-read slowly only while main's feed is not live; a host taken off the list goes", async () => {
    ha.syncHostAttention("local", true, "e1");
    await settle();
    ha.attentionFeedOn("local", true);
    let calls = env.calls;
    await vi.advanceTimersByTimeAsync(130_000);
    expect(env.calls).toBe(calls); // events come: no re-read
    ha.attentionFeedOn("local", false); // refused / away / reconnecting
    calls = env.calls;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(env.calls).toBe(calls + 1);
    ha.pruneHostAttention(new Set(["ssh"]));
    expect(ha.attentionOn("local")).toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(env.calls).toBe(calls + 1);
  });

  it("changes arriving together read the snapshot once", async () => {
    ha.syncHostAttention("local", true, "e1");
    await settle();
    const calls = env.calls;
    ha.attentionChangedOn("local");
    ha.attentionChangedOn("local");
    ha.attentionChangedOn("local");
    await settle();
    expect(env.calls).toBe(calls + 1);
  });
});

describe("reads", () => {
  beforeEach(async () => {
    ha.syncHostAttention("local", true, "e1");
    await settle();
  });

  it("only the agent's latest unread reply, by its exact token, once", async () => {
    expect(ha.readReply("local", "a", "a-t1")).toBe(false); // an older turn: not the latest
    expect(ha.readReply("local", "b", "b-t1")).toBe(false); // nothing unread
    expect(ha.readReply("local", "a", "a-t2")).toBe(true);
    await settle();
    expect(env.reads).toEqual([[{ agentId: "a", through: TOKEN(2) }]]);
    expect(tu.getTurnMarks().a).toBeUndefined();
    expect(ha.readReply("local", "a", "a-t2")).toBe(false);
  });

  it("a stale token reads the snapshot again (and may be sent again only once it is seen in it)", async () => {
    env.readAnswer = { ok: false, code: "attention_stale" };
    const calls = env.calls;
    ha.readReply("local", "a", "a-t2");
    await settle();
    expect(env.calls).toBe(calls + 1);
    expect(tu.getTurnMarks().a?.count).toBe(2);
  });

  it("explicit 标为已读 sends the captured latest token; on an older host it clears the local mark", async () => {
    tu.markReadOn("local", "c");
    await settle();
    expect(env.reads.at(-1)).toEqual([{ agentId: "c", through: TOKEN(3) }]);
  });

  it("another daemon instance or person: tokens sent before do not block new reads", async () => {
    ha.readReply("local", "a", "a-t2");
    await settle();
    env.snapshot = snap({ instanceId: "inst-2" });
    ha.attentionChangedOn("local");
    await settle();
    expect(ha.readReply("local", "a", "a-t2")).toBe(true);
  });
});

describe("batch reads (a project's 标为已读)", () => {
  it("one POST per 100 agents with each one's latest unread token; on an older host the local marks clear", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ agentId: `p${i}`, unreadTurns: 1, running: null, lastTurnStartedAt: null, latest: { turnId: `t${i}`, status: "completed" as const, endedAt: "2026-11-26T00:00:00Z", through: TOKEN(i + 10) }, needs: [] }));
    env.snapshot = snap({ agents: [...snap().agents, ...many] });
    ha.syncHostAttention("local", true, "e1");
    await settle();
    tu.markReadManyOn("local", [...many.map((a) => a.agentId), "b", "a"]);
    await settle();
    expect(env.reads.map((r) => (r as unknown[]).length)).toEqual([100, 51]); // b has nothing unread
    expect((env.reads[0] as { agentId: string; through: string }[])[0]).toEqual({ agentId: "p0", through: TOKEN(10) });
    expect(tu.getTurnMarks().p149).toBeUndefined();
    expect(ha.readReplies("local", ["p1", "a"])).toBe(0); // sent already
  });
});

describe("a failed mark turns plain once a later turn starts", () => {
  const failed = (patch: object) => ({ agentId: "c", unreadTurns: 1, running: null, lastTurnStartedAt: null, latest: { turnId: "c-t1", status: "failed" as const, endedAt: "2026-11-26T02:00:00Z", through: TOKEN(3) }, needs: [], ...patch });
  it("another turn running, or the last start after the failure; the failed turn itself or an older start keeps it failed", () => {
    expect(ha.markOf(failed({}))?.failed).toBe(true); // older host: no fields
    expect(ha.markOf(failed({ running: { turnId: "c-t2", observedAt: null } }))).toMatchObject({ failed: false, count: 1 });
    expect(ha.markOf(failed({ running: { turnId: "c-t1", observedAt: null } }))?.failed).toBe(true);
    expect(ha.markOf(failed({ lastTurnStartedAt: "2026-11-26T02:05:00Z" }))?.failed).toBe(false);
    expect(ha.markOf(failed({ lastTurnStartedAt: "2026-11-26T01:55:00Z" }))?.failed).toBe(true);
  });
  it("from the snapshot: the sidebar mark follows", async () => {
    env.snapshot = snap({ agents: [failed({ lastTurnStartedAt: "2026-11-26T03:00:00Z" })] });
    ha.syncHostAttention("local", true, "e1");
    await settle();
    expect(tu.getTurnMarks().c).toMatchObject({ failed: false, turnId: "c-t1" });
  });
});

describe("dismissals", () => {
  it("send exactly the given keys and hide them at once; the count follows", async () => {
    ha.syncHostAttention("local", true, "e1");
    await settle();
    ha.dismissNeeds("local", "b", [KEY("1")]);
    expect(ha.needsOf(ha.attentionOn("local"), "b").needs).toEqual([]);
    expect(ha.attentionOn("local")?.needsYouCount).toBe(2);
    await settle();
    expect(env.dismissals).toEqual([[{ agentId: "b", itemKey: KEY("1") }]]);
  });

  it("unlisted needs are an agent's needs too; the runtime error is apart", async () => {
    ha.syncHostAttention("local", true, "e1");
    await settle();
    const state = ha.attentionOn("local");
    expect(ha.needsOf(state, "z").needs.map((n) => n.kind)).toEqual(["ownerMessage"]);
    expect(ha.needsOf(state, "c")).toEqual({ needs: [], runtimeError: expect.objectContaining({ kind: "runtimeError", itemKey: KEY("2") }) });
  });
});
