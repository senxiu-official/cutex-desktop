// @vitest-environment jsdom
// An opened saved row (session-interaction-history-v1): a secret answer cutex did not keep reads 「（已隐藏）」 — never
// 「（没有回答）」 — and a local secret reply shows no plaintext opened either; the row says who answered and when.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InteractionHistoryRecord } from "@cutex-desktop/protocol";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { answeredRecord, savedRecord, type InteractionRecord } from "../src/renderer/src/lib/interactionLog";
import { InteractionRow } from "../src/renderer/src/components/InteractionRow";

vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ timelineInteractions: true }) }));
vi.mock("../src/renderer/src/lib/userLayoutToggle", () => ({ useUserLayoutToggle: () => (fn: () => void) => fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "zh-CN", t: (key: keyof typeof zhCN, vars?: Record<string, string | number>) => {
  const template = zhCN[key] ?? String(key);
  return vars ? template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`)) : template;
} }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PARAMS = {
  threadId: "t", turnId: "turn-2", itemId: "item-q", isBlocking: true,
  questions: [
    { id: "q1", header: "Deploy", question: "现在部署吗？", isOther: false, isSecret: false, options: [{ label: "现在", description: "" }, { label: "稍后", description: "" }] },
    { id: "token", header: "Token", question: "API token？", isOther: true, isSecret: true, options: null },
  ],
};
const saved = (over: Partial<InteractionHistoryRecord>): InteractionRecord => savedRecord({
  runtimeGeneration: 3, native: { id: 9, method: "item/tool/requestUserInput", params: PARAMS }, turnId: "turn-2",
  result: { answers: { q1: { answers: ["现在"] } } }, actor: { kind: "owner" }, answeredAt: "2026-11-25T06:30:00Z", redactedQuestionIds: ["token"], ...over,
})!;

let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const open = async (record: InteractionRecord) => {
  await act(async () => root.render(h(InteractionRow, { record })));
  await act(async () => { host.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  return host.textContent ?? "";
};

describe("opened saved row", () => {
  it("shows the chosen option, the hidden secret and who answered", async () => {
    const text = await open(saved({}));
    expect(text).toContain("现在部署吗？");
    expect(text).toContain("（已隐藏）");
    expect(text).not.toContain("（没有回答）");
    expect(host.querySelector("[data-interaction-hidden]")).not.toBeNull();
    expect(host.querySelector("[data-interaction-by]")?.textContent).toMatch(/^你 · /);
    expect(host.querySelector("[data-interaction-saved]")).not.toBeNull();
  });
  it("says an abbreviated approval is truncated", async () => {
    const record = savedRecord({ runtimeGeneration: 3, native: { id: 11, method: "item/commandExecution/requestApproval", params: { kind: "command", threadId: "t", turnId: "turn-2", itemId: "c", startedAtMs: 0, environmentId: null, command: "echo aaaa", cwd: "/w", reason: null, availableDecisions: ["accept", "decline"] } }, turnId: "turn-2", result: { decision: "accept" }, actor: { kind: "owner" }, answeredAt: "2026-11-25T06:30:00Z", redactedQuestionIds: [], truncated: true })!;
    await open(record);
    expect(host.querySelector("[data-interaction-truncated]")?.textContent).toContain("已截断");
  });
  it("names another user or agent", async () => {
    await open(saved({ actor: { kind: "user", userId: "u1", name: "Mika" } }));
    expect(host.querySelector("[data-interaction-by]")?.textContent).toMatch(/^Mika · /);
    await act(async () => root.render(h("div")));
    const agent = savedRecord({ runtimeGeneration: 3, native: { id: 10, method: "item/tool/requestUserInput", params: PARAMS }, turnId: "turn-2", result: { answers: {} }, actor: { kind: "agent", cutexSessionId: "lead" }, answeredAt: "2026-11-25T06:30:00Z", redactedQuestionIds: [] }, false, () => "Lead")!;
    await open(agent);
    expect(host.querySelector("[data-interaction-by]")?.textContent).toMatch(/^Lead · /);
  });
  it("a secret reply sent here shows no plaintext, collapsed or opened", async () => {
    const record = answeredRecord({ id: 9, method: "item/tool/requestUserInput", params: { ...PARAMS, questions: [PARAMS.questions[1]] } }, { result: { answers: { token: { answers: ["sk-plain"] } } } }, "turn-2", 1, 3);
    await act(async () => root.render(h(InteractionRow, { record })));
    expect(host.textContent).toContain("（已隐藏）");
    const text = await open(record);
    expect(text).not.toContain("sk-plain");
    expect(text).toContain("（已隐藏）");
  });
});
