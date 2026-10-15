// Taking back popups once the owner handled it in the app (owner bug 2026-10-13: the big alert stayed
// up after the approval / question was answered): the triggers (lib/notifyRetract), retractNotify →
// the notifications module (keys in main's form, late deliveries stopped) → main via the shell bridge.
import { afterEach, describe, expect, it, vi } from "vitest";

const shell = vi.hoisted(() => ({ retractAlerts: vi.fn(async () => {}) }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { shell }, onEvent: () => () => {} }));

const { lookOf, retractionOfApproval, retractionOfHostEvent, retractionOfLook, startLookRetract } = await import("../src/renderer/src/lib/notifyRetract");
const { agentRetraction, retractNotify, setRetractHandler } = await import("../src/renderer/src/lib/notifyEvents");
const { noteRetract, retractMark, retractedSince, retractRequestOf, safeKey } = await import("../src/renderer/src/modules/notifications/runtime");
const { retractDelivered } = await import("../src/renderer/src/modules/notifications/methods");

const native = (method: string, params: unknown, kind = "notification") => ({ cutexSessionId: "a1", source: "native", correlation: {}, native: { kind, message: { method, params, id: 7 } } }) as never;

afterEach(() => vi.clearAllMocks());

describe("retract triggers", () => {
  it("a resolved native request names its key; a turn end every request of that agent", () => {
    expect(retractionOfHostEvent(native("serverRequest/resolved", { threadId: "t", requestId: 7 }), false)).toEqual({ keys: ["req:a1:7"] });
    expect(retractionOfHostEvent(native("serverRequest/resolved", { threadId: "t", requestId: "r-2" }), false)).toEqual({ keys: ["req:a1:r-2"] });
    expect(retractionOfHostEvent(native("serverRequest/resolved", {}), false)).toBeNull();
    expect(retractionOfHostEvent(native("turn/completed", {}), true)).toEqual({ prefixes: ["req:a1:"] });
    expect(retractionOfHostEvent(native("item/started", {}), false)).toBeNull();
    // The request itself never retracts.
    expect(retractionOfHostEvent(native("item/commandExecution/requestApproval", {}, "serverRequest"), true)).toBeNull();
  });

  it("an owner approval that left pending names its key", () => {
    expect(retractionOfApproval({ approval: { approvalId: "ap-1", state: "pending" } })).toBeNull();
    expect(retractionOfApproval({ approval: { approvalId: "ap-1", state: "approved" } })).toEqual({ keys: ["approval:ap-1"] });
    expect(retractionOfApproval(null)).toBeNull();
  });

  it("looking: an agent's conversation (focused) or the approvals page", () => {
    expect(lookOf({ selectedId: "a1", view: { kind: "conversation" } }, true)).toBe("agent:a1");
    expect(lookOf({ selectedId: "a1", view: { kind: "conversation" } }, false)).toBeNull();
    expect(lookOf({ selectedId: "a1", view: { kind: "page", page: "approvals.page" } }, true)).toBe("approvals");
    expect(lookOf({ selectedId: "a1", view: { kind: "page", page: "settings.page" } }, true)).toBeNull();
    expect(retractionOfLook("agent:a1")).toEqual(agentRetraction("a1"));
    expect(agentRetraction("a1")).toEqual({ prefixes: ["req:a1:", "turn:a1:"] });
    expect(retractionOfLook("approvals")).toEqual({ prefixes: ["approval:"] });
  });

  it("opening an agent / focusing the window on it retracts once per look", () => {
    const seen: unknown[] = [];
    const off = setRetractHandler((r) => seen.push(r));
    let state = { selectedId: null as string | null, view: { kind: "conversation" } };
    const listeners: ((s: typeof state) => void)[] = [];
    const store = { getState: () => state, subscribe: (fn: (s: typeof state) => void) => (listeners.push(fn), () => {}) };
    const win = new EventTarget() as EventTarget & { document: { hasFocus(): boolean } };
    let focused = false;
    win.document = { hasFocus: () => focused };
    const stop = startLookRetract(store, win as never);
    const change = (next: typeof state) => {
      state = next;
      listeners.forEach((fn) => fn(state));
    };
    change({ selectedId: "a1", view: { kind: "conversation" } });
    expect(seen).toEqual([]); // window not focused: the owner is not looking
    focused = true;
    win.dispatchEvent(new Event("focus"));
    expect(seen).toEqual([{ prefixes: ["req:a1:", "turn:a1:"] }]);
    change({ ...state }); // same look: nothing again
    expect(seen).toHaveLength(1);
    change({ selectedId: "a2", view: { kind: "conversation" } });
    expect(seen.at(-1)).toEqual({ prefixes: ["req:a2:", "turn:a2:"] });
    // Away and back to the same agent: retracted again (alerts may have come meanwhile).
    focused = false;
    win.dispatchEvent(new Event("blur"));
    focused = true;
    win.dispatchEvent(new Event("focus"));
    expect(seen).toHaveLength(3);
    stop();
    off();
  });
});

describe("the notifications module's side", () => {
  it("retractions take main's key form; empty ones are not sent", () => {
    expect(retractRequestOf({ keys: ["req:a b:1", "req:a b:1"], prefixes: ["turn:a b:", "nocolon", ":"], notes: [{ hostId: "local", notificationId: "n1" }] })).toEqual({
      keys: [safeKey("req:a b:1")],
      prefixes: ["turn:a_b:"],
      notes: [{ hostId: "local", notificationId: "n1" }],
    });
    const seen: unknown[] = [];
    const off = setRetractHandler((r) => seen.push(r));
    retractNotify({});
    retractNotify({ keys: [] });
    expect(seen).toEqual([]);
    retractNotify({ keys: ["k"] });
    expect(seen).toEqual([{ keys: ["k"] }]);
    off();
  });

  it("a retract that lands while the host decides stops that delivery only", () => {
    const since = retractMark();
    expect(retractedSince("req:a1:7", since)).toBe(false);
    noteRetract({ keys: ["req:a1:7"], prefixes: ["turn:a2:"], notes: [] });
    expect(retractedSince("req:a1:7", since)).toBe(true);
    expect(retractedSince("turn:a2:t9", since)).toBe(true);
    expect(retractedSince("req:a1:8", since)).toBe(false);
    // An occurrence that arrives after the retract still pops up.
    expect(retractedSince("req:a1:7", retractMark())).toBe(false);
  });

  it("delivered popups are retracted through main", () => {
    const r = { keys: ["req:a1:7"], prefixes: [], notes: [{ hostId: "local", notificationId: "n1" }] };
    retractDelivered(r);
    expect(shell.retractAlerts).toHaveBeenCalledWith(r);
  });
});
