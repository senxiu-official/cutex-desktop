import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserExternalPagesStore, browserExternalForce, createBrowserExternalPages } from "../src/main/browser/externalPages";
import { BROWSER_LOCAL_PROXY } from "../src/main/browser/network";
import { LOCKDOWN_DNS, lockdownProxy } from "../src/main/pluginNetwork";

const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "cutex-browser-external-")); dirs.push(dir); return join(dir, "browser-external.json"); };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("owner switch 「允许浏览外部网页」 (main-only state)", () => {
  it("defaults on when no file exists, persists the owner's choice and reads it back", () => {
    const file = temp(), store = new BrowserExternalPagesStore(file);
    expect(store.get()).toBe(true);
    store.set(false);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ externalPages: false });
    expect(new BrowserExternalPagesStore(file).get()).toBe(false);
    store.set(true); expect(new BrowserExternalPagesStore(file).get()).toBe(true);
  });
  it.each(["{broken", "[]", "{}", "{\"externalPages\":\"yes\"}", "null"])("a present but malformed file (%s) reads off", text => {
    const file = temp(); writeFileSync(file, text);
    expect(new BrowserExternalPagesStore(file).get()).toBe(false);
  });
  it("an unreadable file reads off; a failed write still turns the switch off in memory", () => {
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    expect(new BrowserExternalPagesStore("x", { read: () => { throw denied; }, write: () => {} }).get()).toBe(false);
    const store = new BrowserExternalPagesStore("x", { read: () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }, write: () => { throw denied; } });
    expect(store.get()).toBe(true);
    expect(() => store.set(false)).toThrow("denied"); expect(store.get()).toBe(false);
    expect(() => store.set(true)).toThrow("denied"); expect(store.get()).toBe(false);
  });
  it("packaged builds ignore the development environment override", () => {
    for (const flag of ["n2", "off", "", undefined, "1"]) expect(browserExternalForce(true, flag)).toBeUndefined();
    expect(browserExternalForce(false, "n2")).toBe("on"); expect(browserExternalForce(false, "off")).toBe("off");
    expect(browserExternalForce(false, "1")).toBeUndefined(); expect(browserExternalForce(false, undefined)).toBeUndefined();
    const store = new BrowserExternalPagesStore(null); store.set(false);
    expect(createBrowserExternalPages({ packaged: true, flag: "n2", store }).view()).toEqual({ enabled: false, stored: false });
    expect(createBrowserExternalPages({ packaged: false, flag: "n2", store }).view()).toEqual({ enabled: true, stored: false, forced: "on" });
  });
});

describe("non-browser sessions stay network-locked with N2 on (packaged)", () => {
  // The app-wide containment (default session black hole + dead secure DNS) must not learn about N2.
  it("plugin / agent-page lockdown has no N2 bypass", () => {
    expect(lockdownProxy()).toEqual({ mode: "fixed_servers", proxyRules: "socks5://127.0.0.1:9", proxyBypassRules: "<-loopback>" });
    expect(LOCKDOWN_DNS.secureDnsMode).toBe("secure");
    expect(LOCKDOWN_DNS.secureDnsServers).toEqual(["https://127.0.0.1:9/dns-query{?dns}"]);
    expect(BROWSER_LOCAL_PROXY.proxyRules).toBe("socks5://127.0.0.1:9");
  });
  it("the N2 code paths never reach the default session, the host resolver or frame/plugin modules", () => {
    const root = join(__dirname, "../src/main");
    for (const file of ["browser/egress.ts", "browser/egressProxy.ts", "browser/externalPages.ts", "browser/sessionProxy.ts"]) {
      const source = readFileSync(join(root, file), "utf8");
      for (const forbidden of ["defaultSession", "configureHostResolver", "fromPartition", "plugin-sandbox", "opaque-frame", "ipcMain"])
        expect(source.includes(forbidden), `${file}: ${forbidden}`).toBe(false);
    }
    // Only install.ts wires N2, and it configures sessions only via main-derived browser partitions.
    const install = readFileSync(join(root, "browser/install.ts"), "utf8");
    expect(install.includes("defaultSession")).toBe(false);
    expect(install.includes("configureHostResolver")).toBe(false);
    const index = readFileSync(join(root, "index.ts"), "utf8");
    for (const forbidden of ["egressProxy", "createBrowserEgress", "externalPages"]) expect(index.includes(forbidden), forbidden).toBe(false);
  });
});
