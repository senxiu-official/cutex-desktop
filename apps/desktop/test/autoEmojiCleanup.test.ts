// @vitest-environment jsdom
// One-time cleanup of the emoji defaults stored as agents' own avatars (lib/autoEmojiCleanup): only this device's
// auto-saved agents, only while the avatar is still exactly a default the planner wrote; once; offline → retried.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionAvatar } from "@cutex-desktop/protocol";

const fixture = vi.hoisted(() => ({
  entries: new Map<string, any>(), loaded: new Set<string>(["A"]), features: new Set(["session-metadata", "session-avatar-mode"]),
  action: vi.fn(), notify: vi.fn(), reread: vi.fn(), known: true,
}));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  return {
    useApp: create(() => ({ sidebar: {}, byHost: {}, features: new Set(), sessionAction: fixture.action, notify: fixture.notify })),
    featuresOf: () => fixture.features,
    sidebarOf: (_state: unknown, host: string) => (fixture.loaded.has(host) ? { active: [] } : null),
  };
});
vi.mock("../src/renderer/src/lib/agentLook", () => ({ agentIndex: () => fixture.entries, sessionProfileName: () => "profile", lookOf: (entry: any) => ({ family: entry.family ?? "claude" }) }));
vi.mock("../src/renderer/src/lib/profileLooks", () => ({ profileLooksKnown: () => fixture.known, profileLookOf: () => ({ id: "profile" }), onProfileLooksNoted: () => () => {} }));
vi.mock("../src/renderer/src/lib/avatarStyle", () => ({ effectiveAvatarStyle: () => ({ kind: "emoji", emojiThemes: null }) }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ avatarThemesOverride: () => null, getUiPrefs: () => ({}), subscribeUiPrefs: () => () => {} }));
vi.mock("../src/renderer/src/lib/portraitAssign", () => ({ rereadSession: fixture.reread }));
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string, vars?: Record<string, string>) => `${key}:${vars?.n ?? ""}` }));

import { useApp } from "../src/renderer/src/store";
import { AUTO_EMOJI_CLEANUP_KEY, isDefaultEmoji, loadCleanupState, startAutoEmojiCleanup } from "../src/renderer/src/lib/autoEmojiCleanup";
import { familyThemes } from "../src/renderer/src/lib/avatarStyleAssign";
import { themedEmoji, themesEmoji } from "../src/renderer/src/lib/avatarThemes";

const claude = familyThemes("claude");
const pick = (seed: string, offset = 0): SessionAvatar => {
  const pool = themesEmoji(claude);
  const start = pool.findIndex((e) => e.glyph === themedEmoji(seed, claude).glyph);
  return { kind: "emoji", value: pool[(start + offset) % pool.length]!.glyph };
};
const key = (seed: string, host = "A") => `${host}\u0000${seed}`;

function seed(id: string, avatar: SessionAvatar | null, fields: Record<string, unknown> = {}, host = "A") {
  const session = { cutexSessionId: id, lifecycle: "active", avatar, avatarMode: "fixed", revision: 4, ...fields };
  fixture.entries.set(id, { hostId: host, row: { projectId: "p" }, pinned: false, isDirector: false, session });
  return session;
}
function saved(...keys: string[]) { localStorage.setItem("cutex-desktop.portraitSaved", JSON.stringify(keys)); }

let stop: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear();
  fixture.entries.clear(); fixture.loaded = new Set(["A"]); fixture.known = true; fixture.features = new Set(["session-metadata", "session-avatar-mode"]);
  fixture.notify.mockReset(); fixture.reread.mockReset(); fixture.action.mockReset();
  fixture.action.mockImplementation(async (id: string, _method: string, params: { avatar: SessionAvatar | null; avatarMode?: unknown }) => {
    const s = fixture.entries.get(id).session; s.avatar = params.avatar; s.avatarMode = params.avatarMode; s.revision++; return {};
  });
  stop = null;
});
afterEach(() => { stop?.(); vi.useRealTimers(); });
const run = async () => { stop = startAutoEmojiCleanup(); await vi.advanceTimersByTimeAsync(2100); };

describe("isDefaultEmoji", () => {
  it("the seed's own pick, or a few places on (the project's worn skips); nothing else", () => {
    expect(isDefaultEmoji(pick("s"), "s", [claude], 0)).toBe(true);
    expect(isDefaultEmoji(pick("s", 2), "s", [claude], 0)).toBe(false);
    expect(isDefaultEmoji(pick("s", 2), "s", [claude], 3)).toBe(true);
    expect(isDefaultEmoji({ ...pick("s"), color: "#112233" }, "s", [claude], 0)).toBe(false);
    expect(isDefaultEmoji({ kind: "icon", value: "portrait:p/beach/claude-v1" }, "s", [claude], 0)).toBe(false);
    expect(isDefaultEmoji({ kind: "emoji", value: "🦄🦄" }, "s", [claude], 9)).toBe(false);
  });
});

describe("startAutoEmojiCleanup", () => {
  it("clears only auto-saved agents still wearing their default emoji, through the fenced metadata update", async () => {
    const auto = seed("auto", pick("auto"));
    const picked = seed("picked", pick("picked", 7)); // hand-picked from the same pool, far from its default
    const portrait = seed("portrait", { kind: "icon", value: "portrait:p/beach/claude-v1" });
    const coloured = seed("coloured", { ...pick("coloured"), color: "#112233" });
    const notListed = seed("other", pick("other"));
    saved(key("auto"), key("picked"), key("portrait"), key("coloured"));
    await run();
    expect(fixture.action).toHaveBeenCalledExactlyOnceWith("auto", "cutex/session/metadata/update", { avatar: null, avatarMode: null, expectedRevision: 4 }, "A");
    expect(auto.avatar).toBeNull();
    for (const s of [picked, portrait, coloured, notListed]) expect(s.avatar).not.toBeNull();
    expect(fixture.notify).toHaveBeenCalledExactlyOnceWith("avatar.autoEmojiCleared:1", "info");
    expect(loadCleanupState().pending).toEqual([]);
  });

  it("hosts without avatar modes get only the avatar cleared", async () => {
    fixture.features = new Set(["session-metadata"]);
    seed("auto", pick("auto"), { avatarMode: null }); saved(key("auto"));
    await run();
    expect(fixture.action.mock.calls[0]![2]).toEqual({ avatar: null, expectedRevision: 4 });
  });

  it("keeps an avatar changed meanwhile (by the owner or another device)", async () => {
    const s = seed("auto", pick("auto")); saved(key("auto"));
    fixture.action.mockRejectedValueOnce(new Error("revision_conflict"));
    fixture.reread.mockResolvedValueOnce({ ...s, avatar: { kind: "emoji", value: "🦊" }, revision: 5 });
    await run(); await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.action).toHaveBeenCalledTimes(1);
    expect(s.avatar).toEqual(pick("auto"));
    expect(fixture.notify).not.toHaveBeenCalled();
    expect(loadCleanupState().pending).toEqual([]);
  });

  it("runs once per device", async () => {
    seed("auto", pick("auto")); saved(key("auto"));
    await run(); stop?.();
    expect(fixture.action).toHaveBeenCalledTimes(1);
    // The owner shows the default emoji again (显示头像): a later start leaves it.
    fixture.entries.get("auto").session.avatar = pick("auto");
    await run();
    expect(fixture.action).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(AUTO_EMOJI_CLEANUP_KEY)!)).toMatchObject({ pending: [], cleared: 1 });
  });

  it("an offline host (or a failed write) stays pending and is cleared on a later start", async () => {
    seed("away", pick("away"), {}, "B"); seed("flaky", pick("flaky")); saved(key("away", "B"), key("flaky"));
    fixture.loaded = new Set(["A"]);
    fixture.action.mockRejectedValueOnce(new Error("fetch failed"));
    await run(); stop?.();
    expect(loadCleanupState().pending.sort()).toEqual([key("away", "B"), key("flaky")].sort());
    expect(fixture.notify).not.toHaveBeenCalled();
    // Next start: B is online.
    fixture.loaded = new Set(["A", "B"]);
    await run();
    expect(fixture.entries.get("away").session.avatar).toBeNull();
    expect(fixture.entries.get("flaky").session.avatar).toBeNull();
    expect(fixture.notify).toHaveBeenCalledExactlyOnceWith("avatar.autoEmojiCleared:2", "info");
    expect(loadCleanupState().pending).toEqual([]);
  });

  it("an unknown Profile list waits; it runs again when the host's sidebar arrives", async () => {
    seed("auto", pick("auto")); saved(key("auto"));
    fixture.known = false;
    await run();
    expect(fixture.action).not.toHaveBeenCalled();
    fixture.known = true;
    useApp.setState({ sidebar: {} } as never);
    await vi.advanceTimersByTimeAsync(2100);
    expect(fixture.action).toHaveBeenCalledTimes(1);
  });

  it("nothing auto-saved: no writes, no notice, done", async () => {
    seed("own", pick("own"));
    await run();
    expect(fixture.action).not.toHaveBeenCalled(); expect(fixture.notify).not.toHaveBeenCalled();
    expect(loadCleanupState().pending).toEqual([]);
  });
});
