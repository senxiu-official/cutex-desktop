/** The owner's 2026-10-29 kit, in catalog themes.order. IDs are independent of asset paths. */
export const DEFAULT_PORTRAIT_PACK = "kit-20261029";
export const DEFAULT_PORTRAIT_THEME_IDS = [
  "cloud-woven-silks", "great-ming", "tales-of-frills", "ad-astra", "mountain-city-myriad-layers",
  "snowy-owl-post", "girls-night-in", "misty-city-cyberpunk", "silver-snow-i", "mortal-world",
  "metropolitan-muses", "university-universalis", "uniform-revolution", "sunlit-shores", "southern-cross",
  "beyond-spotlight", "little-callings", "season-letters", "lanterns-after-dark", "kindred-creatures",
] as const;
export const DEFAULT_PORTRAIT_THEMES = DEFAULT_PORTRAIT_THEME_IDS.map(id => `${DEFAULT_PORTRAIT_PACK}/${id}`);
export const isPortraitThemeKey = (key: unknown): key is string => typeof key === "string" && /^[a-z0-9][a-z0-9-]{0,19}\/[a-z0-9][a-z0-9-]{0,31}$/.test(key);

const OLD_THEMES: Record<string, string> = {
  lolita: "tales-of-frills", wizarding: "snowy-owl-post", "pajama-party": "girls-night-in", "street-food": "mortal-world",
  miao: "cloud-woven-silks", tibetan: "silver-snow-i", office: "metropolitan-muses",
  "chinese-school": "uniform-revolution", "western-school": "uniform-revolution", "japanese-school": "uniform-revolution",
  "french-aristocracy": "tales-of-frills", "animal-friends": "kindred-creatures", "summer-beach": "sunlit-shores",
  "australian-life": "southern-cross", "anu-campus": "university-universalis", "ecn-campus": "university-universalis",
  aerospace: "ad-astra", "buaa-campus": "university-universalis",
};
/** Retire the test pack without leaving selected themes empty; explicit off and user packs stay intact. */
export function migratePortraitThemes(keys: readonly string[]): string[] {
  return [...new Set(keys.flatMap(key => key.startsWith("overnight-test-v1/")
    ? [`${DEFAULT_PORTRAIT_PACK}/${OLD_THEMES[key.slice("overnight-test-v1/".length)] ?? DEFAULT_PORTRAIT_THEME_IDS[0]}`]
    : [key]))];
}
