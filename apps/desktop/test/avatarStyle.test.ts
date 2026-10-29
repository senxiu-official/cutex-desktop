import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvatarStyle } from "../src/renderer/src/lib/avatarStyle";

const legacy = vi.hoisted(() => ({
  prefs: { portraitPacks: [] as string[], agentAvatarDefault: "emoji" },
  profiles: new Map<string, string[] | null>(), writes: vi.fn(), prefsListeners: new Set<() => void>(), looksListeners: new Set<() => void>(),
  capable: new Set<string>(), hostProfiles: new Map<string, unknown>(), patch: vi.fn(), get: vi.fn(),
  atomic: true, storeListeners: new Set<(next: any, prev: any) => void>(),
}));
vi.mock("../src/renderer/src/store", () => ({ featuresOf: (_s: unknown, host: string) => new Set(legacy.capable.has(host) ? ["profile-avatar-style", ...(legacy.atomic ? ["profile-avatar-style-import-if-unset"] : [])] : []), useApp: { getState: () => ({}), subscribe: (listener: (next: any, prev: any) => void) => { legacy.storeListeners.add(listener); return () => legacy.storeListeners.delete(listener); } } }));
vi.mock("../src/renderer/src/lib/hostSwitch", () => ({ onHostReset: () => {}, onHostSwitch: () => {} }));
vi.mock("../src/renderer/src/lib/prefs", () => ({
  getUiPrefs: () => legacy.prefs,
  setUiPref: (key: "portraitPacks" | "agentAvatarDefault", value: never) => { legacy.prefs[key] = value; },
  avatarThemesOverride: (host: string, profile: string) => legacy.profiles.get(JSON.stringify([host, profile])) ?? null,
  setAvatarThemeOverride: legacy.writes,
  subscribeUiPrefs: (listener: () => void) => { legacy.prefsListeners.add(listener); return () => legacy.prefsListeners.delete(listener); },
}));
vi.mock("../src/renderer/src/lib/profileLooks", () => ({
  onProfileLooksNoted: () => () => {},
  profileLookOf: (host: string, profile: string) => legacy.hostProfiles.get(JSON.stringify([host, profile])) ?? null,
  patchProfileLook: (host: string, profile: string, patch: unknown) => legacy.hostProfiles.set(JSON.stringify([host, profile]), patch),
  profileLooksApi: () => ({ getProfile: legacy.get, patchProfile: legacy.patch }),
  subscribeProfileLooks: (listener: () => void) => { legacy.looksListeners.add(listener); return () => legacy.looksListeners.delete(listener); },
}));
const storage = new Map<string, string>();
const key = "cutex-desktop.avatarStyle";
const scope = (host: string, profile: string) => JSON.stringify([host, profile]);
const load = async () => { vi.resetModules(); return import("../src/renderer/src/lib/avatarStyle"); };
beforeEach(() => {
  storage.clear(); legacy.prefs.portraitPacks = []; legacy.prefs.agentAvatarDefault = "emoji";
  legacy.profiles.clear(); legacy.writes.mockClear(); legacy.prefsListeners.clear(); legacy.looksListeners.clear();
  legacy.capable.clear(); legacy.hostProfiles.clear(); legacy.patch.mockReset(); legacy.get.mockReset();
  legacy.atomic = true; legacy.storeListeners.clear();
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
});
afterEach(() => vi.unstubAllGlobals());

describe("host Profile avatar style", () => {
  it("migrates retired theme ids and preserves explicitly saved emoji or letter styles", async () => {
    storage.set(key, JSON.stringify({ version: 1, app: { kind: "portrait", portraitThemes: ["overnight-test-v1/office"] }, profiles: {}, portraitThemes: [] }));
    expect((await load()).getAppAvatarStyle()).toEqual({ kind: "portrait", portraitThemes: ["kit-20261029/metropolitan-muses"] });
    for (const app of [{ kind: "letter" }, { kind: "emoji", emojiThemes: null }]) {
      legacy.prefs.portraitPacks = ["kit-20261029/cloud-woven-silks"];
      storage.set(key, JSON.stringify({ version: 1, app, profiles: {}, portraitThemes: [] }));
      expect((await load()).getAppAvatarStyle()).toEqual(app);
    }
  });
  const profile = (style: AvatarStyle | null = null, updatedAt: string | null = null) => ({ id: "p", name: "Profile", appearance: { avatarStyle: style, avatarThemes: ["sea"] }, appearanceRevisions: { avatarStyle: { etag: "etag", updatedAt } } }) as never;

  it("capable hosts use the full host style, and explicit null uses app default rather than legacy emoji or the local copy", async () => {
    const styles = await load();
    styles.setAppAvatarStyle({ kind: "letter" });
    styles.setProfileAvatarStyle("a", "p", { kind: "portrait", portraitThemes: ["pack/theme"] });
    legacy.capable.add("a");
    legacy.hostProfiles.set(scope("a", "p"), profile({ kind: "emoji", emojiThemes: ["gems"] }));
    expect(styles.effectiveAvatarStyle("a", "p")).toEqual({ kind: "emoji", emojiThemes: ["gems"] });
    legacy.hostProfiles.set(scope("a", "p"), profile(null, "2026-10-24T00:00:00Z"));
    expect(styles.effectiveAvatarStyle("a", "p")).toEqual({ kind: "letter" });
  });

  it("imports a preexisting local choice once using a fresh host read, independently of legacy emoji themes", async () => {
    const styles = await load();
    const style: AvatarStyle = { kind: "portrait", portraitThemes: ["pack/theme"] };
    styles.setProfileAvatarStyle("a", "p", style);
    legacy.capable.add("a");
    legacy.get.mockResolvedValue(profile()); legacy.patch.mockResolvedValue(profile(style, "saved"));
    await styles.importLocalProfileAvatarStyles("a", [profile()]);
    expect(legacy.get).toHaveBeenCalledWith("p");
    expect(legacy.patch).toHaveBeenCalledWith("p", { avatarStyle: style, avatarStyleImportIfUnset: true });
    await styles.importLocalProfileAvatarStyles("a", [profile()]);
    expect(legacy.patch).toHaveBeenCalledTimes(1);
    expect(styles.getProfileAvatarStyle("a", "p")).toEqual(style);
    expect(legacy.writes).not.toHaveBeenCalled();
  });

  it.each([false, true])("never overwrites a host's explicit cleared style (fresh-read guard: %s)", async (freshRead) => {
    const styles = await load();
    styles.setProfileAvatarStyle("a", "p", { kind: "letter" });
    legacy.capable.add("a"); legacy.get.mockResolvedValue(profile(null, "owner-clear"));
    await styles.importLocalProfileAvatarStyles("a", [profile(null, freshRead ? null : "owner-clear")]);
    expect(legacy.patch).not.toHaveBeenCalled();
    await styles.importLocalProfileAvatarStyles("a", [profile()]);
    expect(legacy.patch).not.toHaveBeenCalled();
  });

  it("retains the local draft on failure and retries on a later refresh; old hosts receive no style writes", async () => {
    const styles = await load();
    styles.setProfileAvatarStyle("a", "p", { kind: "letter" });
    await styles.importLocalProfileAvatarStyles("a", [profile()]);
    expect(legacy.get).not.toHaveBeenCalled();
    legacy.capable.add("a"); legacy.get.mockResolvedValue(profile()); legacy.patch.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(profile({ kind: "letter" }, "saved"));
    await styles.importLocalProfileAvatarStyles("a", [profile()]);
    expect(JSON.parse(storage.get(key)!).profiles[scope("a", "p")]).toEqual({ kind: "letter" });
    await styles.importLocalProfileAvatarStyles("a", [profile()]);
    expect(legacy.patch).toHaveBeenCalledTimes(2);
  });

  it("notifies subscribers when a refreshed Profile changes the host style", async () => {
    const styles = await load(); legacy.capable.add("a");
    const listener = vi.fn(), stop = styles.subscribeAvatarStyles(listener);
    legacy.hostProfiles.set(scope("a", "p"), profile({ kind: "letter" }));
    for (const notify of legacy.looksListeners) notify();
    expect(listener).toHaveBeenCalled();
    expect(styles.getProfileAvatarStyle("a", "p")).toEqual({ kind: "letter" });
    stop();
  });

  it("without atomic import support shows the local draft and waits for an explicit host save", async () => {
    const styles = await load(), local: AvatarStyle = { kind: "portrait", portraitThemes: ["pack/theme"] };
    styles.setProfileAvatarStyle("a", "p", local);
    legacy.capable.add("a"); legacy.atomic = false;
    legacy.hostProfiles.set(scope("a", "p"), profile());
    await styles.importLocalProfileAvatarStyles("a", [profile()]);
    expect(legacy.patch).not.toHaveBeenCalled(); expect(legacy.get).not.toHaveBeenCalled();
    expect(styles.pendingLocalProfileAvatarStyle("a", "p")).toEqual(local);
    expect(styles.getProfileAvatarStyle("a", "p")).toBeNull();
    legacy.patch.mockResolvedValue(profile(local, "owner-save"));
    await styles.saveLocalProfileAvatarStyle("a", "p");
    expect(legacy.patch).toHaveBeenCalledWith("p", { avatarStyle: local });
    expect(styles.pendingLocalProfileAvatarStyle("a", "p")).toBeNull();
  });

  it("adopts a concurrent owner clear when the atomic import refuses, and drops the local draft", async () => {
    const styles = await load(); styles.setProfileAvatarStyle("a", "p", { kind: "letter" }); legacy.capable.add("a");
    legacy.get.mockResolvedValueOnce(profile()).mockResolvedValueOnce(profile(null, "concurrent-owner-clear"));
    legacy.patch.mockRejectedValue(new Error("409 avatar_style_already_set"));
    await styles.importLocalProfileAvatarStyles("a", [profile()]);
    expect(legacy.patch).toHaveBeenCalledTimes(1); expect(legacy.get).toHaveBeenCalledTimes(2);
    expect(styles.getProfileAvatarStyle("a", "p")).toBeNull();
    expect(JSON.parse(storage.get(key)!).profiles[scope("a", "p")]).toBeUndefined();
    await styles.importLocalProfileAvatarStyles("a", [profile()]);
    expect(legacy.patch).toHaveBeenCalledTimes(1);
  });

  it("background sidebar changes do not invalidate the global style version", async () => {
    const styles = await load(), changed = vi.fn(), stop = styles.subscribeAvatarStyles(changed);
    const prev = { hosts: { active: "a" }, features: new Set(["profile-avatar-style"]), byHost: { b: { features: new Set(["profile-avatar-style"]), sidebar: {} } } };
    const next = { ...prev, hosts: { ...prev.hosts }, byHost: { b: { ...prev.byHost.b, sidebar: { changed: true } } } };
    for (const listener of legacy.storeListeners) listener(next, prev);
    expect(changed).not.toHaveBeenCalled();
    for (const listener of legacy.storeListeners) listener({ ...next, features: new Set() }, next);
    expect(changed).toHaveBeenCalledTimes(1); stop();
  });
});

describe("desktop avatar style", () => {
  it("migrates portrait packs before letter and persists locally without legacy or network writes", async () => {
    legacy.prefs.portraitPacks = ["pack/one", "pack/two"]; legacy.prefs.agentAvatarDefault = "letter";
    let styles = await load();
    expect(styles.getAppAvatarStyle()).toEqual({ kind: "portrait", portraitThemes: ["pack/one", "pack/two"] });
    expect(storage.size).toBe(1); expect(legacy.writes).not.toHaveBeenCalled();
    legacy.prefs.portraitPacks = []; styles = await load();
    expect(styles.getAppAvatarStyle().kind).toBe("portrait");
  });

  it("migrates letter or automatic emoji when no portrait theme was enabled", async () => {
    legacy.prefs.agentAvatarDefault = "letter";
    expect((await load()).getAppAvatarStyle()).toEqual({ kind: "letter" });
    storage.clear(); legacy.prefs.agentAvatarDefault = "important";
    expect((await load()).getAppAvatarStyle()).toEqual({ kind: "emoji", emojiThemes: null });
  });

  it("gives a legacy Profile emoji override precedence over app portraits without syncing a migration", async () => {
    legacy.prefs.portraitPacks = ["pack/theme"];
    legacy.profiles.set(scope("host", "p"), ["sky", "animals", "sky"]);
    const styles = await load();
    expect(styles.effectiveAvatarStyle("host", "p")).toEqual({ kind: "emoji", emojiThemes: ["animals", "sky"] });
    expect(styles.effectiveAvatarStyle("other-host", "p").kind).toBe("portrait");
    expect(styles.effectiveAvatarStyle("host", null).kind).toBe("portrait");
    expect(legacy.writes).not.toHaveBeenCalled();
  });

  it("persists inherit as a tombstone and never reimports the retained legacy override", async () => {
    legacy.profiles.set(scope("a", "p"), ["sea"]);
    let styles = await load(); expect(styles.getProfileAvatarStyle("a", "p")!.kind).toBe("emoji");
    styles.setProfileAvatarStyle("a", "p", null);
    expect(JSON.parse(storage.get(key)!).profiles[scope("a", "p")]).toBeNull();
    styles = await load(); expect(styles.getProfileAvatarStyle("a", "p")).toBeNull();
    expect(legacy.profiles.get(scope("a", "p"))).toEqual(["sea"]);
    expect(legacy.writes).not.toHaveBeenCalled();
  });

  it("dual-writes app modes for older desktops while retaining the last portrait picks", async () => {
    const styles = await load();
    styles.setAppAvatarStyle({ kind: "portrait", portraitThemes: ["pack/theme", "pack/theme"] });
    expect(legacy.prefs.portraitPacks).toEqual(["pack/theme"]);
    styles.setAppAvatarStyle({ kind: "letter" });
    expect(legacy.prefs).toEqual({ portraitPacks: [], agentAvatarDefault: "letter" });
    expect(styles.getSavedPortraitThemes()).toEqual(["pack/theme"]);
    styles.setAppAvatarStyle({ kind: "emoji", emojiThemes: ["gems"] });
    expect(legacy.prefs).toEqual({ portraitPacks: [], agentAvatarDefault: "emoji" });
    expect((await load()).getSavedPortraitThemes()).toEqual(["pack/theme"]);
  });

  it("preserves the independent important-only dot preference across style changes", async () => {
    legacy.prefs.agentAvatarDefault = "important";
    const styles = await load();
    for (const style of [{ kind: "portrait", portraitThemes: ["pack/theme"] }, { kind: "letter" }, { kind: "emoji", emojiThemes: null }] as AvatarStyle[]) {
      styles.setAppAvatarStyle(style);
      expect(legacy.prefs.agentAvatarDefault).toBe("important");
      expect(styles.getAppAvatarStyle()).toEqual(style);
    }
  });

  it("resets test caches without erasing saved preferences", async () => {
    const styles = await load(); styles.setAppAvatarStyle({ kind: "letter" });
    const saved = storage.get(key); legacy.prefs.agentAvatarDefault = "emoji";
    styles.resetAvatarStyleForTest();
    expect(storage.get(key)).toBe(saved); expect(styles.getAppAvatarStyle()).toEqual({ kind: "letter" });
    storage.clear(); styles.resetAvatarStyleForTest();
    expect(styles.getAppAvatarStyle()).toEqual({ kind: "emoji", emojiThemes: null });
  });

  it("dual-writes only explicit Profile emoji saves and keeps full styles isolated by host and Profile", async () => {
    const styles = await load();
    styles.setProfileAvatarStyle("a", "x:y", { kind: "portrait", portraitThemes: ["pack/theme"] });
    styles.setProfileAvatarStyle("a:x", "y", { kind: "letter" });
    expect(styles.getProfileAvatarStyle("a", "x:y")!.kind).toBe("portrait");
    expect(styles.getProfileAvatarStyle("a:x", "y")!.kind).toBe("letter");
    expect(styles.getProfileAvatarStyle("b", "x:y")).toBeNull();
    expect(legacy.writes).not.toHaveBeenCalled();
    styles.setProfileAvatarStyle("b", "p", { kind: "emoji", emojiThemes: ["sky", "sea"] });
    expect(legacy.writes).toHaveBeenCalledExactlyOnceWith("b", "p", ["sea", "sky"]);
    styles.setProfileAvatarStyle("b", "p", { kind: "emoji", emojiThemes: [] });
    expect(styles.getProfileAvatarStyle("b", "p")).toEqual({ kind: "emoji", emojiThemes: null });
    expect(legacy.writes).toHaveBeenLastCalledWith("b", "p", null);
  });

  it("preserves malformed storage on reads and rejects invalid explicit styles", async () => {
    for (const raw of ["{broken", "[]", '{"version":2}', '{"version":1,"app":{"kind":"unknown"},"profiles":{}}']) {
      storage.set(key, raw); const styles = await load();
      expect(styles.getAppAvatarStyle()).toEqual({ kind: "emoji", emojiThemes: null });
      legacy.profiles.set(scope("a", "p"), ["sea"]);
      expect(styles.getProfileAvatarStyle("a", "p")!.kind).toBe("emoji");
      expect(storage.get(key)).toBe(raw);
      for (const invalid of [{ kind: "other" }, { kind: "portrait", portraitThemes: ["../outside"] }, { kind: "emoji", emojiThemes: ["unknown"] }]) {
        expect(() => styles.setAppAvatarStyle(invalid as AvatarStyle)).toThrow("Invalid avatar style");
        expect(() => styles.setProfileAvatarStyle("a", "p", invalid as AvatarStyle)).toThrow("Invalid avatar style");
      }
    }
  });

  it("accepts only canonical host keys from stored data and preserves valid sibling entries", async () => {
    storage.set(key, JSON.stringify({ version: 1, app: { kind: "letter" }, profiles: {
      [scope("host", "p")]: { kind: "emoji", emojiThemes: ["food"] },
      '["host", "p"]': { kind: "letter" }, bad: { kind: "letter" },
    } }));
    const styles = await load();
    expect(styles.getProfileAvatarStyle("host", "p")).toEqual({ kind: "emoji", emojiThemes: ["food"] });
    expect(styles.getProfileAvatarStyle("elsewhere", "p")).toBeNull();
  });

  it("returns defensive copies and signals explicit changes, late legacy arrival, and unsubscribe", async () => {
    const styles = await load(); const listener = vi.fn(); const stop = styles.subscribeAvatarStyles(listener);
    expect(styles.getProfileAvatarStyle("a", "p")).toBeNull();
    legacy.profiles.set(scope("a", "p"), ["sea"]);
    for (const changed of legacy.looksListeners) changed();
    expect(listener).toHaveBeenCalledTimes(1);
    const profile = styles.getProfileAvatarStyle("a", "p");
    if (profile?.kind === "emoji") profile.emojiThemes!.push("sky");
    expect(styles.getProfileAvatarStyle("a", "p")).toEqual({ kind: "emoji", emojiThemes: ["sea"] });
    styles.setAppAvatarStyle({ kind: "portrait", portraitThemes: ["pack/theme"] });
    const app = styles.getAppAvatarStyle(); if (app.kind === "portrait") app.portraitThemes.length = 0;
    expect(styles.getSavedPortraitThemes()).toEqual(["pack/theme"]);
    expect(listener).toHaveBeenCalledTimes(2);
    stop(); expect(legacy.looksListeners.size).toBe(0); expect(legacy.prefsListeners.size).toBe(0);
    styles.setAppAvatarStyle({ kind: "letter" }); expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reconciles legacy data arriving between the first read and subscription", async () => {
    const styles = await load(); expect(styles.getProfileAvatarStyle("late", "p")).toBeNull();
    legacy.profiles.set(scope("late", "p"), ["food"]);
    const listener = vi.fn(); const stop = styles.subscribeAvatarStyles(listener);
    expect(styles.getProfileAvatarStyle("late", "p")).toEqual({ kind: "emoji", emojiThemes: ["food"] });
    expect(listener).toHaveBeenCalledTimes(1); expect(legacy.writes).not.toHaveBeenCalled(); stop();
  });

  it("does not claim or dual-write an explicit save when local persistence fails", async () => {
    const styles = await load(); styles.getAppAvatarStyle();
    const listener = vi.fn(); const stop = styles.subscribeAvatarStyles(listener);
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: () => { throw Error("storage full"); } });
    expect(() => styles.setProfileAvatarStyle("a", "p", { kind: "emoji", emojiThemes: ["sea"] })).toThrow("storage full");
    expect(styles.getProfileAvatarStyle("a", "p")).toBeNull();
    expect(legacy.writes).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled(); stop();
  });
});
