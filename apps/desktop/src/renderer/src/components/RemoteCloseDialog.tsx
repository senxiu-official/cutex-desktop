// The remote-close countdown (cutex `client-remote-close`; lib/remoteClose.ts): another device asked
// this desktop to close. Main runs the countdown and quits the app when it ends (also when this
// dialog never shows); 取消 keeps the app, 立即关闭 quits now. cutex and its agents keep running.
import { Power } from "lucide-react";
import { useI18n } from "../i18n";
import { answerRemoteClose, useRemoteCloseCountdown } from "../lib/remoteClose";
import { useNow } from "../lib/time";
import { useHostLook } from "../lib/useHostScope";
import { secondsLeft } from "../../../shared/remoteClose";

export function RemoteCloseDialog() {
  const view = useRemoteCloseCountdown();
  const { t } = useI18n();
  const now = useNow(!!view);
  const host = useHostLook(view?.hostId)?.view.label ?? view?.hostId ?? "";
  if (!view) return null;
  const device = view.deviceName ?? host;
  const button = "rounded-md px-3 py-1 text-sm disabled:opacity-50";
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 pt-[18vh]" data-testid="remote-close-dialog">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remote-close-title"
        className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-4 shadow-2xl"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !view.closing) answerRemoteClose("cancel");
        }}
      >
        <div id="remote-close-title" className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Power size={16} className="shrink-0 text-warn" />
          <span className="min-w-0 break-words">
            {view.closing ? t("remoteClose.closing") : t("remoteClose.countdown", { device, n: secondsLeft(view.deadline, now) })}
          </span>
        </div>
        <div className="text-xs text-muted">{t("remoteClose.countdownHint")}</div>
        {view.deviceName && host && <div className="mt-1 text-xs text-subtle">{t("remoteClose.via", { host })}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button autoFocus disabled={view.closing} onClick={() => answerRemoteClose("cancel")} className={`${button} text-muted hover:bg-surface-2`}>
            {t("remoteClose.cancel")}
          </button>
          <button disabled={view.closing} onClick={() => answerRemoteClose("now")} className={`${button} bg-danger text-white`}>
            {t("remoteClose.closeNow")}
          </button>
        </div>
      </div>
    </div>
  );
}
