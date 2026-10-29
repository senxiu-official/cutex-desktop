import { useI18n } from "../i18n";
import { useMultiWindow } from "../lib/multiWindowPref";
import { setUiPref, useUiPrefs } from "../lib/prefs";

/** Same persistent, dismissible notice style as the existing shelf toast. */
export function DeskPerformanceNotice({ count }: { count: number }) {
  const { t } = useI18n();
  const enabled = useMultiWindow();
  const done = useUiPrefs().deskPerformanceHintDone;
  if (!enabled || count < 3 || done) return null;
  return <div role="status" data-desk-performance-notice="" className="pointer-events-none fixed inset-x-0 bottom-14 z-[66] flex justify-center">
    <div className="motion-toast-in pointer-events-auto flex max-w-[min(34rem,calc(100vw-2rem))] items-center gap-2 rounded-xl border border-border bg-background py-1.5 pr-1.5 pl-3.5 text-ui/[inherit] shadow-e2">
      <span className="min-w-0 flex-1 text-muted">{t("desk.performanceHint")}</span>
      <button type="button" className="shrink-0 rounded-md px-2 py-0.5 font-medium text-accent hover:bg-hover" onClick={() => setUiPref("deskPerformanceHintDone", true)}>{t("ownerNotify.ack")}</button>
    </div>
  </div>;
}
