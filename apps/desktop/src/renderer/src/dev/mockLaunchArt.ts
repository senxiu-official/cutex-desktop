// Preview mock of Settings → 外观 → 启动页立绘 (shared/launchArt.ts). No real artwork: each "imported"
// provider gets a generated placeholder figure. `?launchart=imported` starts with Kimi imported.
// 从文件夹导入… pretends the folder held Claude and Kimi complete, one GLM image and a non-PNG file.
import type { LaunchArtBridge, LaunchArtImages, LaunchArtProvider, LaunchArtState } from "../../../shared/launchArt";
import { LAUNCH_ART_FILES } from "../../../shared/launchArt";

function placeholder(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="700" viewBox="0 0 560 700"><rect width="560" height="700" fill="none"/><circle cx="280" cy="230" r="120" fill="hsl(${hue} 45% 70%)"/><rect x="150" y="360" width="260" height="340" rx="110" fill="hsl(${hue} 45% 60%)"/><text x="280" y="250" font-family="sans-serif" font-size="56" text-anchor="middle" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function entry(provider: LaunchArtProvider, hue: number) {
  return { portrait: placeholder(provider, hue), victory: placeholder(`${provider}!`, hue) };
}

export function mockLaunchArt(): LaunchArtBridge {
  let imported: LaunchArtImages = new URLSearchParams(location.search).get("launchart") === "imported" ? { kimi: entry("kimi", 200) } : {};
  const state = (): LaunchArtState => ({ imported: { ...imported } });
  return {
    async state() {
      return state();
    },
    async import() {
      await new Promise((r) => setTimeout(r, 400));
      imported = { ...imported, claude: entry("claude", 25), kimi: entry("kimi", 200) };
      return { canceled: false, imported: ["claude", "kimi"], incomplete: ["glm"], refused: [{ file: LAUNCH_ART_FILES.gemini.portrait, reason: "notPng" }], state: state() };
    },
    async clear() {
      imported = {};
      return state();
    },
  };
}
