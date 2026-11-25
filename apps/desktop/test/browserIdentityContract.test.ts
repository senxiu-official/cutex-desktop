// 浏览器身份 package 0: the strict request parser, the channel's routing (unsupported until a package installs its
// service; history clears split from site data), and the partition name of an identity.
import { describe, expect, it, vi } from "vitest";
import { browserIdentityPartition, DEFAULT_BROWSER_IDENTITY_ID, parseBrowserIdentityRequest } from "../src/shared/browserIdentity";
import { createBrowserIdentityChannel, route } from "../src/main/browser/identity/channel";
import type { BrowserIdentityServices } from "../src/main/browser/identity/contract";

const ID = "0123456789abcdef0123456789abcdef";

describe("parseBrowserIdentityRequest", () => {
  it("accepts the documented shapes", () => {
    expect(parseBrowserIdentityRequest({ op: "state" })).toEqual({ op: "state" });
    expect(parseBrowserIdentityRequest({ op: "create", name: " 工作 Outlook ", color: "teal" })).toEqual({ op: "create", name: "工作 Outlook", color: "teal" });
    expect(parseBrowserIdentityRequest({ op: "update", id: ID, expectedRevision: 3, initial: "工" })).toEqual({ op: "update", id: ID, expectedRevision: 3, initial: "工" });
    expect(parseBrowserIdentityRequest({ op: "remove", id: "1a2b3c4d" })).toEqual({ op: "remove", id: "1a2b3c4d" });
    expect(parseBrowserIdentityRequest({ op: "clearData", request: { identityId: ID, hostId: "all", types: ["siteData", "history"], historyRange: "day" } }).op).toBe("clearData");
    expect(parseBrowserIdentityRequest({ op: "history", query: { identityId: ID, hostId: "ssh-hostb", text: "outlook", limit: 50 } }).op).toBe("history");
    expect(parseBrowserIdentityRequest({ op: "historyDelete", target: { identityId: ID, hostId: "local", origin: "https://outlook.office.com" } }).op).toBe("historyDelete");
    expect(parseBrowserIdentityRequest({ op: "prefs", patch: { searchEngine: "bing", passwordHelloGrace: true } })).toEqual({ op: "prefs", patch: { searchEngine: "bing", passwordHelloGrace: true } });
    expect(parseBrowserIdentityRequest({ op: "passwordStatus" })).toEqual({ op: "passwordStatus" });
    expect(parseBrowserIdentityRequest({ op: "promptAnswer", promptId: "p-1", choice: "never" }).op).toBe("promptAnswer");
  });

  it.each([
    [{ op: "nope" }],
    [{ op: "state", extra: 1 }],
    [{ op: "create", name: "", color: "teal" }],
    [{ op: "create", name: "x", color: "red" }],
    [{ op: "create", name: "x".repeat(41), color: "teal" }],
    [{ op: "update", id: ID, expectedRevision: 1 }],
    [{ op: "remove", id: "../etc" }],
    [{ op: "remove", id: "ABCDEF12" }],
    [{ op: "clearData", request: { identityId: ID, hostId: "all", types: [] } }],
    [{ op: "clearData", request: { identityId: ID, hostId: "all", types: ["cookies"] } }],
    [{ op: "clearData", request: { identityId: ID, hostId: "all", types: ["cache"], origins: ["javascript:alert(1)"] } }],
    [{ op: "history", query: { identityId: ID, hostId: "local", limit: 1000 } }],
    [{ op: "historyDelete", target: { identityId: ID, hostId: "local", ids: [] } }],
    [{ op: "prefs", patch: { searchEngine: "yahoo" } }],
    [{ op: "prefs", patch: { password: "x" } }],
    [{ op: "fill", offerId: "o 1", loginId: "l" }],
  ])("refuses %j", (raw) => {
    expect(() => parseBrowserIdentityRequest(raw)).toThrow("invalid_browser_request");
  });
});

describe("channel", () => {
  const empty = (): BrowserIdentityServices => ({ onIdentitySession: [], emit: () => {} });

  it("answers unsupported_operation until a package installs its service", async () => {
    await expect(route({ op: "state" }, empty())).rejects.toThrow("unsupported_operation");
    await expect(route({ op: "history", query: { identityId: ID, hostId: "local" } }, empty())).rejects.toThrow("unsupported_operation");
    await expect(route({ op: "passwordStatus" }, empty())).rejects.toThrow("unsupported_operation");
  });

  it("refuses senders other than the app frame", async () => {
    const handle = createBrowserIdentityChannel<{ ok: boolean }>({ isAppSender: (e) => e.ok, services: empty() });
    await expect(handle({ ok: false }, { op: "state" })).rejects.toThrow("untrusted_sender");
  });

  it("routes history clears to the history store and the rest to the identity service", async () => {
    const services = empty();
    const clearData = vi.fn(async () => {});
    const clear = vi.fn(async () => {});
    services.identities = { clearData } as unknown as BrowserIdentityServices["identities"];
    services.history = { clear } as unknown as BrowserIdentityServices["history"];
    await route({ op: "clearData", request: { identityId: ID, hostId: "local", types: ["history", "cache"], historyRange: "hour" } }, services);
    expect(clear).toHaveBeenCalledWith({ identityId: ID, hostId: "local", types: ["history", "cache"], historyRange: "hour" });
    expect(clearData).toHaveBeenCalledWith({ identityId: ID, hostId: "local", types: ["cache"], historyRange: "hour" });
    clearData.mockClear();
    await route({ op: "clearData", request: { identityId: ID, hostId: "local", types: ["history"] } }, services);
    expect(clearData).not.toHaveBeenCalled();
  });
});

describe("browserIdentityPartition", () => {
  it("keeps the default identity on today's owner partition", () => {
    expect(browserIdentityPartition(DEFAULT_BROWSER_IDENTITY_ID, "local")).toBe("persist:browser-local");
    expect(browserIdentityPartition(ID, "ssh-hostb")).toBe(`persist:browser-id-${ID}-ssh-hostb`);
    expect(() => browserIdentityPartition("agent", "local")).toThrow();
    expect(() => browserIdentityPartition(ID, "agent-local")).toThrow();
  });
});

describe("channel: 「验证后 5 分钟内不再问」", () => {
  const make = (current: boolean) => {
    let grace = current;
    const confirmGrace = vi.fn(async () => {});
    const graceChanged = vi.fn();
    const services = {
      onIdentitySession: [], emit: () => {},
      identities: { prefs: vi.fn(async (patch?: { passwordHelloGrace?: boolean }) => { if (patch?.passwordHelloGrace !== undefined) grace = patch.passwordHelloGrace; return { passwordHelloGrace: grace }; }) },
      passwords: { confirmGrace, graceChanged },
    } as unknown as BrowserIdentityServices;
    return { services, confirmGrace, graceChanged };
  };
  it("turning it on asks the password service first (owner gesture + Hello); a refusal leaves the pref off", async () => {
    const on = make(false);
    await route({ op: "prefs", patch: { passwordHelloGrace: true } }, on.services);
    expect(on.confirmGrace).toHaveBeenCalledTimes(1);
    expect(on.graceChanged).toHaveBeenCalledWith(true);
    const refused = make(false);
    refused.confirmGrace.mockRejectedValueOnce(new Error("owner_gesture_required"));
    await expect(route({ op: "prefs", patch: { passwordHelloGrace: true } }, refused.services)).rejects.toThrow("owner_gesture_required");
    expect((await refused.services.identities!.prefs()).passwordHelloGrace).toBe(false);
    expect(refused.graceChanged).not.toHaveBeenCalled();
  });
  it("turning it off locks at once without asking; other prefs leave it alone", async () => {
    const off = make(true);
    await route({ op: "prefs", patch: { passwordHelloGrace: false } }, off.services);
    expect(off.confirmGrace).not.toHaveBeenCalled();
    expect(off.graceChanged).toHaveBeenCalledWith(false);
    const other = make(true);
    await route({ op: "prefs", patch: { searchEngine: "bing" } }, other.services);
    expect(other.confirmGrace).not.toHaveBeenCalled();
    expect(other.graceChanged).not.toHaveBeenCalled();
  });
});
