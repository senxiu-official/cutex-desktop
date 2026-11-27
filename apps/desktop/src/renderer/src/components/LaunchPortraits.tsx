// The provider artwork image of the launch openings (components/LaunchProviderColumns): the 启动页立绘 slot plus the
// per-provider fit of the current art set.
import type { PortraitProvider } from "../lib/launchPortraits";

// Art direction for this cast, not official provider character measurements.
const HEIGHT_CM: Record<PortraitProvider, number> = {
  codex: 174, claude: 168, deepseek: 162, glm: 158, kimi: 165, gemini: 166,
};
// Match eye lines, so horns/headpieces do not determine apparent character height.
const EYE_LINE: Record<PortraitProvider, number> = {
  codex: .485, claude: .406, deepseek: .456, glm: .464, kimi: .428, gemini: .292,
};
// A portrait framed wider than the redraw-v4 set: enlarged about its eye line, so the head matches
// the others and the eye line stays where HEIGHT_CM puts it (the extra body runs into the bottom fade).
// 1.6 makes the pupil distance the set's average (measured in the running app: others 65–75 px, mean ≈ 70).
const HEAD_ZOOM: Partial<Record<PortraitProvider, number>> = { gemini: 1.6 };
// Portraits whose crown runs off the top of the image: fade the image's top edge so the cut is not a
// hard line where the others still show hair or headpieces.
const TOP_FADE: Partial<Record<PortraitProvider, string>> = { gemini: "linear-gradient(to bottom, transparent, #000 9%)" };

/**
 * One provider's artwork image (the 启动页立绘 slot: any URL from lib/launchArt). The size / eye-line / zoom tables fit
 * the current art set; a new set framed alike can drop them, so replacing the images needs no change here.
 */
export function PortraitImage({ provider, src }: { provider: PortraitProvider; src: string | undefined }) {
  return <img src={src} style={{
    width: `${260 * HEIGHT_CM[provider] / 174 * (1 - EYE_LINE.codex) / (1 - EYE_LINE[provider])}%`,
    ...(provider === "codex" ? { transform: "translate(-50%, -10px) scale(0.94)", transformOrigin: "center bottom" } : {}),
    ...(HEAD_ZOOM[provider] ? { transform: `translateX(-50%) scale(${HEAD_ZOOM[provider]})`, transformOrigin: `center ${EYE_LINE[provider] * 100}%` } : {}),
    ...(TOP_FADE[provider] ? { maskImage: TOP_FADE[provider] } : {}),
  }} alt="" draggable={false} />;
}
