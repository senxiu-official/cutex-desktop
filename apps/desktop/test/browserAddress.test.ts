import { afterEach, describe, expect, it } from "vitest";
import { browserAddressUrl, browserNavigationUrl, INVALID_ADDRESS, MAX_BROWSER_INPUT, NOT_WEB_ADDRESS } from "../src/renderer/src/modules/browser/browserState";
import { pickerGroups, recentGrants, rememberGrant, type PickerAgent } from "../src/renderer/src/modules/browser/agentPicker";
import { browserOwnerErrorKey } from "../src/shared/browser";

describe("browser address bar", () => {
  it.each([
    ["www.google.com", "https://www.google.com/"],
    ["example.com/a?b=1#c", "https://example.com/a?b=1#c"],
    ["Example.COM:8443/x", "https://example.com:8443/x"],
    ["localhost", "http://localhost/"],
    ["localhost:3000", "http://localhost:3000/"],
    ["LOCALHOST:3000/app", "http://localhost:3000/app"],
    ["svc.localhost:8080/", "http://svc.localhost:8080/"],
    ["docs.svc.localhost", "http://docs.svc.localhost/"],
    ["127.0.0.1:5173", "http://127.0.0.1:5173/"],
    ["127.1.2.3", "http://127.1.2.3/"],
    ["[::1]:8080/path", "http://[::1]:8080/path"],
    ["10.0.0.5:8080", "https://10.0.0.5:8080/"],
    ["[2001:db8::1]", "https://[2001:db8::1]/"],
    ["  www.google.com  ", "https://www.google.com/"],
    ["例子.测试", "https://xn--fsqu00a.xn--0zwm56d/"],
  ])("adds a scheme to %s", (input, url) => {
    expect(browserAddressUrl(input)).toEqual({ url });
  });

  it("keeps explicit schemes on the strict rules", () => {
    expect(browserAddressUrl("http://www.google.com")).toEqual({ url: "http://www.google.com/" });
    expect(browserAddressUrl("about:blank")).toEqual({ url: "about:blank" });
    expect(browserAddressUrl("cutex:service/docs/index")).toEqual({ url: "cutex:service/docs/index" });
    for (const value of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://example.com/", "https://u:p@localhost/", "about:srcdoc"])
      expect(browserAddressUrl(value)).toEqual({ error: INVALID_ADDRESS });
  });

  it("never fills in credentials, control characters, backslashes or oversized input", () => {
    for (const value of ["user@example.com", "u:p@localhost:3000", "local\u0000host", "localhost\\x", "x".repeat(MAX_BROWSER_INPUT + 1)])
      expect(browserAddressUrl(value)).toEqual({ error: INVALID_ADDRESS });
  });

  it.each(["", "   ", "hello world", "google", "what is cutex", "foo.123", "localhost:99999", "999.1.1.1", "-bad.com", "a..b", "[::1"])("says %j is not a web address", (value) => {
    expect(browserAddressUrl(value)).toEqual({ error: NOT_WEB_ADDRESS });
  });

  it("leaves agent / claim URLs strict (no scheme filling there)", () => {
    expect(browserNavigationUrl("localhost:3000")).toBeNull();
    expect(browserNavigationUrl("www.google.com")).toBeNull();
  });

  it("an external page refused by main shows the external-unavailable text", () => {
    expect(browserOwnerErrorKey(new Error("Error invoking remote method 'browser:tab': Error: external_pages_unavailable"))).toBe("browser.externalUnavailable");
    expect(browserOwnerErrorKey("external_pages_unavailable")).toBe("browser.externalUnavailable");
  });
});

describe("browser agent picker", () => {
  const agent = (sessionId: string, name: string, projectId: string | null = null, projectName: string | null = projectId): PickerAgent => ({ sessionId, name, projectId, projectName });
  const agents = [agent("a1", "Zed", "p1", "Website"), agent("a2", "Alice", "p1", "Website"), agent("a3", "Bob"), agent("a4", "Carol", "p2", "Analytics"), agent("a5", "Dave")];

  it("groups by project (sorted), 独立 last, names sorted", () => {
    const groups = pickerGroups(agents);
    expect(groups.map(g => [g.kind, g.label, g.agents.map(a => a.name)])).toEqual([
      ["project", "Analytics", ["Carol"]],
      ["project", "Website", ["Alice", "Zed"]],
      ["independent", null, ["Bob", "Dave"]],
    ]);
  });

  it("puts the current conversation's agent, then recent grants, on top without duplicates", () => {
    const groups = pickerGroups(agents, { current: "a3", recent: ["a1", "a3", "gone"] });
    expect(groups[0]).toMatchObject({ kind: "top" });
    expect(groups[0]!.agents.map(a => a.sessionId)).toEqual(["a3", "a1"]);
    expect(groups.flatMap(g => g.agents).map(a => a.sessionId).sort()).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  it("filters by name and project, case-insensitive, every word", () => {
    expect(pickerGroups(agents, { query: "web" }).flatMap(g => g.agents.map(a => a.name))).toEqual(["Alice", "Zed"]);
    expect(pickerGroups(agents, { query: "WEB ali" }).flatMap(g => g.agents.map(a => a.name))).toEqual(["Alice"]);
    expect(pickerGroups(agents, { query: "nobody" })).toEqual([]);
    expect(pickerGroups(agents, { query: "bob", current: "a1" }).flatMap(g => g.agents.map(a => a.name))).toEqual(["Bob"]);
  });

  describe("recent grants", () => {
    const store = new Map<string, string>();
    const local = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    afterEach(() => { store.clear(); Reflect.deleteProperty(globalThis, "localStorage"); });
    it("remembers the latest five per host, most recent first", () => {
      Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true });
      for (const id of ["a", "b", "c", "d", "e", "f", "b"]) rememberGrant("h1", id);
      rememberGrant("h2", "x");
      expect(recentGrants("h1")).toEqual(["b", "f", "e", "d", "c"]);
      expect(recentGrants("h2")).toEqual(["x"]);
    });
    it("survives missing or broken storage", () => {
      expect(recentGrants("h1")).toEqual([]);
      expect(() => rememberGrant("h1", "a")).not.toThrow();
      Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => "{broken", setItem: () => { throw new Error("quota"); } }, configurable: true });
      expect(recentGrants("h1")).toEqual([]);
      expect(() => rememberGrant("h1", "a")).not.toThrow();
    });
  });
});
