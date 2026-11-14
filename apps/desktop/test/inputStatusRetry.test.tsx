// @vitest-environment jsdom
// The owner's view of a resend that did not go out, of a note whose carrier was interrupted, and of a long wait.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InputRecord } from "@cutex-desktop/protocol";
import { InputStatus } from "../src/renderer/src/components/InputStatus";
import { bridge } from "../src/renderer/src/bridge";
import { emptyInputLedgerSession } from "../src/renderer/src/lib/inputLedger/alignment";
import { stalledMinutes } from "../src/renderer/src/lib/inputLedger/labels";
import { projectNextUp } from "../src/renderer/src/lib/inputLedger/nextUpRegistry";
import { retryRefusal } from "../src/renderer/src/lib/inputLedger/owner";
import { iso, record, T0 } from "../src/renderer/src/lib/inputLedger/testkit";
import { viewKey } from "../src/renderer/src/lib/viewKey";
import { INPUT_LEDGER_FEATURE } from "../src/renderer/src/lib/deliveryMode";
import { translate } from "../src/renderer/src/i18n";
import { useApp } from "../src/renderer/src/store";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

vi.mock("../src/renderer/src/i18n", async (original) => {
  const { zhCN: strings } = await import("../src/renderer/src/i18n/zh-CN");
  const t = (key: keyof typeof strings, vars: Record<string, unknown> = {}) => strings[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name]));
  return { ...await original<object>(), useI18n: () => ({ t, locale: "zh-CN" }) };
});

const SESSION = "cutex.s1";
let root: Root | null = null;
let before: ReturnType<typeof useApp.getState>;

function render(input: InputRecord): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(h(InputStatus, { record: input, sessionId: SESSION, hostId: "local" })));
  return host;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  before = useApp.getState();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  useApp.setState(before, true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const stranded = (patch: Partial<InputRecord> = {}) => record("m1", {
  state: "waiting", reason: "ownerRetry", surface: "nextUp", since: iso(T0), actions: ["retry", "dismiss"],
  stalled: { reason: "noProgress", since: iso(T0 + 8 * 60_000) }, ...patch,
});

it("nativeHeld{interrupted} does not claim the recipient temporarily cannot receive", () => {
  const note = record("n1", { kind: "agentMessage", state: "waiting", reason: "nativeHeld", surface: "nextUp", actions: ["dismiss"], details: { nativeReason: "interrupted" } });
  expect(projectNextUp(note)).toMatchObject({ kind: "state", state: "unconfirmed" });
  const host = render(note);
  expect(host.querySelector("[data-testid=input-status]")?.textContent).toContain(zhCN["nextUp.state.unconfirmed"]);
  // A real hold (plan mode) needs the owner.
  expect(projectNextUp(record("n2", { kind: "agentMessage", state: "waiting", reason: "nativeHeld", details: { nativeReason: "plan_mode" } }))).toMatchObject({ state: "needsAction" });
});

it("a stranded resend says it is unsure, not waiting to send, and the wait is the whole wait without repeating the label", () => {
  vi.useFakeTimers({ now: T0 + 8 * 60_000 + 5_000 });
  const row = stranded();
  expect(projectNextUp(row)).toMatchObject({ kind: "state", state: "unconfirmed" });
  expect(projectNextUp(stranded({ stalled: null, actions: [] }))).toMatchObject({ state: "sending" });
  expect(stalledMinutes(row, Date.now())).toBe(8);
  const text = render(row).textContent ?? "";
  expect(text).toContain("已等 8 分钟");
  expect(text.split(zhCN["nextUp.state.unconfirmed"]).length, text).toBe(2);
});

it("retryRefusal reads the redelivery the call answered with", () => {
  expect(retryRefusal({ redelivery: { ok: true } })).toBeNull();
  expect(retryRefusal(record("mock"))).toBeNull();
  expect(retryRefusal(undefined)).toBeNull();
  expect(retryRefusal({ redelivery: { ok: false, error: { code: "user_input_in_progress", details: {} } } })).toEqual({ code: "user_input_in_progress", nothingSent: true, offline: false, onlyDismiss: false });
  expect(retryRefusal({ redelivery: { ok: false, error: { code: "retry_payload_unavailable", details: { nothingSent: true } } } })).toEqual({ code: "retry_payload_unavailable", nothingSent: true, offline: false, onlyDismiss: false });
  expect(retryRefusal({ redelivery: { ok: false, error: { code: "bus_redrive_failed", details: {} } } })).toEqual({ code: "bus_redrive_failed", nothingSent: false, offline: false, onlyDismiss: false });
  expect(retryRefusal({ redelivery: { ok: false, error: { code: "user_input_in_progress", details: { retryCannotHelp: true } } } })).toEqual({ code: "user_input_in_progress", nothingSent: true, offline: false, onlyDismiss: true });
  expect(retryRefusal({ redelivery: { ok: false, error: { code: "app_server_unavailable", details: {} } } })).toEqual({ code: "app_server_unavailable", nothingSent: true, offline: true, onlyDismiss: false });
});

it("a refused resend shows the owner an error that says nothing was sent", async () => {
  const row = record("m1", { state: "uncertain", reason: "outcomeUnknown", surface: "nextUp", rev: 8, actions: ["retry", "dismiss"] });
  const session = { ...emptyInputLedgerSession(), generation: 1, epoch: "e", rev: 8, records: new Map([["m1", row]]) };
  const notify = vi.fn();
  useApp.setState({ features: new Set([INPUT_LEDGER_FEATURE]), inputs: { [viewKey("local", SESSION)]: session }, notify } as never);
  const retry = vi.spyOn(bridge.api, "inputRetry").mockResolvedValue({
    ledgerEpoch: "e", stateRevision: 9, record: row,
    redelivery: { path: "ownerResubmit", ok: false, error: { code: "user_input_in_progress", message: "nothing was sent", retryable: true, details: { nothingSent: true } } },
  });
  vi.spyOn(bridge.api, "inputGet").mockResolvedValue({ ledgerEpoch: "e", stateRevision: 9, records: [row], missing: [] });
  const host = render(row);
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === zhCN["inputLedger.retry"])!;
  await act(async () => { button.click(); });
  expect(retry).toHaveBeenCalledWith(SESSION, "m1", 8);
  expect(notify).toHaveBeenCalledWith(translate("inputLedger.retryNothingSent"), "error", { hostId: "local", sessionId: SESSION });
  // The row keeps its actions.
  expect([...host.querySelectorAll("button")].map(item => item.textContent)).toContain(zhCN["inputLedger.retry"]);
});

it("a resend refused because the runtime is away says nothing was sent, not a raw code", async () => {
  const row = record("m1", { state: "uncertain", reason: "runtimeLost", surface: "nextUp", rev: 8, actions: ["retry", "dismiss"] });
  const session = { ...emptyInputLedgerSession(), generation: 1, epoch: "e", rev: 8, records: new Map([["m1", row]]) };
  const notify = vi.fn();
  useApp.setState({ features: new Set([INPUT_LEDGER_FEATURE]), inputs: { [viewKey("local", SESSION)]: session }, notify } as never);
  vi.spyOn(bridge.api, "inputRetry").mockResolvedValue({
    ledgerEpoch: "e", stateRevision: 9, record: row,
    redelivery: { path: "ownerResubmit", ok: false, error: { code: "app_server_unavailable", message: "unavailable", retryable: true, details: {} } },
  });
  vi.spyOn(bridge.api, "inputGet").mockResolvedValue({ ledgerEpoch: "e", stateRevision: 9, records: [row], missing: [] });
  const host = render(row);
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === zhCN["inputLedger.retry"])!;
  await act(async () => { button.click(); });
  expect(notify).toHaveBeenCalledWith(translate("inputLedger.retryNothingSentOffline"), "error", { hostId: "local", sessionId: SESSION });
  expect(notify.mock.calls[0]?.[0]).not.toContain("app_server_unavailable");
  expect(zhCN["inputLedger.retryNothingSentOffline"]).toContain("没有发出去");
});

it("a refusal no later resend can change says the owner can only dismiss, not to try later", async () => {
  const row = record("m1", { state: "uncertain", reason: "outcomeUnknown", surface: "nextUp", rev: 8, actions: ["retry", "dismiss"] });
  const session = { ...emptyInputLedgerSession(), generation: 1, epoch: "e", rev: 8, records: new Map([["m1", row]]) };
  const notify = vi.fn();
  useApp.setState({ features: new Set([INPUT_LEDGER_FEATURE]), inputs: { [viewKey("local", SESSION)]: session }, notify } as never);
  vi.spyOn(bridge.api, "inputRetry").mockResolvedValue({
    ledgerEpoch: "e", stateRevision: 9, record: row,
    redelivery: { path: "ownerResubmit", ok: false, error: { code: "user_input_in_progress", message: "unresolved", retryable: true, details: { nothingSent: true, retryCannotHelp: true } } },
  });
  vi.spyOn(bridge.api, "inputGet").mockResolvedValue({ ledgerEpoch: "e", stateRevision: 9, records: [row], missing: [] });
  const host = render(row);
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === zhCN["inputLedger.retry"])!;
  await act(async () => { button.click(); });
  expect(notify).toHaveBeenCalledWith(translate("inputLedger.retryNothingSentOnlyDismiss"), "error", { hostId: "local", sessionId: SESSION });
  expect(zhCN["inputLedger.retryNothingSentOnlyDismiss"]).toContain("只能放弃");
  expect(zhCN["inputLedger.retryNothingSentOnlyDismiss"]).not.toContain("稍后再试");
});

it("the new strings exist in zh-CN and en", () => {
  for (const key of ["inputLedger.stalledFor", "inputLedger.retryNothingSent", "inputLedger.retryFailed", "inputLedger.retryNothingSentOffline", "inputLedger.retryNothingSentOnlyDismiss"] as const) {
    expect(zhCN[key]).toBeTruthy();
    expect(en[key]).toBeTruthy();
  }
  expect(en["inputLedger.retryNothingSent"]).toContain("Nothing was sent");
});
