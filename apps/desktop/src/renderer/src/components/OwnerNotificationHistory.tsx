// History grows only when the owner requests another page, independently of native turns.
import { useEffect } from "react";
import { NOTIFICATION_PAGES_FEATURE } from "../../../shared/notificationPaging";
import { useConvFeatures } from "../lib/conversationScope";
import { loadOwnerNotificationHistory, ownerNotificationHistoryKey, useOwnerNotify } from "../lib/ownerNotifyStore";
import { useI18n } from "../i18n";

export function OwnerNotificationHistory({ hostId, agentId }: { hostId: string; agentId: string }) {
  const capable = useConvFeatures().has(NOTIFICATION_PAGES_FEATURE);
  const page = useOwnerNotify(s => s.history[ownerNotificationHistoryKey(hostId, agentId)]);
  const { t } = useI18n();
  const unrequested = !page;
  useEffect(() => {
    if (capable && unrequested) void loadOwnerNotificationHistory(hostId, agentId);
  }, [capable, unrequested, hostId, agentId]);
  if (!capable || !page || (!page.loading && !page.error && !page.cursor)) return null;
  return (
    <div className="my-2 flex flex-wrap items-center justify-center gap-2 text-xs text-muted" aria-live="polite">
      {page.error && <span>{page.error}</span>}
      <button type="button" disabled={page.loading} onClick={() => void loadOwnerNotificationHistory(hostId, agentId)}
        className="rounded-full border border-border px-3 py-1 hover:bg-surface-2 hover:text-foreground disabled:opacity-60">
        {t(page.loading ? "ownerNotify.historyLoading" : page.error ? "ownerNotify.historyRetry" : "ownerNotify.historyMore")}
      </button>
    </div>
  );
}
