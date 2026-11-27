// Window caption parts shared by the title bar and the right side's full-screen title row: Linux
// gets drawn buttons; Windows keeps native caption buttons over the right end (a spacer under them);
// macOS keeps the traffic lights on the left (callers pad by 76 px).
import { Minus, Square, X } from "lucide-react";
import { bridge } from "../bridge";
import { useI18n } from "../i18n";
import { TITLEBAR_HEIGHT } from "../../../shared/ipc";
import { getAppearance } from "../lib/appearance";

const win = bridge.window;

/** `deskId`: the buttons of a desk window (multi-window): main checks the desk and acts on that window. */
export function LinuxControls({ deskId }: { deskId?: string } = {}) {
  const { t } = useI18n();
  if (!win || win.nativeControls !== null) return null;
  // Drawn buttons have no native names: each says what it does (aria-label + the app's tip).
  return (
    <div className="ml-1 flex items-center [app-region:no-drag]">
      <button aria-label={t("window.minimize")} data-tip={t("window.minimize")} onClick={() => void win.control("minimize", deskId)} className="press px-3 py-2.5 text-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        <Minus size={14} />
      </button>
      <button aria-label={t("window.maximize")} data-tip={t("window.maximize")} onClick={() => void win.control("toggleMaximize", deskId)} className="press px-3 py-2.5 text-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        <Square size={12} />
      </button>
      <button aria-label={t("window.close")} data-tip={t("window.close")} onClick={() => void win.control("close", deskId)} className="press-solid px-3 py-2.5 text-muted hover:bg-danger-solid hover:text-white active:bg-danger-solid active:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * Space under the native Windows caption buttons (3 × 46 px). Their fill is transparent (docs/design/029,
 * shared/windowChrome): the window bar's own frost (styles.css, over the desktop background) or the window colour
 * shows through, exactly as under the rest of the bar.
 */
export function CaptionSpace() {
  return win?.nativeControls === "right" ? <div className="w-[138px] shrink-0" /> : null;
}

/**
 * The top band a full-window overlay (the enlarged image) leaves to the window's own buttons (owner 2026-11-28: the
 * viewer's × sat on the window's ×). Where the OS draws them over the page — Windows' caption buttons on the right,
 * macOS' traffic lights on the left — it is the window bar's height, the one main gives the caption overlay
 * (TITLEBAR_HEIGHT), maximised or not. Linux (null): the drawn buttons are page content the overlay covers, so 0.
 * In CSS px: main's band is TITLEBAR_HEIGHT device-independent px, the page is zoomed by the app's 缩放 (`zoom`, 1 =
 * 100 %): at 80 % the band is 50 CSS px — 40 left the viewer's × under the window's × (owner 2026-11-28).
 */
export function captionBand(controls: "right" | "left" | null | undefined = bridge.window?.nativeControls, zoom = getAppearance().zoom / 100): number {
  return controls ? Math.ceil(TITLEBAR_HEIGHT / (zoom > 0 ? zoom : 1)) : 0;
}
