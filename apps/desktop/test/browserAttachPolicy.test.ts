import { describe, expect, it } from "vitest";
import { browserAttachId, browserAttachSource, browserPartition, evaluateBrowserAttach, matchBrowserPartition,
  type BrowserAttachInput } from "../src/main/browser/attachPolicy";

const ticket = "a".repeat(64);
function input(): BrowserAttachInput {
  return { moduleEnabled: true, popupGuardInstalled: true, registeredHostIds: ["local", "ssh-test", "dev-test"], appWebContentsId: 1, senderWebContentsId: 1,
    reservation: { attachId: ticket, hostId: "local", partition: "persist:browser-local" },
    params: { src: browserAttachSource(ticket), partition: "persist:browser-local" },
    webPreferences: { partition: "persist:browser-local" } };
}
describe("browser attach admission", () => {
  it.each(["local", "ssh-test", "dev-test"])("matches only both exact registered partitions for %s", hostId => {
    for (const pool of ["owner", "agent"] as const) {
      const partition = browserPartition(hostId, pool);
      expect(matchBrowserPartition(partition, [hostId])).toEqual({ hostId, pool });
      for (const bad of [partition + "-extra", partition + "/", partition.toUpperCase(), "x" + partition, partition.replace("persist:", "")])
        expect(matchBrowserPartition(bad, [hostId])).toBeUndefined();
    }
  });
  it.each(["unknown", "../local", "agent-local", "local/x", "", "ssh-"])("rejects unsafe host id %s", hostId => {
    expect(() => browserPartition(hostId)).toThrow();
    expect(matchBrowserPartition(`persist:browser-${hostId}`, [hostId])).toBeUndefined();
  });
  it("removes every supplied preference and every preload, then loads exact blank", () => {
    const value = input();
    Object.assign(value.params, { preload: "file:///secret.js", webpreferences: "nodeIntegration=yes", useragent: ticket,
      httpreferrer: "http://127.0.0.1/", allowpopups: true });
    Object.assign(value.webPreferences, { preload: "unsafe", session: {}, additionalArguments: ["--unsafe"], unknownFutureSetting: true,
      sandbox: false, nodeIntegration: true, nodeIntegrationInWorker: true, webviewTag: true, webSecurity: false });
    expect(evaluateBrowserAttach(value)).toEqual({ allowed: true, hostId: "local", partition: "persist:browser-local" });
    expect(value.params.src).toBe("about:blank");
    expect(value.params).not.toHaveProperty("preload");
    expect(value.params).not.toHaveProperty("webpreferences");
    expect(value.params).not.toHaveProperty("useragent");
    expect(value.webPreferences).not.toHaveProperty("preload");
    expect(value.webPreferences).not.toHaveProperty("session");
    expect(value.webPreferences).not.toHaveProperty("unknownFutureSetting");
    expect(value.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, webSecurity: true,
      nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, disablePopups: false, webviewTag: false });
    expect(value.params.allowpopups).toBe(true);
  });
  it.each([false, undefined, "true", 1])("refuses popup delivery without strict main guard proof: %s", proof => {
    const value = input(); value.popupGuardInstalled = proof as boolean;
    value.params.allowpopups = true; value.webPreferences.disablePopups = false;
    expect(evaluateBrowserAttach(value)).toEqual({ allowed: false, reason: "popup_guard_unavailable" });
    expect(value.params.allowpopups).toBe(false); expect(value.webPreferences.disablePopups).toBe(true);
  });
  it("guard proof alone never opens popups for an invalid attach ticket", () => {
    const value = input(); delete value.reservation;
    expect(evaluateBrowserAttach(value).allowed).toBe(false);
    expect(value.params.allowpopups).toBe(false); expect(value.webPreferences.disablePopups).toBe(true);
  });
  it("admits reserved agent pool but never guesses it from a prefix", () => {
    const value = input();
    value.params.partition = value.webPreferences.partition = value.reservation!.partition = browserPartition("local", "agent");
    expect(evaluateBrowserAttach(value).allowed).toBe(true);
  });
  it("module disabled denies even a valid reservation", () => {
    const value = input(); value.moduleEnabled = false;
    expect(evaluateBrowserAttach(value)).toEqual({ allowed: false, reason: "module_disabled" });
  });
  it("unregistered host, different embedder, and altered preferences are denied", () => {
    const host = input(); host.registeredHostIds = [];
    expect(evaluateBrowserAttach(host).allowed).toBe(false);
    const guest = input(); guest.senderWebContentsId = 2;
    expect(evaluateBrowserAttach(guest)).toEqual({ allowed: false, reason: "untrusted_sender" });
    const prefs = input(); prefs.webPreferences.partition = "persist:browser-agent-local";
    expect(evaluateBrowserAttach(prefs)).toEqual({ allowed: false, reason: "partition_mismatch" });
  });
  it.each(["about:blank", "https://example.com", "file:///secret", "javascript:alert(1)", "data:text/html,x", "about:blank#" + ticket])(
    "unreserved plugin/subframe cannot attach with %s", src => {
      const value = input(); value.params.src = src; delete value.reservation;
      expect(evaluateBrowserAttach(value)).toEqual({ allowed: false, reason: "invalid_ticket" });
    });
  it("P4 possession check denies guessed ticket, missing reservation and host substitution", () => {
    const guessed = input(); guessed.params.src = browserAttachSource("b".repeat(64));
    expect(evaluateBrowserAttach(guessed).allowed).toBe(false);
    const replay = input(); delete replay.reservation; // main atomically consumed it on first admission
    expect(evaluateBrowserAttach(replay).allowed).toBe(false);
    const crossed = input(); crossed.reservation!.hostId = "ssh-test";
    expect(evaluateBrowserAttach(crossed).allowed).toBe(false);
  });
  it("strictly encodes admission envelopes, rejecting suffixes/escaped aliases", () => {
    expect(browserAttachId(browserAttachSource(ticket))).toBe(ticket);
    for (const value of [browserAttachSource(ticket) + "x", browserAttachSource(ticket) + "?x", browserAttachSource(ticket).replace("=a", "=%61"), ticket])
      expect(browserAttachId(value)).toBeUndefined();
    expect(() => browserAttachSource("a")).toThrow();
  });
});
