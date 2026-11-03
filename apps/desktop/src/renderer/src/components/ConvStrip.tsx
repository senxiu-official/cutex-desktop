// A conversation folded to its strip (收起一个会话, docs/design/002; lib/convStrips): two workspaces on screen,
// one column shows as a STRIP_W-wide card in place — the agent's avatar with its status (Avatar `status`: running
// ring, the 需要你 / unread badge, as the sidebar's rail) and its name written vertically. A click (or keyboard focus: 聚焦窄条 = 展开它) expands it with
// its Shelf as it was. Its signals come from the sidebar's sources (lib/scopedSidebarView, as the home dock).
// The conversation itself stays mounted under it, hidden (components/PaneHost).
// `across` (portrait, lib/portrait P2): the other workspace's strip across the top of the stack — the avatar and the name in a
// row; a click (or keyboard focus) only moves the focus to it (nothing of lib/convStrips is written).
import { useMemo } from "react";
import { useI18n } from "../i18n";
import { showsRunningRing } from "../lib/agentAttention";
import { expandStrip } from "../lib/convStrips";
import { focusConversationPane } from "../lib/paneStore";
import { turnMarksOn, unreadCount, useTurnMarks } from "../lib/turnUnread";
import { leaveShelfOnly, useIsShelfOnly } from "../lib/shelfOnly";
import { useScopedAttention, useScopedSidebar } from "../lib/scopedSidebarView";
import { rowKey } from "../lib/sidebar";
import { avatarBadge } from "../lib/avatarStatus";
import { useConvSession } from "../lib/workspaceRowView";
import { StatusAvatar } from "./AgentStatus";
import { Avatar } from "./Avatar";
import "./strips.css";

export function ConvStrip({ paneId, hostId, sessionId, across = false }: { paneId: string; hostId: string; sessionId: string | null; across?: boolean }) {
  const { t } = useI18n();
  const session = useConvSession(hostId, sessionId);
  const scoped = useScopedSidebar();
  const attention = useScopedAttention(scoped.model, scoped.scope);
  const focus = scoped.scope.focus;
  const row = useMemo(() => attention.rows.find((r) => (r.hostId ?? focus) === hostId && r.session.cutexSessionId === sessionId), [attention.rows, focus, hostId, sessionId]);
  const signal = row ? attention.signals.get(rowKey(row)) : undefined;
  const needsYou = row ? attention.needs.get(rowKey(row)) : undefined;
  const needs = needsYou?.count ?? 0;
  const name = session?.displayName ?? row?.name ?? sessionId ?? "";
  const running = !!row && !!signal && showsRunningRing(signal, row.session);
  // 只看 Shelf (lib/shelfOnly): a click brings the conversation back and the Shelf to its width.
  const shelfOnly = useIsShelfOnly(paneId);
  const title = t(across ? "orientation.stripTitle" : shelfOnly ? "shelfOnly.stripTitle" : "strip.title", { name });
  // Folded = not looked at (owner 2026-10-22): turns that end meanwhile count as unread, shown here (blue).
  useTurnMarks();
  const unread = sessionId ? unreadCount(turnMarksOn(hostId)[sessionId]) : 0;
  // The corner badge as everywhere (lib/avatarStatus): 需要你 first, then unread turns (blue), then 出错.
  const badge = needs > 0 ? avatarBadge("needsYou", needsYou) : unread > 0 ? avatarBadge("done", null, unread) : signal === "error" ? avatarBadge("error") : null;
  const state = [needs ? t("strip.needs", { n: needs }) : null, !needs && unread ? t("sidebar.unreadCount", { n: unread }) : null, running ? t("strip.running") : null].filter(Boolean).join(" · ");
  return (
    <button type="button" data-side-nodrag data-conv-strip-button="" className={across ? "conv-strip conv-strip-across" : "conv-strip"} title={title} aria-label={state ? `${title} · ${state}` : title} onClick={() => (across ? focusConversationPane(paneId) : shelfOnly ? leaveShelfOnly(paneId) : expandStrip(paneId))}>
      <span className="conv-strip-avatar">
        {row && signal ? (
          <StatusAvatar name={row.name} initial={row.initial} color={row.color} avatar={row.session.avatar} seed={row.session.cutexSessionId} size={28} signal={signal} running={running} badge={badge} />
        ) : (
          <Avatar name={name} avatar={session?.avatar} seed={sessionId} size={28} status={{ badge }} />
        )}
      </span>
      <span className="conv-strip-name">{name}</span>
    </button>
  );
}
