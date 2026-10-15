import { describe, expect, it } from "vitest";
import type { TimelineEntry, TimelineState } from "../src/renderer/src/lib/timeline";
import { liveReasoning, turnActivity } from "../src/renderer/src/lib/turnActivity";

const tool = (id: string, item: Record<string, unknown>): TimelineEntry => ({ kind: "tool", id, turnId: "t1", item: { id, ...item } as never });
const agent = (id: string, streaming = false): TimelineEntry => ({ kind: "agent", id, text: "…", turnId: "t1", streaming });
const reasoning = (id: string, streaming = false, content: string[] = []): TimelineEntry => ({ kind: "reasoning", id, turnId: "t1", summary: [], content, streaming, startedAt: null, completedAt: null });
const invisible = (id: string): TimelineEntry => ({ kind: "other", id, turnId: "t1", item: { id, type: "contextCompaction" } });
const user = (id: string): TimelineEntry => ({ kind: "user", id, text: "hi", turnId: "t1" });

function timeline(entries: TimelineEntry[], opts: { active?: boolean; pending?: string[] } = {}): Pick<TimelineState, "activeTurnId" | "turns" | "entries" | "pending"> {
  const active = opts.active ?? true;
  return {
    activeTurnId: active ? "t1" : null,
    turns: [{ id: "t1", status: active ? "inProgress" : "completed", startedAt: 1, completedAt: active ? null : 2, entryIds: entries.map((e) => e.id) }],
    entries: new Map(entries.map((e) => [e.id, e])),
    pending: new Map((opts.pending ?? []).map((method, i) => [String(i), { id: i, method, params: {} }])),
  };
}

const running = (type: string) => ({ type, status: "inProgress" });
const done = (type: string) => ({ type, status: "completed" });

describe("turnActivity", () => {
  it("is null when no turn runs", () => {
    expect(turnActivity(timeline([user("u")], { active: false }))).toBeNull();
  });

  it("is just working when nothing tells more (just started, between steps)", () => {
    expect(turnActivity(timeline([user("u")]))).toBe("working");
    expect(turnActivity(timeline([user("u"), tool("a", done("commandExecution")), reasoning("r"), invisible("x")]))).toBe("working");
  });

  it("reports reasoning in progress, even without text, and the newest live step wins", () => {
    expect(turnActivity(timeline([user("u"), reasoning("r", true)]))).toBe("reasoning");
    expect(turnActivity(timeline([tool("a", running("commandExecution")), reasoning("r", true)]))).toBe("reasoning");
    expect(turnActivity(timeline([reasoning("r", true), tool("a", running("fileChange"))]))).toBe("editing");
    const tl = timeline([reasoning("r0"), reasoning("r1", true, ["thinking…"]), tool("a", done("commandExecution"))]);
    expect(liveReasoning(tl)?.id).toBe("r1");
    expect(liveReasoning(timeline([reasoning("r0")]))).toBeNull();
  });

  it("names the newest running tool of the trailing run, across reasoning and parallel calls", () => {
    expect(turnActivity(timeline([user("u"), tool("a", running("commandExecution"))]))).toBe("command");
    expect(turnActivity(timeline([user("u"), tool("a", running("fileChange")), invisible("r"), tool("b", done("commandExecution"))]))).toBe("editing");
    expect(turnActivity(timeline([tool("a", running("mcpToolCall"))]))).toBe("tool");
    expect(turnActivity(timeline([tool("a", running("collabAgentToolCall"))]))).toBe("tool");
  });

  it("ignores running tools before later text, and commands moved to the background", () => {
    expect(turnActivity(timeline([tool("a", running("commandExecution")), agent("m")]))).toBe("working");
    expect(turnActivity(timeline([tool("a", running("commandExecution"))]), ["a"])).toBe("working");
  });

  it("reports streaming text", () => {
    expect(turnActivity(timeline([user("u"), agent("m", true)]))).toBe("replying");
    expect(turnActivity(timeline([{ kind: "plan", id: "p", turnId: "t1", text: "", streaming: true }]))).toBe("planning");
  });

  it("puts a pending approval or question first", () => {
    expect(turnActivity(timeline([tool("a", running("commandExecution"))], { pending: ["item/commandExecution/requestApproval"] }))).toBe("approval");
    expect(turnActivity(timeline([agent("m", true)], { pending: ["item/tool/requestUserInput"] }))).toBe("question");
    expect(turnActivity(timeline([], { pending: ["item/tool/requestUserInput", "item/fileChange/requestApproval"] }))).toBe("approval");
  });
});
