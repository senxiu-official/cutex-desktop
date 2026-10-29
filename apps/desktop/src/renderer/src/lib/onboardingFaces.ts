// The faces the onboarding shows (owner 2026-10-24): one per portrait theme, a fixed set chosen in advance and shipped
// with the app — each shipped theme's `cover` in its pack manifest (assets/avatars/portraits/*.json `themes`). They are
// static files of the app, preloaded when the flow opens, so nothing loads while a card is open. A theme only in the
// owner's own folder has no shipped face: the cards draw its initial instead (no loading from the folder there).
import { BUNDLED_PORTRAIT_PACKS, type PortraitPack } from "./portraitPacks";

/** `pack/theme` → the URL of its shipped face (preview size). */
export function onboardingFaces(packs: readonly PortraitPack[] = BUNDLED_PORTRAIT_PACKS): Map<string, string> {
  const out = new Map<string, string>();
  for (const pack of packs) {
    if (pack.source !== "bundled") continue;
    for (const th of pack.themes) {
      const p = th.pictures.find((x) => x.stem === th.cover) ?? th.pictures[0];
      const url = p?.preview ?? p?.full;
      if (url) out.set(`${pack.id}/${th.id}`, url);
    }
  }
  return out;
}

export const ONBOARDING_FACES: ReadonlyMap<string, string> = onboardingFaces();

let preloaded = false;
const kept: HTMLImageElement[] = [];

/** Starts loading every onboarding face (once per window); the flow calls it when it opens. */
export function preloadOnboardingFaces(): void {
  if (preloaded || typeof Image === "undefined") return;
  preloaded = true;
  for (const url of ONBOARDING_FACES.values()) {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    kept.push(img);
  }
}
