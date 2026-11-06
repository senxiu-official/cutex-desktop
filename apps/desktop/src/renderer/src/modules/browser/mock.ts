// Preview is deliberately an inert browser card. The ordinary mock bridge has no browser namespace;
// BrowserBody shows its localized placeholder and never creates a webview / loads an external URL.
// The host reports browser-open-full-access (r236), so Settings → 浏览器 shows the full-access hint
// (`?legacy`: the older wording).
// `?browserBackground`: every browser card previews a background agent tab (main's offscreen
// carrier, 2026-10-18) with a locally drawn live thumbnail that ticks once per second.
// `?browserChrome=none|granted|operating|paused|pending` (`&browserPool=agent`, `&browserZoom=1.25`): every browser card
// shows an attached page in that control state, so the card's three rows can be looked at without a host (the buttons
// reach no bridge; a click reports a failure in the row).
import type { ModuleMock } from "../../dev/mockTypes";
import { browserActivation, type BrowserTabView } from "../../../../shared/browser";

function previewChrome(params: URLSearchParams): void {
  const state = params.get("browserChrome");
  if (!state) return;
  browserActivation.complete(browserActivation.begin());
  window.addEventListener("cutex-preview-browser-tab", (event) => {
    const { hostId, tabKey, url } = (event as CustomEvent<{ hostId: string; tabKey: string; url: string }>).detail;
    const service = url.startsWith("cutex:service/");
    const lease = state === "none" ? undefined : { leaseId: "preview-lease", sessionId: "s-moth", agentName: "Moth", state: state === "pending" ? "pending" as const : "active" as const, origin: "owner" as const };
    const view: BrowserTabView = {
      hostId, tabKey, guestId: "preview-guest", pageGeneration: 1, status: "attached", loading: false, canGoBack: true, canGoForward: false,
      url: service ? url : "https://example.org/research/notes", title: service ? "RNA velocity" : "Research notes · Example",
      pool: params.get("browserPool") === "agent" ? "agent" : "owner", zoom: Number(params.get("browserZoom")) || undefined, lease,
      control: lease && state !== "pending" ? { grantee: "Moth", state: state === "paused" ? "paused" : "granted", operating: state === "operating" } : undefined,
    };
    // browserCache.ts takes it (dev-only listener): a module mock reaches module state only through events.
    window.dispatchEvent(new CustomEvent("cutex-preview-browser-view", { detail: view }));
  });
}

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
    if (typeof document === "undefined") return;
    previewChrome(new URLSearchParams(location.search));
    if (!new URLSearchParams(location.search).has("browserBackground")) return;
    let tick = 0;
    // The preview has no browser bridge: hand the frame to thumbnails.ts's dev-only listener.
    const paint = () => { const image = drawThumbnail(++tick); if (image) window.dispatchEvent(new CustomEvent("cutex-preview-browser-thumbnail", { detail: image })); };
    paint(); setInterval(paint, 1000);
  },
};
