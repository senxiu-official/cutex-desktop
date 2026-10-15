// Provider launcher artwork (portrait + victory pose). The images are the owner's and stay out of
// git (assets/launcher/.gitignore; scripts/copy-launcher-art.{ps1,sh} copy them in). They are
// loaded with an eager glob instead of static imports so a checkout without them — the in-app
// updater's clean clone, CI, another machine — still builds: missing files yield no entry and the
// launcher falls back to the icon + greeting intro.
import type { PortraitProvider } from "./launchPortraits";

export const LAUNCH_ART_FILES: Record<PortraitProvider, { portrait: string; victory: string }> = {
  codex: { portrait: "codex-portrait-astra-v7.png", victory: "codex-victory-astra-v4.png" },
  claude: { portrait: "claude-portrait-redraw-v4.png", victory: "claude-victory-paired-v1.png" },
  deepseek: { portrait: "deepseek-portrait-redraw-v4.png", victory: "deepseek-victory-paired-v1.png" },
  kimi: { portrait: "kimi-portrait-redraw-v4.png", victory: "kimi-victory-paired-v1.png" },
  glm: { portrait: "glm-portrait-redraw-v4.png", victory: "glm-victory-paired-v1.png" },
  gemini: { portrait: "gemini-portrait-v2.png", victory: "gemini-victory-v1.png" },
};

export type LaunchArt = Partial<Record<PortraitProvider, { portrait: string; victory: string }>>;

/** Glob result (path → URL) → per-provider art; a provider counts only with both of its files. */
export function launchArtFrom(urls: Record<string, string>): LaunchArt {
  const byName = new Map(Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url]));
  const art: LaunchArt = {};
  for (const [provider, files] of Object.entries(LAUNCH_ART_FILES) as [PortraitProvider, { portrait: string; victory: string }][]) {
    const portrait = byName.get(files.portrait);
    const victory = byName.get(files.victory);
    if (typeof portrait === "string" && typeof victory === "string") art[provider] = { portrait, victory };
  }
  return art;
}

export const LAUNCH_ART: LaunchArt = launchArtFrom(
  import.meta.glob<string>("../assets/launcher/*.png", { eager: true, query: "?url", import: "default" }),
);
