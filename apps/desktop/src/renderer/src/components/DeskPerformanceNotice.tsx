import { useI18n } from "../i18n";
import { useMultiWindow } from "../lib/multiWindowPref";
import { setUiPref, useUiPrefs } from "../lib/prefs";

/** Same persistent, dismissible notice style as the existing shelf toast. */
export function DeskPerformanceNotice({ count }: { count: number }) {
  const { t } = useI18n();
  const enabled = useMultiWindow();
  const done = useUiPrefs().deskPerformanceHintDone;
  if (!enabled || count < 3 || done) return null;
  return <div role="status" data-desk-performance-notice="" className="pointer-events-none fixed inset-x-0 bottom-14 z-[170] flex justify-center">
    <div className="float float-toast max-w-[min(34rem,calc(100vw-2rem))]">
      <span className="min-w-0 flex-1 text-muted">{t("desk.performanceHint")}</span>
      <button type="button" className="shrink-0 rounded-md px-2 py-0.5 font-medium text-accent hover:bg-hover" onClick={() => setUiPref("deskPerformanceHintDone", true)}>{t("ownerNotify.ack")}</button>
    </div>
  </div>;
}
