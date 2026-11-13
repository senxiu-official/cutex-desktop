import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { BrowserOwnerNavigation, observeOwnerNavigation, OWNER_NAVIGATION_WORLD } from "../src/main/browser/ownerNavigation";

const url = "http://nas.local:5000/login";
function fixture() {
  let now = 1, owner = true, agent = false;
  const intent = new BrowserOwnerNavigation(() => owner, () => agent, () => now);
  return { intent, tick: (ms: number) => { now += ms; }, owner: (v: boolean) => { owner = v; }, agent: (v: boolean) => { agent = v; },
    click: (target = url) => { intent.native("mouseUp"); intent.trustedReceipt({ url: target, kind: "navigation" }); } };
}
describe("main-verified owner navigation intent", () => {
  it("a public-start chain cannot redirect a 307/308 body or cookies into a new private origin", () => {
    const f = fixture(), start = "https://evil.example/go";
    f.click(start); expect(f.intent.navigation(start, "navigation")).toBe(true); expect(f.intent.request("post", start)).toBe(true);
    expect(f.intent.navigation("http://10.0.0.1/apply.cgi", "redirect")).toBe(false);
    expect(f.intent.request("post", "http://10.0.0.1/apply.cgi")).toBe(false);
  });
  it("a public-start chain may return to a private origin already admitted for the tab", () => {
    const allowed = "https://nas.local:5001";
    const intent = new BrowserOwnerNavigation(() => true, () => false, undefined, { admitted: raw => new URL(raw).origin === allowed });
    intent.ownerNavigation("https://login.example/sso"); intent.request("sso", "https://login.example/sso");
    expect(intent.navigation(`${allowed}/callback`, "redirect")).toBe(true);
    expect(intent.request("sso", `${allowed}/callback`)).toBe(true);
  });
  it("DNS classification must pass the private-hop guard before admitting a public-looking LAN alias", () => {
    const intent = new BrowserOwnerNavigation(() => true, () => false);
    intent.ownerNavigation("https://evil.example/go"); intent.request("nav", "https://evil.example/go");
    const alias = "https://router.example/apply";
    expect(intent.navigation(alias, "redirect")).toBe(true); // not yet known to be private
    expect(intent.canAdmitPrivate(alias)).toBe(false); // DNS reveals LAN: never insert admission first
  });
  it("an agent event invalidates older owner input even if its receipt arrives after agent dispatch ended", () => {
    const f = fixture(); f.intent.native("mouseUp"); f.agent(true); f.intent.native("mouseUp"); f.agent(false);
    f.intent.trustedReceipt({ url, kind: "navigation" }); expect(f.intent.navigation(url, "navigation")).toBe(false);
  });
  it("requires corroborating native input and an exact trusted target, not only a recent click", () => {
    const f = fixture();
    expect(f.intent.navigation(url, "navigation")).toBe(false);
    f.intent.native("mouseUp");
    expect(f.intent.navigation(url, "navigation")).toBe(false); // script after a click
    f.click();
    expect(f.intent.navigation("http://nas.local:5000/delete", "navigation")).toBe(false);
    expect(f.intent.navigation(url, "navigation")).toBe(true);
    expect(f.intent.request("request-1", url)).toBe(true);
    expect(f.intent.request("request-2", url)).toBe(false);
  });
  it("never blesses agent input, an agent-pool tab, expired input or an old document", () => {
    const f = fixture(); f.agent(true); f.click(); f.agent(false);
    expect(f.intent.navigation(url, "navigation")).toBe(false);
    f.owner(false); f.click(); f.owner(true);
    expect(f.intent.navigation(url, "navigation")).toBe(false);
    f.click(); f.tick(751); expect(f.intent.navigation(url, "navigation")).toBe(false);
    f.click(); f.intent.document(); expect(f.intent.navigation(url, "navigation")).toBe(false);
  });
  it("keeps SSO and NAS redirect chains under the same request id, then withdraws them", () => {
    const f = fixture(); f.click(); expect(f.intent.navigation(url, "navigation")).toBe(true);
    expect(f.intent.request("nav", url)).toBe(true);
    for (const next of ["https://nas.local:5001/login", "https://keycloak.lan/auth", "https://nas.local:5001/callback"]) {
      expect(f.intent.navigation(next, "redirect")).toBe(true);
      expect(f.intent.request("nav", next)).toBe(true);
      expect(f.intent.request("unrelated", next)).toBe(false);
    }
    f.intent.ended("nav");
    expect(f.intent.navigation(url, "redirect")).toBe(false);
  });
  it("does not turn a receipt into a script redirect or permit an agent to borrow the active chain", () => {
    const f = fixture(); f.click();
    expect(f.intent.navigation(url, "redirect")).toBe(false);
    f.intent.navigation(url, "navigation"); f.intent.request("nav", url); f.agent(true);
    expect(f.intent.navigation("http://nas.local/delete", "redirect")).toBe(false);
    expect(f.intent.request("nav", url)).toBe(false);
  });
  it("checks the private document prefix and main frame; normal console messages mint nothing", () => {
    const f = fixture(); const emitter = new EventEmitter();
    const guest = Object.assign(emitter, { mainFrame: {}, isDestroyed: () => false,
      executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, _scripts: { code: string }[], _gesture: boolean) => {}) });
    const off = observeOwnerNavigation(guest, f.intent);
    expect(guest.executeJavaScriptInIsolatedWorld.mock.calls[0]?.[0]).toBe(OWNER_NAVIGATION_WORLD);
    const code = (guest.executeJavaScriptInIsolatedWorld.mock.calls[0] as unknown as [number, { code: string }[]])[1][0]!.code;
    const prefix = /prefix=("[^"]+")/.exec(code)![1]!;
    f.intent.native("mouseUp");
    emitter.emit("console-message", { frame: guest.mainFrame, message: JSON.stringify({ url, kind: "navigation" }) });
    expect(f.intent.navigation(url, "navigation")).toBe(false);
    emitter.emit("console-message", { frame: {}, message: JSON.parse(prefix) + JSON.stringify({ url, kind: "navigation" }) });
    expect(f.intent.navigation(url, "navigation")).toBe(false);
    emitter.emit("console-message", { frame: guest.mainFrame, message: JSON.parse(prefix) + JSON.stringify({ url, kind: "navigation" }) });
    expect(f.intent.navigation(url, "navigation")).toBe(true);
    off(); expect(emitter.listenerCount("console-message")).toBe(0);
  });
  it("a renderer closing during observer installation fails closed without throwing in main", () => {
    const f = fixture(); const emitter = new EventEmitter();
    const guest = Object.assign(emitter, { mainFrame: {}, isDestroyed: () => false,
      executeJavaScriptInIsolatedWorld: vi.fn((): Promise<unknown> => { throw Error("guest closed"); }) });
    let off!: () => void;
    expect(() => { off = observeOwnerNavigation(guest, f.intent); }).not.toThrow();
    f.intent.native("mouseUp"); emitter.emit("console-message", { frame: guest.mainFrame, message: JSON.stringify({ url, kind: "navigation" }) });
    expect(f.intent.navigation(url, "navigation")).toBe(false); off();
  });
});
