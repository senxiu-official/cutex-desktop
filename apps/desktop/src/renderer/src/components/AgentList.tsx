// 全部 agent: one group's online / offline / archived agents — search, sort, runtime filter,
// multi-select (Shift = range) and bulk 停止 / 启动 / 归档 / 恢复 through the existing cutex mutations
// (at most 3 at once, per-row progress). Online rows show the sidebar's running ring / pills / running
// time. Shared by the sidebar's 全部 agent dialog (opens on 离线) and the project page's Agent tab
// (opens on 在线). Everything goes through the daemon, so a remote host works the same.
// On the project page the list is also the member management (`members`): row menu entries for the
// Director seat / 移出项目 and a bulk 移出项目 (the page supplies the cutex mutations).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Loader2, MoreHorizontal, Search } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import type { ActivityPreview } from "../lib/activity";
import { rawIdTitle, useModelName } from "../lib/modelDisplay";
import {
  archivedOf,
  defaultAgentListTab,
  filterSortAgents,
  modelOf,
  profileOf,
  runLimited,
  runtimeOf,
  selectionState,
  selectRange,
  START_CONCURRENCY,
  START_CONFIRM_OVER,
  tabActions,
  tabRows,
  type AgentListAction,
  type AgentListTab,
  type AgentSort,
  type RuntimeFilter,
} from "../lib/agentList";
import { confirmDialog, contextMenu, openMenuFrom, type MenuEntry } from "../lib/contextMenu";
import { agentMenu, ownedServicesNote, restoreArchived } from "../lib/menus";
import { runningSince, showsRunningRing } from "../lib/agentAttention";
import { AttentionContext, useAttention, useRowSignal } from "../lib/attentionView";
import { lastSeen } from "../lib/offlineAgents";
import { detachable } from "../lib/projectMembers";
import { cachedProfileList, loadProfileList } from "../lib/profileSnapshot";
import type { AgentRow } from "../lib/sidebar";
import { relativeTime, useSidebarModel } from "../lib/sidebarView";
import { sidebarOf, useApp } from "../store";
import { useTargetHostId, useTargetIsFocus, useTargetSelect } from "../lib/targetHost";
import { Avatar } from "./Avatar";
import { RunningTime, StatusAvatar, StatusPill } from "./AgentStatus";
import { realAgentName, realNameTip } from "../lib/agentAlias";

/** `detach`: 移出项目 (project page only, `members`). */
type Action = AgentListAction | "detach";

/** The project page's member management on top of the list (modules/projects). */
export interface MemberControls {
  /** The project's Director (its row cannot be detached). */
  directorId: string | null;
  /** Entries put before the agent menu of a member row (在线 / 离线 tabs). */
  rowMenu(row: AgentRow): MenuEntry[];
  /** 移出项目 of one member (cutex detach_member); one at a time (the project revision fences each). */
  detach(id: string): Promise<void>;
}
type Phase = "queued" | "running" | "done" | "failed";

/** A row acted on in this list: it stays where it was (frozen sort key) until the list closes. */
interface Progress {
  action: Action;
  phase: Phase;
  error?: string;
  tab: AgentListTab;
  row: AgentRow;
  last: number;
}

const NO_ACTIVITY: Record<string, ActivityPreview> = {};
const GRID = "grid grid-cols-[1rem_1.75rem_minmax(0,1fr)_minmax(0,9rem)_2.75rem_5.5rem] items-center gap-x-3";
const BUTTON = "rounded-md px-3 py-1 text-xs disabled:opacity-40";
const ACTION_LABEL: Record<Action, MessageKey> = {
  stop: "agents.stop",
  start: "agents.start",
  archive: "agents.archive",
  restore: "agents.restore",
  restoreStart: "agents.restoreStart",
  detach: "agents.detach",
};

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One bulk action on `hostId`'s agent (the list's host: the target host, lib/targetHost). */
async function perform(action: Action, row: AgentRow, hostId: string): Promise<void> {
  const app = useApp.getState();
  const id = row.id;
  if (action === "stop") {
    // Same mutation as the agent menu's 停止运行时.
    await app.sessionAction(id, "cutex/runtime/offline", { expectedRuntimeGeneration: row.session.runtime.runtimeGeneration }, hostId);
    return;
  }
  if (action === "archive") {
    await app.sessionAction(id, "cutex/session/retire", { reason: "desktop" }, hostId);
    return;
  }
  if (action === "restore" || action === "restoreStart") {
    const session = sidebarOf(app, hostId)?.retired.find((s) => s.cutexSessionId === id);
    if (session) await restoreArchived(session, true, hostId);
    else await app.sessionAction(id, "cutex/session/restore", undefined, hostId);
  }
  if (action === "start" || action === "restoreStart") await app.sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false }, hostId);
}

function Checkbox({ state, disabled, title, onClick }: { state: "none" | "some" | "all"; disabled?: boolean; title?: string; onClick(e: MouseEvent): void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      title={title}
      aria-label={title}
      tabIndex={-1}
      checked={state === "all"}
      disabled={disabled}
      onChange={() => {}}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)] disabled:cursor-default disabled:opacity-30"
    />
  );
}

function PreviewLine({ preview }: { preview: ActivityPreview | undefined }) {
  if (!preview?.text.trim()) return null;
  const tone = preview.kind === "tool" ? "font-mono text-[11px]" : preview.kind === "received" ? "text-accent/70" : preview.kind === "retry" ? "text-warn" : "";
  return <div className={`truncate text-xs text-subtle ${tone}`}>{preview.text}</div>;
}

function StatusCell({ p, live }: { p: Progress | undefined; live: AgentRow | undefined }) {
  const { t } = useI18n();
  if (!p) return null;
  if (p.phase === "failed") {
    return (
      <span title={p.error} className="cursor-help text-danger">
        {t("agents.state.failed")}
      </span>
    );
  }
  if (p.phase === "queued") return <span className="text-subtle">{t("agents.state.queued")}</span>;
  const starts = p.action === "start" || p.action === "restoreStart";
  if (p.phase === "running") {
    const key = starts ? "agents.state.starting" : p.action === "stop" ? "agents.state.stopping" : p.action === "archive" ? "agents.state.archiving" : p.action === "detach" ? "agents.state.detaching" : "agents.state.restoring";
    return (
      <span className="inline-flex items-center gap-1 text-accent">
        <Loader2 size={11} className="animate-spin" />
        {t(key)}
      </span>
    );
  }
  const online = live && live.status !== "offline" && live.status !== "unknown";
  const key: MessageKey = starts
    ? online
      ? "agents.state.online"
      : "agents.state.started"
    : p.action === "stop"
      ? "agents.state.stopped"
      : p.action === "archive"
        ? "agents.state.archived"
        : p.action === "detach"
          ? "agents.state.detached"
          : "agents.state.restored";
  return <span className={starts && online ? "text-ok-text" : "text-muted"}>{t(key)}</span>;
}

function Row({
  row,
  live,
  preview,
  last,
  progress,
  profileModels,
  hostId,
  online,
  checked,
  selectable,
  onToggle,
  onOpen,
  onMove,
  menu,
}: {
  row: AgentRow;
  live: AgentRow | undefined;
  preview: ActivityPreview | undefined;
  last: number;
  progress: Progress | undefined;
  profileModels: ReadonlyMap<string, string | null>;
  hostId: string;
  /** 在线 tab: the sidebar's status look (running ring, 完成 / 需要你 / 出错 pill, running time). */
  online: boolean;
  checked: boolean;
  selectable: boolean;
  onToggle(e: MouseEvent | KeyboardEvent): void;
  onOpen(): void;
  onMove(el: HTMLElement, delta: 1 | -1): void;
  /** The row menu (⋯, right-click, the context-menu key / Shift+F10). */
  menu(): MenuEntry[];
}) {
  const { t } = useI18n();
  const session = (live ?? row).session;
  const runtime = runtimeOf(session);
  const profile = profileOf(session) ?? (runtime === "claude" ? "Claude" : null);
  const model = modelOf(session, profileModels);
  const modelName = useModelName();
  const modelShown = modelName(model, null, profile);
  const note = session.note?.trim();
  const shown = live ?? row;
  const { signal, needs } = useRowSignal(shown);
  const since = online && signal === "running" ? runningSince(shown) : null;
  const flagged = signal === "needsYou" || signal === "done" || signal === "error";
  return (
    <div
      tabIndex={0}
      data-agent-row
      onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? selectable && onToggle(e) : onOpen())}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") onOpen();
        else if (e.key === " ") {
          e.preventDefault();
          if (selectable) onToggle(e);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          onMove(e.currentTarget, e.key === "ArrowDown" ? 1 : -1);
        } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
          e.preventDefault();
          openMenuFrom(e.currentTarget.querySelector<HTMLElement>("[data-row-more]") ?? e.currentTarget, menu());
        }
      }}
      onContextMenu={contextMenu(menu)}
      className={`group ${GRID} cursor-default border-b border-border/60 px-4 py-2 outline-none last:border-b-0 focus-visible:bg-surface-2 ${checked ? "bg-accent/10" : "hover:bg-surface-2/60"}`}
    >
      <Checkbox state={checked ? "all" : "none"} disabled={!selectable} onClick={onToggle} />
      {online ? (
        <StatusAvatar name={row.name} initial={row.initial} color={row.color} avatar={session.avatar} seed={session.cutexSessionId} size={28} minor signal={signal} running={showsRunningRing(signal, session)} />
      ) : (
        <Avatar name={row.name} initial={row.initial} color={row.color} avatar={session.avatar} seed={session.cutexSessionId} size={28} minor />
      )}
      <div className="min-w-0 leading-snug">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium" title={realNameTip(session) ? `${row.name}\n${t("info.realNameTip", { name: realAgentName(session) })}` : row.name}>
            {row.name}
          </span>
          {realNameTip(session) && <span className="min-w-0 shrink truncate text-[11px] text-subtle">{realAgentName(session)}</span>}
          {row.isDirector && <span className="shrink-0 rounded bg-surface-2 px-1 text-[9px] font-semibold text-muted">{t("sidebar.director")}</span>}
          {online && flagged && <StatusPill signal={signal} needs={needs} />}
        </div>
        {note && (
          <div className="truncate text-xs text-muted" title={note}>
            {note}
          </div>
        )}
        <PreviewLine preview={preview} />
      </div>
      <div className="min-w-0 text-xs leading-snug">
        <div className="truncate text-muted" title={profile ?? undefined}>
          {profile ?? "—"}
        </div>
        {model && (
          <div className="truncate text-[11px] text-subtle" title={rawIdTitle(model, modelShown) ?? model}>
            {modelShown}
          </div>
        )}
      </div>
      <div className="text-right text-[11px] text-subtle tabular-nums">{since !== null ? <RunningTime since={since} className="text-[11px]" /> : relativeTime(last)}</div>
      <div className="flex justify-end text-[11px]">
        {progress ? (
          <StatusCell p={progress} live={live} />
        ) : (
          <button
            title={t("menu.more")}
            aria-label={t("menu.more")}
            data-row-more
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              openMenuFrom(e.currentTarget, menu());
            }}
            className="rounded p-0.5 text-subtle opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:bg-surface hover:text-foreground"
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Pill<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="flex shrink-0 rounded-lg bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-0.5 text-xs whitespace-nowrap ${value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AgentList({
  groupId,
  initialTab,
  variant,
  renderHeader,
  onOpened,
  autoFocus,
  members,
}: {
  groupId: string;
  /** Default: defaultAgentListTab(variant) (page 在线, dialog 离线). */
  initialTab?: AgentListTab;
  /** dialog: fills a fixed-height box, the rows scroll. page: flows in the page, footer sticks to the bottom. */
  variant: "dialog" | "page";
  /** Lays out the 在线 / 离线 / 已归档 tabs (dialog: next to the title and ×). */
  renderHeader?(tabs: ReactNode): ReactNode;
  /** After a row opened its agent (the dialog closes). */
  onOpened?(): void;
  autoFocus?: boolean;
  /** Project page: member management (row menu entries, bulk 移出项目). */
  members?: MemberControls;
}) {
  const { t } = useI18n();
  const model = useSidebarModel();
  // The list's host: the target host (a dialog / project page of another host of the scope), else the focus host.
  const hostId = useTargetHostId();
  const own = useTargetIsFocus();
  const focusActivity = useApp((s) => s.activity);
  // Activity previews are kept for the focus host only.
  const activity = own ? focusActivity : NO_ACTIVITY;
  // The sidebar's signals (需要你 / 完成 / 出错) for the 在线 rows; kept for the focus host only too.
  const attention = useAttention();
  const select = useTargetSelect();
  const [tab, setTab] = useState<AgentListTab>(() => initialTab ?? defaultAgentListTab(variant));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<AgentSort>("recent");
  const [runtime, setRuntime] = useState<RuntimeFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  // Profile → its model, for agents whose model only the profile knows (one cached list call).
  const [profiles, setProfiles] = useState(() => cachedProfileList(hostId));
  useEffect(() => void loadProfileList(hostId).then(setProfiles, () => {}), [hostId]);
  const profileModels = useMemo(() => new Map((profiles?.profiles ?? []).flatMap((p) => [[p.id, p.model] as const, [p.name, p.model] as const])), [profiles]);

  const group = useMemo(() => model.groups.find((g) => g.id === groupId), [model.groups, groupId]);
  const online = group?.online ?? [];
  const offline = group?.offline ?? [];
  const archived = useMemo(() => archivedOf(model.archived, groupId), [model.archived, groupId]);
  const live = useMemo(() => {
    const all = [...model.groups.flatMap((g) => [...g.online, ...g.offline]), ...model.chats, ...model.archived];
    return new Map(all.map((r) => [r.id, r]));
  }, [model]);

  const progressOf = (id: string) => (progress[id]?.tab === tab ? progress[id] : undefined);
  const lastOf = (r: AgentRow) => progressOf(r.id)?.last ?? lastSeen(r, activity[r.id]?.at);
  const rows = useMemo(() => {
    const base = tabRows(group, archived.rows, tab);
    const ids = new Set(base.map((r) => r.id));
    // Rows acted on stay listed (stopped → offline, started → online, archived, restored) until the list closes.
    const kept = Object.entries(progress)
      .filter(([id, p]) => p.tab === tab && !ids.has(id))
      .map(([id, p]) => live.get(id) ?? p.row);
    return filterSortAgents([...base, ...kept], { query, sort, runtime }, lastOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, group, archived, progress, live, query, sort, runtime, activity]);

  const selectable = (id: string) => {
    const p = progressOf(id);
    return !p || p.phase === "failed";
  };
  const order = rows.map((r) => r.id);
  const selectableShown = order.filter(selectable);
  const chosen = selectableShown.filter((id) => selected.has(id));
  const all = selectionState(selectableShown, selected);
  const mine = Object.values(progress).filter((p) => p.tab === tab);
  const busy = Object.values(progress).some((p) => p.phase === "queued" || p.phase === "running");
  const done = mine.filter((p) => p.phase === "done" || p.phase === "failed").length;
  const failed = mine.filter((p) => p.phase === "failed").length;

  const switchTab = (next: AgentListTab) => {
    setTab(next);
    setSelected(new Set());
    anchor.current = null;
  };

  const toggle = (id: string, e: MouseEvent | KeyboardEvent) => {
    const on = !selected.has(id);
    setSelected(selectRange(selected, selectableShown, e.shiftKey ? anchor.current : null, id, on));
    anchor.current = id;
  };

  const open = (id: string) => {
    void select(id);
    onOpened?.();
  };

  const bulk = async (action: Action) => {
    const ids = action === "detach" ? detachable(chosen, members?.directorId ?? null) : chosen;
    if (ids.length === 0 || busy) return;
    const starts = action === "start" || action === "restoreStart";
    if (starts && ids.length > START_CONFIRM_OVER && !(await confirmDialog(t("agents.startConfirm", { count: ids.length })))) return;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const busyCount = ids.filter((id) => !!(live.get(id) ?? byId.get(id))?.session.runtime.activeTurnId).length;
    const busyNote = busyCount > 0 ? t("agents.busyNote", { count: busyCount }) : "";
    if (action === "stop" && !(await confirmDialog([t("agents.stopConfirm", { count: ids.length }), busyNote].filter(Boolean).join("\n\n"), busyCount > 0))) return;
    if (action === "detach") {
      const skipped = ids.length < chosen.length ? t("agents.detachSkipsDirector") : "";
      if (!(await confirmDialog([t("agents.detachConfirm", { count: ids.length }), skipped].filter(Boolean).join("\n\n"), true))) return;
    }
    if (action === "archive") {
      // The agent menu's warning for agents that own services, one paragraph per such agent.
      const owners = ids.flatMap((id) => {
        const note = ownedServicesNote(id, t, hostId);
        return note ? [`${byId.get(id)?.name ?? id}：${note}`] : [];
      });
      if (!(await confirmDialog([t("agents.archiveConfirm", { count: ids.length }), busyNote, ...owners].filter(Boolean).join("\n\n"), true))) return;
    }
    setProgress((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const row = byId.get(id)!;
        next[id] = { action, phase: "queued", tab, row, last: lastOf(row) };
      }
      return next;
    });
    setSelected(new Set());
    anchor.current = null;
    const update = (id: string, patch: Partial<Progress>) => setProgress((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id]!, ...patch } } : prev));
    // Detaches go one at a time: each is fenced by the project revision the one before advanced.
    await runLimited(ids, action === "detach" ? 1 : START_CONCURRENCY, async (id) => {
      update(id, { phase: "running" });
      try {
        if (action === "detach") await members!.detach(id);
        else await perform(action, byId.get(id)!, hostId);
        update(id, { phase: "done", error: undefined });
      } catch (e) {
        update(id, { phase: "failed", error: errorText(e) });
      }
    });
  };

  const move = (el: HTMLElement, delta: 1 | -1) => {
    const all = [...(el.parentElement?.querySelectorAll<HTMLElement>("[data-agent-row]") ?? [])];
    all[all.indexOf(el) + delta]?.focus();
  };

  const tabs = (
    <Pill<AgentListTab>
      value={tab}
      onChange={switchTab}
      options={[
        { value: "online", label: t("agents.tab.online", { count: online.length }) },
        { value: "offline", label: t("agents.tab.offline", { count: offline.length }) },
        { value: "archived", label: t("agents.tab.archived", { count: archived.rows.length }) },
      ]}
    />
  );
  const base = tabRows(group, archived.rows, tab);
  const [secondary, primary] = tabActions(tab);
  const dialog = variant === "dialog";
  const detachCount = members && tab !== "archived" ? detachable(chosen, members.directorId).length : 0;

  return (
    <AttentionContext.Provider value={own ? attention : null}>
    <div className={dialog ? "flex min-h-0 flex-1 flex-col" : "rounded-xl border border-border bg-surface"}>
      {renderHeader ? renderHeader(tabs) : <div className="px-4 pt-3">{tabs}</div>}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <label className="flex min-w-40 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 focus-within:border-accent">
          <Search size={13} className="shrink-0 text-subtle" />
          <input
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("agents.search")}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
          />
        </label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as AgentSort)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
        >
          {(["recent", "name", "created"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`agents.sort.${s}`)}
            </option>
          ))}
        </select>
        <Pill<RuntimeFilter> value={runtime} onChange={setRuntime} options={(["all", "codex", "claude"] as const).map((r) => ({ value: r, label: t(`agents.runtime.${r}`) }))} />
      </div>
      {tab === "archived" && !archived.scoped && <p className="border-b border-border bg-surface-2/40 px-4 py-1.5 text-[11px] text-subtle">{t("agents.archivedUnscoped")}</p>}
      <div className={`${GRID} border-b border-border px-4 py-1 text-[10.5px] text-subtle`}>
        <Checkbox state={all} disabled={selectableShown.length === 0} title={t("agents.selectAll")} onClick={() => setSelected(all === "all" ? new Set([...selected].filter((id) => !selectableShown.includes(id))) : new Set([...selected, ...selectableShown]))} />
        <span />
        <span>{t("agents.col.agent")}</span>
        <span>{t("agents.col.profile")}</span>
        <span className="text-right">{t("agents.col.activity")}</span>
        <span />
      </div>
      <div className={dialog ? "min-h-0 flex-1 overflow-y-auto" : ""}>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-subtle">{base.length === 0 ? t(`agents.empty.${tab}`) : t("agents.noMatch")}</p>
        ) : (
          rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              live={live.get(row.id)}
              preview={activity[row.id]}
              last={lastOf(row)}
              progress={progressOf(row.id)}
              profileModels={profileModels}
              hostId={hostId}
              online={tab === "online"}
              checked={selected.has(row.id) && selectable(row.id)}
              selectable={selectable(row.id)}
              onToggle={(e) => toggle(row.id, e)}
              onOpen={() => open(row.id)}
              onMove={move}
              menu={() => {
                const current = live.get(row.id) ?? row;
                const own = members && tab !== "archived" ? members.rowMenu(current) : [];
                // An entry the page puts on top (e.g. 轮换主管…) is not repeated in the agent menu.
                const labels = new Set(own.flatMap((e) => (e && e !== "separator" ? [e.label] : [])));
                const agent = agentMenu(current.session, t, hostId).filter((e) => !e || e === "separator" || !labels.has(e.label));
                return own.length ? [...own, "separator", ...agent] : agent;
              }}
            />
          ))
        )}
      </div>
      <div className={`flex items-center gap-2 border-t border-border bg-surface px-4 py-2 ${dialog ? "" : "sticky bottom-0 rounded-b-xl"}`}>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {[
            chosen.length > 0 ? t("agents.selected", { count: chosen.length }) : mine.length === 0 ? t(tab === "online" ? "agents.selectHintOnline" : "agents.selectHint") : null,
            mine.length > 0 ? t("agents.progress", { done, total: mine.length }) : null,
            failed > 0 ? t("agents.failedCount", { count: failed }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {members && tab !== "archived" && (
          <button disabled={detachCount === 0 || busy} onClick={() => void bulk("detach")} className={`${BUTTON} text-muted hover:bg-surface-2 hover:text-danger`}>
            {t("agents.detach", { count: detachCount })}
          </button>
        )}
        <button disabled={chosen.length === 0 || busy} onClick={() => void bulk(secondary)} className={`${BUTTON} text-muted hover:bg-surface-2 hover:text-foreground`}>
          {t(ACTION_LABEL[secondary], { count: chosen.length })}
        </button>
        <button disabled={chosen.length === 0 || busy} onClick={() => void bulk(primary)} className={`${BUTTON} bg-accent font-medium text-white hover:bg-accent/90`}>
          {t(ACTION_LABEL[primary], { count: chosen.length })}
        </button>
      </div>
    </div>
    </AttentionContext.Provider>
  );
}
