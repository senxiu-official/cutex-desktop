import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserAgentOpens, type BrowserAgentOpenIntent } from "../src/renderer/src/modules/browser/agentOpen";
import { initBrowser, parseBrowserParams, restoreBrowser, browserRef } from "../src/renderer/src/modules/browser/browserState";

const intent = (over: Partial<BrowserAgentOpenIntent> = {}): BrowserAgentOpenIntent => ({ requestId: "call-1", hostId: "ssh-a", epoch: "epoch-a", tabKey: "12345678-1234-4234-8234-123456789abc", cutexSessionId: "agent-1", url: "http://docs.svc.localhost:26070/", remainingMs: 1000, ...over });
function fixture() {
  const hold = { scope: "host:local", instanceId: "side-1", token: "prehold-test" };
  const side = { openHeld: vi.fn(() => ({ status: "opened" as const, instanceId: "side-1", pageId: "page-1", reused: false, hold })), releaseHold: vi.fn(() => true), reveal: vi.fn(() => ({ status: "stale" as const })) };
  const selected = vi.fn(() => false), refused = vi.fn(async () => {});
  return { side, hold, selected, refused, opens: createBrowserAgentOpens({ side, isSelected: selected, refused }) };
}
afterEach(() => vi.useRealTimers());
describe("browser v1.10 background opens", () => {
  it("same-pool owner popup state preserves only main-correlated provenance, with no lease or pending open", () => {
    const params = parseBrowserParams({ url: "http://localhost/?token=secret", tabKey: intent().tabKey, agentOpened: true });
    expect(params).toEqual({ url: "http://localhost/", tabKey: intent().tabKey, agentOpened: true });
    const state = initBrowser(params!, null);
    expect(state).toEqual({ url: "http://localhost/", title: "", tabKey: intent().tabKey, agentOpened: true });
    expect(restoreBrowser(state, 1)).toEqual(state);
    expect(browserRef(state)?.params).toEqual({ url: "http://localhost/" });
    expect(parseBrowserParams({ url: "http://localhost/", agentOpened: true, tabKey: "forged" })).toBeNull();
  });
  it("uses the bound non-selected agent and epoch without reveal/focus options", () => {
    const f = fixture(); f.opens.open(intent());
    expect(f.side.openHeld).toHaveBeenCalledWith("browser.tab", { url: intent().url, tabKey: intent().tabKey, pendingOpen: "call-1" }, { binding: { kind: "agent", hostId: "ssh-a", sessionId: "agent-1" }, hostEpoch: "epoch-a" });
    expect(f.side.reveal).not.toHaveBeenCalled(); f.opens.dispose();
    expect(f.side.releaseHold).toHaveBeenCalledWith(f.hold, { discard: true });
  });
  it("selected agent can reveal only its newly held instance, with no focus argument", () => {
    const f = fixture(); f.selected.mockReturnValue(true); f.opens.open(intent());
    expect(f.side.reveal).toHaveBeenCalledWith({ instanceId: "side-1" }); f.opens.confirmed("ssh-a", "call-1"); f.opens.dispose();
    expect(f.side.releaseHold).not.toHaveBeenCalled();
  });
  it.each([["hold-limit", "lease_limit"], ["scope-unsupported", "scope_unsupported"], ["scope-invalid", "scope_invalid"], ["host-offline", "stale_connection"], ["module-off", "browser_disabled"]])("surfaces %s without retries or reveal", (reason, code) => {
    const f = fixture(); f.side.openHeld.mockReturnValue({ status: "unavailable", reason } as never); f.opens.open(intent());
    expect(f.refused).toHaveBeenCalledWith(intent(), code); expect(f.side.openHeld).toHaveBeenCalledOnce(); expect(f.side.reveal).not.toHaveBeenCalled(); expect(f.side.releaseHold).not.toHaveBeenCalled();
  });
  it("discards a timed-out pre-hold even if Body never rendered", () => {
    vi.useFakeTimers(); const f = fixture(); f.opens.open(intent()); f.opens.open(intent());
    expect(f.side.openHeld).toHaveBeenCalledOnce(); vi.advanceTimersByTime(1001);
    expect(f.side.releaseHold).not.toHaveBeenCalled(); // main's deadline/cancellation wins
    vi.advanceTimersByTime(30_000);
    expect(f.side.releaseHold).toHaveBeenCalledOnce(); f.opens.cancelled("ssh-a", "call-1"); expect(f.side.releaseHold).toHaveBeenCalledOnce();
  });
  it("main confirmation at the advertised deadline wins over the generous renderer fallback", () => {
    vi.useFakeTimers(); const f = fixture(); f.opens.open(intent());
    vi.advanceTimersByTime(1000); f.opens.confirmed("ssh-a", "call-1"); vi.advanceTimersByTime(40_000);
    expect(f.side.releaseHold).not.toHaveBeenCalled(); expect(f.refused).not.toHaveBeenCalled();
  });
  it("a different host cancellation cannot drop the hold; epoch replacement can", () => {
    const f = fixture(); f.opens.open(intent()); f.opens.cancelled("other", "call-1"); f.opens.invalidateHost("ssh-a", "epoch-a");
    expect(f.side.releaseHold).not.toHaveBeenCalled(); f.opens.invalidateHost("ssh-a", "epoch-b"); expect(f.side.releaseHold).toHaveBeenCalledOnce(); f.opens.dispose();
  });
  it("module stop clears only pending pre-holds and rejects later opens", () => {
    const f = fixture(); f.opens.open(intent()); f.opens.dispose(); f.opens.dispose(); f.opens.open(intent({ requestId: "call-2" }));
    expect(f.side.releaseHold).toHaveBeenCalledOnce(); expect(f.side.openHeld).toHaveBeenCalledOnce(); expect(f.refused).toHaveBeenCalledWith(expect.objectContaining({ requestId: "call-2" }), "browser_disabled");
  });
  it("pending tabs never restore, and confirmed state/ref do not preserve pending hints", () => {
    const params = parseBrowserParams({ url: intent().url, tabKey: intent().tabKey, pendingOpen: "call-1" })!;
    const state = initBrowser(params, null); expect(state.agentOpened).toBe(true); expect(state.tabKey).toBe(intent().tabKey); expect(restoreBrowser(state, 1)).toBeNull();
    for (const marker of [false, null, "", 123]) expect(restoreBrowser({ ...state, pendingOpen: marker }, 1)).toBeNull();
    const { pendingOpen: _pending, ...confirmed } = state; expect(restoreBrowser(confirmed, 1)).toEqual(confirmed); expect(browserRef(state)?.params).toEqual({ url: state.url });
  });
});
