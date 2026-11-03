// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { record } from "../src/renderer/src/lib/inputLedger/testkit";
const calls = vi.hoisted(() => ({ interrupt: vi.fn(), retry: vi.fn(), dismiss: vi.fn(), notify: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ interruptSendInput: calls.interrupt, retryInput: calls.retry, dismissInput: calls.dismiss, notify: calls.notify }) } }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { shell: { logError: vi.fn() } } }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/time", () => ({ useNow: () => 0 }));
import { InputStatus } from "../src/renderer/src/components/InputStatus";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let el: HTMLDivElement;
const offered = () => record("owner-1", { state: "waiting", reason: "explicitQueue", surface: "nextUp", actions: ["interruptSend", "retry", "dismiss"] });
const button = () => [...el.querySelectorAll("button")].find(node => node.textContent === "steer.interruptSend");
beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset();
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });
describe("InputStatus server-offered interrupt-and-send", () => {
  it("renders only the offered action without deriving legality from state, turn or history", () => {
    act(() => root.render(h(InputStatus, { record: record("owner-1", { state: "waiting", reason: "hostBusy", surface: "nextUp", actions: [] }), sessionId: "cutex.s1" })));
    expect(button()).toBeUndefined();
    // The store checks authoritative turn/generation; this component only uses actions.
    act(() => root.render(h(InputStatus, { record: offered(), sessionId: "cutex.s1" })));
    expect(button()).toBeTruthy(); expect(button()!.disabled).toBe(false);
    act(() => root.render(h(InputStatus, { record: { ...offered(), actions: [] }, sessionId: "cutex.s1" })));
    expect(button()).toBeUndefined();
  });
  it("hides all controls in a read-only surface including interruptSend", () => {
    act(() => root.render(h(InputStatus, { record: offered(), sessionId: "cutex.s1", hostId: "remote", readOnly: true })));
    expect(el.querySelectorAll("button")).toHaveLength(0);
    expect(calls.interrupt).not.toHaveBeenCalled();
  });
  it("calls the scoped store action once for a rapid double-click and awaits authoritative state", async () => {
    let resolve!: () => void;
    calls.interrupt.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const input = Object.freeze(offered());
    act(() => root.render(h(InputStatus, { record: input, sessionId: "cutex.s1", hostId: "remote" })));
    const before = el.textContent;
    act(() => { button()!.click(); button()!.click(); });
    expect(calls.interrupt).toHaveBeenCalledExactlyOnceWith("cutex.s1", "owner-1", "remote");
    expect([...el.querySelectorAll("button")].every(node => node.disabled)).toBe(true);
    expect(el.querySelector('[data-testid="input-status"]')?.getAttribute("data-state")).toBe("waiting");
    expect(el.textContent).toBe(before);
    await act(async () => resolve());
    expect(button()!.disabled).toBe(false); expect(input.state).toBe("waiting");
    expect(calls.retry).not.toHaveBeenCalled(); expect(calls.dismiss).not.toHaveBeenCalled();
  });
  it.each(["remote", undefined])("reports refusal to host %s, restores controls and leaves record unchanged", async hostId => {
    let reject!: (error: Error) => void;
    calls.interrupt.mockImplementation(() => new Promise<void>((_done, fail) => { reject = fail; }));
    const input = offered();
    act(() => root.render(h(InputStatus, { record: input, sessionId: "cutex.s1", hostId })));
    act(() => button()!.click()); expect(button()!.disabled).toBe(true);
    await act(async () => reject(Error("input_revision_conflict")));
    expect(calls.interrupt).toHaveBeenCalledExactlyOnceWith("cutex.s1", "owner-1", hostId);
    expect(calls.notify).toHaveBeenCalledExactlyOnceWith("Error: input_revision_conflict", "error", { hostId: hostId ?? "local", sessionId: "cutex.s1" });
    expect(button()!.disabled).toBe(false);
    expect(input).toMatchObject({ state: "waiting", reason: "explicitQueue", surface: "nextUp" });
  });
});
