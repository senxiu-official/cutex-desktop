// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INPUT_WAITING_REASONS } from "@cutex-desktop/protocol";
import { record } from "../src/renderer/src/lib/inputLedger/testkit";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
const fx = vi.hoisted(() => ({ locale: "zh" as "zh" | "en", retry: vi.fn(), dismiss: vi.fn(), interrupt: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ retryInput: fx.retry, dismissInput: fx.dismiss, interruptSendInput: fx.interrupt, notify: vi.fn() }) } }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { shell: { logError: vi.fn() } } }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars: Record<string, unknown> = {}) => ((fx.locale === "zh" ? zhCN : en)[key as keyof typeof zhCN] ?? key).replace(/\{(\w+)\}/g, (whole, name) => name in vars ? String(vars[name]) : whole) }) }));
vi.mock("../src/renderer/src/lib/time", () => ({ useNow: () => 0 }));
import { InputStatus } from "../src/renderer/src/components/InputStatus";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>, el: HTMLDivElement;
beforeEach(() => { fx.retry.mockReset(); fx.dismiss.mockReset(); fx.interrupt.mockReset(); fx.locale = "zh"; el = document.createElement("div"); document.body.append(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });
const draw = (patch: Parameters<typeof record>[1], timeline = false) => act(() => root.render(h(InputStatus, { record: record("notice-1", patch), sessionId: "session-1", timeline })));
describe("owner-facing input status wording", () => {
  it.each(["agentMessage", "peerMessage", "delegationResult"] as const)("%s: plain 已接收 draws nothing on a timeline row, only a screen-reader label", kind => {
    draw({ kind, state: "accepted", surface: "timeline", actions: [] }, true);
    const status = el.querySelector<HTMLElement>('[data-testid="input-status"]')!;
    expect(status.className).toBe("sr-only");
    expect(status.getAttribute("data-state")).toBe("accepted");
    expect(status.textContent).toBe(zhCN["inputLedger.record.accepted"]);
    expect(el.children).toHaveLength(1);
    draw({ kind, state: "inContext", surface: "timeline", actions: [] }, true);
    expect(el.querySelector('[data-testid="input-status"]')?.className).toBe("sr-only");
  });
  it("a silent timeline 已接收 still shows what the owner can act on or should know", () => {
    draw({ kind: "agentMessage", state: "accepted", surface: "timeline", actions: ["dismiss"] }, true);
    expect(el.querySelector('[data-testid="input-status"]')?.className).not.toBe("sr-only");
    expect(el.textContent).toBe(zhCN["inputLedger.dismiss"]);
    draw({ kind: "agentMessage", state: "accepted", surface: "timeline", stalled: { reason: "noProgress", since: "2026-11-03T10:10:44.887Z" }, actions: [] }, true);
    expect(el.textContent).not.toContain(zhCN["inputLedger.record.accepted"]);
    expect(el.textContent).toContain("noProgress");
    draw({ kind: "agentMessage", state: "accepted", surface: "pendingNotes", actions: [] }, true);
    expect(el.textContent).toBe(zhCN["inputLedger.record.unread"]);
    for (const state of ["uncertain", "failed", "rejected", "waiting"] as const) {
      draw({ kind: "agentMessage", state, reason: state === "uncertain" ? "receiptTimeout" : state === "failed" ? "notDelivered" : state === "rejected" ? "invalid" : "afterTurn", surface: "timeline", actions: [] }, true);
      expect(el.querySelector('[data-testid="input-status"]')?.className).not.toBe("sr-only");
      expect(el.textContent).not.toBe("");
    }
    draw({ kind: "owner", state: "accepted", surface: "timeline", turnId: "t1", actions: [] }, true);
    expect(el.textContent).toBe(zhCN["inputLedger.record.inserted"]);
  });
  it.each(["zh", "en"] as const)("%s: accepted pending notes say Unread without changing state or actions", locale => {
    fx.locale = locale;
    const catalog = locale === "zh" ? zhCN : en;
    draw({ kind: "agentMessage", state: "accepted", surface: "pendingNotes", actions: ["dismiss"] });
    expect(el.textContent).toContain(locale === "zh" ? "未读" : "Unread");
    expect(el.textContent).not.toContain(catalog["inputLedger.record.accepted"]);
    expect(el.querySelector('[data-testid="input-status"]')?.getAttribute("data-state")).toBe("accepted");
    expect([...el.querySelectorAll("button")].map(b => b.textContent)).toEqual([catalog["inputLedger.dismiss"]]);
    draw({ kind: "agentMessage", state: "accepted", surface: "timeline", actions: [] });
    expect(el.textContent).toBe(catalog["inputLedger.record.accepted"]);
  });
  it.each(["timeline", "nextUp"] as const)("preserves registered waiting text and interrupt action on server surface %s", async surface => {
    draw({ kind: "owner", state: "accepted", stage: "registered", surface, actions: ["interruptSend"] });
    expect(el.textContent).toContain(zhCN["inputLedger.record.registered"]);
    expect(el.textContent).toContain(zhCN["steer.interruptSend"]);
    await act(async () => el.querySelector<HTMLButtonElement>("button")!.click());
    expect(fx.interrupt).toHaveBeenCalledExactlyOnceWith("session-1", "notice-1", undefined);
  });
  it("keeps restart-stalled accepted owner status visible without inventing recovery actions", () => {
    draw({ kind: "owner", state: "accepted", stage: "registered", surface: "timeline", stalled: { reason: "runtimeDisconnected", since: "2026-11-03T10:10:44.887Z" }, actions: [] });
    expect(el.textContent).toContain(zhCN["inputLedger.record.registered"]);
    expect(el.querySelector("button")).toBeNull();
  });
  it.each(["zh", "en"] as const)("%s: native request uncertainty is not recipient unavailability, with only offered actions", locale => {
    fx.locale = locale;
    draw({ kind: "systemNotice", state: "waiting", reason: "nativeHeld", details: { nativeReason: "request_uncertain" }, actions: ["dismiss"] });
    const catalog = locale === "zh" ? zhCN : en;
    expect(el.textContent).toContain(catalog["inputLedger.record.uncertain"]);
    expect(el.textContent).not.toContain(catalog["inputLedger.record.nativeHeld"]);
    expect(el.textContent).not.toContain("request_uncertain");
    expect(el.querySelector(".text-warn-text")).toBeTruthy();
    expect(el.querySelector('[data-testid="input-status"]')?.getAttribute("data-state")).toBe("waiting");
    expect([...el.querySelectorAll("[data-tip]")].some(node => node.getAttribute("data-tip")?.includes("request_uncertain"))).toBe(true);
    expect([...el.querySelectorAll("button")].map(node => node.textContent)).toEqual([catalog["inputLedger.dismiss"]]);
  });
  it.each(["zh", "en"] as const)("%s: passive status notifications wait to be read and ignore only the notification", async locale => {
    fx.locale = locale;
    draw({ kind: "delegationStatus", state: "waiting", reason: "passive", askId: "ask-b0", actions: ["dismiss"] });
    const catalog = locale === "zh" ? zhCN : en;
    expect(el.textContent).toContain(locale === "zh" ? "待读取" : "Waiting to be read");
    expect(el.querySelector("[data-tip]")?.getAttribute("data-tip")).toBe(catalog["inputLedger.record.passive"]);
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
    expect(label.getAttribute("data-tip")).toBe(label.textContent);
    expect(label.getAttribute("data-tip")).not.toContain(reason);
    expect(el.textContent).not.toContain("context_missing");
  });
  it.each(["delegationLease", "nativeHeld"] as const)("stalled waiting %s uses its localized explanation instead of a diagnostic code", reason => {
    draw({ state: "waiting", reason, details: { nativeReason: "request_uncertain" }, stalled: { since: "2026-11-01T00:00:00Z", reason: "noProgress" }, actions: ["dismiss"] });
    expect(el.textContent).not.toContain("noProgress");
    expect([...el.querySelectorAll("[data-tip]")].some(node => node.getAttribute("data-tip")?.includes("noProgress"))).toBe(false);
    expect(el.textContent).toContain(reason === "nativeHeld" ? "不确定是否送达" : "等当前委托做完");
  });
  it("delegation waiting says what it is waiting for, instead of presenting another work status", () => {
    draw({ state: "waiting", reason: "delegationLease", actions: [] });
    expect(el.textContent).toBe("等当前委托做完");
    expect(el.querySelector("[data-tip]")?.getAttribute("data-tip")).toBe("等当前委托做完");
  });
});
