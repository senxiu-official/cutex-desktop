import { describe, expect, it, vi } from "vitest";
import { openClaimTab } from "../src/renderer/src/modules/browser/claimOpen";
import { initBrowser, parseBrowserParams } from "../src/renderer/src/modules/browser/browserState";

const key = "11111111-2222-4333-8444-555555555555";
const hold = { scope: "s", instanceId: "i", token: "t" };
describe("claim-open in the renderer", () => {
  it("holds main's reserved owner key in the agent's lane, else the host's, and drops the pre-hold without a lease", () => {
    const openHeld = vi.fn().mockReturnValueOnce({ status: "unavailable", reason: "scope-invalid" }).mockReturnValueOnce({ status: "opened", instanceId: "i", pageId: null, reused: false, hold });
    const releaseHold = vi.fn(), timers: (() => void)[] = [];
    expect(openClaimTab({ openHeld, releaseHold }, "local", "epoch", { tabKey: key, url: "cutex:service/yemao/", sessionId: "reader" }, () => undefined,
      ((fn: () => void) => { timers.push(fn); return 0; }) as never)).toBe(true);
    expect(openHeld.mock.calls[0]).toEqual(["browser.tab", { url: "cutex:service/yemao/", tabKey: key, ownerTab: true }, { binding: { kind: "agent", hostId: "local", sessionId: "reader" }, hostEpoch: "epoch" }]);
    expect(openHeld.mock.calls[1]![2]).toEqual({ binding: { kind: "host", hostId: "local" }, hostEpoch: "epoch" });
    timers[0]!(); expect(releaseHold).toHaveBeenCalledWith(hold);
  });
  it("refuses bad keys and URLs, and keeps the hold while a lease exists", () => {
    const openHeld = vi.fn(() => ({ status: "opened", instanceId: "i", pageId: null, reused: false, hold })), releaseHold = vi.fn(), timers: (() => void)[] = [];
    expect(openClaimTab({ openHeld, releaseHold } as never, "local", "e", { tabKey: "not-a-uuid", url: "http://localhost/", sessionId: "s" }, () => undefined)).toBe(false);
    expect(openClaimTab({ openHeld, releaseHold } as never, "local", "e", { tabKey: key, url: "javascript:alert(1)", sessionId: "s" }, () => undefined)).toBe(false);
    expect(openHeld).not.toHaveBeenCalled();
    openClaimTab({ openHeld, releaseHold } as never, "local", "e", { tabKey: key, url: "http://localhost/", sessionId: "s" }, () => ({ lease: { leaseId: "l" } }) as never, ((fn: () => void) => { timers.push(fn); return 0; }) as never);
    timers[0]!(); expect(releaseHold).not.toHaveBeenCalled();
  });
  it("ownerTab params keep main's key instead of reserving a new owner tab", () => {
    const params = parseBrowserParams({ url: "http://localhost:3000/", tabKey: key, ownerTab: true })!;
    expect(params).toEqual({ url: "http://localhost:3000/", tabKey: key, ownerTab: true });
    expect(initBrowser(params, null)).toEqual({ url: "http://localhost:3000/", title: "", tabKey: key });
    expect(parseBrowserParams({ url: "http://localhost:3000/", tabKey: "x", ownerTab: true })).toBeNull();
  });
});
