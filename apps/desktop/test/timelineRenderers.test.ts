import { describe, expect, it } from "vitest";
import { toolRendererFor } from "../src/renderer/src/lib/timelineRenderers";
import { segmentEntries } from "../src/renderer/src/lib/workGroups";
import { turnActivity } from "../src/renderer/src/lib/turnActivity";
import { isAgentTaskTool, isTaskServiceTool, taskIdForAssignment } from "../src/renderer/src/lib/taskRows";
import type { RawItem, TimelineEntry } from "../src/renderer/src/lib/timeline";
import type { AppSlotEntry, ToolRenderer } from "../src/renderer/src/modules/slots";

const renderer = (id: `${string}.${string}`, extra: Partial<ToolRenderer> = {}): AppSlotEntry<"timeline.tool"> => ({ moduleId: id, item: { id, match: () => true, Row: () => null, ...extra }, mode: "show", waiting: false, missing: [] });
const tool = (id: string, type = "mcpToolCall", extra: Record<string, unknown> = {}): Extract<TimelineEntry, { kind: "tool" }> => ({ kind: "tool", id, turnId: "t1", item: { id, type, status: "inProgress", ...extra } });

describe("timeline tool renderer selection", () => {
  it("first matching shown contribution wins consistently for rendering, grouping and activity", () => {
    const first = renderer("first.tool", { standalone: () => false, activity: () => "turn.activity.search" });
    const second = renderer("second.tool", { standalone: () => true, activity: () => "turn.activity.subagent" });
    const item = tool("a").item;
    expect(toolRendererFor(item, [first, second])).toBe(first);
    expect(toolRendererFor(item, [first, second])?.item.standalone?.(item)).toBe(false);
    expect(toolRendererFor(item, [first, second])?.item.activity?.(item)).toBe("turn.activity.search");
    expect(toolRendererFor(item, [{ ...first, mode: "disable" }, second])).toBe(second);
    expect(toolRendererFor(item, [{ ...first, mode: "notice" }, second])).toBe(second);
    expect(toolRendererFor(item, [renderer("unrelated.tool", { match: () => false })])).toBeUndefined();
  });

  it("agent gating rejects explicit false only and lets a later available renderer win", () => {
    const first = renderer("first.tool", { agentFeature: "planMode" });
    const fallback = renderer("fallback.tool");
    expect(toolRendererFor(tool("x").item, [first, fallback], { runtime: "claude", map: { planMode: false } })).toBe(fallback);
    expect(toolRendererFor(tool("x").item, [first], { runtime: "claude", map: null })).toBe(first);
  });

  it("the selected standalone renderer closes groups; withdrawal restores folding without losing entries", () => {
    const command = tool("a", "commandExecution");
    const card = tool("b", "special");
    const after = tool("c", "commandExecution");
    const entries = [renderer("special.tool", { match: (item) => item.type === "special", standalone: () => true })];
    const groups = segmentEntries([command, card, after], { standalone: (item) => !!toolRendererFor(item, entries)?.item.standalone?.(item) });
    expect(groups.map((s) => s.kind)).toEqual(["work", "entry", "work"]);
    expect(groups[0]).toMatchObject({ open: false, steps: [command] });
    expect(groups[1]).toMatchObject({ entry: card });
    expect(groups[2]).toMatchObject({ open: true, steps: [after] });
    const fallback = segmentEntries([command, card, after], { standalone: (item) => !!toolRendererFor(item, [])?.item.standalone?.(item) });
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toMatchObject({ open: true, steps: [command, card, after] });
  });

  it("module activity applies to live tools only; pending requests and background work keep precedence", () => {
    const entry = tool("a", "collabAgentToolCall");
    const entries = [renderer("subagents.tool", { activity: () => "turn.activity.subagent" })];
    const activity = (item: RawItem) => toolRendererFor(item, entries)?.item.activity?.(item) ?? null;
    const timeline = { activeTurnId: "t1", turns: [{ id: "t1", status: "inProgress" as const, startedAt: 1, completedAt: null, entryIds: [entry.id] }], entries: new Map<string, TimelineEntry>([[entry.id, entry]]), pending: new Map() };
    expect(turnActivity(timeline, [], activity)).toBe("turn.activity.subagent");
    expect(turnActivity(timeline, [], () => null)).toBe("tool");
    expect(turnActivity(timeline, [entry.id], activity)).toBe("working");
    expect(turnActivity({ ...timeline, pending: new Map([["1", { id: 1, method: "item/tool/requestUserInput", params: {} }]]) }, [], activity)).toBe("question");
    expect(turnActivity({ ...timeline, activeTurnId: null }, [], activity)).toBeNull();
  });

  it("cutex tool matchers are cheap, server-specific and do not populate transcript caches", () => {
    const item = tool("legacy", "mcpToolCall", { server: "cutex", tool: "cutex_task_service_director", arguments: { operation: "assign", assignment_id: "pure-match-only", task_id: "task-7" } }).item;
    expect(isTaskServiceTool(item)).toBe(true);
    expect(isAgentTaskTool(item)).toBe(false);
    expect(taskIdForAssignment("pure-match-only")).toBeNull();
    expect(isAgentTaskTool({ ...item, tool: "agent_delegate" })).toBe(true);
    expect(isAgentTaskTool({ ...item, tool: "read_overlength_content" })).toBe(true);
    expect(isAgentTaskTool({ ...item, tool: "constructor" })).toBe(false);
    expect(isAgentTaskTool({ ...item, server: "other", tool: "agent_delegate" })).toBe(false);
    expect(isTaskServiceTool({ ...item, type: "dynamicToolCall" })).toBe(false);
  });
});
