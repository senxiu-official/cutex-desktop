// Preview is deliberately an inert browser card. The ordinary mock bridge has no browser namespace;
// BrowserBody shows its localized placeholder and never creates a webview / loads an external URL.
// The host reports browser-open-full-access (r236), so Settings → 浏览器 shows the full-access hint
// (`?legacy`: the older wording).
// `?browserBackground`: every browser card previews a background agent tab (main's offscreen
// carrier, 2026-10-18) with a locally drawn live thumbnail that ticks once per second.
import type { ModuleMock } from "../../dev/mockTypes";

function drawThumbnail(tick: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = 480; canvas.height = 270;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#fafafa"; g.fillRect(0, 0, 480, 270);
  g.fillStyle = `hsl(${(tick * 37) % 360} 60% 55%)`; g.fillRect(0, 0, 48, 48);
  g.fillStyle = "#222"; g.font = "18px sans-serif";
  g.fillText("Agent page (preview)", 24, 90);
  g.fillText(`step ${tick}`, 24, 120);
  return canvas.toDataURL("image/jpeg", 0.7);
}
export const mock: ModuleMock = {
  features: { new: ["browser-open-full-access"] },
  start() {
    if (typeof document === "undefined" || !new URLSearchParams(location.search).has("browserBackground")) return;
    let tick = 0;
    // The preview has no browser bridge: hand the frame to thumbnails.ts's dev-only listener.
    const paint = () => { const image = drawThumbnail(++tick); if (image) window.dispatchEvent(new CustomEvent("cutex-preview-browser-thumbnail", { detail: image })); };
    paint(); setInterval(paint, 1000);
  },
};
