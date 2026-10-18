// The reply box of an agent → owner message (owner-notify 回复): textarea, Ctrl+Enter / Esc, 取消 /
// 发送. Shared by the timeline card (components/OwnerNotifyCard) and the open agent's 等你回复 row
// above the composer (components/PendingOwnerNotes), so a reply from either place is the same
// `ownerNotifyAct(…, "reply", text)` on the sender's session.
import { useState } from "react";
import type { OwnerNotification } from "@cutex-desktop/protocol";
import { OWNER_REPLY_MAX } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { ownerNotifyAct } from "../lib/ownerNotifyStore";
import { useApp } from "../store";

export function OwnerReplyBox({
  record,
  hostId,
  onClose,
  onBusy,
  rows = 3,
}: {
  record: Pick<OwnerNotification, "agentId" | "notificationId">;
  /** The record's host (default: the focus host). */
  hostId?: string;
  /** 取消 / Esc, and after the reply went out. */
  onClose(sent: boolean): void;
  /** Sending started / ended (the card disables its other buttons meanwhile). */
  onBusy?(busy: boolean): void;
  rows?: number;
}) {
  const { t } = useI18n();
  const notify = useApp((s) => s.notify);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    onBusy?.(true);
    try {
      const result = await ownerNotifyAct(record, "reply", text, hostId);
      if (!result.ok) notify(result.error.code === "notification_closed" ? t("ownerNotify.closedMeanwhile") : result.error.message || result.error.code, "error");
      else {
        setDraft("");
        onClose(true);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSending(false);
      onBusy?.(false);
    }
  };
  return (
    <div data-owner-reply-box="">
      <textarea
        autoFocus
        value={draft}
        maxLength={OWNER_REPLY_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          } else if (e.key === "Escape") {
            // Esc closes this box only (not the panel / composer layers behind it).
            e.stopPropagation();
            onClose(false);
          }
        }}
        placeholder={t("ownerNotify.replyPlaceholder")}
        rows={rows}
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <div className="mt-1 flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-subtle">{t("ownerNotify.replyHint")}</span>
        <button onClick={() => onClose(false)} className="rounded-lg px-3 py-1 text-sm text-muted hover:bg-surface-2 hover:text-foreground">
          {t("ownerNotify.cancel")}
        </button>
        <button onClick={() => void send()} disabled={!draft.trim() || sending} className="rounded-lg bg-accent px-3 py-1 text-sm text-white disabled:opacity-40">
          {sending ? t("ownerNotify.sending") : t("ownerNotify.send")}
        </button>
      </div>
    </div>
  );
}
