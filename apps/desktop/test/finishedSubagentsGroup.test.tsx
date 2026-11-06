// 子代理 → 最近完成: openable rows are buttons; a background Claude subagent of an older adapter is plain
// text saying no transcript was kept, one of claude-r23 opens with its duration; folded under working
// sub-agents, open when it is all there is.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FinishedSubAgent } from "../src/renderer/src/lib/finishedSubagents";

const fx = vi.hoisted(() => ({ rows: [] as FinishedSubAgent[], features: {} as Record<string, unknown> }));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/agentFeaturesView", () => ({ useAgentFeatures: () => fx.features, agentFeaturesFor: () => fx.features }));
vi.mock("../src/renderer/src/modules/subagents/useSubagentsStatus", () => ({
  useActiveSubAgents: () => [],
  useFinishedSubAgents: () => fx.rows,
  useFinishedSubAgentsNow: () => () => fx.rows,
  useFinishedSpanReads: () => {},
}));

const { FinishedGroup } = await import("../src/renderer/src/modules/subagents/SubagentsStatus");

const row = (over: Partial<FinishedSubAgent>): FinishedSubAgent => ({ key: "k", threadId: null, name: "x", type: null, durationMs: null, outcome: "completed", background: false, noTranscript: false, task: null, ...over });

describe("最近完成 group", () => {
  fx.rows = [
    row({ key: "a", threadId: "00000000-0000-7000-8000-00000000000a", name: "Euclid · explorer", type: "explorer", durationMs: 42_000 }),
    row({ key: "b", threadId: "claude:s:task:b", name: "扫描日志", type: "general-purpose", background: true, noTranscript: true }),
    row({ key: "c", name: null, outcome: "failed" }),
    row({ key: "d", threadId: "claude:s:task:d", name: "整理日志", type: "general-purpose", background: true, durationMs: 90_000, outcome: "stopped" }),
  ];
  fx.features = { runtime: "claude", map: { subagentTranscripts: true } };

  it("lists the rows when open: name, type unless already in the name, duration, outcome", () => {
    const html = renderToStaticMarkup(h(FinishedGroup, { sessionId: "eva", initiallyOpen: true }));
    expect(html).toContain("subagents.recent(4)");
    expect(html.match(/data-finished-subagent/g)).toHaveLength(4);
    expect(html).toContain("Euclid · explorer");
    expect(html).not.toContain('ml-1.5 text-subtle">explorer');
    expect(html).toContain("42s · subagents.outcome.completed");
    expect(html).toContain("subagents.outcome.failed");
    // A Codex child and a claude-r23 background run open; the old background one and the card without a
    // reference do not.
    expect(html.match(/<button[^>]*data-finished-subagent/g)).toHaveLength(2);
    expect(html).toContain("subagents.recent.background");
    expect(html).toContain('data-tip="claude:s:task:d');
    expect(html).toContain("subagents.background</span>");
    expect(html).toContain("1m · subagents.outcome.stopped");
    expect(html).toContain("subagents.recent.noTranscript");
    expect(html).toContain("subagents.claude.agent");
  });

  it("is folded under working sub-agents", () => {
    const html = renderToStaticMarkup(h(FinishedGroup, { sessionId: "eva", initiallyOpen: false }));
    expect(html).toContain("subagents.recent(4)");
    expect(html).not.toContain("data-finished-subagent");
  });
});
