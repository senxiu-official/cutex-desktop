import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserDesktopLoopbackChallenges, BrowserDesktopLoopbackStore } from "../src/main/browser/desktopLoopback";

const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "cutex-browser-loopback-")); dirs.push(dir); return join(dir, "browser-desktop-loopback.json"); };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("per-SSH-host desktop loopback choice", () => {
  it("defaults off, persists independently per host and reloads", () => {
    const file = temp(), store = new BrowserDesktopLoopbackStore(file);
    expect(store.enabled("ssh-one")).toBe(false);
    expect(store.set("ssh-one", true)).toEqual({ enabled: true });
    expect(store.enabled("ssh-two")).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ desktopLoopback: { "ssh-one": true } });
    expect(new BrowserDesktopLoopbackStore(file).enabled("ssh-one")).toBe(true);
    store.set("ssh-one", false);
    expect(new BrowserDesktopLoopbackStore(file).enabled("ssh-one")).toBe(false);
  });
  it.each(["{broken", "[]", "{}", "null", "{\"desktopLoopback\":[]}", "{\"desktopLoopback\":{\"ssh-one\":\"yes\"}}"])("malformed choice %s fails closed", text => {
    const file = temp(); writeFileSync(file, text);
    expect(new BrowserDesktopLoopbackStore(file).enabled("ssh-one")).toBe(false);
  });
  it("a failed enabling write grants nothing; a failed disabling write still closes", () => {
    const denied = new Error("denied");
    const store = new BrowserDesktopLoopbackStore("x", { read: () => { throw new Error("missing"); }, write: () => { throw denied; } });
    expect(() => store.set("ssh-one", true)).toThrow("denied");
    expect(store.enabled("ssh-one")).toBe(false);
    const enabled = new BrowserDesktopLoopbackStore(null); enabled.set("ssh-one", true);
    const file = temp(); writeFileSync(file, "{\"desktopLoopback\":{\"ssh-one\":true}}");
    const closing = new BrowserDesktopLoopbackStore(file, { read: () => "{\"desktopLoopback\":{\"ssh-one\":true}}", write: () => { throw denied; } });
    expect(() => closing.set("ssh-one", false)).toThrow("denied");
    expect(closing.enabled("ssh-one")).toBe(false);
  });
  it("drops the remembered choice of a removed host only", () => {
    const file = temp(), store = new BrowserDesktopLoopbackStore(file);
    store.set("ssh-one", true); store.set("ssh-two", true);
    store.retain(["ssh-two", "local"]);
    expect(store.enabled("ssh-one")).toBe(false);
    expect(store.enabled("ssh-two")).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ desktopLoopback: { "ssh-two": true } });
  });
});

describe("one-use desktop loopback confirmation", () => {
  it("binds a 30 second nonce to host, tab and exact origin; replay and expiry fail", () => {
    let now = 1000;
    const challenges = new BrowserDesktopLoopbackChallenges(() => now, () => "a".repeat(64));
    challenges.issue("ssh-one", "tab-one", "http://127.0.0.1:59273/one");
    const nonce = challenges.nonce("ssh-one", "tab-one", "http://127.0.0.1:59273/two")!;
    expect(nonce).toHaveLength(64);
    expect(challenges.nonce("ssh-one", "tab-two", "http://127.0.0.1:59273/two")).toBeNull();
    expect(challenges.nonce("ssh-two", "tab-one", "http://127.0.0.1:59273/two")).toBeNull();
    expect(challenges.consume("ssh-one", "tab-one", "http://localhost:59273/two", nonce)).toBe(false);
    expect(challenges.consume("ssh-one", "tab-one", "http://127.0.0.1:59273/two", nonce)).toBe(true);
    expect(challenges.consume("ssh-one", "tab-one", "http://127.0.0.1:59273/two", nonce)).toBe(false);
    challenges.issue("ssh-one", "tab-one", "http://127.0.0.1:59273/");
    now += 30_000;
    expect(challenges.nonce("ssh-one", "tab-one", "http://127.0.0.1:59273/")).toBeNull();
    expect(challenges.consume("ssh-one", "tab-one", "http://127.0.0.1:59273/", nonce)).toBe(false);
  });
});
