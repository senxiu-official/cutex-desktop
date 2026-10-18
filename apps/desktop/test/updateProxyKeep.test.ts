// Owner Q16 ②: this desktop's update proxy keeps the manual URL (and its encrypted login) when switched
// to 不使用 / 跟随系统, so switching back to 手动 restores it (main/shell.ts setUpdateProxy).
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { on: () => {}, getPath: () => "/nonexistent-cutex-test", getLocale: () => "en" },
  BrowserWindow: class {},
  dialog: {},
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: { createEmpty: () => ({}), createFromBuffer: () => ({}) },
  Notification: { isSupported: () => false },
  powerMonitor: { on: () => {} },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(`enc:${s}`), decryptString: (b: Buffer) => b.toString().slice(4) },
  Tray: class {},
}));
vi.mock("node:fs", async (original) => ({ ...(await original<object>()), readFileSync: () => "{}" }));
vi.mock("node:fs/promises", async (original) => ({ ...(await original<object>()), writeFile: async () => {}, rename: async () => {} }));

const { DesktopShell } = await import("../src/main/shell");
const shell = () => new DesktopShell(() => null, () => {}, () => {});

describe("update proxy keeps the manual URL", () => {
  it("none and system keep URL + login; manual restores it and the login", () => {
    const s = shell();
    s.setUpdateProxy({ mode: "manual", url: "http://alice:pw@10.0.0.2:3128" });
    expect(s.state().prefs.updateProxy).toEqual({ mode: "manual", url: "http://10.0.0.2:3128", hasCredentials: true });
    s.setUpdateProxy({ mode: "none" });
    expect(s.state().prefs.updateProxy).toEqual({ mode: "none", url: "http://10.0.0.2:3128", hasCredentials: true });
    expect(s.updateProxyConfig()).toEqual({ mode: "none" });
    s.setUpdateProxy({ mode: "system" });
    expect(s.state().prefs.updateProxy).toEqual({ mode: "system", url: "http://10.0.0.2:3128", hasCredentials: true });
    expect(s.updateProxyConfig()).toEqual({ mode: "system" });
    // Back to manual from the shown (credential-free) URL, or with no URL at all: the login comes back.
    s.setUpdateProxy({ mode: "manual", url: "http://10.0.0.2:3128" });
    expect(s.updateProxyConfig()).toMatchObject({ mode: "manual", server: { host: "10.0.0.2", port: 3128, auth: { username: "alice", password: "pw" } } });
    s.setUpdateProxy({ mode: "none" });
    s.setUpdateProxy({ mode: "manual" });
    expect(s.updateProxyConfig()).toMatchObject({ mode: "manual", server: { auth: { username: "alice" } } });
    // Another URL drops the old login.
    s.setUpdateProxy({ mode: "manual", url: "http://10.0.0.3:8080" });
    expect(s.state().prefs.updateProxy).toEqual({ mode: "manual", url: "http://10.0.0.3:8080" });
  });
  it("system without a manual URL stores nothing", () => {
    const s = shell();
    s.setUpdateProxy({ mode: "none" });
    expect(s.state().prefs.updateProxy).toEqual({ mode: "none" });
    s.setUpdateProxy({ mode: "system" });
    expect(s.state().prefs.updateProxy).toBeUndefined();
  });
});
