// 头像主题 per Profile (lib/avatarThemes) and 默认头像 = 仅重要智能体 (lib/avatarDefault, owner 2026-10-18).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_EMOJI_SET, defaultEmoji, seedHash } from "../src/renderer/src/lib/agentEmoji";
import { AVATAR_THEME_IDS, avatarThemesOf, defaultAvatarTheme, defaultAvatarThemes, isAvatarTheme, modelFamily, normalizeAvatarThemes, themedEmoji, themeEmoji, themePreview, themesEmoji } from "../src/renderer/src/lib/avatarThemes";
import { AGENT_AVATAR_DEFAULT_REV, AGENT_AVATAR_DEFAULTS, DEFAULT_AGENT_AVATAR, avatarSwitchOf, drawsEmoji, hiddenAvatar, isMinorAgent, migrateAgentAvatarDefault, minorDotSize, shownAvatar } from "../src/renderer/src/lib/avatarDefault";

describe("avatar themes", () => {
  it("every theme is a subset of the bundled set with at least 8 distinct emoji", () => {
    const bundled = new Set(AVATAR_EMOJI_SET.map((e) => e.code));
    for (const id of AVATAR_THEME_IDS) {
      const set = themeEmoji(id);
      expect(set.length, id).toBeGreaterThanOrEqual(8);
      expect(new Set(set.map((e) => e.code)).size, id).toBe(set.length);
      for (const e of set) expect(bundled.has(e.code), `${id} ${e.code}`).toBe(true);
    }
    expect(themeEmoji("all")).toBe(AVATAR_EMOJI_SET);
  });

  it("themes hold what they say", () => {
    expect(themeEmoji("sea").map((e) => e.glyph)).toEqual(expect.arrayContaining(["🐙", "🐬", "🐋", "🐠", "🦀"]));
    expect(themeEmoji("gems")[0]!.glyph).toBe("💎");
    expect(themeEmoji("animals").map((e) => e.glyph)).toContain("🦊");
    expect(themeEmoji("animals").map((e) => e.glyph)).not.toContain("🐋");
    expect(themeEmoji("plants").every((e) => e.group === "plants")).toBe(true);
    expect(themeEmoji("food").every((e) => e.group === "food")).toBe(true);
    expect(themeEmoji("sky").map((e) => e.glyph)).toEqual(expect.arrayContaining(["🚀", "⭐", "🌈"]));
  });

  it("preview row = the first 6 of the theme", () => {
    for (const id of AVATAR_THEME_IDS) expect(themePreview(id)).toEqual(themeEmoji(id).slice(0, 6));
  });

  it("the pick is stable per agent and theme, inside the theme, and 全部 (every theme / none) matches the old default", () => {
    const ids = ["0b6f7c2e-1d1a-4b7e-9a51-6a2f3c4d5e6f", "demo-director-r2", "a", "lab-analysis-r1"];
    for (const id of ids) {
      expect(themedEmoji(id, AVATAR_THEME_IDS)).toBe(defaultEmoji(id));
      expect(themedEmoji(id)).toBe(defaultEmoji(id));
      expect(themedEmoji(id, [])).toBe(defaultEmoji(id));
      for (const theme of AVATAR_THEME_IDS) {
        const e = themedEmoji(id, [theme]);
        expect(themedEmoji(id, [theme])).toBe(e);
        expect(themeEmoji(theme)).toContain(e);
        expect(e).toBe(themeEmoji(theme)[seedHash(id) % themeEmoji(theme).length]);
      }
    }
    // Pinned so a reorder of a theme list is noticed (every device must agree).
    expect(ids.map((id) => themedEmoji(id, ["sea"]).code)).toMatchInlineSnapshot(`
      [
        "1f419",
        "1f420",
        "1f419",
        "26f5",
      ]
    `);
  });

  it("spreads agents over a small theme", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(themedEmoji(`agent-${i}`, ["sky"]).code);
    expect(seen.size).toBe(themeEmoji("sky").length);
  });

  it("several themes: their union in canonical order, duplicates once, the same whatever order they were ticked in", () => {
    const union = themesEmoji(["sky", "gems"]);
    expect(themesEmoji(["gems", "sky", "gems"])).toBe(union);
    const codes = union.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    // gems first (canonical order), then the sky pictures gems does not already have.
    expect(codes.slice(0, themeEmoji("gems").length)).toEqual(themeEmoji("gems").map((e) => e.code));
    expect(codes).toEqual(expect.arrayContaining(themeEmoji("sky").map((e) => e.code)));
    expect(codes.length).toBeLessThan(themeEmoji("gems").length + themeEmoji("sky").length); // ⭐ 🔭 🧭 shared
    for (const id of ["a", "demo-director-r2"]) expect(themedEmoji(id, ["sky", "gems"])).toBe(union[seedHash(id) % union.length]);
    expect(themePreview(["sky", "gems"])).toEqual(union.slice(0, 6));
  });

  it("stored choices normalise: known ids, canonical order, legacy single id and 全部", () => {
    expect(normalizeAvatarThemes(["sky", "sea", "sky"])).toEqual(["sea", "sky"]);
    expect(normalizeAvatarThemes("food")).toEqual(["food"]);
    expect(normalizeAvatarThemes("all")).toEqual([...AVATAR_THEME_IDS]);
    expect(normalizeAvatarThemes(["birds", "cats"])).toBeNull(); // cutex ids without pictures here yet
    expect(normalizeAvatarThemes(["birds", "sea"])).toEqual(["sea"]);
    expect(normalizeAvatarThemes([])).toBeNull();
    expect(normalizeAvatarThemes(null)).toBeNull();
    expect(normalizeAvatarThemes(7)).toBeNull();
  });
});

describe("model family → default theme", () => {
  it.each([
    [{ cliKind: "claude", model: null }, "claude", "animals"],
    [{ cliKind: "claude", model: "sonnet" }, "claude", "animals"],
    [{ cliKind: "codex", model: "claude-opus-4-1" }, "claude", "animals"],
    [{ model: "opus" }, "claude", "animals"],
    [{ model: "gpt-5.5" }, "openai", "gems"],
    [{ model: "GPT-6-Astra" }, "openai", "gems"],
    [{ model: "o3" }, "openai", "gems"],
    [{ model: "o4-mini" }, "openai", "gems"],
    [{ model: "gpt-5.2-codex" }, "openai", "gems"],
    [{ model: "codex-mini-latest" }, "openai", "gems"],
    [{ model: "openai/gpt-oss-120b" }, "openai", "gems"],
    [{ model: "deepseek-v4-flash" }, "deepseek", "sea"],
    [{ model: "deepseek-ai/DeepSeek-V4" }, "deepseek", "sea"],
    [{ model: "glm-5.3" }, "other", "all"],
    [{ model: "kimi-k3" }, "other", "all"],
    [{ model: "gemini-3.8-flash" }, "other", "all"],
    [{ model: "qwen3-coder" }, "other", "all"],
    [{ model: "omni-moderation" }, "other", "all"],
    [{ model: null }, "other", "all"],
    [{}, "other", "all"],
  ] as const)("%o → %s / %s", (profile, family, theme) => {
    expect(modelFamily(profile)).toBe(family);
    expect(defaultAvatarTheme(profile)).toBe(theme);
    expect(defaultAvatarThemes(profile)).toEqual(theme === "all" ? [...AVATAR_THEME_IDS] : [theme]);
  });

  it("never looks at the base URL / provider name", () => {
    const relay = { model: "glm-5.3", cliKind: "codex", provider: "openai", baseUrl: "https://api.openai.com/v1" };
    expect(defaultAvatarTheme(relay)).toBe("all");
  });

  it("the owner's choice wins; an unknown stored value falls back to the family", () => {
    expect(avatarThemesOf({ model: "gpt-5.5" }, ["food", "sea"])).toEqual(["sea", "food"]);
    expect(avatarThemesOf({ model: "gpt-5.5" }, null)).toEqual(["gems"]);
    expect(avatarThemesOf({ model: "gpt-5.5" }, ["bogus"])).toEqual(["gems"]);
    expect(avatarThemesOf({ model: "glm-5.3" }, null)).toEqual([...AVATAR_THEME_IDS]);
    expect(isAvatarTheme("sea")).toBe(true);
    expect(isAvatarTheme("ocean")).toBe(false);
  });
});

describe("默认头像 migration", () => {
  it("new installs get 仅重要智能体", () => {
    expect(DEFAULT_AGENT_AVATAR).toBe("important");
    expect(AGENT_AVATAR_DEFAULTS).toEqual(["emoji", "letter", "important"]);
    expect(migrateAgentAvatarDefault(undefined, undefined)).toBe("important");
    expect(migrateAgentAvatarDefault("bogus", AGENT_AVATAR_DEFAULT_REV)).toBe("important");
  });

  it("the old default (emoji) saved before the rev moves once; an explicit letter stays", () => {
    expect(migrateAgentAvatarDefault("emoji", undefined)).toBe("important");
    expect(migrateAgentAvatarDefault("emoji", 0)).toBe("important");
    expect(migrateAgentAvatarDefault("letter", undefined)).toBe("letter");
  });

  it("after the migration a chosen emoji stays", () => {
    expect(migrateAgentAvatarDefault("emoji", AGENT_AVATAR_DEFAULT_REV)).toBe("emoji");
    expect(migrateAgentAvatarDefault("important", AGENT_AVATAR_DEFAULT_REV)).toBe("important");
  });

  it("only 字母 draws no emoji", () => {
    expect(drawsEmoji("emoji")).toBe(true);
    expect(drawsEmoji("important")).toBe(true);
    expect(drawsEmoji("letter")).toBe(false);
  });
});

describe("prefs: 默认头像 + 头像主题 storage", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("an old stored emoji loads as important and is saved with the rev; letter is kept", async () => {
    storage.set("cutex-desktop.ui", JSON.stringify({ agentAvatarDefault: "emoji" }));
    let prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.getUiPrefs().agentAvatarDefault).toBe("important");
    prefs.setUiPref("agentAvatarDefault", "emoji");
    expect(JSON.parse(storage.get("cutex-desktop.ui")!)).toMatchObject({ agentAvatarDefault: "emoji", agentAvatarDefaultRev: AGENT_AVATAR_DEFAULT_REV });
    vi.resetModules();
    prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.getUiPrefs().agentAvatarDefault).toBe("emoji");

    storage.set("cutex-desktop.ui", JSON.stringify({ agentAvatarDefault: "letter" }));
    vi.resetModules();
    prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.getUiPrefs().agentAvatarDefault).toBe("letter");
  });

  it("local theme choices are per host + profile id, cleared with null; old single ids and 全部 migrate, bad entries dropped", async () => {
    storage.set("cutex-desktop.ui", JSON.stringify({ avatarThemes: { '["local","p1"]': "sea", bare: "sea", '["local","p2"]': "ocean", '["local","p3"]': "all", '["local","p4"]': ["sky", "sea", "sky"] } }));
    const prefs = await import("../src/renderer/src/lib/prefs");
    expect(prefs.getUiPrefs().avatarThemes).toEqual({ '["local","p1"]': ["sea"], '["local","p3"]': [...AVATAR_THEME_IDS], '["local","p4"]': ["sea", "sky"] });
    expect(prefs.avatarThemesOverride("local", "p1")).toEqual(["sea"]);
    expect(prefs.avatarThemeOverride("local", "p1")).toBe("sea");
    expect(prefs.avatarThemeOverride("local", "p4")).toBeNull(); // the old one-of picker shows several as automatic
    expect(prefs.avatarThemesOverride("hosta", "p1")).toBeNull();
    prefs.setAvatarThemeOverride("hosta", "p1", "food");
    expect(prefs.avatarThemesOverride("hosta", "p1")).toEqual(["food"]);
    prefs.setAvatarThemeOverride("hosta", "p1", ["sky", "food"]);
    expect(prefs.avatarThemesOverride("hosta", "p1")).toEqual(["food", "sky"]);
    prefs.setAvatarThemeOverride("local", "p1", null);
    prefs.setAvatarThemeOverride("local", "p3", []);
    prefs.setAvatarThemeOverride("local", "p4", null);
    expect(prefs.avatarThemesOverride("local", "p1")).toBeNull();
    expect(JSON.parse(storage.get("cutex-desktop.ui")!).avatarThemes).toEqual({ '["hosta","p1"]': ["food", "sky"] });
  });

  it("a host with profile-avatar: reads its themes, writes go to the host, local choices are uploaded once", async () => {
    storage.set("cutex-desktop.ui", JSON.stringify({ avatarThemes: { '["hosta","p1"]': "sea", '["hosta","p2"]': "food", '["local","p1"]': "sky" } }));
    const prefs = await import("../src/renderer/src/lib/prefs");
    const looks = await import("../src/renderer/src/lib/profileLooks");
    const patchProfile = vi.fn(async (id: string, patch: { avatarThemes?: string[] | null }) => ({ appearance: { avatarThemes: patch.avatarThemes ?? null } }));
    looks.setProfileLooksApi(() => ({ patchProfile, profileImage: vi.fn(), putProfileImage: vi.fn() }) as never);
    const look = (id: string, avatarThemes: string[] | null) => ({ id, name: id, model: "gpt-5.5", cliKind: "codex", avatarEtag: null, introPortraitEtag: null, appearance: { color: null, effectiveColor: null, providerCategory: null, avatarThemes } });
    // p1 has no host choice: the local one goes up; p2 already has one on the host: kept there, local stays.
    looks.noteProfileLooks("hosta", [look("p1", null), look("p2", ["cats", "gems"])]);
    await vi.waitFor(() => expect(patchProfile).toHaveBeenCalledTimes(1));
    expect(patchProfile).toHaveBeenCalledWith("p1", { avatarThemes: ["sea"] });
    await vi.waitFor(() => expect(prefs.localAvatarThemes("hosta", "p1")).toBeNull());
    expect(prefs.localAvatarThemes("hosta", "p2")).toEqual(["food"]);
    expect(prefs.avatarThemesOverride("hosta", "p1")).toEqual(["sea"]);
    expect(prefs.avatarThemesOverride("hosta", "p2")).toEqual(["gems"]); // "cats" has no pictures here yet
    // A second list of the same host in this run does not import again.
    looks.noteProfileLooks("hosta", [look("p1", ["sea"]), look("p2", ["cats", "gems"])]);
    // Writes go to the host (shown at once).
    prefs.setAvatarThemeOverride("hosta", "p2", ["sky", "sea"]);
    expect(prefs.avatarThemesOverride("hosta", "p2")).toEqual(["sea", "sky"]);
    await vi.waitFor(() => expect(patchProfile).toHaveBeenLastCalledWith("p2", { avatarThemes: ["sea", "sky"] }));
    expect(patchProfile).toHaveBeenCalledTimes(2);
    // An older host (no avatarEtag in its list) keeps this device's choice.
    looks.noteProfileLooks("local", [{ id: "p1", name: "p1", model: null, cliKind: "codex", appearance: { color: null, effectiveColor: null, providerCategory: null } }]);
    expect(looks.profileLooksSynced("local")).toBe(false);
    expect(prefs.avatarThemesOverride("local", "p1")).toEqual(["sky"]);
    looks.resetProfileLooksForTest();
  });
});

describe("仅重要智能体: who gets the dot", () => {
  const plain = { isDirector: false, pinned: false, avatar: null, picture: null };
  it("a plain agent gets the dot only in important mode", () => {
    expect(isMinorAgent("important", plain)).toBe(true);
    expect(isMinorAgent("emoji", plain)).toBe(false);
    expect(isMinorAgent("letter", plain)).toBe(false);
  });

  it("Directors, pinned and custom-avatar agents keep the avatar", () => {
    expect(isMinorAgent("important", { ...plain, isDirector: true })).toBe(false);
    expect(isMinorAgent("important", { ...plain, pinned: true })).toBe(false);
    expect(isMinorAgent("important", { ...plain, avatar: { kind: "emoji", value: "🦊" } })).toBe(false);
    expect(isMinorAgent("important", { ...plain, avatar: { kind: "icon", value: "desktop-picture:x" } })).toBe(false);
    expect(isMinorAgent("important", { ...plain, picture: "data:image/png;base64,AAAA" })).toBe(false);
  });

  it("selection plays no part: an open plain agent still gets the dot (no flicker while clicking around)", () => {
    // The facts carry no selection at all; extra fields (an old caller's `open`) are ignored.
    expect(isMinorAgent("important", { ...plain, open: true } as typeof plain)).toBe(true);
    expect(isMinorAgent("important", { ...plain, open: false } as typeof plain)).toBe(true);
  });

  it("a colour-only avatar is no picture: still the dot (in its colour)", () => {
    expect(isMinorAgent("important", { ...plain, avatar: { kind: "color", value: "#40c057" } })).toBe(true);
  });

  it("the dot is ≈ 8 px in rows, smaller in 16 px slots", () => {
    expect(minorDotSize(28)).toBe(8);
    expect(minorDotSize(18)).toBe(8);
    expect(minorDotSize(16)).toBe(6);
  });
});

describe("仅重要智能体: 显示头像 / 隐藏头像", () => {
  const plain = { isDirector: false, pinned: false, avatar: null };
  it("a dot agent offers 显示头像, an emoji / icon avatar 隐藏头像", () => {
    expect(avatarSwitchOf("important", plain)).toBe("show");
    expect(avatarSwitchOf("important", { ...plain, avatar: { kind: "color", value: "#40c057" } })).toBe("show");
    expect(avatarSwitchOf("important", { ...plain, avatar: { kind: "emoji", value: "🦊" } })).toBe("hide");
    expect(avatarSwitchOf("important", { ...plain, avatar: { kind: "icon", value: "lucide:star" } })).toBe("hide");
  });

  it("nothing for Directors, pinned agents, pictures and the other modes", () => {
    expect(avatarSwitchOf("important", { ...plain, isDirector: true })).toBeNull();
    expect(avatarSwitchOf("important", { ...plain, pinned: true, avatar: { kind: "emoji", value: "🦊" } })).toBeNull();
    expect(avatarSwitchOf("important", { ...plain, avatar: { kind: "icon", value: "desktop-picture:01234567-89ab-cdef-0123-456789abcdef" } })).toBeNull();
    expect(avatarSwitchOf("emoji", plain)).toBeNull();
    expect(avatarSwitchOf("letter", { ...plain, avatar: { kind: "emoji", value: "🦊" } })).toBeNull();
  });

  it("显示头像 writes the theme default emoji (an own colour stays where the host combines)", () => {
    const glyph = themedEmoji("agent-1", ["gems"]).glyph;
    expect(shownAvatar(glyph, null, true)).toEqual({ kind: "emoji", value: glyph });
    expect(shownAvatar(glyph, { kind: "color", value: "#40C057" }, true)).toEqual({ kind: "emoji", value: glyph, color: "#40c057" });
    expect(shownAvatar(glyph, { kind: "color", value: "#40c057" }, false)).toEqual({ kind: "emoji", value: glyph });
  });

  it("隐藏头像 clears the avatar, keeping an own colour as a colour avatar", () => {
    expect(hiddenAvatar({ kind: "emoji", value: "🦊" })).toBeNull();
    expect(hiddenAvatar({ kind: "emoji", value: "🦊", color: "#7950F2" })).toEqual({ kind: "color", value: "#7950f2" });
  });
});
