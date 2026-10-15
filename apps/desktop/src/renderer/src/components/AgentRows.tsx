// Sidebar agent rows (sidebar v2): a full row (status avatar, name, Director / 新 tags, status tail,
// optional latest-message line), its compact one-line variant (running agents and the expanded
// 「N 个空闲」 fold: small avatar) and the compact offline row. Every variant puts its avatar in the
// same fixed column (AVATAR_COL), so names line up whatever the row shows; the status tail follows
// lib/statusTail (attention pill / running dot / passive text) in a fixed-height line box.
// Shared by the sidebar, the project flyout and the Projects page.
import { MoreHorizontal } from "lucide-react";
import { memo, useMemo, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { previewFromResource, type ActivityPreview } from "../lib/activity";
import { rowKey, sameAgentRow, type AgentRow } from "../lib/sidebar";
import { useIsFreshAgent } from "../lib/freshAgents";
import { useUiPrefs } from "../lib/prefs";
import { relativeTime } from "../lib/sidebarView";
import { lastSeen } from "../lib/offlineAgents";
import { useApp } from "../store";
import { contextMenu, openMenuFrom } from "../lib/contextMenu";
import { agentMenu } from "../lib/menus";
import { runningSince, showsRunningRing, type AgentSignal } from "../lib/agentAttention";
import { statusTail } from "../lib/statusTail";
import { useRowSignal } from "../lib/attentionView";
import { showsPreview } from "../lib/sidebarLayout";
import { useSidebarHosts } from "../lib/scopedSidebarView";
import { sidebarMark } from "../lib/hostScope";
import { HostMark } from "./HostMark";
import { PassiveText, RunningDot, RunningTime, StatusAvatar, StatusPill } from "./AgentStatus";
import { useChipFit } from "../lib/useChipFit";
import { ScriptText } from "./ScriptText";
import { realAgentName, realNameTip } from "../lib/agentAlias";

/** Width of the avatar column (px) shared by every row variant; smaller avatars sit centred in it. The offline 「更多」 link (Sidebar) indents to the name column: 6 + 22 + 8 = 36px. */
const AVATAR_COL = 22;

/** A row's avatar in the fixed avatar column. */
function AvatarCell({ children }: { children: ReactNode }) {
  return (
    <span data-avatar-col="" className="flex shrink-0 items-center justify-center" style={{ width: AVATAR_COL }}>
      {children}
    </span>
  );
}

/** Same row-local name tag look for 主管 and 新 (they describe the agent, not its state). */
const NAME_TAG = "shrink-0 rounded px-1 text-[10px] leading-4 font-medium";

function Preview({ row, preview }: { row: AgentRow; preview: ActivityPreview | undefined }) {
  const { t } = useI18n();
  if (!preview) return <span>{t(`status.${row.status}`)}</span>;
  const tone = preview.kind === "tool" ? "font-mono text-[10.5px]" : preview.kind === "received" ? "text-accent/80" : "";
  return <span className={tone}>{preview.kind === "tool" ? preview.text : <ScriptText text={preview.text} />}</span>;
}

/**
 * Right side of a row, one tier of lib/statusTail: the attention pill (needs-you / 出错) or 完成, the
 * running dot + elapsed time, else the last activity. Activity / passive text gives way to ⋯ on hover.
 */
function RowTail({ row, signal, last, needs, compact, fit }: { row: AgentRow; signal: AgentSignal; last: number; needs: ReturnType<typeof useRowSignal>["needs"]; compact: boolean; fit: boolean }) {
  const { t } = useI18n();
  const tail = statusTail(signal, signal === "running" ? runningSince(row) : null);
  if (tail.tier === "attention" || (tail.tier === "passive" && tail.kind === "done")) return <StatusPill signal={signal} needs={needs} compact={compact} fit={fit} />;
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

/**
 * A row's host (multi-host sidebar): selection, preview, menu and open go to that host; a row of a host
 * that is offline is greyed and cannot be opened (RFC §8.5).
 */
function useRowHost(row: AgentRow) {
  const { t } = useI18n();
  const hosts = useSidebarHosts();
  const focus = useApp((s) => s.hosts?.active ?? "local");
  const host = row.hostId ?? focus;
  const own = host === focus;
  const selected = useApp((s) => s.selectedId === row.id && (s.selectedHost ?? focus) === host && s.view.kind === "conversation");
  const live = useApp((s) => (own ? s.activity[row.id] : undefined));
  // Another host's previews come from its snapshot (its live deltas are not followed here).
  const seeded = useMemo(() => (own ? undefined : (previewFromResource(row.session) ?? undefined)), [own, row.session]);
  const select = useApp((s) => s.select);
  const look = sidebarMark(hosts, row.hostId);
  const unavailable = hosts?.stateOf(row.hostId) === "offline";
  const label = hosts?.look(row.hostId)?.label ?? host;
  return {
    selected,
    preview: own ? live : seeded,
    look,
    unavailable,
    open: () => {
      if (!unavailable) void select(row.id, host);
    },
    menu: () => agentMenu(row.session, t, host),
    offlineTitle: unavailable ? t("sidebar.hostRowOffline", { host: label }) : null,
  };
}

/** Same row content and variant (the memo of AgentRowButton). */
const sameRowButton = (a: { row: AgentRow; compact?: boolean }, b: { row: AgentRow; compact?: boolean }) => !!a.compact === !!b.compact && sameAgentRow(a, b);

// Memoized by row content: the sidebar model is rebuilt on every store commit, its rows with it.
/** `compact`: one short line (16px avatar centred in the avatar column, no latest-message line). */
export const AgentRowButton = memo(function AgentRowButton({ row, compact = false }: { row: AgentRow; compact?: boolean }) {
  const { t } = useI18n();
  const { selected, preview, look, unavailable, open, menu, offlineTitle } = useRowHost(row);
  const { rowPreview, statusChips } = useUiPrefs();
  const { signal, needs } = useRowSignal(row);
  const last = Math.max(row.lastActivity, preview?.at ?? 0);
  const twoLines = !compact && showsPreview(row, rowPreview);
  const flagged = signal === "needsYou" || signal === "done" || signal === "error";
  // Created recently and not opened yet (lib/freshAgents): a small 「新」 marker.
  const fresh = useIsFreshAgent(rowKey(row));
  // 状态标签 自动: re-measured when the line resizes or its content changes (lib/useChipFit).
  const chipFit = useChipFit(statusChips, [row.name, signal, needs?.count, needs?.reasons.join(), row.isDirector, !!look, fresh]);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={unavailable || undefined}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      onContextMenu={contextMenu(menu)}
      data-row-selectable=""
      data-row-selected={selected ? "" : undefined}
      data-row-compact={compact ? "" : undefined}
      title={offlineTitle ?? (twoLines ? undefined : [labelOf(row), preview?.text].filter(Boolean).join("\n"))}
      className={`density-row group flex w-full cursor-default items-center gap-2 rounded-md px-1.5 text-left ${twoLines ? "py-0.5" : compact ? "py-px" : "py-[3px]"} ${
        selected ? "bg-background shadow-[var(--card-shadow)]" : "hover:bg-hover"
      } ${unavailable ? "opacity-50 grayscale" : ""}`}
    >
      <AvatarCell>
        <StatusAvatar name={row.name} initial={row.initial} color={row.color} avatar={row.session.avatar} seed={row.session.cutexSessionId} size={compact ? 16 : AVATAR_COL} signal={signal} running={showsRunningRing(signal, row.session)} />
      </AvatarCell>
      <div className="min-w-0 flex-1 leading-tight">
        <div ref={chipFit.lineRef} className="flex h-5 items-center gap-1">
          {look && <HostMark host={look} dotOnly />}
          <span data-fit-name="" className={`truncate text-[13px] ${flagged ? "font-semibold" : signal === "offline" || signal === "unknown" ? "text-muted" : ""}`}><ScriptText text={row.name} /></span>
          {row.isDirector && <span className={`${NAME_TAG} bg-surface-2 text-muted`}>{t("sidebar.director")}</span>}
          {fresh && (
            <span className={`${NAME_TAG} bg-accent/10 text-accent`} title={t("sidebar.freshHint")} data-testid="agent-fresh">
              {t("sidebar.fresh")}
            </span>
          )}
          <span className="ml-auto" />
          <RowTail row={row} signal={signal} last={last} needs={needs} compact={chipFit.compact} fit={statusChips === "auto"} />
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
        </div>
        {twoLines && (
          // Smaller and dimmer than the name above it (owner 2026-10-12), still readable (UI review #4).
          <div data-row-preview="" className="truncate text-[11px] leading-4 text-muted">
            <Preview row={row} preview={preview} />
          </div>
        )}
      </div>
    </div>
  );
}, sameRowButton);

/** An offline agent as one compact dimmed line: small avatar, name, last activity; ⋯ / right-click = agent menu. */
export const OfflineRow = memo(function OfflineRow({ row }: { row: AgentRow }) {
  const { t } = useI18n();
  const { selected, preview, look, unavailable, open, menu, offlineTitle } = useRowHost(row);
  const previewAt = preview?.at;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={unavailable || undefined}
      title={offlineTitle ?? [labelOf(row), row.session.note].filter(Boolean).join("\n")}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      onContextMenu={contextMenu(menu)}
      data-row-selectable=""
      data-row-selected={selected ? "" : undefined}
      className={`group flex w-full cursor-default items-center gap-2 rounded-md px-1.5 py-px text-left ${selected ? "bg-background shadow-[var(--card-shadow)]" : "hover:bg-hover"} ${unavailable ? "opacity-50" : ""}`}
    >
      <AvatarCell>
        <span className={`flex grayscale ${selected ? "" : "opacity-55 group-hover:opacity-90"}`}>
          <StatusAvatar name={row.name} initial={row.initial} color={row.color} avatar={row.session.avatar} seed={row.session.cutexSessionId} size={18} signal="idle" />
        </span>
      </AvatarCell>
      <div className="flex h-5 min-w-0 flex-1 items-center gap-1">
        {look && <HostMark host={look} dotOnly />}
        <span className={`min-w-0 flex-1 truncate text-[12.5px] ${selected ? "text-foreground" : "text-muted group-hover:text-foreground"}`}><ScriptText text={row.name} /></span>
        {row.isDirector && <span className={`${NAME_TAG} bg-surface-2 text-muted`}>{t("sidebar.director")}</span>}
        <PassiveText text={relativeTime(lastSeen(row, previewAt))} className="group-hover:hidden" />
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


/** Row tooltip head: the shown name, plus the real name under an alias. */
function labelOf(row: AgentRow): string {
  return realNameTip(row.session) ? `${row.name} · ${realAgentName(row.session)}` : row.name;
}
