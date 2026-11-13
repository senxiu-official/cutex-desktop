import { useRef } from "react";
import { useI18n } from "../i18n";
import { useMultiWindow } from "../lib/multiWindowPref";
import { setUiPref, useUiPrefs } from "../lib/prefs";
import { useToastSpot } from "../lib/toastSpot";

/** Same persistent, dismissible notice style and spot as the shelf toast (never over the tray or a composer). */
export function DeskPerformanceNotice({ count }: { count: number }) {
  const { t } = useI18n();
  const enabled = useMultiWindow();
  const done = useUiPrefs().deskPerformanceHintDone;
  const shown = enabled && count >= 3 && !done;
  const card = useRef<HTMLDivElement>(null);
  const spot = useToastSpot(card, shown);
  if (!shown) return null;
  return <div role="status" data-desk-performance-notice="" className="pointer-events-none fixed z-[170] flex justify-center" style={spot.wrapper}>
    <div ref={card} className="float float-toast max-w-[min(34rem,calc(100vw-2rem))]" style={spot.maxWidth === undefined ? undefined : { maxWidth: `min(34rem, ${spot.maxWidth}px)` }}>
      <span className="min-w-0 flex-1 text-muted">{t("desk.performanceHint")}</span>
      <button type="button" className="shrink-0 rounded-md px-2 py-0.5 font-medium text-accent hover:bg-hover" onClick={() => setUiPref("deskPerformanceHintDone", true)}>{t("ownerNotify.ack")}</button>
    </div>
  </div>;
}
