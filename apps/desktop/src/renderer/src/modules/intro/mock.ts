// Browser-preview data for the opening (timeline.intro). The view itself reads only local state
// (lib/introAppearance) plus the core's profile list, so there is no daemon mock here — instead the
// preview seeds one custom portrait + greeting for the scratch agent's profile ("omega" on the
// mock host), so both paths show: scratch opens with the custom opening, the other from-the-start
// agents with their provider artwork / greeting pool. Mocks reach app code only through the core,
// so this writes the store's localStorage shape directly (lib/introAppearance owns it); kept once,
// so reloads keep what you edited.
import type { ModuleMock } from "../../dev/mockTypes";

const HOST = "local"; // the mock bridge's local host id in the hosts list (dev/mockBridge.ts)
const KEY = "cutex-desktop.introAppearance"; // lib/introAppearance's store key

/** A small painted stand-in portrait, so the preview shows the custom path without real art. */
function paintedPortrait(): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#5b6ee1");
  sky.addColorStop(1, "#8ad0c2");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1c1f2b";
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height * 0.62, canvas.width * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f4f2ec";
  ctx.font = "600 64px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("自定义立绘", canvas.width / 2, canvas.height * 0.32);
  const url = canvas.toDataURL("image/webp", 0.85);
  return url.startsWith("data:image/webp") ? url : null;
}

export const mock: ModuleMock = {
  start() {
    try {
      if (localStorage.getItem(KEY)) return;
      const portrait = paintedPortrait();
      const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
      stored[HOST] = { ...(stored[HOST] as Record<string, unknown> | undefined), omega: { ...(portrait ? { portrait } : {}), greeting: "{{owner}}，今天要做什么？" } };
      localStorage.setItem(KEY, JSON.stringify(stored));
      // The store may have inited before this seed: poke the storage listener it follows.
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    } catch {
      // preview only; a locked-down storage just shows the provider fallbacks
    }
  },
};
