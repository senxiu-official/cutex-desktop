// An agent → owner message (owner-notify) in its sender's timeline: level, text, delegation / job
// references, the downgrade / mute note (owner only — the agent never learns how it was delivered),
// state, and for records still open 知道了 / 回复 (only when the agent asked for a reply; those also
// 不回复). Notices cutex wrote itself (origin system: delivery failures, reminders) are labelled as
// cutex notices about the agent and never offer 回复. 删除 (owner-notify-delete, click twice) removes
// the record everywhere. The record comes from lib/ownerNotifyStore by id, so a state change
// re-renders only this card.
// Quiet pass (owner 2026-10-14, lib/ownerNotify notePresentation): only a note that asks for a
// decision (unread 紧急, or waiting for a reply) is a tinted card; the rest is one row with a left
// rule, muted text and its actions shown on hover / keyboard focus.
// Long text (owner 2026-10-15): wraps everywhere (code blocks and paths too, never a sideways
// scrollbar) and is cut at a few lines with 「展开」 (components/ClampBox).
import { useState } from "react";
import { Bell, BellRing, Check, CornerDownRight, MessageSquareReply, Trash2, X } from "lucide-react";
import type { OwnerNotification } from "@cutex-desktop/protocol";
import { useI18n, type MessageKey } from "../i18n";
import { contextMenu } from "../lib/contextMenu";
import { openDelegationDetail } from "../lib/delegationOpen";
import { focusDelegation } from "../lib/focusRequest";
import { ARMED_BUTTON, ARMED_FRAME, useArmed } from "../lib/armedConfirm";
import { canReply, isFinal, isSystemNotice, notePresentation, OWNER_NOTIFY_DELETE_FEATURE } from "../lib/ownerNotify";
import { ownerNotifyAct, useOwnerNotify } from "../lib/ownerNotifyStore";
import { openJobOutput } from "../lib/jobStore";
import { JOB_SERVICE_FEATURE } from "../lib/jobs";
import { formatAbsolute, formatWhen, useClock } from "../lib/time";
import { agentHost, selectedFeatures, selectedSidebar, useApp } from "../store";
import { rowsOf } from "../lib/viewHost";
import { DelegationTag } from "./DelegationParts";
import { ClampBox } from "./ClampBox";
import { SafetyBlockCard } from "./SafetyBlockCard";
import { Markdown } from "./Markdown";
import { OwnerReplyBox } from "./OwnerReplyBox";
import { SystemAvatar } from "./SystemAvatar";

const TONE: Record<OwnerNotification["level"], { frame: string; icon: string; badge: string; dot: string }> = {
  info: { frame: "border-accent/30 bg-accent/5", icon: "text-accent", badge: "bg-accent/15 text-accent", dot: "bg-accent" },
  attention: { frame: "border-warn/40 bg-warn/5", icon: "text-warn", badge: "bg-warn/15 text-warn", dot: "bg-warn" },
  urgent: { frame: "border-danger/45 bg-danger/5", icon: "text-danger", badge: "bg-danger text-white", dot: "bg-danger" },
};
/** Card buttons (bordered) vs. the quiet row's (borderless, hover-revealed). */
const CARD_BUTTON = "flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-50";
const ROW_BUTTON = "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50";

export function OwnerNotifyCard({ notificationId, sessionId }: { notificationId: string; sessionId: string }) {
  const record = useOwnerNotify((s) => s.byId[notificationId]);
  if (!record) return null;
  // claude-safety-grants: a stopped command with 批准一次 / 不批准 instead of a message.
  if (record.safetyBlock) return <SafetyBlockCard record={record} block={record.safetyBlock} />;
  return <Card record={record} sessionId={sessionId} />;
}

function Card({ record: r, sessionId }: { record: OwnerNotification; sessionId: string }) {
  const { t, locale } = useI18n();
  const now = useClock();
  // The card is in the open agent's timeline: the delegation it names is on that agent's host.
  const host = useApp(agentHost);
  const jobs = useApp((s) => selectedFeatures(s).has(JOB_SERVICE_FEATURE));
  const notify = useApp((s) => s.notify);
  const deletable = useApp((s) => selectedFeatures(s).has(OWNER_NOTIFY_DELETE_FEATURE));
  const system = isSystemNotice(r);
  const agentName = useApp((s) =>
    system ? (rowsOf(s.sidebar, selectedSidebar(s)).find((x) => x.cutexSessionId === r.agentId)?.displayName ?? r.agentName ?? r.agentId) : null,
  );
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState<null | "ack" | "reply" | "dismiss" | "delete">(null);
  const [deleteArmed, setDeleteArmed] = useArmed(r.state);
  const tone = TONE[r.level];
  const created = Date.parse(r.createdAt) / 1000;
  const open = !isFinal(r.state);
  const replyable = canReply(r);
  const Icon = r.level === "urgent" ? BellRing : Bell;
  const card = notePresentation(r) === "card";
  const button = card ? CARD_BUTTON : ROW_BUTTON;

  const act = async (action: "ack" | "dismiss" | "delete") => {
    setBusy(action);
    try {
      const result = await ownerNotifyAct(r, action);
      if (!result.ok) notify(result.error.code === "notification_closed" ? t("ownerNotify.closedMeanwhile") : result.error.message || result.error.code, "error");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const note = r.muted
    ? t("ownerNotify.mutedNote")
    : r.downgraded
      ? t(r.downgraded.reason === "rateLimit" ? "ownerNotify.downgradedRate" : "ownerNotify.downgradedUrgent", { from: t(`ownerNotify.level.${r.downgraded.from}` as MessageKey), to: t(`ownerNotify.level.${r.level}` as MessageKey) })
      : null;

  return (
    <div
      data-owner-note={r.notificationId}
      data-origin={system ? "system" : "agent"}
      data-note-look={card ? "card" : "row"}
      tabIndex={-1}
      className={
        card
          ? `my-3 rounded-xl border outline-none px-3.5 py-2.5 transition-colors ${deleteArmed ? ARMED_FRAME : tone.frame}`
          : `group/note relative my-2 outline-none border-l-2 py-0.5 pl-3 transition-colors ${deleteArmed ? `rounded-r-lg pr-2 ${ARMED_FRAME}` : "border-border"}`
      }
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        {system ? <SystemAvatar kind="cutex" size={card ? 16 : 14} /> : <Icon size={card ? 14 : 13} className={`shrink-0 ${card ? tone.icon : "text-subtle"}`} />}
        <span className={card ? "font-medium text-foreground" : "text-muted"}>{t(system ? "system.cutex" : "ownerNotify.toYou")}</span>
        {system && <span className="min-w-0 truncate text-muted">{t("ownerNotify.aboutAgent", { name: agentName ?? r.agentId })}</span>}
        {card ? (
          <span className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${tone.badge}`}>{t(`ownerNotify.level.${r.level}` as MessageKey)}</span>
        ) : (
          <span className="text-subtle">· {t(`ownerNotify.level.${r.level}` as MessageKey)}</span>
        )}
        {r.needsReply && open && <span className="rounded-full bg-warn/15 px-1.5 py-px text-[11px] font-medium text-warn-text">{t("ownerNotify.needsReply")}</span>}
        <span className="text-subtle" title={Number.isFinite(created) ? formatAbsolute(created) : undefined}>
          · {Number.isFinite(created) ? formatWhen(created, now, locale) : ""}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-subtle">
          {/* A quiet row still says it is unread: a small dot in the level's colour. */}
          {!card && r.state === "open" && <span aria-hidden className={`size-1.5 rounded-full ${tone.dot}`} />}
          {t(`ownerNotify.state.${r.state}` as MessageKey)}
        </span>
      </div>
      <ClampBox lines={card ? 12 : 4} resetKey={r.notificationId} className={card ? "mt-1.5 text-[14.5px]" : "mt-0.5 text-[13px] text-muted"}>
        <Markdown text={r.text} />
      </ClampBox>
      {(r.delegation || r.job) && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          {r.delegation && (
            // #tag: the delegation's detail on the right side; 跳到委托卡片 on right click.
            <span className="flex items-center gap-1" onContextMenu={contextMenu(() => [{ label: t("delegation.jumpCard"), onSelect: () => focusDelegation(sessionId, r.delegation!, host) }])}>
              {t("ownerNotify.aboutDelegation")}
              <DelegationTag askId={r.delegation} onJump={() => openDelegationDetail(host, r.delegation!)} />
            </span>
          )}
          {r.job && (
            <span className="flex items-center gap-1">
              {t("ownerNotify.aboutJob")}
              {jobs ? (
                <button onClick={() => openJobOutput(r.job!)} className="font-mono text-[11px] break-all text-accent hover:underline">
                  {r.job}
                </button>
              ) : (
                <span className="font-mono text-[11px] break-all">{r.job}</span>
              )}
            </span>
          )}
        </div>
      )}
      {note && <div className="mt-1.5 text-[11.5px] text-subtle">{note}</div>}
      {r.reply && (
        <div className="mt-2 flex gap-1.5 rounded-lg bg-surface-2/70 px-2.5 py-1.5 text-sm">
          <CornerDownRight size={14} className="mt-0.5 shrink-0 text-subtle" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-subtle">{t("ownerNotify.yourReply")}</div>
            <ClampBox lines={6} resetKey={r.notificationId} className="whitespace-pre-wrap">
              {r.reply.text}
            </ClampBox>
          </div>
        </div>
      )}
      {replyable && replying && (
        <div className="mt-2">
          <OwnerReplyBox record={r} onClose={() => setReplying(false)} onBusy={(b) => setBusy(b ? "reply" : null)} />
        </div>
      )}
      {deleteArmed ? (
        // Right-aligned: the confirming 删除 sits where the first 删除 was (ml-auto below).
        <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5 text-xs">
          <span className="mr-1 text-danger">{t("ownerNotify.deleteArmed")}</span>
          <button
            className={ARMED_BUTTON}
            disabled={!!busy}
            onClick={() => {
              setDeleteArmed(false);
              void act("delete");
            }}
          >
            {t("ownerNotify.delete")}
          </button>
        </div>
      ) : (
        ((open && !replying) || deletable) && (
        <div
          data-note-actions=""
          className={
            card
              ? "mt-2 flex flex-wrap items-center gap-1.5"
              : // Over the state word at the header's right end; shown on hover and on keyboard focus.
                "absolute top-0 right-0 flex items-center gap-0.5 rounded-md bg-background pl-1 opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100"
          }
        >
          {open && !replying && r.state === "open" && (
            <button onClick={() => void act("ack")} disabled={!!busy} className={button}>
              <Check size={13} />
              {t("ownerNotify.ack")}
            </button>
          )}
          {replyable && !replying && (
            <button data-note-reply="" onClick={() => setReplying(true)} disabled={!!busy} className={button}>
              <MessageSquareReply size={13} />
              {t("ownerNotify.reply")}
            </button>
          )}
          {r.needsReply && open && !replying && (
            <button onClick={() => void act("dismiss")} disabled={!!busy} title={t("ownerNotify.dismissHint")} className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50">
              <X size={13} />
              {t("ownerNotify.dismiss")}
            </button>
          )}
          {deletable && !replying && (
            <button
              onClick={() => setDeleteArmed(true)}
              disabled={!!busy}
              title={t("ownerNotify.deleteHint")}
              aria-label={t("ownerNotify.delete")}
              className={`${card ? "ml-auto" : ""} flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-subtle hover:bg-surface-2 hover:text-danger disabled:opacity-50`}
            >
              <Trash2 size={13} />
              {t("ownerNotify.delete")}
            </button>
          )}
        </div>
        )
      )}
    </div>
  );
}
