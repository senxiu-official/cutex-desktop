import { useLayoutEffect, useRef, type RefObject } from "react";
import { installBrowserOwnerCapture } from "./ownerInput";

interface Props {
  hostId: string;
  tabKey: string;
  guestId: string;
  viewport: RefObject<HTMLDivElement | null>;
  failed(error: unknown): void;
}

/** Empty, input-transparent marker over the granted viewport (main's visibility proof requires it,
 * ready, and the guest under every sample). Owner input goes straight to the page (co-control). */
export function BrowserOwnerCapture({ hostId: _hostId, tabKey: _tabKey, guestId, viewport, failed }: Props) {
  const capture = useRef<HTMLDivElement>(null);
  const report = useRef(failed); report.current = failed;
  useLayoutEffect(() => {
    const layer = capture.current, guest = viewport.current?.querySelector("webview");
    if (!layer || !guest || guest.getAttribute("data-browser-guest") !== guestId) {
      // Keep the marker unready (main then refuses agent input), but explain why.
      report.current(new Error("browser_capture_target_unavailable"));
      return;
    }
    try { return installBrowserOwnerCapture(layer, guest, layer.ownerDocument, guestId); }
    catch (error) { report.current(error); }
  }, [guestId, viewport]);
  return <div ref={capture} data-browser-owner-capture={guestId} role="presentation"
    className="pointer-events-none absolute inset-0 z-[1] outline-none" />;
}
