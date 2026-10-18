// The open agent's notices that wait for the owner, at the start of the status row above the composer
// (owner report 2026-10-18: the sidebar said 「等Master回复」 but the card sat many turns up and the
// 需要你 strip leaves the open agent out, so there was nothing to answer). One line: a dot, 等你回复 /
// 需要你, the first line of the notice and its age; click = scroll to the card in the timeline (pages
// older history in when needed, lib/ownerNotifyStore focusOwnerNote) and focus its 回复. 「+N」 lists
// the others (same jump). 回复 opens the card's reply box (components/OwnerReplyBox) in a panel over
// the timeline, so the owner can answer without scrolling. Which notices count is the sidebar's rule
// (lib/ownerNotify openAgentPendingNotes = isPending); an ordinary message to the agent does not
// answer them (cutex semantics unchanged).
import { useEffect, useMemo, useState } from "react";
import { ChevronUp, MessageSquareReply } from "lucide-react";
import type { OwnerNotification } from "@cutex-desktop/protocol";
import { useI18n } from "../i18n";
import { openMenuAbove, type MenuEntry } from "../lib/contextMenu";
import { canReply, noteFirstLine, openAgentPendingNotes, ownerNeedReason, pendingNoteLabel } from "../lib/ownerNotify";
import { focusOwnerNote, useHostOwnerNotes } from "../lib/ownerNotifyStore";
import { useTrackOverlay } from "../lib/openOverlays";
import { chipTone } from "../lib/statusChips";
import { formatAbsolute, formatWhen, useClock } from "../lib/time";
import { ClampBox } from "./ClampBox";
import { Markdown } from "./Markdown";
import { OwnerReplyBox } from "./OwnerReplyBox";

const createdOf = (n: OwnerNotification) => Date.parse(n.createdAt) / 1000;

export function PendingOwnerNotes({ sessionId, hostId }: { sessionId: string; hostId: string }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const byId = useHostOwnerNotes(hostId);
  const notes = useMemo(() => openAgentPendingNotes(byId, sessionId), [byId, sessionId]);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const replying = replyTo ? (notes.find((n) => n.notificationId === replyTo && canReply(n)) ?? null) : null;
  // Answered / dismissed elsewhere meanwhile (the card, the phone): the panel goes.
  useEffect(() => {
    if (replyTo && !replying) setReplyTo(null);
  }, [replyTo, replying]);
  useTrackOverlay(!!replying);
  if (notes.length === 0) return null;

  const first = notes[0]!;
  const labelOf = (n: OwnerNotification) => t(pendingNoteLabel(n) === "awaitsReply" ? "ownerNotify.pending.awaitsReply" : "ownerNotify.pending.needsYou");
  const ageOf = (n: OwnerNotification) => (Number.isFinite(createdOf(n)) ? formatWhen(createdOf(n), now, locale) : "");
  const jump = (n: OwnerNotification) => focusOwnerNote(sessionId, n.notificationId, hostId);
  // lib/statusChips colour budget: a stopped command is tinted, a message / reply is a quiet dot + text.
  const tone = chipTone("needsYou", { count: 1, reasons: [ownerNeedReason(first)], askIds: [] });
  const others: MenuEntry[] = notes.map((n) => ({
    label: `${labelOf(n)} · ${noteFirstLine(n.text, 60)}`,
    hint: ageOf(n),
    title: t("ownerNotify.pending.jump"),
    onSelect: () => jump(n),
  }));

  return (
    <div data-pending-owner-notes="" data-chip-tone={tone} className="flex min-w-0 shrink items-center gap-1.5 text-xs">
      <button
        onClick={() => jump(first)}
        title={`${t("ownerNotify.pending.jump")}\n${Number.isFinite(createdOf(first)) ? formatAbsolute(createdOf(first)) : ""}`}
        className="flex min-w-0 items-center gap-1.5 py-1 text-muted hover:text-foreground"
      >
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${tone === "urgent" ? "bg-danger" : "bg-warn"}`} />
        <span className={`shrink-0 font-medium ${tone === "urgent" ? "text-warn-text" : "text-foreground"}`}>{labelOf(first)}</span>
        <span className="min-w-0 truncate">{noteFirstLine(first.text)}</span>
        <span className="shrink-0 text-subtle tabular-nums">· {ageOf(first)}</span>
      </button>
      {notes.length > 1 && (
        <button
          data-pending-more=""
          aria-haspopup="menu"
          aria-label={t("ownerNotify.pending.more", { n: notes.length - 1 })}
          title={t("ownerNotify.pending.more", { n: notes.length - 1 })}
          onClick={(e) => openMenuAbove(e.currentTarget, others, { minWidth: 280 })}
          className="shrink-0 rounded-full border border-border px-1.5 text-[11px] text-muted tabular-nums hover:bg-hover hover:text-foreground"
        >
          +{notes.length - 1}
        </button>
      )}
      {canReply(first) && (
        <button
          data-pending-reply=""
          onClick={() => setReplyTo(replying ? null : first.notificationId)}
          aria-expanded={!!replying}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-accent hover:bg-hover"
        >
          {replying ? <ChevronUp size={13} /> : <MessageSquareReply size={13} />}
          {t("ownerNotify.reply")}
        </button>
      )}
      {replying && (
        <div data-pending-reply-panel="" className="absolute bottom-full left-6 z-30 mb-1 w-[34rem] max-w-[calc(100%-3rem)] rounded-xl border border-border bg-surface p-2.5 text-sm shadow-xl">
          <div className="mb-1 flex items-center gap-1.5 text-xs">
            <span className="font-medium text-foreground">{labelOf(replying)}</span>
            <span className="text-subtle">· {ageOf(replying)}</span>
            <button onClick={() => jump(replying)} className="ml-auto text-accent hover:underline">
              {t("ownerNotify.pending.jump")}
            </button>
          </div>
          <ClampBox lines={5} resetKey={replying.notificationId} className="mb-2 text-[13px] text-muted">
            <Markdown text={replying.text} />
          </ClampBox>
          <OwnerReplyBox record={replying} hostId={hostId} onClose={() => setReplyTo(null)} />
        </div>
      )}
    </div>
  );
}
