import { describe, expect, it } from "vitest";
import { isPackId, isThemeId, parsePackManifest } from "../src/shared/portraitPacks";
import { DEFAULT_PORTRAIT_THEMES, isPortraitThemeKey } from "../src/shared/portraitDefaults";
import { portraitThemeFeatures, prepareProfilePortraitPatch, profilePortraitThemeProblem, PROFILE_PORTRAIT_THEME_32_FEATURE } from "../src/shared/profilePortraitThemes";

const legacy = new Set(["profile-avatar-style"]);
const current = new Set([...legacy, PROFILE_PORTRAIT_THEME_32_FEATURE]);
const mountain = "kit-20261029/mountain-city-myriad-layers";
const university = "kit-20261029/university-universalis";

describe("portrait theme identifiers across host versions", () => {
  it("identifies the two shipped themes rejected by r289 and preserves their exact references", () => {
    const style = { kind: "portrait" as const, portraitThemes: [...DEFAULT_PORTRAIT_THEMES] };
    expect(profilePortraitThemeProblem(style, legacy)).toEqual({ kind: "invalidReferences", references: [mountain, university], maxThemeLength: 20 });
    expect(profilePortraitThemeProblem(style, current)).toBeNull();
    expect(style.portraitThemes).toEqual(DEFAULT_PORTRAIT_THEMES);
  });

  it("keeps the unsupported style draft intact while preparing unrelated fields for save", () => {
    const style = { kind: "portrait" as const, portraitThemes: [mountain] };
    const draft = { name: "Renamed", model: "example-model", avatarStyle: style, avatarStyleImportIfUnset: true as const };
    const prepared = prepareProfilePortraitPatch(draft, legacy);
    expect(prepared.patch).toEqual({ name: "Renamed", model: "example-model" });
    expect(prepared.problem?.references).toEqual([mountain]);
    expect(draft.avatarStyle).toBe(style);
    expect(style.portraitThemes).toEqual([mountain]);
    expect(prepareProfilePortraitPatch(draft, current)).toEqual({ patch: draft, problem: null });
  });

  it("does not depend on whether a valid pack is installed, and leaves emoji, letter and clear alone", () => {
    expect(profilePortraitThemeProblem({ kind: "portrait", portraitThemes: ["uninstalled/theme"] }, legacy)).toBeNull();
    for (const avatarStyle of [null, { kind: "letter" as const }, { kind: "emoji" as const, emojiThemes: null }]) {
      expect(prepareProfilePortraitPatch({ avatarStyle }, legacy)).toEqual({ patch: { avatarStyle }, problem: null });
    }
  });

  it("omits undefined fields while preserving explicit clears when preparing a partial save", () => {
    const draft = { name: undefined, color: null, avatarStyle: { kind: "portrait" as const, portraitThemes: [mountain] } };
    expect(prepareProfilePortraitPatch(draft, legacy).patch).toEqual({ color: null });
    expect(Object.hasOwn(draft, "name")).toBe(true);
  });

  it("matches count, uniqueness and exact ASCII path-safe boundaries", () => {
    const style = (portraitThemes: string[]) => ({ kind: "portrait" as const, portraitThemes });
    expect(profilePortraitThemeProblem(style([`${"a".repeat(20)}/${"b".repeat(32)}`]), current)).toBeNull();
    for (const ref of [`${"a".repeat(21)}/theme`, `pack/${"b".repeat(33)}`, "../theme", "pack/../theme", "pack/theme/extra", "pack\\theme", "Pack/theme", "pack/theme_name", "pack/山城万象", "pack/-theme", "pack/theme\n"]) {
      expect(profilePortraitThemeProblem(style([ref]), current)?.kind, ref).toBe("invalidReferences");
    }
    expect(profilePortraitThemeProblem(style([]), current)?.kind).toBe("emptyThemes");
    expect(profilePortraitThemeProblem(style(["pack/theme", "pack/theme"]), current)?.kind).toBe("duplicateThemes");
    expect(profilePortraitThemeProblem(style(Array.from({ length: 128 }, (_, i) => `pack/theme-${i}`)), current)).toBeNull();
    expect(profilePortraitThemeProblem(style(Array.from({ length: 129 }, (_, i) => `pack/theme-${i}`)), current)?.kind).toBe("tooManyThemes");
  });

  it("accepts the explicit additive capability only for the target host", () => {
    expect(portraitThemeFeatures({ features: { profileAvatarStyleTheme32: true } }).has(PROFILE_PORTRAIT_THEME_32_FEATURE)).toBe(true);
    expect(portraitThemeFeatures(null).has(PROFILE_PORTRAIT_THEME_32_FEATURE)).toBe(false);
    expect(portraitThemeFeatures({ features: { profileAvatarStyleTheme32: false } }).has(PROFILE_PORTRAIT_THEME_32_FEATURE)).toBe(false);
  });
});

it("validates pack/theme IDs when reading manifests without renaming legitimate catalog IDs", () => {
  const entry = (theme: string) => ({ theme, model: "claude", avatarPath: "avatars/face/claude-v1.png" });
  const data = parsePackManifest({ schemaVersion: 1, entries: [entry("mountain-city-myriad-layers"), entry("theme\n"), entry("a".repeat(33))] });
  expect(data?.themes.map(theme => theme.id)).toEqual(["mountain-city-myriad-layers"]);
  expect(isPackId("pack\n")).toBe(false);
  expect(isThemeId("theme\n")).toBe(false);
  expect(isPortraitThemeKey("pack/theme\n")).toBe(false);
});
