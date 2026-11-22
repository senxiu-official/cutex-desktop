import type { ProfilePatch } from "./ipc";
import { isPortraitThemeKey } from "./portraitDefaults";

export const PROFILE_PORTRAIT_THEME_32_FEATURE = "profile-avatar-style-theme-32";
export const PROFILE_PORTRAIT_THEME_MAX = 128;

export interface ProfilePortraitThemeProblem {
  kind: "invalidReferences" | "duplicateThemes" | "emptyThemes" | "tooManyThemes";
  references: string[];
  maxThemeLength: 20 | 32;
}

export function portraitThemeFeatures(caps: { featureList?: readonly string[]; features?: Readonly<Record<string, unknown>> } | null | undefined): ReadonlySet<string> {
  const features = new Set(caps?.featureList ?? []);
  if (caps?.features?.profileAvatarStyleTheme32 === true) features.add(PROFILE_PORTRAIT_THEME_32_FEATURE);
  return features;
}

/** Contract validation is per target host; missing packs never make a reference invalid. */
export function profilePortraitThemeProblem(style: ProfilePatch["avatarStyle"], features: ReadonlySet<string>): ProfilePortraitThemeProblem | null {
  if (style?.kind !== "portrait") return null;
  const maxThemeLength = features.has(PROFILE_PORTRAIT_THEME_32_FEATURE) ? 32 : 20;
  const references = style.portraitThemes;
  if (!Array.isArray(references) || !references.length) return { kind: "emptyThemes", references: [], maxThemeLength };
  if (references.length > PROFILE_PORTRAIT_THEME_MAX) return { kind: "tooManyThemes", references: [...references], maxThemeLength };
  const invalid = references.filter(ref => !isPortraitThemeKey(ref) || ref.split("/")[1]!.length > maxThemeLength);
  if (invalid.length) return { kind: "invalidReferences", references: [...new Set(invalid)], maxThemeLength };
  const seen = new Set<string>();
  const duplicates = references.filter(ref => {
    if (seen.has(ref)) return true;
    seen.add(ref);
    return false;
  });
  return duplicates.length ? { kind: "duplicateThemes", references: [...new Set(duplicates)], maxThemeLength } : null;
}

/** Save other fields while the caller retains and explains the blocked style draft. No IDs are rewritten. */
export function prepareProfilePortraitPatch(patch: ProfilePatch, features: ReadonlySet<string>): { patch: ProfilePatch; problem: ProfilePortraitThemeProblem | null } {
  const problem = profilePortraitThemeProblem(patch.avatarStyle, features);
  const body = { ...patch };
  for (const key of Object.keys(body) as (keyof ProfilePatch)[]) {
    if (body[key] === undefined) delete body[key];
  }
  if (problem) {
    delete body.avatarStyle;
    delete body.avatarStyleImportIfUnset;
  }
  return { patch: body, problem };
}

export class ProfilePortraitThemeError extends Error {
  constructor(readonly problem: ProfilePortraitThemeProblem) {
    super(`invalid_portrait_themes: ${problem.references.join(", ") || problem.kind} (theme limit ${problem.maxThemeLength})`);
    this.name = "ProfilePortraitThemeError";
  }
}
