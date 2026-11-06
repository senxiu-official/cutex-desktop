// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { record } from "../src/renderer/src/lib/inputLedger/testkit";
const fx = vi.hoisted(() => ({ features: new Set<string>(), hold: vi.fn(), notify: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({
  featuresOf: () => fx.features,
  useApp: Object.assign((selector: (s: object) => unknown) => selector({}), { getState: () => ({ holdInput: fx.hold, notify: fx.notify }) }),
}));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({ useConvHost: () => "conversation-host" }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { InputHoldControl } from "../src/renderer/src/components/InputHoldControl";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>, el: HTMLDivElement;
const input = () => record("n", { kind: "systemNotice", surface: "nextUp", state: "waiting", actions: ["hold"], details: { ownerHold: false } });
const show = (r = input()) => act(() => root.render(h(InputHoldControl, { record: r, sessionId: "s", hostId: "remote" })));
beforeEach(() => { fx.features = new Set(["input-ledger-v1", "owner-carries-v1"]); fx.hold.mockReset(); fx.notify.mockReset(); el = document.createElement("div"); root = createRoot(el); });
afterEach(() => act(() => root.unmount()));
it("requires both capabilities and offered per-record action; generic ownerPause does not expose release", () => {
  for (const features of [[], ["input-ledger-v1"], ["owner-carries-v1"]]) { fx.features = new Set(features); show(); expect(el.querySelector("button")).toBeNull(); }
  fx.features = new Set(["input-ledger-v1", "owner-carries-v1"]);
  show({ ...input(), reason: "ownerPause", actions: [], details: {} }); expect(el.querySelector("button")).toBeNull();
  for (const kind of ["owner", "delegationRequest"] as const) { show({ ...input(), kind }); expect(el.querySelector("button")).toBeNull(); }
  show({ ...input(), surface: "pendingNotes" }); expect(el.querySelector("button")).toBeNull();
});
it("holds once without changing label, then releases only when daemon offers releaseHold", async () => {
  let finish!: () => void; fx.hold.mockImplementationOnce(() => new Promise<void>(done => { finish = done; }));
  show(); const button = el.querySelector("button")!;
  act(() => { button.click(); button.click(); });
  expect(fx.hold).toHaveBeenCalledExactlyOnceWith("s", "n", true, "remote");
  expect(button.disabled).toBe(true); expect(button.textContent).toBe("inputLedger.hold");
  await act(async () => finish());
  expect(button.textContent).toBe("inputLedger.hold");
  show({ ...input(), actions: ["releaseHold"], details: { ownerHold: true } });
  await act(async () => el.querySelector("button")!.click());
  expect(fx.hold).toHaveBeenLastCalledWith("s", "n", false, "remote");
});
it("reports CAS failure and leaves the offered hold available", async () => {
  fx.hold.mockRejectedValueOnce(Error("input_revision_conflict")); show();
  await act(async () => el.querySelector("button")!.click());
  expect(fx.notify).toHaveBeenCalledWith("Error: input_revision_conflict", "error", { hostId: "remote", sessionId: "s" });
  expect(el.querySelector("button")!.disabled).toBe(false); expect(el.textContent).toBe("inputLedger.hold");
});
