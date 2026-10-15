import { describe, expect, it, vi } from "vitest";
import { createBrowserChannel, parseBrowserRequest } from "../src/main/browser/channel";
import { BROWSER_CHANNEL, DEFAULT_BROWSER_CONTROL_SETTINGS as settings, type BrowserRequest } from "../src/shared/browser";
import { browserBridge } from "../src/preload/browser";
const expected = { guestId: "guest", pageGeneration: 1 };

const positive = [
  { op: "agents" }, { op: "settings" }, { op: "settings", agentOpenApproval: "ask" },
  { op: "profileTools", profile: "私有 profile", enabled: true },
  { op: "grantAgent", tabKey: "tab", sessionId: "session", settings, expected },
  { op: "grantAgent", tabKey: "tab", sessionId: "session", settings, approvalId: "approval", expected },
  { op: "holdReady", tabKey: "tab", leaseId: "lease", held: true },
  { op: "resumeLease", tabKey: "tab", leaseId: "lease", settings },
  { op: "turnShots", sessionId: "session", turnId: "turn" },
  { op: "turnShot", id: "shot" }, { op: "toolItem", sessionId: "session", turnId: "turn", itemId: "item" },
] as const;
const reducing = [
  { op: "holdReady", tabKey: "tab", leaseId: "lease", held: false },
  { op: "releaseLease", tabKey: "tab", leaseId: "lease" },
  { op: "openRefused", requestId: "request", code: "lease_limit" },
] as const;
function setup() {
  let enabled = true;
  const connection = { routingEpoch: "epoch", daemon: { generation: 1 } };
  const execute = vi.fn(async (_request: BrowserRequest, _host: string) => undefined);
  const handle = createBrowserChannel({ isAppSender: (sender: boolean) => sender, isEnabled: () => enabled,
    setEnabled: value => { enabled = value; }, getHosts: () => ({ connection: () => connection, focus: () => "focus-host" }), execute });
  return { execute, handle, disable: () => { enabled = false; } };
}
describe("I3 owner channel has no generic RPC or scope escalation", () => {
  it("profile-name bounds agree with ownerApi's 200-character/control-free path segment", () => {
    for (const length of [128, 129, 200]) expect(parseBrowserRequest({ op: "profileTools", profile: "x".repeat(length) })).toEqual({ op: "profileTools", profile: "x".repeat(length) });
    for (const profile of ["x".repeat(201), " ", "bad\u0085name", "bad\u007fname", "../outside", ".", ".."])
      expect(() => parseBrowserRequest({ op: "profileTools", profile })).toThrow("invalid_browser_request");
  });
  it.each([...positive, ...reducing])("valid exact %j is main-frame-only and module-gated", async request => {
    expect(parseBrowserRequest(request)).toEqual(request);
    const f = setup(), binding = { hostId: "explicit-host", epoch: "epoch" };
    await expect(f.handle(false, request, binding)).rejects.toThrow("untrusted_sender");
    f.disable(); await expect(f.handle(true, request, binding)).rejects.toThrow("module_disabled");
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(positive)("positive %j requires the exact current epoch", async request => {
    const f = setup(); await expect(f.handle(true, request, { hostId: "explicit-host", epoch: "old" })).rejects.toThrow("host binding unavailable");
    expect(f.execute).not.toHaveBeenCalled();
    await f.handle(true, request, { hostId: "explicit-host", epoch: "epoch" });
    expect(f.execute.mock.calls[0]?.[1]).toBe("explicit-host");
  });
  it.each(reducing)("only reducing %j ignores stale epoch", async request => {
    const f = setup(); await f.handle(true, request, { hostId: "explicit-host", epoch: "old" });
    expect(f.execute).toHaveBeenCalledWith(request, "explicit-host", undefined);
    await expect(f.handle(true, request, { hostId: "explicit-host", epoch: "epoch", focus: true })).rejects.toThrow("invalid_browser_binding");
  });
  it.each([
    { op: "settings", path: "/v2/config" }, { op: "settings", agentOpenApproval: true },
    { op: "profileTools", profile: "../../root", enabled: true }, { op: "profileTools", profile: ".", enabled: true },
    { op: "profileTools", profile: "test", enabled: "true" }, { op: "profileTools", profile: "test", token: "not-accepted" },
    { op: "grantAgent", tabKey: "tab", sessionId: "session", settings, leaseId: "forged" },
    { op: "holdReady", tabKey: "tab", leaseId: "lease", held: 1 },
    { op: "turnShot", id: "../file" }, { op: "toolItem", sessionId: "session", turnId: "turn", itemId: "item", includeThread: true },
  ])("rejects authority, arbitrary paths and extra fields %j", request => expect(() => parseBrowserRequest(request)).toThrow());
  it("preload setting calls preserve explicit binding and cannot pass extra setting fields", async () => {
    const invoke = vi.fn(async () => undefined);
    const bridge = browserBridge({ invoke, binding: () => ({ hostId: "other", epoch: "epoch", focus: true }), subscribe: () => () => {} });
    await bridge.forHost("other").settings("ask");
    await bridge.forHost("other").profileTools("私有 profile", false);
    expect(invoke.mock.calls).toEqual([
      [BROWSER_CHANNEL, { op: "settings", agentOpenApproval: "ask" }, { hostId: "other", epoch: "epoch" }],
      [BROWSER_CHANNEL, { op: "profileTools", profile: "私有 profile", enabled: false }, { hostId: "other", epoch: "epoch" }],
    ]);
  });
});
