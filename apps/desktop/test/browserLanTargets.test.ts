import { describe, expect, it, vi } from "vitest";
import { BrowserLanTargets } from "../src/main/browser/lanTargets";
import { isLanEgressAddress } from "../src/main/browser/egressAddress";

// Injected DNS only: no real lookup, no network.
const answers = (...addresses: string[]) => addresses.map(address => ({ address, family: address.includes(":") ? 6 : 4 }));
describe("owner LAN target classification", () => {
  it.each([["10.0.0.1", true], ["172.16.0.1", true], ["172.31.255.255", true], ["172.32.0.1", false], ["192.168.255.255", true], ["100.64.0.1", true], ["100.127.255.255", true],
    ["100.128.0.0", false], ["127.0.0.1", false], ["169.254.169.254", false], ["0.0.0.0", false], ["224.0.0.1", false], ["8.8.8.8", false],
    ["fd7a:115c:a1e0::1", true], ["fe80::1", false], ["::1", false], ["2001:db8::1", false]])("%s LAN = %s", (address, lan) => {
    expect(isLanEgressAddress(address)).toBe(lan);
  });
  it("literals and LAN-style names by syntax, without DNS", async () => {
    const lookup = vi.fn(async () => answers("8.8.8.8")), targets = new BrowserLanTargets(lookup);
    expect(await targets.classify("http://100.64.0.27:8765/a")).toEqual({ key: "100.64.0.27:8765", origin: "http://100.64.0.27:8765", hostname: "100.64.0.27", port: 8765 });
    expect(await targets.classify("https://[fd7a:115c:a1e0::5]/")).toMatchObject({ key: "fd7a:115c:a1e0::5:443", origin: "https://[fd7a:115c:a1e0::5]" });
    expect(await targets.classify("http://nas.local/")).toMatchObject({ key: "nas.local:80" });
    expect(await targets.classify("http://router/")).toMatchObject({ key: "router:80" });
    for (const url of ["http://169.254.169.254/", "http://127.0.0.1:3000/", "http://app.localhost/", "file:///etc/passwd", "http://8.8.8.8/"])
      expect(await targets.classify(url)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });
  it("a public-looking name qualifies only when every answer is LAN or public and one is LAN", async () => {
    const table: Record<string, string[]> = { "box.tail0000.ts.net": ["100.101.102.103", "fd7a:115c:a1e0::3"], "example.com": ["93.184.216.34"],
      "rebind.example": ["10.0.0.14", "127.0.0.1"], "meta.example": ["169.254.169.254"] };
    const lookup = vi.fn(async (hostname: string) => answers(...(table[hostname] ?? []))), targets = new BrowserLanTargets(lookup);
    expect(await targets.classify("https://box.tail0000.ts.net/")).toMatchObject({ key: "box.tail0000.ts.net:443" });
    expect(await targets.classify("https://example.com/")).toBeNull();
    expect(await targets.classify("http://rebind.example/")).toBeNull();
    expect(await targets.classify("http://meta.example/")).toBeNull();
    expect(await targets.classify("http://missing.example/")).toBeNull();
    await targets.classify("https://box.tail0000.ts.net/other"); // cached
    expect(lookup).toHaveBeenCalledTimes(5);
  });
  it("admissions are per tab; the authority stays admitted while any admitting tab lives", () => {
    const targets = new BrowserLanTargets(async () => []);
    const target = { key: "nas.local:80", origin: "http://nas.local", hostname: "nas.local", port: 80 };
    targets.admit("tab-a", target); targets.admit("tab-b", target);
    targets.release("tab-a"); expect(targets.has("nas.local", 80)).toBe(true);
    targets.release("tab-b"); expect(targets.has("nas.local", 80)).toBe(false); expect(targets.size).toBe(0);
  });
});
