// A gated cutex tool call that answered approval_required is not a failure: no red ✕ / 失败 / raw
// refusal line, the row says 需要审批 and work-group summaries don't count it. approval_denied reads
// as declined. While cutex approval-wait holds the call it is simply running.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/store", () => {
  const state = { selectedId: "s1", sessions: {}, backgroundItems: {} };
  const useApp = Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state });
  return { useApp, selectedSidebar: () => null };
});
import { PlainToolRow } from "../src/renderer/src/components/PlainToolRow";
import { approvalOutcome, isFailed, summarize, type ToolEntry } from "../src/renderer/src/lib/workGroups";
import { taskRowOutcome } from "../src/renderer/src/lib/taskRows";
import { browserToolView } from "../src/renderer/src/modules/browser/browserTimeline";
import type { RawItem } from "../src/renderer/src/lib/timeline";

const id = "apr-5e7a0c3f9b2d4e61a8c07f1d2b3e4a59";
const call = (body: unknown, over: Partial<RawItem> = {}): RawItem =>
  ({ type: "mcpToolCall", id: "c1", server: "cutex", tool: "service_register", status: "failed", arguments: { slug: "x" }, result: { content: [{ type: "text", text: JSON.stringify(body) }], isError: true }, error: null, durationMs: 120, ...over }) as RawItem;
const required = call({ ok: false, status: "approval_required", code: "approval_required", approval_id: id, detail: "Nothing was done yet: this needs the owner's approval (Keep x). The owner sees the request in the cutex desktop." });
const denied = call({ ok: false, status: "approval_denied", code: "approval_denied", approval_id: id, detail: "The owner declined." });
const plainFailure = call({ ok: false, code: "bad_request", detail: "slug taken" });
const entry = (item: RawItem): ToolEntry => ({ kind: "tool", id: item.id, turnId: "t1", item }) as unknown as ToolEntry;
const render = (item: RawItem) => renderToStaticMarkup(createElement(PlainToolRow, { item }));

describe("approval outcomes of cutex tool calls", () => {
  it("approval_required / approval_denied are not failures", () => {
    expect(approvalOutcome(required)).toBe("required");
    expect(approvalOutcome(denied)).toBe("denied");
    expect(isFailed(required)).toBe(false);
    expect(isFailed(denied)).toBe(false);
    expect(isFailed(plainFailure)).toBe(true);
  });
  it("a held call (approval-wait) is still running, not an approval outcome", () => {
    const held = call(null, { status: "inProgress", result: null });
    expect(approvalOutcome(held)).toBeNull();
    expect(isFailed(held)).toBe(false);
    expect(render(held)).toContain("animate-spin");
  });
  it("work-group summaries don't count them as failed", () => {
    expect(summarize([entry(required), entry({ ...denied, id: "c2" }), entry({ ...plainFailure, id: "c3" })]).failed).toBe(1);
  });
  it("task rows: approval_denied is declined, approval_required waits", () => {
    expect(taskRowOutcome(denied)?.kind).toBe("declined");
    expect(taskRowOutcome(required)?.kind).toBe("approval");
  });
  it("the plain row: 需要审批 in amber, no ✕ / 失败 / refusal line", () => {
    const html = render(required);
    expect(html).toContain('data-tool-approval="required"');
    expect(html).toContain("tool.approvalRequired");
    expect(html).not.toContain("text-danger");
    expect(html).not.toContain("taskrow.outcome.failed");
    expect(html).not.toContain("approval_required");
  });
  it("the plain row: approval_denied reads as declined, not failed", () => {
    const html = render(denied);
    expect(html).toContain('data-tool-approval="denied"');
    expect(html).toContain("tool.declined");
    expect(html).not.toContain("text-danger");
  });
  it("an ordinary failure still shows ✕ and 失败", () => {
    const html = render(plainFailure);
    expect(html).toContain("text-danger");
    expect(html).toContain("taskrow.outcome.failed");
  });
  it("browser tool rows: a relay approval code reads as waiting / declined, not failed", () => {
    const open = (code: string) => call({ error: { code } }, { tool: "browser_open", arguments: { url: "http://127.0.0.1:8000" } });
    expect(approvalOutcome(open("approval_required"))).toBe("required");
    expect(isFailed(open("approval_required"))).toBe(false);
    expect(browserToolView(open("approval_required"))?.approval).toBe("required");
    expect(browserToolView(open("approval_denied"))?.approval).toBe("denied");
    expect(browserToolView(open("navigation_failed"))?.approval).toBeNull();
    expect(browserToolView({ ...denied, tool: "browser_open" } as RawItem)?.approval).toBe("denied");
  });
});
