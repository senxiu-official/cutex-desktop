import { describe, expect, it } from "vitest";
import { createBrowserUrlPolicy, type BrowserNetworkHost, type BrowserRequestContext } from "../src/main/browser/network";
import { relayError, relayWireError } from "../src/main/browser/relayTypes";

// 0.1.3 batch 1: one refusal per real cause, and loopback reachable by pages only per tab/origin.
const local: BrowserNetworkHost = { kind: "local", serviceProxy: true, connectionPort: 24370 };
function policy(options: { host?: BrowserNetworkHost; external?: "ready" | "off" | "unavailable"; admitted?: Record<number, string[]>; control?: number[];
  lan?: Record<string, "ready" | "unavailable"> } = {}) {
  return createBrowserUrlPolicy({ getHost: () => options.host ?? local,
    external: () => options.external ?? "off",
    protectedEndpoint: url => (options.control ?? [24370, 24360]).includes(Number(url.port || 80)),
    admitted: (id, origin) => options.admitted?.[id]?.includes(origin) === true,
    lan: (hostname, port) => options.lan?.[`${hostname}:${port}`] ?? "none" });
}
const page = (extra: Partial<BrowserRequestContext> = {}): BrowserRequestContext => ({ actor: "page", webContentsId: 7, ...extra });

describe("browser refusal reasons", () => {
  it.each([
    ["https://example.com/", "off", "external_pages_off"],
    ["https://example.com/", "unavailable", "external_proxy_unavailable"],
    ["https://example.com/", "ready", null],
    ["http://100.64.0.1:8765/", "ready", "private_address_blocked"],
    ["http://100.64.0.27:8765/", "ready", "private_address_blocked"],
    ["http://10.0.0.11/", "ready", "private_address_blocked"],
    ["http://10.0.0.1:8080/", "off", "private_address_blocked"],
    ["http://nas.local/", "ready", "private_address_blocked"],
    ["http://router/", "ready", "private_address_blocked"],
    ["http://127.0.0.2:3000/", "ready", "reserved_address"],
    ["http://169.254.169.254/latest/meta-data/", "ready", "reserved_address"],
    ["http://app.localhost:3000/", "ready", "reserved_address"],
    ["http://224.0.0.1/", "ready", "reserved_address"],
    ["http://127.0.0.1:24370/v2/health", "ready", "protected_endpoint"],
    ["http://localhost:24360/", "off", "protected_endpoint"],
    ["http://[::1]:24370/", "off", "protected_endpoint"],
    ["http://localhost:3000/", "off", null],
  ] as const)("owner %s with websites %s → %s", (url, external, reason) => {
    expect(policy({ external }).refusal(url, { actor: "owner" })).toBe(reason);
  });
  it("an SSH host's desktop loopback is its own reason; its tunnel port is still protected", () => {
    const ssh = policy({ host: { kind: "ssh", connectionPort: 41000, serviceProxy: true }, control: [41000] });
    expect(ssh.refusal("http://localhost:3000/")).toBe("remote_loopback");
    expect(ssh.refusal("http://127.0.0.1:41000/")).toBe("protected_endpoint");
    expect(ssh.refusal("http://docs.svc.localhost:41000/")).toBeNull();
  });
  it("a host without browser-refusal-reasons receives the established wire code for every refusal", () => {
    for (const code of ["external_pages_off", "external_proxy_unavailable", "private_address_blocked", "reserved_address", "protected_endpoint", "remote_loopback"] as const) {
      expect(relayError({ code })).toBe(code);
      expect(relayWireError(code, false)).toBe("external_pages_unavailable");
      expect(relayWireError(code, true)).toBe(code);
    }
    expect(relayWireError("lease_revoked", false)).toBe("lease_revoked");
  });
});

describe("page request attribution (loopback hole)", () => {
  const admitted = { 7: ["http://localhost:3000"] };
  it("a public page cannot probe arbitrary desktop loopback ports, not even with a top-level navigation", () => {
    const p = policy({ external: "ready", admitted });
    for (const resourceType of ["xhr", "script", "image", "webSocket", "subFrame", "mainFrame"])
      expect(p.refusal("http://localhost:9222/json", page({ resourceType, initiatorOrigin: "https://evil.example" }))).toBe("private_address_blocked");
    // Even an origin admitted in this tab is not reachable from another origin's document.
    expect(p.refusal("http://localhost:3000/api", page({ resourceType: "xhr", initiatorOrigin: "https://evil.example" }))).toBe("private_address_blocked");
    expect(p.refusal("http://localhost:3000/delete", page({ resourceType: "mainFrame", initiatorOrigin: "https://evil.example" }))).toBe("private_address_blocked");
  });
  it("the admitted origin's own document reaches it (subresources, HMR socket, same-origin links)", () => {
    const p = policy({ admitted });
    for (const resourceType of ["xhr", "script", "stylesheet", "image", "subFrame", "mainFrame"])
      expect(p.refusal("http://localhost:3000/x", page({ resourceType, initiatorOrigin: "http://localhost:3000" }))).toBeNull();
    expect(p.refusal("ws://localhost:3000/hmr", page({ resourceType: "webSocket", initiatorOrigin: "http://localhost:3000" }))).toBeNull();
    // Browser-started main frame (main's own loadURL, history, reload) of an admitted origin.
    expect(p.refusal("http://localhost:3000/", page({ resourceType: "mainFrame" }))).toBeNull();
  });
  it("admission is per tab and per origin: other ports, other tabs, opaque or unknown initiators are refused", () => {
    const p = policy({ admitted });
    expect(p.refusal("http://localhost:3001/", page({ resourceType: "xhr", initiatorOrigin: "http://localhost:3000" }))).toBe("private_address_blocked");
    expect(p.refusal("http://localhost:3000/", page({ webContentsId: 8, resourceType: "xhr", initiatorOrigin: "http://localhost:3000" }))).toBe("private_address_blocked");
    expect(p.refusal("http://localhost:3000/", page({ resourceType: "xhr", initiatorOrigin: "null" }))).toBe("private_address_blocked");
    expect(p.refusal("http://localhost:3000/", page({ resourceType: "xhr" }))).toBe("private_address_blocked");
    expect(p.refusal("http://localhost:3000/", { actor: "page", resourceType: "xhr", initiatorOrigin: "http://localhost:3000" })).toBe("private_address_blocked");
  });
  it("control endpoints stay closed even for an admitted-looking same-origin request", () => {
    const p = policy({ admitted: { 7: ["http://127.0.0.1:24370"] } });
    expect(p.refusal("http://127.0.0.1:24370/v2/sessions", page({ resourceType: "xhr", initiatorOrigin: "http://127.0.0.1:24370" }))).toBe("protected_endpoint");
  });
  it("service origins: same-origin subresources only; private /__cutex endpoints only via main's ticket navigation", () => {
    const p = policy({ external: "ready" });
    const svc = "http://docs.svc.localhost:24370";
    expect(p.refusal(`${svc}/app.js`, page({ resourceType: "script", initiatorOrigin: svc }))).toBeNull();
    expect(p.refusal(`${svc}/api`, page({ resourceType: "xhr", initiatorOrigin: "https://evil.example" }))).toBe("private_address_blocked");
    expect(p.refusal(`${svc}/api`, page({ resourceType: "xhr", initiatorOrigin: "http://other.svc.localhost:24370" }))).toBe("private_address_blocked");
    expect(p.refusal(`${svc}/`, page({ resourceType: "mainFrame", initiatorOrigin: "http://other.svc.localhost:24370" }))).toBeNull();
    expect(p.refusal(`${svc}/__cutex/auth?ticket=x`, page({ resourceType: "mainFrame" }))).toBeNull();
    expect(p.refusal(`${svc}/__cutex/auth?ticket=x`, page({ resourceType: "mainFrame", initiatorOrigin: svc }))).toBe("protected_endpoint");
    expect(p.refusal(`${svc}/__cutex/lease`, page({ resourceType: "xhr", initiatorOrigin: svc }))).toBe("protected_endpoint");
    expect(p.refusal(`${svc}/%5F_cutex/lease`, page({ resourceType: "xhr", initiatorOrigin: svc }))).toBe("protected_endpoint");
  });
  it("public pages keep working as the normal web when websites are on", () => {
    const p = policy({ external: "ready" });
    expect(p.refusal("https://cdn.example.net/lib.js", page({ resourceType: "script", initiatorOrigin: "https://evil.example" }))).toBeNull();
  });
});

describe("owner-typed LAN / tailnet targets (batch 2)", () => {
  const lan = { "100.64.0.27:8765": "ready", "nas.local:80": "ready", "box.tail0000.ts.net:443": "ready", "10.0.0.11:80": "unavailable" } as const;
  it("main-admitted owner navigations open; agents never; not admitted = refused", () => {
    const p = policy({ lan, external: "off" });
    expect(p.refusal("http://100.64.0.27:8765/", { actor: "owner" })).toBeNull();
    expect(p.refusal("http://nas.local/", { actor: "owner" })).toBeNull();
    expect(p.refusal("https://box.tail0000.ts.net/", { actor: "owner" })).toBeNull(); // public-looking name, LAN answers
    expect(p.refusal("http://10.0.0.11/", { actor: "owner" })).toBe("external_proxy_unavailable");
    expect(p.refusal("http://10.0.0.12/", { actor: "owner" })).toBe("private_address_blocked");
    expect(p.refusal("http://100.64.0.27:8765/", { actor: "agent" })).toBe("private_address_blocked");
    // A LAN admission never weakens the websites switch for a different (public) authority.
    expect(p.refusal("https://example.com/", { actor: "owner" })).toBe("external_pages_off");
  });
  it("only the admitting tab, same-origin, reaches it; other pages in the same partition do not", () => {
    const p = policy({ lan, external: "ready", admitted: { 7: ["http://100.64.0.27:8765", "https://box.tail0000.ts.net"] } });
    const own = "http://100.64.0.27:8765";
    expect(p.refusal(`${own}/api`, page({ resourceType: "xhr", initiatorOrigin: own }))).toBeNull();
    expect(p.refusal(`${own}/api`, page({ webContentsId: 8, resourceType: "xhr", initiatorOrigin: own }))).toBe("private_address_blocked");
    expect(p.refusal(`${own}/api`, page({ resourceType: "xhr", initiatorOrigin: "https://evil.example" }))).toBe("private_address_blocked");
    expect(p.refusal("http://100.64.0.27:9000/", page({ resourceType: "xhr", initiatorOrigin: own }))).toBe("private_address_blocked");
    expect(p.refusal("http://10.0.0.10/", page({ resourceType: "mainFrame", initiatorOrigin: own }))).toBe("private_address_blocked");
    // The tailnet DNS name is private-class: a public page cannot reach it although it looks public.
    expect(p.refusal("https://box.tail0000.ts.net/x", page({ webContentsId: 8, resourceType: "xhr", initiatorOrigin: "https://evil.example" }))).toBe("private_address_blocked");
    expect(p.refusal("https://box.tail0000.ts.net/x", page({ resourceType: "script", initiatorOrigin: "https://box.tail0000.ts.net" }))).toBeNull();
  });
  it("a remote host's own control endpoint on its tailnet address stays protected", () => {
    const p = createBrowserUrlPolicy({ getHost: () => local, lan: () => "ready",
      protectedEndpoint: url => url.host === "100.64.0.27:24270" });
    expect(p.refusal("http://100.64.0.27:24270/v2/health", { actor: "owner" })).toBe("protected_endpoint");
    expect(p.refusal("http://100.64.0.27:8765/", { actor: "owner" })).toBeNull();
  });
});
