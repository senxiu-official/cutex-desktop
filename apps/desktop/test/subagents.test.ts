import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import {
  activeSubAgents,
  childStatusFromEvent,
  childStatusFromThreadRead,
  NAME_READ_RETRY_MS,
  NAME_READ_TRIES,
  subAgentDisplayName,
  subAgentMetaFromThreadRead,
  subAgentName,
  subAgentsOf,
  subAgentTooltip,
  takeSubAgentReads,
  type SubAgentLive,
  type SubAgentReadLog,
} from "../src/renderer/src/lib/subagents";
import { timelineFromThreadRead } from "../src/renderer/src/lib/timeline";

const PARENT = "00000000-0000-7000-8000-000000000001";
const CHILD = "00000000-0000-7000-8000-000000000002";

// Sanitized from a real Workstation director thread (cute-codex r49, multi-agent v1): the only parent
// item about the child is the spawn call, whose agentsStates snapshot is `pendingInit`. The child's
// completion reached the parent as a `<subagent_notification>` context fragment, not a thread item,
// and the parent never called `wait`.
const spawnItem = {
  type: "collabAgentToolCall",
  id: "exec-907d3911",
  tool: "spawnAgent",
  status: "completed",
  senderThreadId: PARENT,
  receiverThreadIds: [CHILD],
  prompt: "Read-only bounded audit …",
  model: "gpt-model",
  reasoningEffort: "high",
  agentsStates: { [CHILD]: { status: "pendingInit", message: null } },
};

function parentTimeline(items: unknown[] = [spawnItem]) {
  return timelineFromThreadRead({ thread: { id: PARENT, turns: [{ id: "t1", status: "completed", items }] } });
}

function ev(method: string, params: Record<string, unknown>, kind: "notification" | "serverRequest" = "notification"): EventEnvelope {
  return {
    contractVersion: 2, eventId: "e", cursor: "c", streamId: "s", sequence: 1, receivedAt: "2026-10-08T00:00:00Z",
    cutexSessionId: `cutex.${PARENT}`, hostId: "workstation", source: "app_server", sensitivity: "owner",
    correlation: { threadId: params.threadId as string },
    native: { kind, message: { method, params } },
  } as EventEnvelope;
}

/** The child's own events as cutex forwarded them on the parent's stream (same order). */
const childEvents = [
  ev("thread/status/changed", { threadId: CHILD, status: { type: "idle" } }),
  ev("thread/status/changed", { threadId: CHILD, status: { type: "active", activeFlags: [] } }),
  ev("turn/started", { threadId: CHILD, turn: { id: "ct1", status: "inProgress", items: [], error: null, startedAt: 1, completedAt: null, durationMs: null } }),
  ev("thread/status/changed", { threadId: CHILD, status: { type: "idle" } }),
  ev("turn/completed", { threadId: CHILD, turn: { id: "ct1", status: "completed", items: [], error: null, startedAt: 1, completedAt: 93, durationMs: 92777 } }),
];

function replay(events: EventEnvelope[]): SubAgentLive {
  const live: Record<string, string> = {};
  for (const e of events) {
    const s = childStatusFromEvent(e);
    if (s) live[s.threadId] = s.status;
  }
  return live;
}

describe("sub-agent status", () => {
  it("the spawn snapshot alone says pendingInit (the reported bug)", () => {
    expect(subAgentsOf(parentTimeline()).get(CHILD)?.status).toBe("pendingInit");
    expect(activeSubAgents(parentTimeline(), true).map((a) => a.threadId)).toEqual([CHILD]);
  });

  it("the child's own events settle it to completed and drop it from the active list", () => {
    const live = replay(childEvents);
    expect(live).toEqual({ [CHILD]: "completed" });
    expect(subAgentsOf(parentTimeline(), live).get(CHILD)?.status).toBe("completed");
    expect(activeSubAgents(parentTimeline(), true, live)).toEqual([]);
  });

  it("shows running while the child's turn is in progress", () => {
    expect(replay(childEvents.slice(0, 3))).toEqual({ [CHILD]: "running" });
    expect(replay([ev("turn/completed", { threadId: CHILD, turn: { id: "x", status: "failed" } })])).toEqual({ [CHILD]: "errored" });
    expect(replay([ev("turn/completed", { threadId: CHILD, turn: { id: "x", status: "interrupted" } })])).toEqual({ [CHILD]: "interrupted" });
  });

  it("ignores server requests and events without a status change", () => {
    expect(childStatusFromEvent(ev("item/agentMessage/delta", { threadId: CHILD, itemId: "m", delta: "x" }))).toBeNull();
    expect(childStatusFromEvent(ev("item/commandExecution/requestApproval", { threadId: CHILD }, "serverRequest"))).toBeNull();
  });

  it("settles from the child's thread/read after a reload", () => {
    const read = (status: unknown, turns: unknown[]) => childStatusFromThreadRead({ thread: { id: CHILD, status, turns } });
    expect(read({ type: "idle" }, [{ id: "ct1", status: "completed" }])).toBe("completed");
    expect(read({ type: "notLoaded" }, [{ id: "ct1", status: "completed" }])).toBe("completed");
    expect(read({ type: "active", activeFlags: [] }, [{ id: "ct1", status: "inProgress" }])).toBe("running");
    expect(read({ type: "systemError" }, [])).toBe("errored");
    expect(read({ type: "idle" }, [])).toBeNull();
    expect(childStatusFromThreadRead(null)).toBeNull();
  });

  it("a later wait snapshot still applies without live status", () => {
    const wait = { ...spawnItem, id: "w1", tool: "wait", prompt: null, agentsStates: { [CHILD]: { status: "completed", message: "six risks" } } };
    expect(subAgentsOf(parentTimeline([spawnItem, wait])).get(CHILD)).toMatchObject({ status: "completed", message: "six risks", task: "Read-only bounded audit …" });
  });

  it("maps subAgentActivity completed / interrupted (multi-agent v2)", () => {
    const activity = (kind: string) => ({ type: "subAgentActivity", id: `a-${kind}`, kind, agentThreadId: CHILD, agentPath: "/root/aquinas" });
    expect(subAgentsOf(parentTimeline([spawnItem, activity("completed")])).get(CHILD)).toMatchObject({ status: "completed", name: "aquinas" });
    expect(subAgentsOf(parentTimeline([activity("started"), spawnItem, activity("interrupted")])).get(CHILD)?.status).toBe("interrupted");
    expect(subAgentsOf(parentTimeline([activity("started")])).get(CHILD)?.status).toBe("running");
  });

  it("a closed agent stays closed whatever its thread last said", () => {
    const close = { ...spawnItem, id: "c1", tool: "closeAgent", prompt: null, agentsStates: { [CHILD]: { status: "shutdown", message: null } } };
    expect(subAgentsOf(parentTimeline([spawnItem, close]), { [CHILD]: "completed" }).get(CHILD)?.status).toBe("shutdown");
  });
});

describe("sub-agent names", () => {
  const TASK = "claude:sess-1:task:toolu_01AbCdEf";
  const activity = { type: "subAgentActivity", id: "a1", kind: "started", agentThreadId: CHILD, agentPath: "/root/acl_checker" };

  it("reads the nickname / role of a child thread/read, also from its spawn source", () => {
    expect(subAgentMetaFromThreadRead({ thread: { id: CHILD, agentNickname: "Euclid", agentRole: "explorer" } })).toEqual({ nickname: "Euclid", role: "explorer" });
    const source = { subAgent: { thread_spawn: { parent_thread_id: PARENT, depth: 1, agent_path: null, agent_nickname: "Noether", agent_role: "default" } } };
    expect(subAgentMetaFromThreadRead({ thread: { id: CHILD, agentNickname: null, agentRole: null, source } })).toEqual({ nickname: "Noether", role: "default" });
    // An older runtime (no fields), a non-sub-agent source, garbage: nothing known.
    expect(subAgentMetaFromThreadRead({ thread: { id: CHILD, source: "vscode" } })).toEqual({ nickname: null, role: null });
    expect(subAgentMetaFromThreadRead({ thread: { id: CHILD, agentNickname: "  ", source: { subAgent: "review" } } })).toEqual({ nickname: null, role: null });
    expect(subAgentMetaFromThreadRead(null)).toEqual({ nickname: null, role: null });
  });

  it("formats 「nickname · role」, leaving out an absent or default role", () => {
    expect(subAgentDisplayName("00000000", { nickname: "Euclid", role: "explorer" })).toBe("Euclid · explorer");
    expect(subAgentDisplayName("00000000", { nickname: "Euclid", role: "default" })).toBe("Euclid");
    expect(subAgentDisplayName("00000000", { nickname: "Euclid", role: null })).toBe("Euclid");
    expect(subAgentDisplayName("acl_checker", { nickname: null, role: "worker" })).toBe("acl_checker · worker");
    expect(subAgentDisplayName("00000000", { nickname: null, role: null })).toBe("00000000");
    expect(subAgentDisplayName("00000000", undefined)).toBe("00000000");
  });

  it("names a v1 sub-agent by its nickname once read, else by its short id", () => {
    expect(subAgentsOf(parentTimeline()).get(CHILD)).toMatchObject({ name: CHILD.slice(0, 8), nickname: null, role: null, path: null });
    const named = subAgentsOf(parentTimeline(), {}, { [CHILD]: { nickname: "Euclid", role: "explorer" } }).get(CHILD);
    expect(named).toMatchObject({ name: "Euclid · explorer", nickname: "Euclid", role: "explorer" });
    expect(activeSubAgents(parentTimeline(), true, {}, { [CHILD]: { nickname: "Euclid", role: null } }).map((a) => a.name)).toEqual(["Euclid"]);
    // Read, but the runtime had no nickname: today's name.
    expect(subAgentsOf(parentTimeline(), {}, { [CHILD]: { nickname: null, role: null } }).get(CHILD)?.name).toBe(CHILD.slice(0, 8));
  });

  it("a v2 nickname replaces the path leaf; the path stays for the tooltip", () => {
    const items = [activity, spawnItem];
    expect(subAgentsOf(parentTimeline(items)).get(CHILD)).toMatchObject({ name: "acl_checker", path: "/root/acl_checker" });
    const info = subAgentsOf(parentTimeline(items), {}, { [CHILD]: { nickname: "Noether", role: "default" } }).get(CHILD)!;
    expect(info).toMatchObject({ name: "Noether", path: "/root/acl_checker" });
    expect(subAgentTooltip(CHILD, info)).toBe(`/root/acl_checker\n${CHILD}`);
    expect(subAgentTooltip(CHILD, null)).toBe(CHILD);
  });

  it("a name outside the parent's timeline comes from the cache, else the short id", () => {
    const agents = subAgentsOf(parentTimeline());
    expect(subAgentName(CHILD, agents, {})).toBe(CHILD.slice(0, 8));
    expect(subAgentName("grandchild-1", agents, { "grandchild-1": { nickname: "Hypatia", role: "worker" } })).toBe("Hypatia · worker");
    expect(subAgentName("grandchild-2", agents, {})).toBe("grandchi");
  });

  it("leaves Claude task refs alone", () => {
    const claude = { type: "subAgentActivity", id: "c1", kind: "started", agentThreadId: TASK, agentPath: "/claude/toolu_01AbCdEf" };
    expect(subAgentsOf(parentTimeline([claude])).get(TASK)?.name).toBe("toolu_01AbCdEf");
    const log: SubAgentReadLog = { settle: new Set(), name: new Map() };
    expect(takeSubAgentReads("s", subAgentsOf(parentTimeline([claude])).values(), {}, {}, log, 0)).toEqual([]);
  });

  it("plans one read per sub-agent: full to settle an active one, light for a name, a failed one retried a little", () => {
    const log: SubAgentReadLog = { settle: new Set(), name: new Map() };
    const agents = () => subAgentsOf(parentTimeline()).values();
    // pendingInit, no child status: the settle read (it names it too).
    expect(takeSubAgentReads("s", agents(), {}, {}, log, 0)).toEqual([{ threadId: CHILD, settle: true }]);
    expect(takeSubAgentReads("s", agents(), {}, {}, log, 1)).toEqual([]);
    // That read failed (no name recorded): a light read after the back-off, NAME_READ_TRIES reads in all.
    let now = NAME_READ_RETRY_MS;
    for (let i = 1; i < NAME_READ_TRIES; i++, now += NAME_READ_RETRY_MS) expect(takeSubAgentReads("s", agents(), {}, {}, log, now)).toEqual([{ threadId: CHILD, settle: false }]);
    expect(takeSubAgentReads("s", agents(), {}, {}, log, now + NAME_READ_RETRY_MS)).toEqual([]);
    // Settled by its own events and already read (even without a nickname): nothing to read.
    const fresh: SubAgentReadLog = { settle: new Set(), name: new Map() };
    expect(takeSubAgentReads("s", agents(), { [CHILD]: "completed" }, { [CHILD]: { nickname: null, role: null } }, fresh, 0)).toEqual([]);
    // Settled but never read: one light read for the name.
    expect(takeSubAgentReads("s", agents(), { [CHILD]: "completed" }, {}, fresh, 0)).toEqual([{ threadId: CHILD, settle: false }]);
    expect(takeSubAgentReads("s", agents(), { [CHILD]: "completed" }, {}, fresh, 1)).toEqual([]);
  });
});
