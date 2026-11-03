// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INPUT_WAITING_REASONS } from "@cutex-desktop/protocol";
import { record } from "../src/renderer/src/lib/inputLedger/testkit";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
const fx = vi.hoisted(() => ({ locale: "zh" as "zh" | "en", retry: vi.fn(), dismiss: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ retryInput: fx.retry, dismissInput: fx.dismiss, notify: vi.fn() }) } }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { shell: { logError: vi.fn() } } }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars: Record<string, unknown> = {}) => ((fx.locale === "zh" ? zhCN : en)[key as keyof typeof zhCN] ?? key).replace(/\{(\w+)\}/g, (whole, name) => name in vars ? String(vars[name]) : whole) }) }));
vi.mock("../src/renderer/src/lib/time", () => ({ useNow: () => 0 }));
import { InputStatus } from "../src/renderer/src/components/InputStatus";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>, el: HTMLDivElement;
beforeEach(() => { fx.retry.mockReset(); fx.dismiss.mockReset(); fx.locale = "zh"; el = document.createElement("div"); document.body.append(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });
const draw = (patch: Parameters<typeof record>[1]) => act(() => root.render(h(InputStatus, { record: record("notice-1", patch), sessionId: "session-1" })));
describe("owner-facing input status wording", () => {
  it.each(["zh", "en"] as const)("%s: native request uncertainty is not recipient unavailability, with only offered actions", locale => {
    fx.locale = locale;
    draw({ kind: "systemNotice", state: "waiting", reason: "nativeHeld", details: { nativeReason: "request_uncertain" }, actions: ["dismiss"] });
    const catalog = locale === "zh" ? zhCN : en;
    expect(el.textContent).toContain(catalog["inputLedger.record.uncertain"]);
    expect(el.textContent).not.toContain(catalog["inputLedger.record.nativeHeld"]);
    expect(el.textContent).not.toContain("request_uncertain");
    expect(el.querySelector(".text-warn-text")).toBeTruthy();
    expect(el.querySelector('[data-testid="input-status"]')?.getAttribute("data-state")).toBe("waiting");
    expect([...el.querySelectorAll("[title]")].some(node => node.getAttribute("title")?.includes("request_uncertain"))).toBe(true);
    expect([...el.querySelectorAll("button")].map(node => node.textContent)).toEqual([catalog["inputLedger.dismiss"]]);
  });
  it.each(["zh", "en"] as const)("%s: passive status notifications wait to be read and ignore only the notification", async locale => {
    fx.locale = locale;
    draw({ kind: "delegationStatus", state: "waiting", reason: "passive", askId: "ask-b0", actions: ["dismiss"] });
    const catalog = locale === "zh" ? zhCN : en;
    expect(el.textContent).toContain(locale === "zh" ? "待读取" : "Waiting to be read");
    expect(el.querySelector("[title]")?.getAttribute("title")).toBe(catalog["inputLedger.record.passive"]);
    expect([...el.querySelectorAll("button")].map(node => node.textContent)).toEqual([locale === "zh" ? "忽略此通知" : "Ignore notification"]);
    await act(async () => el.querySelector<HTMLButtonElement>("button")!.click());
    expect(fx.dismiss).toHaveBeenCalledExactlyOnceWith("session-1", "notice-1", undefined);
    expect(fx.retry).not.toHaveBeenCalled();
    draw({ kind: "delegationStatus", state: "waiting", reason: "passive", actions: [] });
    expect(el.querySelector("button")).toBeNull();
    draw({ kind: "agentMessage", state: "waiting", reason: "passive", actions: ["dismiss"] });
    expect(el.querySelector("button")?.textContent).toBe(catalog["inputLedger.dismiss"]);
  });
  it("true uncertain records keep the server-offered retry and dismiss actions", () => {
    draw({ kind: "systemNotice", state: "uncertain", reason: "outcomeUnknown", actions: ["retry", "dismiss"] });
    expect(el.textContent).toContain("不确定是否送达");
    expect([...el.querySelectorAll("button")].map(node => node.textContent)).toEqual([zhCN["inputLedger.retry"], zhCN["inputLedger.dismiss"]]);
  });
  it.each(INPUT_WAITING_REASONS)("known waiting %s uses a human label in text and tooltip", reason => {
    draw({ state: "waiting", reason, details: { nativeReason: "context_missing" }, actions: [] });
    const label = el.querySelector('[data-testid="input-status"] > span')!;
    expect(label.textContent).toBeTruthy();
    expect(label.getAttribute("title")).toBe(label.textContent);
    expect(label.getAttribute("title")).not.toContain(reason);
    expect(el.textContent).not.toContain("context_missing");
  });
  it.each(["delegationLease", "nativeHeld"] as const)("stalled waiting %s uses its localized explanation instead of a diagnostic code", reason => {
    draw({ state: "waiting", reason, details: { nativeReason: "request_uncertain" }, stalled: { since: "2026-11-01T00:00:00Z", reason: "noProgress" }, actions: ["dismiss"] });
    expect(el.textContent).not.toContain("noProgress");
    expect([...el.querySelectorAll("[title]")].some(node => node.getAttribute("title")?.includes("noProgress"))).toBe(false);
    expect(el.textContent).toContain(reason === "nativeHeld" ? "不确定是否送达" : "等当前委托做完");
  });
  it("delegation waiting says what it is waiting for, instead of presenting another work status", () => {
    draw({ state: "waiting", reason: "delegationLease", actions: [] });
    expect(el.textContent).toBe("等当前委托做完");
    expect(el.querySelector("[title]")?.getAttribute("title")).toBe("等当前委托做完");
  });
});
