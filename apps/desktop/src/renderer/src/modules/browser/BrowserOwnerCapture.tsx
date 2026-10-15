import { useLayoutEffect, useRef, type RefObject } from "react";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import { browserCache } from "./browserCache";
import { browserActivation } from "./activation";
import { installBrowserOwnerCapture } from "./ownerInput";

interface Props {
  hostId: string;
  tabKey: string;
  guestId: string;
  viewport: RefObject<HTMLDivElement | null>;
  failed(error: unknown): void;
}

/** Empty, bounded host layer; the visibility policy recognizes only this exact guest's sibling. */
export function BrowserOwnerCapture({ hostId, tabKey, guestId, viewport, failed }: Props) {
  const { t } = useI18n();
  const capture = useRef<HTMLDivElement>(null);
  const report = useRef(failed); report.current = failed;
  useLayoutEffect(() => {
    const layer = capture.current, guest = viewport.current?.querySelector("webview");
    if (!layer || !guest || guest.getAttribute("data-browser-guest") !== guestId) {
      // Keep the unready shield fail-closed, but explain why owner input is unavailable.
      report.current(new Error("browser_capture_target_unavailable"));
      return;
    }
    try {
      return installBrowserOwnerCapture(layer, guest, layer.ownerDocument, async kind => {
        const current = browserCache.get(hostId, tabKey);
        if (!bridge.browser || !browserActivation.get() || current?.guestId !== guestId || current.control?.state !== "granted") return;
        // Downgrade only. Main owns paused state and permits this exact-host call during reconnect.
        await bridge.browser.forHost(hostId).ownerInput(tabKey, kind);
      }, error => report.current(error));
    } catch (error) {
      // Leave the unready host layer in place; main's visibility check denies automation.
      report.current(error);
    }
  }, [hostId, tabKey, guestId, viewport]);
  return <div ref={capture} data-browser-owner-capture={guestId} tabIndex={0} aria-label={t("browser.ownerCapture")}
    className="absolute inset-0 z-[1] outline-none" />;
}
