// 头像主题 (owner idea 2026-10-18): each Profile draws its agents' default emoji from a themed subset
// of the bundled set (lib/agentEmoji), so a glance at the sidebar tells Claude agents (animals) from
// GPT ones (treasures) and DeepSeek ones (sea creatures). Pure: no React, no store.
//
// The default themes come from the Profile's model family — its model id and runtime (cliKind) only,
// never its base URL / provider name (no relay or domain special-casing). The owner can tick other
// themes per Profile (a multi-select, never empty): stored on the host as the Profile's
// `appearance.avatarThemes` (cutex `profile-avatar`), else device-local (prefs `avatarThemes`, keyed
// by hostKey(host id, profile id)) on older hosts. An agent's default emoji comes from the union of
// its Profile's themes in canonical order (AVATAR_THEME_IDS), so it is the same on every device.
// "全部" is not a stored id: it means every theme ticked, which picks from the whole bundled set (the
// pick from before themes existed).
//
// Every theme is a subset of the 80 bundled pictures; nothing new is bundled (the set has no
// fetch / build pipeline). The set holds only one real gem (💎), so 宝石 is "gems & treasures":
// 💎 with the precious / crafted things (key, compass, telescope, guitar …). 星空 has six sky
// pictures and borrows the kite and compass (the sky / star navigation) to reach eight.
import { AVATAR_EMOJI_SET, seedHash, type AvatarEmoji } from "./agentEmoji";

/** Themes this desktop has pictures for. cutex knows more ids (its `detail.avatarThemeOptions`); an id
 *  the desktop has no pictures for yet is ignored when picking (kept on the host). */
export type AvatarThemeId = "animals" | "sea" | "gems" | "plants" | "food" | "sky";

/** Canonical order: the picker's order and the order the union of several themes is built in. */
export const AVATAR_THEME_IDS: readonly AvatarThemeId[] = ["animals", "sea", "gems", "plants", "food", "sky"];

export const isAvatarTheme = (v: unknown): v is AvatarThemeId => typeof v === "string" && (AVATAR_THEME_IDS as readonly string[]).includes(v);

/**
 * A stored theme choice as known ids in canonical order, duplicates dropped; the legacy single id is
 * `[id]` and the legacy "all" every theme. null: nothing usable (= by model family).
 */
export function normalizeAvatarThemes(value: unknown): AvatarThemeId[] | null {
  const list = value === "all" ? AVATAR_THEME_IDS : typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const set = new Set(list.flatMap((v) => (v === "all" ? AVATAR_THEME_IDS : [v])));
  const ids = AVATAR_THEME_IDS.filter((id) => set.has(id));
  return ids.length ? ids : null;
}

/** Every known theme ticked (= the whole bundled set). */
const everyTheme = (themes: readonly AvatarThemeId[]): boolean => AVATAR_THEME_IDS.every((id) => themes.includes(id));

/** Model family of a Profile, by model id / runtime only. */
export type ModelFamily = "claude" | "openai" | "deepseek" | "other";

// Code points (as in lib/agentEmoji ROWS). Order is part of the pick: append only, never reorder.
const SEA = ["1f419", "1f422", "1f42c", "1f40b", "1f420", "1f980", "1f9a6", "1f427", "26f5"];
const GEMS = ["1f48e", "1f511", "1f9ed", "1f52d", "1f4a1", "1f9e9", "1f3b8", "1f3a8", "1f4da", "2b50"];
const SKY = ["1f680", "2b50", "1f308", "2744-fe0f", "2601-fe0f", "1f52d", "1fa81", "1f9ed"];
/** Pure sea creatures leave 动物 (the penguin, turtle and otter stay in both). */
const SEA_ONLY = new Set(["1f419", "1f42c", "1f40b", "1f420", "1f980"]);

const byCode = new Map(AVATAR_EMOJI_SET.map((e) => [e.code, e]));
const pick = (codes: readonly string[]): AvatarEmoji[] => codes.map((c) => byCode.get(c)).filter((e): e is AvatarEmoji => !!e);

const THEMES: Record<AvatarThemeId, readonly AvatarEmoji[]> = {
  animals: AVATAR_EMOJI_SET.filter((e) => e.group === "animals" && !SEA_ONLY.has(e.code)),
  sea: pick(SEA),
  gems: pick(GEMS),
  plants: AVATAR_EMOJI_SET.filter((e) => e.group === "plants"),
  food: AVATAR_EMOJI_SET.filter((e) => e.group === "food"),
  sky: pick(SKY),
};

/** One theme's emoji ("all" or an unknown id: the whole bundled set). */
export function themeEmoji(theme: AvatarThemeId | "all"): readonly AvatarEmoji[] {
  return (theme !== "all" && THEMES[theme]) || AVATAR_EMOJI_SET;
}

const unions = new Map<string, readonly AvatarEmoji[]>();

/**
 * The emoji of several themes: their union in canonical theme order, duplicates removed. No themes
 * (null / empty / only unknown ids) or every theme: the whole bundled set in its original order, the
 * pick from before themes existed.
 */
export function themesEmoji(themes: readonly AvatarThemeId[] | null | undefined): readonly AvatarEmoji[] {
  const ids = normalizeAvatarThemes(themes ?? []);
  if (!ids || everyTheme(ids)) return AVATAR_EMOJI_SET;
  const key = ids.join(",");
  let set = unions.get(key);
  if (!set) {
    const seen = new Set<string>();
    set = ids.flatMap((id) => THEMES[id]).filter((e) => !seen.has(e.code) && (seen.add(e.code), true));
    unions.set(key, set);
  }
  return set;
}

/** The default emoji of an agent (seed = its cutexSessionId) within its Profile's themes: stable per agent and theme set, the same on every device. */
export function themedEmoji(seed: string, themes?: readonly AvatarThemeId[] | null): AvatarEmoji {
  const set = themesEmoji(themes);
  return set[seedHash(seed) % set.length]!;
}

/** The first `n` emoji of a theme or theme set (the picker's preview row; "all" = the whole set). */
export function themePreview(theme: AvatarThemeId | "all" | readonly AvatarThemeId[], n = 6): readonly AvatarEmoji[] {
  return (typeof theme === "string" ? themeEmoji(theme) : themesEmoji(theme)).slice(0, n);
}

const CLAUDE_MODEL = /(^|[^a-z])(claude|opus|sonnet|haiku)([^a-z]|$)/;
const OPENAI_MODEL = /^(gpt|chatgpt|codex|o\d+)([^a-z]|$)|(^|[^a-z])codex([^a-z]|$)/;

/** A Profile's model family: Claude by runtime or model id, GPT / o-series / codex, DeepSeek, else other. */
export function modelFamily(p: { model?: string | null; cliKind?: string | null }): ModelFamily {
  if (p.cliKind === "claude") return "claude";
  // Strip an `org/` prefix (openai/gpt-5.5, deepseek-ai/deepseek-v4) so the id itself is matched.
  const model = (p.model ?? "").trim().toLowerCase().replace(/^.*\//, "");
  if (!model) return "other";
  if (CLAUDE_MODEL.test(model)) return "claude";
  if (model.includes("deepseek")) return "deepseek";
  if (OPENAI_MODEL.test(model)) return "openai";
  return "other";
}

const FAMILY_THEME: Record<ModelFamily, AvatarThemeId | "all"> = { claude: "animals", openai: "gems", deepseek: "sea", other: "all" };

/** The single theme a Profile gets unless the owner picked some ("all" = every theme; the legacy picker's label). */
export function defaultAvatarTheme(p: { model?: string | null; cliKind?: string | null }): AvatarThemeId | "all" {
  return FAMILY_THEME[modelFamily(p)];
}

/** The themes a Profile gets unless the owner ticked some. */
export function defaultAvatarThemes(p: { model?: string | null; cliKind?: string | null }): AvatarThemeId[] {
  const theme = defaultAvatarTheme(p);
  return theme === "all" ? [...AVATAR_THEME_IDS] : [theme];
}

/** The themes in effect: the owner's choice for this Profile (stored ids; unusable = none), else the model family's. */
export function avatarThemesOf(p: { model?: string | null; cliKind?: string | null }, chosen: readonly string[] | null | undefined): AvatarThemeId[] {
  return normalizeAvatarThemes(chosen ?? null) ?? defaultAvatarThemes(p);
}
