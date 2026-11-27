// Preview entry (dev/mockBridge.ts `?imagezoom`): the enlarged image view (components/ImageThumbs ImageZoom) open over
// the app with a drawn stand-in picture, for checking its toolbar against the window's own buttons (`?caption`: the
// Windows caption overlay; `?platform=darwin`: the traffic lights' side).
import { createRoot } from "react-dom/client";
import { ImageZoom } from "../components/ImageThumbs";
import { I18nProvider } from "../i18n";

export function installDevImageZoom(): void {
  window.setTimeout(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1000;
    const g = canvas.getContext("2d");
    if (g) {
      const fill = g.createLinearGradient(0, 0, 1600, 1000);
      fill.addColorStop(0, "#6aa9ff");
      fill.addColorStop(1, "#ffb36a");
      g.fillStyle = fill;
      g.fillRect(0, 0, 1600, 1000);
    }
    const host = document.createElement("div");
    host.dataset.devImageZoom = "";
    document.body.append(host);
    const root = createRoot(host);
    root.render(<I18nProvider><ImageZoom src={canvas.toDataURL("image/png")} dimensions={{ width: 1600, height: 1000 }} onClose={() => root.unmount()} onCopy={async () => true} onSave={() => {}} /></I18nProvider>);
  }, 1500);
}
