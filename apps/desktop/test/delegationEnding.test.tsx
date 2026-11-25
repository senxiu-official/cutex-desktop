// @vitest-environment jsdom
// The detail's 「结束经过」 (cutex r295 terminal notices): one sequence — the failed attempt, then the closure with who and
// why — a retry that has not started said apart, an unknown actor said as unknown, the requester's own stop muted;
// nothing on an older host or for a normal answer.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskDetail, AskSummary } from "../src/shared/ipc";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { hostKey } from "../src/renderer/src/lib/hostKeys";
import { useDelegations } from "../src/renderer/src/lib/delegationStore";
import { DelegationEndingSection, EndingBy } from "../src/renderer/src/components/DelegationEnding";
import { parseTerminalNotice } from "../src/renderer/src/lib/delegationTerminal";
import { resetEndingLoader } from "../src/renderer/src/lib/endingLoader";
import { en } from "../src/renderer/src/i18n/en";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "zh-CN", t: (key: keyof typeof zhCN, vars?: Record<string, string | number>) => {
  const template = zhCN[key] ?? String(key);
  return vars ? template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`)) : template;
} }) }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({ useAgentNames: () => (id: string) => ({ lead: "Lead", helper: "Helper" })[id] ?? id }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST = "local";
const d = (over: Partial<AskSummary> = {}): AskSummary => ({ askId: "ask-1", title: "T", requester: { kind: "agent", cutexSessionId: "lead" }, target: "helper", targetName: "Helper", execution: "interrupted", closed: "stopped", attempts: 2, createdAt: "", updatedAt: "", revision: 9, ...over });
const notice = (refId: string, at: string, over: Record<string, unknown>) => ({ refId, at, revision: 9, attempt: 2, execution: "interrupted", closed: null, reason: "", actor: { kind: "unknown" }, ...over });
const seed = (detail: Partial<AskDetail> | null) => useDelegations.setState({ details: detail ? { [hostKey(HOST, "ask-1")]: { askId: "ask-1", title: "T", requester: { kind: "agent", cutexSessionId: "lead" }, targetCutexSessionId: "helper", execution: "interrupted", createdAt: "", updatedAt: "", revision: 9, ...detail } as AskDetail } : {} });

let host: HTMLDivElement; let root: Root;
beforeEach(() => { resetEndingLoader(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); useDelegations.setState({ details: {} }); });
const render = async (node: ReturnType<typeof h>) => { await act(async () => root.render(node)); return host.textContent ?? ""; };

describe("结束经过", () => {
  it("the failed attempt, then your stop: one sequence in time order", async () => {
    seed({ closed: "stopped", terminalNotices: [
      notice("terminal@9", "2026-11-25T05:02:00Z", { closed: "stopped", actor: { kind: "owner" }, reason: "ownerStopped" }),
      notice("handlerTurnFailed@2", "2026-11-25T05:00:00Z", { actor: { kind: "system", component: "handlerRuntime" }, reason: "misalignmentPolicyViolation" }),
    ] });
    const text = await render(h(DelegationEndingSection, { d: d(), host: HOST }));
    expect(text).toContain("结束经过");
    const rows = [...host.querySelectorAll("[data-ending-ref]")].map((e) => e.getAttribute("data-ending-ref"));
    expect(rows).toEqual(["handlerTurnFailed@2", "terminal@9"]);
    expect(rows.length).toBe(2);
    const [failed, stopped] = [...host.querySelectorAll("[data-ending-ref]")].map((e) => e.textContent ?? "");
    expect(failed).toContain("第 2 次尝试中断");
    expect(failed).toContain("由 Helper 的运行时");
    expect(failed).toContain("原因：模型服务拒绝了这次请求");
    expect(stopped).toContain("已停止");
    // P3: 「由你」, not delegation.you's owner term.
    expect(stopped).toContain("已停止 · 由你 · 第 2 次尝试");
    expect(stopped).not.toContain("{{");
    expect(stopped).toContain("第 2 次尝试");
    // ownerStopped only restates who stopped it: no 原因 line.
    expect(stopped).not.toContain("原因");
  });
  it("an unknown actor reads 未记录由谁, never 你", async () => {
    seed({ closed: "cancelled", execution: "rejected", terminalNotices: [notice("terminal@4", "2026-11-25T05:00:00Z", { closed: "cancelled", execution: "rejected", attempt: null, reason: "Historical terminal state; its initiating actor/reason was not recorded" })] });
    const text = await render(h(DelegationEndingSection, { d: d({ closed: "cancelled", execution: "rejected" }), host: HOST }));
    expect(text).toContain("未记录由谁");
    expect(text).not.toContain("由你");
  });
  it("the requester's own abandon is muted, not a warning", async () => {
    seed({ closed: "abandoned", terminalNotices: [notice("terminal@7", "2026-11-25T05:00:00Z", { closed: "abandoned", actor: { kind: "agent", sessionId: "lead" }, reason: "abandoned" })] });
    await render(h(DelegationEndingSection, { d: d({ closed: "abandoned" }), host: HOST }));
    const row = host.querySelector("[data-ending-self]")!;
    expect(row.textContent).toContain("由 Lead");
    expect(row.querySelector(".text-danger-text")).toBeNull();
  });
  it("a retry that has not started is its own line", async () => {
    seed({ closed: null, execution: "queued", attempts: [{ n: 1, startedAt: "x" } as never, { n: 2 } as never], terminalNotices: [notice("handlerTurnFailed@1", "2026-11-25T05:00:00Z", { attempt: 1, execution: "failed", actor: { kind: "system", component: "handlerRuntime" }, reason: "runtime exited: 429" })] });
    const text = await render(h(DelegationEndingSection, { d: d({ closed: null, execution: "queued" }), host: HOST }));
    expect(text).toContain("第 1 次尝试失败");
    expect(text).toContain("原因：runtime exited: 429");
    expect(host.querySelector("[data-ending-retry]")?.textContent).toContain("第 2 次尝试还没开始");
  });
  it("nothing on an older host, nor for a normal answer", async () => {
    seed({ closed: "stopped" });
    expect(await render(h(DelegationEndingSection, { d: d(), host: HOST }))).toBe("");
    seed({ closed: "completed", execution: "answered", terminalNotices: [notice("terminal@4", "2026-11-25T05:00:00Z", { closed: "completed", execution: "answered", actor: { kind: "system", component: "cutex" }, reason: "answered" })] });
    expect(await render(h(DelegationEndingSection, { d: d({ closed: "completed", execution: "answered", answerId: "a" }), host: HOST }))).toBe("");
  });
});

describe("由 X beside a status word", () => {
  it("names the actor; the hover lists the sequence", async () => {
    const stop = parseTerminalNotice(notice("terminal@9", "2026-11-25T05:02:00Z", { closed: "stopped", actor: { kind: "system", component: "scheduler" }, reason: "Mika was archived" }))!;
    const text = await render(h(EndingBy, { notice: stop, targetName: "Helper" }));
    expect(text).toBe("· 由 cutex 调度");
    expect(host.querySelector("[data-delegation-ending-by]")?.getAttribute("title")).toContain("已停止 · 由 cutex 调度 · 第 2 次尝试 原因：Mika was archived");
  });
});

describe("接下来 status notice (registry 2.11)", () => {
  const both = [
    notice("handlerTurnFailed@2", "2026-11-25T05:00:00Z", { actor: { kind: "system", component: "handlerRuntime" }, reason: "x" }),
    notice("terminal@9", "2026-11-25T05:02:00Z", { closed: "stopped", actor: { kind: "owner" }, reason: "ownerStopped" }),
  ];
  it("each row names the actor of its own notice (by the ref in its preview), not the later stopper", async () => {
    const { NextUpEndingBy } = await import("../src/renderer/src/components/NextUpEndingBy");
    seed({ closed: "stopped", terminalNotices: both });
    expect(await render(h(NextUpEndingBy, { host: HOST, ask: d(), preview: "handlerTurnFailed@2: T" }))).toBe("· 由 Helper 的运行时");
    expect(await render(h(NextUpEndingBy, { host: HOST, ask: d(), preview: "terminal@9: T" }))).toBe("· 由你");
  });
  it("no matching snapshot, or an older host: no actor", async () => {
    const { NextUpEndingBy } = await import("../src/renderer/src/components/NextUpEndingBy");
    seed({ closed: "stopped", terminalNotices: both });
    expect(await render(h(NextUpEndingBy, { host: HOST, ask: d(), preview: "stopped@7: T" }))).toBe("");
    expect(await render(h(NextUpEndingBy, { host: HOST, ask: d(), preview: "T" }))).toBe("");
    seed({ closed: "stopped" });
    expect(await render(h(NextUpEndingBy, { host: HOST, ask: d(), preview: "terminal@9: T" }))).toBe("");
  });
  it("「由你」 / \"by you\" are the catalogs' words", () => {
    expect(zhCN["delegation.ending.byYou"]).toBe("由你");
    expect(en["delegation.ending.byYou"]).toBe("by you");
  });
});
