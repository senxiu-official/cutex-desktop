// claude-safety-grants: a tool call a Claude Code safety check stopped is not a failure. Its row reads
// 已拦截（安全检查） with the check's reason (no red ✕ / 失败), and a folded work group counts it as
// stopped, not failed.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

const fx = vi.hoisted(() => ({
  state: { selectedId: "eva", selectedHost: null, hosts: null, sessions: {}, backgroundItems: {} } as Record<string, unknown>,
  notes: {} as Record<string, unknown>,
}));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agentHost: () => "local",
  selectedSidebar: () => null,
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/lib/ownerNotifyStore", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useHostOwnerNotes: () => fx.notes,
}));
// The work group renders its rows through the slot outlet; here the plain row directly.
vi.mock("../src/renderer/src/modules/TimelineOutlet", async () => {
  const { PlainToolRow } = await import("../src/renderer/src/components/PlainToolRow");
  return { ToolOutlet: ({ item }: { item: Record<string, unknown> }) => h(PlainToolRow, { item: item as never }) };
});

const { PlainToolRow } = await import("../src/renderer/src/components/PlainToolRow");
const { WorkGroup } = await import("../src/renderer/src/components/WorkGroup");
const { summarize } = await import("../src/renderer/src/lib/workGroups");
const { SafetyToolRow } = await import("../src/renderer/src/modules/safety-grants/SafetyToolRow");

const REASON = "Dangerous rm operation on possibly-empty variable path: $OUT/$run";
const claudeCall = { type: "dynamicToolCall", id: "call-1", namespace: "claude", tool: "Bash", status: "failed", contentItems: [{ type: "inputText", text: `${REASON}\n\nFull access does not cover this Claude Code safety check.` }] };

describe("a safety-stopped tool row", () => {
  it("reads 已拦截（安全检查） with the reason, not 失败", () => {
    const html = renderToStaticMarkup(h(PlainToolRow, { item: claudeCall as never, safetyBlock: { reason: REASON } }));
    expect(html).toContain("tool.safetyBlocked");
    expect(html).toContain("data-tool-blocked");
    expect(html).toContain(REASON);
    expect(html).not.toContain("taskrow.outcome.failed");
    expect(html).not.toContain("text-danger");
  });

  it("without a safety block the same call still reads failed", () => {
    const html = renderToStaticMarkup(h(PlainToolRow, { item: claudeCall as never }));
    expect(html).toContain("taskrow.outcome.failed");
    expect(html).not.toContain("tool.safetyBlocked");
  });

  it("a folded work group counts it as stopped, a real failure stays red", () => {
    const steps = [
      { kind: "tool", id: "call-1", item: claudeCall },
      { kind: "tool", id: "cmd-2", item: { type: "commandExecution", id: "cmd-2", command: "ls", status: "completed", exitCode: 0 } },
    ] as never[];
    const render = () => renderToStaticMarkup(h(WorkGroup, { steps, open: false, summary: summarize(steps), sessionId: "eva" }));
    fx.notes = { "ntf-1": { notificationId: "ntf-1", agentId: "eva", createdAt: "2026-10-16T01:00:00.000Z", safetyBlock: { itemId: "call-1", reason: REASON, state: "blocked" } } };
    // The header (the rows below come from the outlet; the safety row is the module's).
    const header = (html: string) => html.slice(0, html.indexOf("</button>"));
    const blocked = render();
    expect(header(blocked)).toContain("work.safetyBlocked(1)");
    expect(header(blocked)).not.toContain("work.failed");
    expect(header(blocked)).not.toContain("text-danger");
    expect(blocked).not.toContain("border-danger");
    fx.notes = {};
    const failed = render();
    expect(header(failed)).toContain("work.failed(1)");
    expect(header(failed)).toContain("text-danger");
    expect(failed).not.toContain("work.safetyBlocked");
  });

  it("the safety-grants row renders the stopped row and the owner's decision line", () => {
    fx.notes = { "ntf-1": { notificationId: "ntf-1", agentId: "eva", createdAt: "2026-10-16T01:00:00.000Z", safetyBlock: { itemId: "call-1", reason: REASON, state: "blocked" } } };
    const html = renderToStaticMarkup(h(SafetyToolRow, { item: claudeCall as never, sessionId: "eva" }));
    expect(html).toContain("tool.safetyBlocked");
    expect(html).toContain('data-safety-line="blocked"');
    expect(html).not.toContain("taskrow.outcome.failed");
    fx.notes = {};
  });

  it("has zh-CN and en wording", () => {
    expect(zhCN["tool.safetyBlocked"]).toBe("已拦截（安全检查）");
    expect(en["tool.safetyBlocked"]).toBeTruthy();
    expect(zhCN["work.safetyBlocked"]).toContain("{n}");
    expect(en["work.safetyBlocked"]).toContain("{n}");
  });
});
