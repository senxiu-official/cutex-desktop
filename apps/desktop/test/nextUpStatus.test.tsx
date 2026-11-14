// @vitest-environment jsdom
// InputStatus draws only from the Next Up registry: the state label (i18n by state key), the meaning as tooltip, the
// registered buttons (working, or grey with a reason), and the store's explicit results. Replaces the old per-reason
// wording tests (inputStatusLabels / inputStatusInterruptSend) retired with registry 1.5.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INPUT_WAITING_REASONS, type InputRecord } from "@cutex-desktop/protocol";
import { record } from "../src/renderer/src/lib/inputLedger/testkit";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { NEXT_UP_STATES, NEXT_UP_EFFECTS, RETIRED_WORDS, projectNextUp, DISABLED_REASONS } from "../src/renderer/src/lib/inputLedger/nextUpRegistry";

const fx = vi.hoisted(() => ({ locale: "zh-CN", retry: vi.fn(), dismiss: vi.fn(), interrupt: vi.fn(), hold: vi.fn(), notify: vi.fn(), log: vi.fn(), refresh: vi.fn() }));
const LEDGER = new Set(["input-ledger-v1"]);
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const useApp = create(() => ({ inputs: {}, ledgerOwnerDrafts: {}, hosts: { active: "local" }, byHost: {},
    retryInput: fx.retry, dismissInput: fx.dismiss, interruptSendInput: fx.interrupt, holdInput: fx.hold, notify: fx.notify, refreshInputs: fx.refresh, refreshApprovalsOn: () => {} }));
  return { useApp, agentState: (map: Record<string, unknown>, host: string, session: string) => map?.[host + "\n" + session], featuresOf: () => LEDGER, hostData: () => null, selectedFeatures: () => LEDGER, agentHost: () => "local" };
});
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { shell: { logError: fx.log } }, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: fx.locale, t: (key: string, vars: Record<string, unknown> = {}) => ((fx.locale.startsWith("zh") ? zhCN : en)[key as keyof typeof zhCN] ?? key).replace(/\{(\w+)\}/g, (whole, name) => name in vars ? String(vars[name]) : whole) }) }));
vi.mock("../src/renderer/src/lib/time", () => ({ useNow: () => Date.parse("2026-11-14T00:00:00Z") }));
import { InputStatus } from "../src/renderer/src/components/InputStatus";
import { resetTombstonesForTest } from "../src/renderer/src/lib/inputLedger/nextUpTombstones";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot>, el: HTMLDivElement;
beforeEach(() => {
  for (const fn of Object.values(fx)) if (typeof fn === "function") fn.mockReset();
  fx.retry.mockResolvedValue({ ok: true }); fx.dismiss.mockResolvedValue({ ok: true }); fx.interrupt.mockResolvedValue({ ok: true }); fx.hold.mockResolvedValue({ ok: true });
  fx.locale = "zh-CN"; localStorage.clear(); resetTombstonesForTest();
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });
const NOW = new Date(Date.parse("2026-11-14T00:00:00Z")).toISOString();
const draw = (patch: Partial<InputRecord>, props: Record<string, unknown> = {}) =>
  act(() => root.render(h(InputStatus, { record: record("in-1", { createdAt: NOW, since: NOW, ...patch }), sessionId: "s1", hostId: "local", ...props })));
const label = () => el.querySelector<HTMLElement>('[data-testid="next-up-label"]');
const buttons = () => [...el.querySelectorAll<HTMLButtonElement>("button")];
const effects = () => buttons().map(b => b.dataset.effect);
const button = (effect: string) => buttons().find(b => b.dataset.effect === effect)!;

describe("label and tooltip come from the registry", () => {
  it.each(INPUT_WAITING_REASONS)("waiting %s: the short label of its registry state, the meaning as tooltip, no code", reason => {
    const r = record("in-1", { state: "waiting", reason, createdAt: NOW, since: NOW, details: { nativeReason: "context_missing" } });
    const p = projectNextUp(r);
    if (p.kind !== "state") throw new Error("hidden");
    draw(r);
    expect(el.querySelector('[data-testid="input-status"]')?.getAttribute("data-next-up-state")).toBe(p.state);
    expect(label()!.textContent).toBe(zhCN[`nextUp.state.${p.state === "afterWork" ? "afterWork.untimed" : p.state}` as keyof typeof zhCN]);
    expect(label()!.dataset.tip).toBe(NEXT_UP_STATES[p.state].meaning.zh);
    expect(el.textContent).not.toContain(reason);
    expect(el.textContent).not.toContain("context_missing");
    for (const word of RETIRED_WORDS) expect(el.textContent).not.toContain(word);
  });
  it.each([["zh-CN", "zh"], ["en", "en"]] as const)("%s: effect words follow the owner's language", (locale, lang) => {
    fx.locale = locale;
    draw({ kind: "agentMessage", state: "uncertain", reason: "outcomeUnknown", actions: ["retry", "dismiss"] });
    expect(buttons().map(b => b.textContent)).toEqual([NEXT_UP_EFFECTS.retry.label[lang], NEXT_UP_EFFECTS.dismiss.label[lang], NEXT_UP_EFFECTS.viewReason.label[lang]]);
    expect(button("retry").dataset.tip).toBe(NEXT_UP_EFFECTS.retry.tip[lang]);
    expect(button("dismiss").dataset.tip).toBe(NEXT_UP_EFFECTS.dismiss.tip[lang]);
  });
  it("an unsure native send reads unconfirmed (not needs-you), raw reason only in the details", async () => {
    draw({ kind: "systemNotice", state: "waiting", reason: "nativeHeld", details: { nativeReason: "request_uncertain" }, actions: ["dismiss"] });
    expect(el.querySelector('[data-testid="input-status"]')?.getAttribute("data-next-up-state")).toBe("unconfirmed");
    expect(el.textContent).not.toContain("request_uncertain");
    await act(async () => button("viewReason").click());
    expect(document.querySelector("[data-next-up-details]")?.textContent).toContain("request_uncertain");
  });
});

describe("input-disposal-v1 (registry 1.9)", () => {
  it("an owner queue row's 删除 goes to dismissInput (dispose), not the old queue remove; an older host keeps the old path", async () => {
    const oldRemove = vi.fn();
    const owner = { kind: "owner" as const, state: "waiting" as const, reason: "explicitQueue" as const, actions: ["cancel", "sendNow", "edit", "dismiss"] as InputRecord["actions"] };
    // Older host: the revisioned queue remove the caller passes.
    draw(owner, { handlers: { remove: oldRemove }, ctx: { queueItem: true } });
    expect(effects()).toContain("remove");
    await act(async () => button("remove").click());
    expect(oldRemove).toHaveBeenCalledTimes(1);
    expect(fx.dismiss).not.toHaveBeenCalled();
    // input-disposal-v1: same word 删除, routed to dismissInput (which disposes by id), even before the queue item loads.
    LEDGER.add("input-disposal-v1");
    try {
      oldRemove.mockReset();
      draw(owner, { handlers: { remove: oldRemove }, ctx: { queueItem: false } });
      expect(button("remove").textContent).toBe(NEXT_UP_EFFECTS.remove.label.zh);
      expect(button("remove").disabled).toBe(false);
      await act(async () => button("remove").click());
      expect(oldRemove).not.toHaveBeenCalled();
      expect(fx.dismiss).toHaveBeenCalledExactlyOnceWith("s1", "in-1", "local");
    } finally { LEDGER.delete("input-disposal-v1"); }
  });
  it("a pending dispose greys the row's changing buttons with 'working on it'; details stay usable; no new state", async () => {
    const { useApp } = await import("../src/renderer/src/store");
    const r = { kind: "agentMessage" as const, state: "waiting" as const, reason: "turnRunning" as const, actions: ["dismiss", "hold"] as InputRecord["actions"] };
    draw(r);
    const before = el.querySelector('[data-testid="input-status"]')?.getAttribute("data-next-up-state");
    expect(button("dismiss").disabled).toBe(false);
    act(() => useApp.setState({ inputDisposals: { ["local\ns1"]: { "in-1": { inputId: "in-1", cutexSessionId: "s1", dispositionId: "d", requestedAt: NOW, appliedAt: null, effect: "stop" } } } } as never));
    draw(r);
    expect(el.querySelector('[data-testid="input-status"]')?.getAttribute("data-next-up-state")).toBe(before);
    for (const effect of ["dismiss", "hold"]) {
      expect(button(effect).disabled, effect).toBe(true);
      expect(button(effect).dataset.disabledReason).toBe("pending");
      expect(button(effect).dataset.tip).toBe(DISABLED_REASONS.pending.zh);
    }
    act(() => useApp.setState({ inputDisposals: {} } as never));
  });
});

describe("timeline rows", () => {
  it.each(["agentMessage", "peerMessage", "delegationResult"] as const)("%s: plain accepted on the timeline draws only a screen-reader word", kind => {
    draw({ kind, state: "accepted", surface: "timeline", actions: [] }, { timeline: true });
    const status = el.querySelector<HTMLElement>('[data-testid="input-status"]')!;
    expect(status.className).toBe("sr-only");
    draw({ kind, state: "inContext", surface: "timeline", actions: [] }, { timeline: true });
    expect(el.querySelector('[data-testid="input-status"]')?.className).toBe("sr-only");
  });
  it("uncertain / failed / waiting on the timeline show their state and every disposal", () => {
    for (const [state, reason] of [["uncertain", "receiptTimeout"], ["failed", "notDelivered"]] as const) {
      draw({ kind: "agentMessage", state, reason, surface: "timeline", actions: [] }, { timeline: true });
      expect(label()).toBeTruthy();
      expect(effects()).toContain("dismiss");
    }
  });
});

describe("buttons: registered, working or grey with a reason", () => {
  it("Claude Task notice: Resend notice says only the notice is sent again; Ignore this notice dismisses", async () => {
    draw({ kind: "systemNotice", state: "uncertain", reason: "outcomeUnknown", sender: { kind: "claudeTask", id: "t", name: "Claude Task", host: null, cutexSessionId: null }, actions: ["retry", "dismiss"], details: { retryEffect: "redeliverNotice", mayArriveTwice: true, taskRestartsOnRetry: false } });
    expect(effects()).toEqual(["retryNotice", "ignoreNotice", "viewReason"]);
    expect(button("retryNotice").dataset.tip).toBe(NEXT_UP_EFFECTS.retryNotice.tip.zh);
    await act(async () => button("retryNotice").click());
    expect(fx.retry).toHaveBeenCalledWith("s1", "in-1", "local");
    await act(async () => button("ignoreNotice").click());
    expect(fx.dismiss).toHaveBeenCalledWith("s1", "in-1", "local");
  });
  it("interruptSend works only when the host offers it; otherwise it stays, grey, with a reason", () => {
    draw({ kind: "owner", state: "waiting", reason: "afterTurn", surface: "nextUp", actions: ["interruptSend", "dismiss"] });
    expect(button("interruptSend").disabled).toBe(false);
    draw({ kind: "owner", state: "waiting", reason: "afterTurn", surface: "nextUp", actions: [] });
    expect(button("interruptSend").disabled).toBe(true);
    expect(button("interruptSend").dataset.disabledReason).toBe("notOffered");
    expect(button("dismiss").disabled).toBe(true);
  });
  it("read-only: actions are grey (readOnly), looking stays possible", () => {
    draw({ kind: "agentMessage", state: "uncertain", reason: "outcomeUnknown", actions: ["retry", "dismiss"] }, { readOnly: true });
    expect(button("retry").dataset.disabledReason).toBe("readOnly");
    expect(button("dismiss").dataset.disabledReason).toBe("readOnly");
    expect(button("viewReason").disabled).toBe(false);
  });
  it("a rapid double-click runs once; all buttons wait for the result", async () => {
    let resolve!: (v: unknown) => void;
    fx.interrupt.mockImplementation(() => new Promise(done => { resolve = done; }));
    draw({ kind: "owner", state: "waiting", reason: "afterTurn", surface: "nextUp", actions: ["interruptSend", "dismiss"] });
    act(() => { button("interruptSend").click(); button("interruptSend").click(); });
    expect(fx.interrupt).toHaveBeenCalledExactlyOnceWith("s1", "in-1", "local");
    expect(buttons().every(b => b.disabled)).toBe(true);
    await act(async () => resolve({ ok: true }));
    expect(button("interruptSend").disabled).toBe(false);
  });
});

describe("failures never leave a row without a way out", () => {
  const row = { kind: "agentMessage" as const, state: "uncertain" as const, reason: "outcomeUnknown" as const, actions: ["retry", "dismiss"] as InputRecord["actions"] };
  it.each([
    ["busy / RPC throws", () => fx.dismiss.mockRejectedValue(new Error("host_busy"))],
    ["conflict (record changed)", () => fx.dismiss.mockResolvedValue({ ok: false, reason: "changed" })],
    ["HTTP 200 with failed[] (refused)", () => fx.dismiss.mockResolvedValue({ ok: false, reason: "refused" })],
    ["payload expired (gone)", () => fx.dismiss.mockResolvedValue({ ok: false, reason: "gone" })],
  ])("%s: says so, and the disposal is enabled again", async (_name, arrange) => {
    arrange();
    draw(row);
    await act(async () => button("dismiss").click());
    expect(button("dismiss").disabled).toBe(false);
    expect(el.querySelector('[data-testid="input-status"]')).toBeTruthy();
  });
  it("a refusal other than refused/gone is told to the owner in plain words", async () => {
    fx.dismiss.mockResolvedValue({ ok: false, reason: "notOffered" });
    draw(row);
    await act(async () => button("dismiss").click());
    expect(fx.notify).toHaveBeenCalledOnce();
    expect(String(fx.notify.mock.calls[0]![0])).not.toMatch(/notOffered|_/);
  });
  it("an RPC that never resolves keeps the row and its other buttons visible (pending, not gone)", async () => {
    fx.dismiss.mockImplementation(() => new Promise(() => {}));
    draw(row);
    act(() => button("dismiss").click());
    expect(effects()).toEqual(["retry", "dismiss", "viewReason"]);
    expect(el.querySelector('[data-testid="next-up-label"]')).toBeTruthy();
  });
});

describe("state unknown (14)", () => {
  it("plain words, Refresh / View details / Clear this notice; clearing is durable and only for this exact status", async () => {
    const odd = { kind: "agentMessage" as const, state: "waiting" as const, reason: "futureReason" as never, actions: [] };
    draw(odd);
    expect(label()!.textContent).toBe(zhCN["nextUp.state.unknown"]);
    expect(el.textContent).not.toContain("futureReason");
    expect(fx.log).toHaveBeenCalledOnce();
    expect(effects()).toEqual(["refresh", "viewDetails", "clearNotice"]);
    await act(async () => button("refresh").click());
    expect(fx.refresh).toHaveBeenCalledWith("s1", "local");
    await act(async () => button("clearNotice").click());
    expect(el.querySelector('[data-testid="input-status"]')).toBeNull();
    // After a reload (memory dropped, storage kept) it stays cleared.
    act(() => root.unmount()); root = createRoot(el); resetTombstonesForTest();
    draw(odd);
    expect(el.querySelector('[data-testid="input-status"]')).toBeNull();
    // Another status from the host brings the row back with what it says now.
    draw({ ...odd, reason: "explicitQueue" });
    expect(el.querySelector('[data-testid="input-status"]')).toBeTruthy();
  });
});

describe("review fixes 2026-11-14", () => {
  it("a countdown / hold overlay never turns an unknown status into another state", () => {
    const odd = { kind: "agentMessage" as const, state: "waiting" as const, reason: "futureReason" as never, actions: ["dismiss"] as InputRecord["actions"] };
    draw(odd, { override: { state: "afterWork", variant: "timed", time: "1:00", symbol: h("svg", { "data-ring": "" }), addOn: h("span", null, "add-on") } });
    expect(el.querySelector('[data-testid="input-status"]')?.getAttribute("data-next-up-state")).toBe("unknown");
    expect(effects()).toEqual(["refresh", "viewDetails", "clearNotice"]);
    expect(el.querySelector("[data-ring]")).toBeNull();
    expect(el.textContent).not.toContain("add-on");
  });
  it("a failed call is told in plain words; the raw code only in the details and the log", async () => {
    fx.dismiss.mockRejectedValue(new Error("dismiss_failed: result admission busy; try again"));
    draw({ kind: "agentMessage", state: "uncertain", reason: "outcomeUnknown", actions: ["retry", "dismiss"] });
    await act(async () => button("dismiss").click());
    expect(fx.notify).toHaveBeenCalledOnce();
    expect(String(fx.notify.mock.calls[0]![0])).not.toMatch(/dismiss_failed|busy|_/);
    expect(fx.log).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("dismiss_failed") }));
    await act(async () => button("viewReason").click());
    expect(document.querySelector("[data-next-up-details]")?.textContent).toContain("dismiss_failed");
  });
  it("ⓘ only on passiveNote, afterWork timed, unconfirmed and needsAction; every label explains its state on hover", () => {
    const cases: [Partial<InputRecord>, Record<string, unknown>, boolean][] = [
      [{ kind: "agentMessage", state: "waiting", reason: "passive", surface: "pendingNotes" }, {}, true],
      [{ kind: "agentMessage", state: "waiting", reason: "turnRunning" }, { override: { state: "afterWork", variant: "timed", time: "1:00" } }, true],
      [{ kind: "agentMessage", state: "waiting", reason: "turnRunning" }, { override: { variant: "untimed" } }, false],
      [{ kind: "agentMessage", state: "uncertain", reason: "outcomeUnknown" }, {}, true],
      [{ kind: "agentMessage", state: "waiting", reason: "staleHeld" }, {}, true],
      [{ kind: "agentMessage", state: "waiting", reason: "agentOffline" }, {}, false],
      [{ kind: "agentMessage", state: "failed", reason: "notDelivered" }, {}, false],
    ];
    for (const [patch, props, icon] of cases) {
      draw(patch, props);
      expect(!!el.querySelector("[data-testid=next-up-info]"), JSON.stringify(patch)).toBe(icon);
      expect(label()!.dataset.tip, JSON.stringify(patch)).toBeTruthy();
    }
  });
});
