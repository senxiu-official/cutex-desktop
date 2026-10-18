// Proxy v1 (shared/proxy.ts, main/updateNet.ts chromiumProxyConfig, shared/shell.ts parsePrefs): manual URL
// parsing / redaction, the update proxy pref and the Chromium proxy config each mode maps to.
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, net: {}, session: {} }));

import { chromiumProxyRules, isProxyParseError, normalizeNoProxy, parseProxyUrl, parseUpdateProxyPref, redactProxyUrl } from "../src/shared/proxy";
import { parsePrefs } from "../src/shared/shell";
import { chromiumProxyConfig } from "../src/main/updateNet";

describe("parseProxyUrl", () => {
  it("accepts http / https / socks with optional Basic login and default ports", () => {
    expect(parseProxyUrl("http://127.0.0.1:7890")).toMatchObject({ scheme: "http", host: "127.0.0.1", port: 7890, username: null, display: "http://127.0.0.1:7890" });
    expect(parseProxyUrl("proxy.corp:3128")).toMatchObject({ scheme: "http", port: 3128, display: "http://proxy.corp:3128" });
    expect(parseProxyUrl("https://proxy.corp")).toMatchObject({ scheme: "https", port: 443 });
    expect(parseProxyUrl("socks5h://127.0.0.1:1080")).toMatchObject({ scheme: "socks5", port: 1080 });
    expect(parseProxyUrl("http://al%40ice:p%3Ass@10.0.0.2:8080")).toMatchObject({ username: "al@ice", password: "p:ss", display: "http://10.0.0.2:8080" });
  });
  it("refuses empty, PAC / other schemes and URLs with a path", () => {
    expect(parseProxyUrl(" ")).toEqual({ error: "empty" });
    expect(parseProxyUrl("ftp://proxy:21")).toEqual({ error: "scheme" });
    expect(parseProxyUrl("http://wpad.corp/proxy.pac")).toEqual({ error: "invalid" });
    expect(isProxyParseError(parseProxyUrl("http://"))).toBe(true);
  });
  it("redacts logins and builds Chromium rules", () => {
    expect(redactProxyUrl("http://u:secret@h:1")).toBe("http://h:1");
    expect(redactProxyUrl("u:secret@h:1")).not.toContain("secret");
    expect(chromiumProxyRules({ scheme: "socks5", host: "127.0.0.1", port: 1080 })).toBe("socks5://127.0.0.1:1080");
    expect(chromiumProxyRules({ scheme: "http", host: "::1", port: 8080 })).toBe("http://[::1]:8080");
  });
  it("normalises the bypass list without the always-direct loopback names", () => {
    expect(normalizeNoProxy(" *.corp, 10.0.0.0/8 ;localhost  127.0.0.1 *.corp")).toBe("*.corp,10.0.0.0/8");
    expect(normalizeNoProxy("localhost")).toBeNull();
  });
});

describe("update proxy pref", () => {
  it("keeps only valid modes; absent = follow system; the encrypted login stays only with a manual login", () => {
    expect(parseUpdateProxyPref(undefined)).toBeUndefined();
    expect(parseUpdateProxyPref({ mode: "system" })).toBeUndefined();
    expect(parseUpdateProxyPref({ mode: "none" })).toEqual({ mode: "none" });
    expect(parseUpdateProxyPref({ mode: "manual", url: "http://u:p@h:1", hasCredentials: true })).toEqual({ mode: "manual", url: "http://h:1", hasCredentials: true });
    expect(parseUpdateProxyPref({ mode: "manual", url: "ftp://x" })).toBeUndefined();
    expect(parsePrefs({ updateProxy: { mode: "manual", url: "http://h:1", hasCredentials: true }, updateProxyAuth: "ZW5j" })).toMatchObject({ updateProxy: { mode: "manual" }, updateProxyAuth: "ZW5j" });
    expect(parsePrefs({ updateProxy: { mode: "none" }, updateProxyAuth: "ZW5j" }).updateProxyAuth).toBeUndefined();
    // Q16 ②: a manual URL (and its login) kept while following the system or going direct.
    expect(parseUpdateProxyPref({ mode: "none", url: "http://h:1", hasCredentials: true })).toEqual({ mode: "none", url: "http://h:1", hasCredentials: true });
    expect(parseUpdateProxyPref({ mode: "system", url: "http://h:1" })).toEqual({ mode: "system", url: "http://h:1" });
    expect(parseUpdateProxyPref({ mode: "none", url: "ftp://x" })).toEqual({ mode: "none" });
    expect(parsePrefs({ updateProxy: { mode: "none", url: "http://h:1", hasCredentials: true }, updateProxyAuth: "ZW5j" }).updateProxyAuth).toBe("ZW5j");
  });
  it("maps each mode to the updater session's Chromium proxy config (loopback stays implicit-direct)", () => {
    expect(chromiumProxyConfig({ mode: "system" })).toEqual({ mode: "system" });
    expect(chromiumProxyConfig({ mode: "none" })).toEqual({ mode: "direct" });
    expect(chromiumProxyConfig({ mode: "manual", rules: "http://h:1", server: { scheme: "http", host: "h", port: 1 } })).toEqual({ mode: "fixed_servers", proxyRules: "http://h:1" });
  });
});
