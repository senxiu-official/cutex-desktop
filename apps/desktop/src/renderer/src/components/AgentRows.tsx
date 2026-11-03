// Sidebar agent rows (sidebar v2): a full row (status avatar, name, Director / 📌 / 新 tags, status tail,
// optional latest-message line), its compact one-line variant (running agents and the expanded
// 「N 个空闲」 fold: small avatar) and the compact offline row. Every variant puts its avatar in the
// same fixed column (AVATAR_COL), so names line up whatever the row shows; the status tail follows
// lib/statusTail (attention pill / running dot / passive text) in a fixed-height line box.
// Shared by the sidebar, the project flyout and the Projects page.
import { AgentPauseTag } from "./AgentPauseParts";
import { Columns2, MoreHorizontal, Pin } from "lucide-react";
import { memo, useContext, useMemo, useSyncExternalStore, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { formatAutoRetryWait } from "../lib/modelOverloadRetry";
import { useModelOverloadRetry } from "../lib/modelOverloadRetryView";
import { AllRowsCompact } from "../lib/allRowsCompact";
import { previewFromResource, previewLine, type ActivityPreview } from "../lib/activity";
import { getTurnMarks, subscribeTurnMarks, turnMarksOn, unreadCount, type TurnMark } from "../lib/turnUnread";
import { AgentBadge } from "./AgentBadge";
import { avatarCarriesMark } from "../lib/projectMark";
import { createdByOf, rowKey, sameAgentRow, shownName, type AgentRow } from "../lib/sidebar";
import { useIsFreshAgent } from "../lib/freshAgents";
import { useUiPrefs } from "../lib/prefs";
import { relativeTime } from "../lib/sidebarView";
import { lastSeen } from "../lib/offlineAgents";
import { useApp } from "../store";
import { startWorkspaceDrag } from "../lib/workspaces";
import { openAgentPendingNotes } from "../lib/ownerNotify";
import { focusOwnerNote, useHostOwnerNotes } from "../lib/ownerNotifyStore";
import { newInstanceKey, openModifiers } from "../lib/openModifiers";
import { usePanes } from "../lib/paneStore";
import { useForetell, withHandlers } from "../lib/foretell";
import { agentEffect } from "../lib/workspaceEffects";
import { contextMenu, openMenuFrom } from "../lib/contextMenu";
import { agentMenu } from "../lib/menus";
import { runningSince, showsRunningRing, type AgentSignal } from "../lib/agentAttention";
import { statusTail } from "../lib/statusTail";
import { signalLabel, useRowSignal } from "../lib/attentionView";
import { avatarBadge } from "../lib/avatarStatus";
import { paneMarkOf } from "../lib/paneMarks";
import { pinnedRows, showsPreview } from "../lib/sidebarLayout";
import { useSidebarHosts } from "../lib/scopedSidebarView";
import { sidebarMark } from "../lib/hostScope";
import { HostMark } from "./HostMark";
import { PassiveText, RunningDot, RunningTime, StatusAvatar, StatusPill } from "./AgentStatus";
import { useChipFit } from "../lib/useChipFit";
import { ScriptText } from "./ScriptText";
import { realAgentName, realNameTip } from "../lib/agentAlias";
import { CountBadge, Tag } from "./Tag";
import { SelectionMark } from "./SelectionMark";

/** Width of the avatar column (px) shared by every row variant; smaller avatars sit centred in it (design 040 §3.1 scale: 20 in a 32 px row). The offline 「更多」 link (Sidebar) indents to the name column: 6 + 20 + 8 = 34px. */
const AVATAR_COL = 20;

/** A row's avatar in the fixed avatar column. */
function AvatarCell({ children, min }: { children: ReactNode; min?: number }) {
  // `--avatar-col`: the sidebar widens the column for its IM-style rows so every variant's names line up.
  return (
    <span data-avatar-col="" className="flex shrink-0 items-center justify-center" style={{ width: `var(--avatar-col, ${AVATAR_COL}px)`, minWidth: min }}>
      {children}
    </span>
  );
}

/** Same row-local name tag look for 主管 and 新 (they describe the agent, not its state). */

/** The 📌 after a pinned row's name (menu 置顶; device-local). */
function PinMark() {
  const { t } = useI18n();
  return (
    <span className="flex shrink-0 text-subtle" title={t("sidebar.pinned")} data-row-pinned="">
      <Pin size={10} className="rotate-45" aria-label={t("sidebar.pinned")} />
    </span>
  );
}

/**
 * The IM-style second line (lib/activity previewLine): the last message as plain text (「你：…」 for the
 * owner's), while running the current step; nothing seen yet: the row's status.
 */
function Preview({ row, preview, running }: { row: AgentRow; preview: ActivityPreview | undefined; running: boolean }) {
  const { t } = useI18n();
  const retry = useModelOverloadRetry(row.id, row.hostId);
  if (retry && row.status !== "unknown" && row.status !== "offline") return <span>{formatAutoRetryWait(t, retry)}</span>;
  const line = previewLine(preview, running);
  if (!line) return <span>{t(`status.${row.status}`)}</span>;
  if (line.kind === "tool") return <span className="font-mono text-caption/[inherit]">{line.text}</span>;
  if (line.kind === "input") return <span><span className="text-muted">{t("sidebar.previewYou")}</span><ScriptText text={line.text} /></span>;
  const tone = line.kind === "received" ? "text-accent/80" : line.kind === "retry" ? "text-warn" : "";
  return <span className={tone}><ScriptText text={line.text} /></span>;
}


/**
 * Right side of a row, one tier of lib/statusTail: the attention pill (needs-you / 出错) or 完成, the
 * running dot + elapsed time, else the last activity. Activity / passive text gives way to ⋯ on hover.
 */
function RowTail({ row, signal, last, needs, compact, fit, openHost }: { row: AgentRow; signal: AgentSignal; last: number; needs: ReturnType<typeof useRowSignal>["needs"]; compact: boolean; fit: boolean; openHost: string | null }) {
  const { t } = useI18n();
  const retry = useModelOverloadRetry(row.id, row.hostId);
  if (retry && signal !== "needsYou" && signal !== "offline" && signal !== "unknown") return <PassiveText text={formatAutoRetryWait(t, retry)} className="group-hover:hidden" />;
  const tail = statusTail(signal, signal === "running" ? runningSince(row) : null);
  if (tail.tier === "attention" || (tail.tier === "passive" && tail.kind === "done")) {
    const pill = <StatusPill signal={signal} needs={needs} compact={compact} fit={fit} />;
    // The open agent's 等…回复 / 需要你 from a message: the pill jumps to that card (selecting it again does nothing else).
    return openHost && needs?.notificationIds?.length ? <NoteJump agentId={row.id} hostId={openHost}>{pill}</NoteJump> : pill;
  }
  if (tail.tier === "activity") {
    return tail.since !== null ? (
      <RunningTime since={tail.since} dot className="group-hover:hidden" />
    ) : (
      <span className="flex h-4 shrink-0 items-center group-hover:hidden">
        <RunningDot title={t("status.running")} />
      </span>
    );
  }
  return <PassiveText text={relativeTime(last)} className="group-hover:hidden" />;
}

/** The pill of the open agent's row as a button to its first pending owner notice (lib/ownerNotify openAgentPendingNotes). */
function NoteJump({ agentId, hostId, children }: { agentId: string; hostId: string; children: ReactNode }) {
  const { t } = useI18n();
  const byId = useHostOwnerNotes(hostId);
  const target = useMemo(() => openAgentPendingNotes(byId, agentId)[0], [byId, agentId]);
  if (!target) return <>{children}</>;
  return (
    <button
      type="button"
      data-row-note-jump=""
      // Counted as the chip slot by 状态标签 自动 (lib/useChipFit skips it among the line's children).
      data-fit-chip=""
      title={t("ownerNotify.pending.jump")}
      onClick={(e) => {
        e.stopPropagation();
        focusOwnerNote(agentId, target.notificationId, hostId);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="flex shrink-0 rounded-full hover:brightness-95 focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}

/**
 * A row's host (multi-host sidebar): selection, preview, menu and open go to that host; a row of a host
 * that is offline is greyed and cannot be opened (RFC §8.5).
 */
function useRowHost(row: AgentRow, withPreview = true) {
  const { t } = useI18n();
  const hosts = useSidebarHosts();
  const focus = useApp((s) => s.hosts?.active ?? "local");
  const host = row.hostId ?? focus;
  const own = host === focus;
  const selected = useApp((s) => s.selectedId === row.id && (s.selectedHost ?? focus) === host && s.view.kind === "conversation");
  const live = useApp((s) => (own && withPreview ? s.activity[row.id] : undefined));
  // Another host's previews come from its snapshot (its live deltas are not followed here).
  const seeded = useMemo(() => (own || !withPreview ? undefined : (previewFromResource(row.session) ?? undefined)), [own, withPreview, row.session]);
  const look = sidebarMark(hosts, row.hostId);
  const unavailable = hosts?.stateOf(row.hostId) === "offline";
  const label = hosts?.look(row.hostId)?.label ?? host;
  const effect = (beside: boolean) => agentEffect({ hostId: host, key: row.id, title: row.name }, beside ? "beside" : "replace");
  const rowForetell = useForetell((m) => effect(m.beside).foretell, { disabled: unavailable });
  return {
    selected,
    host,
    own,
    preview: own ? live : seeded,
    look,
    unavailable,
    /**
     * Plain click: the focused conversation pane shows it (or the pane already showing it gets the
     * focus; a minimised one comes back on its side). Ctrl/⌘-click, middle click, Ctrl/⌘+Enter: a
     * workspace beside (lib/workspaceEffects agentEffect — the same effect the hover foretells, 008).
     */
    open: (e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; button?: number }) => {
      if (unavailable) return;
      effect(!!e && openModifiers(e).newInstance).run();
    },
    /** The row's hover / keyboard-focus preview (Ctrl/⌘ held: the beside one). */
    foretell: rowForetell,
    menu: () => agentMenu(row.session, t, host),
    offlineTitle: unavailable ? t("sidebar.hostRowOffline", { host: label }) : null,
  };
}

/**
 * A row's hover 「在旁边打开」 (panes step 2): the agent in a conversation pane beside the focused one. Memoized on the
 * agent (primitive props; its own effect and preview): a row re-rendering for a status tick does not redraw it.
 */
const BesideButton = memo(function BesideButton({ hostId, id, title, size = 14 }: { hostId: string; id: string; title: string; size?: number }) {
  const { t } = useI18n();
  const effect = () => agentEffect({ hostId, key: id, title }, "beside");
  const foretell = useForetell(() => effect().foretell);
  return (
    <button
      {...foretell}
      data-fit-skip=""
      data-open-beside=""
      title={t("pane.openBesideHint", { key: newInstanceKey() })}
      aria-label={t("pane.openBeside")}
      onClick={(e) => {
        e.stopPropagation();
        effect().run();
      }}
      className="hidden shrink-0 rounded px-0.5 text-subtle group-hover:block hover:bg-surface hover:text-foreground"
    >
      <Columns2 size={size} />
    </button>
  );
});

/** Same row content and variant (the memo of AgentRowButton). */
const sameRowButton = (a: { row: AgentRow; compact?: boolean }, b: { row: AgentRow; compact?: boolean }) => !!a.compact === !!b.compact && sameAgentRow(a, b);

/** Width (px) the IM line's preview keeps before a needs-you pill shrinks to its count (状态标签 自动). */
const PREVIEW_ROOM = 72;

/** A row's turn mark (unread count) from its own host's marks. */
function useRowMark(row: AgentRow, host: string, own: boolean) {
  // Only this row's mark (perf §9): a turn ending anywhere re-rendered every row.
  return useSyncExternalStore(subscribeTurnMarks, () => (own ? getTurnMarks()[row.id] : turnMarksOn(host)[row.id]));
}

// Memoized by row content: the sidebar model is rebuilt when a row's data changes, not per streamed token
// (lib/sessionsMeta); a row re-renders for its own preview / selection / signal only.
/**
 * `compact`: one short line (16px avatar centred in the avatar column, 20px among IM-style rows; no
 * preview). Inside a project group the name drops the group's shared prefix (`shortName`; the full
 * name in the tooltip). Otherwise IM-style
 * (消息预览 on, the default): avatar, name and time over the last message and the badge (需要你 /
 * 出错 pill, unread count); the running dot and time on the first line. 消息预览 off: one line.
 */
export const AgentRowButton = memo(function AgentRowButton({ row, compact: compactRow = false }: { row: AgentRow; compact?: boolean }) {
  const { t } = useI18n();
  // Layout B 「全部」 (lib/allRowsCompact): every row compact, 20 px avatar.
  const allCompact = useContext(AllRowsCompact);
  const compact = compactRow || allCompact;
  const { selected, host, own, preview, look, unavailable, open, menu, offlineTitle, foretell } = useRowHost(row);
  const { rowPreview, statusChips } = useUiPrefs();
  const { signal, needs } = useRowSignal(row);
  const mark = useRowMark(row, host, own);
  const last = Math.max(row.lastActivity, preview?.at ?? 0);
  const twoLines = !compact && showsPreview(row, rowPreview);
  const flagged = signal === "needsYou" || signal === "done" || signal === "error";
  // Created recently and not opened yet (lib/freshAgents): a small 「新」 marker.
  const fresh = useIsFreshAgent(rowKey(row));
  // 状态标签 自动: re-measured when the line resizes or its content changes (lib/useChipFit).
  const chipFit = useChipFit(statusChips, [shownName(row), signal, needs?.count, needs?.reasons.join(), row.isDirector, row.isOperator, row.operatorRestartRequired, row.pinned, !!look, fresh, twoLines]);
  // Compact rows under IM-style rows (消息预览 on): a 20 px avatar (sidebar density), else 16 px.
  const avatar = twoLines ? IM_AVATAR : compact ? (rowPreview === "off" && !allCompact ? 16 : COMPACT_IM_AVATAR) : AVATAR_COL;
  const nameTags = (
    <>
      {row.isDirector && <Tag>{t("sidebar.director")}</Tag>}
      {row.isOperator && <Tag data-operator-tag="">{t("sidebar.operator")}</Tag>}
      <AgentPauseTag hostId={host} sessionId={row.session.cutexSessionId} />
      {!twoLines && row.operatorRestartRequired && <Tag data-operator-restart-required="" tone="attention" title={t("sidebar.operatorRestartRequired")}>{t("sidebar.operatorRestartRequired")}</Tag>}
      {row.pinned && <PinMark />}
      {fresh && (
        <Tag tone="accent" title={t("sidebar.freshHint")} data-testid="agent-fresh">
          {t("sidebar.fresh")}
        </Tag>
      )}
    </>
  );
  const hoverActions = (
    <>
      {!unavailable && <BesideButton hostId={host} id={row.id} title={row.name} />}
      <button
        data-fit-skip=""
        title={t("menu.more")}
        onClick={(e) => {
          e.stopPropagation();
          openMenuFrom(e.currentTarget, menu());
        }}
        className="hidden shrink-0 rounded px-0.5 text-subtle group-hover:block hover:bg-surface hover:text-foreground"
      >
        <MoreHorizontal size={14} />
      </button>
    </>
  );
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={unavailable || undefined}
      onClick={(e) => open(e)}
      onAuxClick={(e) => e.button === 1 && open(e)}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      {...withHandlers({ onPointerDown: (e: ReactPointerEvent) => void (!unavailable && startWorkspaceDrag({ kind: "agent", hostId: row.hostId ?? useApp.getState().hosts?.active ?? "local", key: row.id, title: row.name }, e)) }, foretell)}
      onKeyDown={(e) => {
        // Enter / Space = click; Ctrl/⌘ held = Ctrl/⌘-click (window audit #10).
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        open(e);
      }}
      onContextMenu={contextMenu(menu)}
      data-row-selectable=""
      data-created-by={createdByOf(row.session)}
      data-row-selected={selected ? "" : undefined}
      data-row-compact={compact ? "" : undefined}
      data-row-im={twoLines ? "" : undefined}
      title={offlineTitle ?? (twoLines ? undefined : [labelOf(row), preview?.text, t("pane.openBesideHint", { key: newInstanceKey() })].filter(Boolean).join("\n"))}
      className={`density-row group flex w-full cursor-default items-center rounded-md px-1.5 text-left ${twoLines ? "gap-2.5 rounded-lg py-1.5" : compact ? "gap-2 py-px" : "gap-2 py-[3px]"} ${
        selected ? "bg-selected" : "hover:bg-hover"
      } ${unavailable ? "opacity-50 grayscale" : ""}`}
    >
      <AvatarCell min={twoLines ? IM_AVATAR : undefined}>
        <StatusAvatar name={row.name} initial={row.initial} color={row.color} avatar={row.session.avatar} seed={row.session.cutexSessionId} size={avatar} signal={signal} running={showsRunningRing(signal, row.session)} badge={twoLines ? avatarBadge(signal, needs, unreadCount(mark)) : undefined} />
      </AvatarCell>
      {twoLines ? (
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex h-5 items-center gap-1">
            {look && <HostMark host={look} dotOnly />}
            <span title={row.shortName ? labelOf(row) : undefined} className={`min-w-0 truncate text-ui/[inherit] ${flagged ? "font-semibold" : "font-medium"} ${signal === "offline" || signal === "unknown" ? "text-muted" : ""}`}><ScriptText text={shownName(row)} /></span>
            <AgentBadge badge={row.session.badge} hostId={row.hostId} onAvatar={avatarCarriesMark(avatar)} />
            {nameTags}
            <span className="ml-auto" />
            <ImTime row={row} signal={signal} last={last} />
            {hoverActions}
          </div>
          <div ref={chipFit.lineRef} className="relative flex h-[18px] items-center gap-1.5">
            {row.operatorRestartRequired && <Tag data-operator-restart-required="" tone="attention">{t("sidebar.operatorRestartRequired")}</Tag>}
            <span data-fit-name="" aria-hidden className="pointer-events-none invisible absolute h-0 overflow-hidden" style={{ width: PREVIEW_ROOM }} />
            <span data-row-preview="" data-fit-skip="" className="min-w-0 flex-1 truncate text-meta/[inherit] leading-4 text-subtle">
              <Preview row={row} preview={preview} running={signal === "running" || row.status === "running"} />
            </span>
            <RowBadge row={row} signal={signal} needs={needs} mark={mark} compact={chipFit.compact} fit={statusChips === "auto"} openHost={selected ? host : null} />
          </div>
        </div>
      ) : (
        <div className="min-w-0 flex-1 leading-tight">
          <div ref={chipFit.lineRef} className="flex h-5 items-center gap-1">
            {look && <HostMark host={look} dotOnly />}
            <span data-fit-name="" className={`truncate text-ui/[inherit] ${flagged ? "font-semibold" : signal === "offline" || signal === "unknown" ? "text-muted" : ""}`}><ScriptText text={shownName(row)} /></span>
            <AgentBadge badge={row.session.badge} hostId={row.hostId} onAvatar={avatarCarriesMark(avatar)} />
            {nameTags}
            <span className="ml-auto" />
            <RowTail row={row} signal={signal} last={last} needs={needs} compact={chipFit.compact} fit={statusChips === "auto"} openHost={selected ? host : null} />
            {hoverActions}
          </div>
        </div>
      )}
    </div>
  );
}, sameRowButton);

/** Avatar size (px) of an IM-style row. */
const IM_AVATAR = 32;

/** Avatar size (px) of a compact row among IM-style rows. */
const COMPACT_IM_AVATAR = 20;

/** First line's right end of an IM row: the running dot + elapsed time, else when it last spoke; ⋯ on hover. */
function ImTime({ row, signal, last }: { row: AgentRow; signal: AgentSignal; last: number }) {
  const { t } = useI18n();
  const retry = useModelOverloadRetry(row.id, row.hostId);
  if (retry && signal !== "offline" && signal !== "unknown") return <PassiveText text={formatAutoRetryWait(t, retry)} className="group-hover:hidden" />;
  if (signal === "running") {
    const since = runningSince(row);
    return since !== null ? (
      <RunningTime since={since} dot className="group-hover:hidden" />
    ) : (
      <span className="flex h-4 shrink-0 items-center group-hover:hidden">
        <RunningDot title={t("status.running")} />
      </span>
    );
  }
  return <PassiveText text={relativeTime(last)} className="group-hover:hidden" />;
}

/**
 * Second line's right end of an IM row: the attention pill (需要你 / 出错; the open agent's jumps to its
 * card), else the unread count of finished turns not seen yet.
 */
function RowBadge({ row, signal, needs, mark, compact, fit, openHost }: { row: AgentRow; signal: AgentSignal; needs: ReturnType<typeof useRowSignal>["needs"]; mark: TurnMark | undefined; compact: boolean; fit: boolean; openHost: string | null }) {
  if (signal === "needsYou" || signal === "error") {
    const pill = <StatusPill signal={signal} needs={needs} compact={compact} fit={fit} plain />;
    return openHost && needs?.notificationIds?.length ? <NoteJump agentId={row.id} hostId={openHost}>{pill}</NoteJump> : pill;
  }
  // The unread count is the avatar's corner badge now (IM rows are always two-line; compact rows never reach here).
  return null;
}

/** An offline agent as one compact dimmed line: small avatar, name, last activity; ⋯ / right-click = agent menu. */
export const OfflineRow = memo(function OfflineRow({ row }: { row: AgentRow }) {
  const { t } = useI18n();
  const { selected, host, preview, look, unavailable, open, menu, offlineTitle, foretell } = useRowHost(row);
  const previewAt = preview?.at;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={unavailable || undefined}
      title={offlineTitle ?? [labelOf(row), row.session.note, t("pane.openBesideHint", { key: newInstanceKey() })].filter(Boolean).join("\n")}
      onClick={(e) => open(e)}
      onAuxClick={(e) => e.button === 1 && open(e)}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      {...withHandlers({ onPointerDown: (e: ReactPointerEvent) => void (!unavailable && startWorkspaceDrag({ kind: "agent", hostId: row.hostId ?? useApp.getState().hosts?.active ?? "local", key: row.id, title: row.name }, e)) }, foretell)}
      onKeyDown={(e) => {
        // Enter / Space = click; Ctrl/⌘ held = Ctrl/⌘-click (window audit #10).
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        open(e);
      }}
      onContextMenu={contextMenu(menu)}
      data-row-selectable=""
      data-row-selected={selected ? "" : undefined}
      className={`group flex w-full cursor-default items-center gap-2 rounded-md px-1.5 py-px text-left ${selected ? "bg-background shadow-e1" : "hover:bg-hover"} ${unavailable ? "opacity-50" : ""}`}
    >
      <AvatarCell>
        <span className={`flex grayscale ${selected ? "" : "opacity-55 group-hover:opacity-90"}`}>
          <StatusAvatar name={row.name} initial={row.initial} color={row.color} avatar={row.session.avatar} seed={row.session.cutexSessionId} size={20} signal="idle" />
        </span>
      </AvatarCell>
      <div className="flex h-5 min-w-0 flex-1 items-center gap-1">
        {look && <HostMark host={look} dotOnly />}
        <AgentBadge badge={row.session.badge} hostId={row.hostId} />
        <span className={`min-w-0 flex-1 truncate text-ui/[inherit] ${selected ? "text-foreground" : "text-muted group-hover:text-foreground"}`}><ScriptText text={shownName(row)} /></span>
        {row.isDirector && <Tag>{t("sidebar.director")}</Tag>}
        {row.isOperator && <Tag data-operator-tag="">{t("sidebar.operator")}</Tag>}
        <AgentPauseTag hostId={host} sessionId={row.session.cutexSessionId} />
        {row.operatorRestartRequired && <Tag data-operator-restart-required="" tone="attention">{t("sidebar.operatorRestartRequired")}</Tag>}
        {row.pinned && <PinMark />}
        <PassiveText text={relativeTime(lastSeen(row, previewAt))} className="group-hover:hidden" />
        {!unavailable && <BesideButton hostId={host} id={row.id} title={row.name} size={13} />}
        <button
          title={t("menu.more")}
          onClick={(e) => {
            e.stopPropagation();
            openMenuFrom(e.currentTarget, menu());
          }}
          className="hidden shrink-0 rounded px-0.5 text-subtle group-hover:block hover:bg-surface hover:text-foreground"
        >
          <MoreHorizontal size={13} />
        </button>
      </div>
    </div>
  );
}, sameAgentRow);
/** The pinned rows (menu 置顶) of a collapsed group, as full rows under its header; nothing without pins. */
export function PinnedRows({ rows, className }: { rows: readonly AgentRow[]; className?: string }) {
  const pins = pinnedRows(rows);
  if (pins.length === 0) return null;
  return (
    <div className={className} data-pinned-rows="">
      {pins.map((row) => (
        <AgentRowButton key={rowKey(row)} row={row} />
      ))}
    </div>
  );
}

/** Row tooltip head: the shown name, plus the real name under an alias. */
function labelOf(row: AgentRow): string {
  return realNameTip(row.session) ? `${row.name} · ${realAgentName(row.session)}` : row.name;
}
