// Project 「动态」 (design 022; preview .claude/previews/preview-project-activity.html, owner OK 2026-10-23):
// on hosts with cutex `project-events` it replaces the derived 最近动态 under the agents. 正在进行 on
// top (what runs now across the project, per agent; 停止 is a medium-risk click-twice, design 013),
// then the type chips + agent filter and the day-grouped timeline (newest first, older pages on scroll,
// live rows; scrolled down, new rows wait behind 「↑ N 条新动态」). Rules in stream.ts, data in
// streamStore.ts / streamData.ts.
import { memo, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Bot, Check, ChevronDown, ChevronRight, CircleAlert, FileBox, History, Loader2, RefreshCw, Send, ShieldCheck, Square, SquareTerminal, Workflow, X } from "lucide-react";
import type { BackgroundAgent, BackgroundItem, ProjectEvent } from "../../../../shared/projectEvents";
import { ArmedHint } from "../../components/ArmedHint";
import { Avatar } from "../../components/Avatar";
import { useI18n, type MessageKey } from "../../i18n";
import { formatElapsed } from "../../lib/agentAttention";
import { ARMED_COUNTDOWN, useArmed } from "../../lib/armedConfirm";
import { openMenuFrom } from "../../lib/contextMenu";
import type { ProjectData } from "./data";
import { ACTIVITY_CLASS, type ViewState } from "./model";
import { openAgentBeside, openStreamTarget } from "./open";
import {
  attentionRows,
  clockOf,
  describeRow,
  formatDuration,
  groupByDay,
  itemKey,
  newerThan,
  queryKinds,
  rowTarget,
  runningKind,
  runningOpen,
  runningSummary,
  seqOf,
  STREAM_GROUPS,
  stopCall,
  toggleGroup,
  type RowBadge,
  type RowTone,
  type RunningKind,
} from "./stream";
import { useProjectFeed, useRunningNow } from "./streamData";
import { loadOlder, sendStop } from "./streamStore";

type T = ReturnType<typeof useI18n>["t"];

/** Auto-read older pages while the list does not fill the view (only-needs-you filters sparse pages). */
const AUTO_PAGES = 10;
/** Read the next page when the scroll is this close to the bottom (px). */
const NEAR_BOTTOM = 240;

const BADGE: Record<RowBadge, [typeof Send, string]> = {
  turn: [History, "text-muted"],
  ask: [Send, "text-accent"],
  subagent: [Bot, "text-accent"],
  background: [SquareTerminal, "text-muted"],
  approval: [ShieldCheck, "text-warn-text"],
  artifact: [FileBox, "text-accent"],
  ok: [Check, "text-ok-text"],
  fail: [X, "text-danger"],
  other: [Workflow, "text-subtle"],
};
const TONE: Record<RowTone, string> = { default: "", ok: "text-ok-text", danger: "text-danger", muted: "text-muted", warn: "text-warn-text" };

function LiveDot({ live, t }: { live: string; t: T }) {
  const on = live === "live";
  const label = t(on ? "project-view.stream.live" : live === "connecting" ? "project-view.stream.connecting" : live === "retrying" ? "project-view.stream.retrying" : "project-view.stream.offline");
  return (
    <span className="ml-auto inline-flex items-center gap-1 text-caption/[inherit] text-subtle" data-testid="project-stream-live" data-live={live}>
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-ok" : "border border-subtle"}`} />
      {label}
    </span>
  );
}

// ── 正在进行 ──────────────────────────────────────────────────────────────────────────────────────

const RUN_ICON: Record<RunningKind, [typeof Bot, string]> = { subagent: [Bot, "text-accent"], background: [SquareTerminal, "text-muted"], job: [SquareTerminal, "text-muted"] };

type StopState = { phase: "stopping"; at: number } | { phase: "error"; text: string };

function StopButton({ onStop, t, resetKey }: { onStop(): void; t: T; resetKey: string }) {
  const [armed, setArmed] = useArmed(resetKey);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        data-testid="project-run-stop"
        data-armed={armed || undefined}
        aria-label={armed ? t("project-view.run.stopArmed") : t("project-view.run.stop")}
        title={armed ? undefined : t("project-view.run.stop")}
        onClick={(e) => {
          e.stopPropagation();
          if (!armed) return setArmed(true);
          setArmed(false);
          onStop();
        }}
        className={`inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md px-1.5 text-caption/[inherit] ${armed ? `${ARMED_COUNTDOWN} bg-danger-solid font-semibold text-white` : "text-muted hover:bg-danger/10 hover:text-danger"}`}
      >
        <Square size={9} fill="currentColor" />
        {t("project-view.run.stop")}
      </button>
      {armed && <ArmedHint anchor={ref} text={t("project-view.run.stopArmed")} />}
    </>
  );
}

function RunItem({ hostId, sessionId, item, now, stop, setStop, refresh, t }: { hostId: string; sessionId: string; item: BackgroundItem; now: number; stop: StopState | undefined; setStop(s: StopState | null): void; refresh(): void; t: T }) {
  const kind = runningKind(item);
  const [Icon, tone] = RUN_ICON[kind];
  const call = stopCall(item);
  const started = item.startedAt ? Date.parse(item.startedAt) : NaN;
  const mono = kind !== "subagent";
  const run = async () => {
    if (!call) return;
    setStop({ phase: "stopping", at: Date.now() });
    const r = await sendStop(hostId, call);
    if (r.ok) return refresh();
    setStop({ phase: "error", text: r.conflict ? t("project-view.run.stopConflict") : t("project-view.run.stopFailed", { reason: r.message }) });
    if (r.conflict) refresh();
  };
  return (
    <div className="flex min-w-0 flex-col" data-testid="project-run-item" data-kind={kind}>
      <div className="flex min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-0.5 pl-6 text-meta/[inherit] hover:bg-hover">
        <Icon size={12} className={`shrink-0 ${tone}`} />
        <span className="shrink-0 text-caption/[inherit] text-subtle">{t(`project-view.run.kind.${kind}` as MessageKey)}</span>
        <button type="button" onClick={() => openAgentBeside(hostId, sessionId)} className={`min-w-0 flex-1 truncate text-left ${mono ? "font-mono text-caption/[inherit]" : ""}`} title={[item.title, item.detail].filter(Boolean).join("\n") || undefined}>
          {item.title || item.detail || item.id}
        </button>
        {item.state === "unknown" ? (
          <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-caption/[inherit] text-subtle">{t("project-view.run.unknown")}</span>
        ) : item.state === "pending" ? (
          <span className="shrink-0 text-caption/[inherit] text-subtle">{t("project-view.run.pending")}</span>
        ) : Number.isFinite(started) ? (
          <span className="shrink-0 text-caption/[inherit] text-subtle tabular-nums">{formatElapsed(Math.max(0, now - started))}</span>
        ) : null}
        {call &&
          (stop?.phase === "stopping" ? (
            <span className="inline-flex h-[22px] shrink-0 items-center gap-1 px-1.5 text-caption/[inherit] text-subtle" data-testid="project-run-stopping">
              <Loader2 size={11} className="animate-spin" />
              {t("project-view.run.stopping")}
            </span>
          ) : (
            <StopButton onStop={() => void run()} t={t} resetKey={itemKey(sessionId, item)} />
          ))}
      </div>
      {stop?.phase === "error" && <div className="pl-11 text-caption/[inherit] text-danger">{stop.text}</div>}
    </div>
  );
}

function RunAgent({ hostId, agent, data, now, stops, setStop, refresh, t }: { hostId: string; agent: BackgroundAgent; data: ProjectData; now: number; stops: Record<string, StopState>; setStop(key: string, s: StopState | null): void; refresh(): void; t: T }) {
  const member = data.members.find((m) => m.id === agent.cutexSessionId);
  const name = data.nameOf(agent.cutexSessionId, agent.agentName) ?? agent.cutexSessionId;
  const unknown = agent.items.some((i) => i.state === "unknown");
  return (
    <div className="px-2 pb-1" data-testid="project-run-agent">
      <button type="button" onClick={() => openAgentBeside(hostId, agent.cutexSessionId)} className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 pt-1 pb-0.5 text-left text-meta/[inherit] font-semibold hover:bg-hover">
        <Avatar name={name} initial={member?.row.initial} color={member?.row.color} avatar={member?.row.session.avatar} seed={agent.cutexSessionId} size={16} />
        <span className="min-w-0 truncate">{name}</span>
      </button>
      {agent.items.map((item) => {
        const key = itemKey(agent.cutexSessionId, item);
        return <RunItem key={key} hostId={hostId} sessionId={agent.cutexSessionId} item={item} now={now} stop={stops[key]} setStop={(s) => setStop(key, s)} refresh={refresh} t={t} />;
      })}
      {unknown && <div className="pl-6 text-caption/[inherit] text-subtle">{t("project-view.run.offlineNote")}</div>}
      {!agent.complete && !unknown && <div className="pl-6 text-caption/[inherit] text-subtle">{t("project-view.run.incomplete")}</div>}
    </div>
  );
}

/** How long a 「正在停止…」 waits for the item to leave the list before showing the button again. */
const STOPPING_MS = 30_000;

function RunningNow({ data, state, setState, now }: { data: ProjectData; state: ViewState; setState(s: ViewState): void; now: number }) {
  const { t } = useI18n();
  const { hostId, projectId } = data.target!;
  const bg = useRunningNow(hostId, projectId);
  const summary = runningSummary(bg.data);
  const [stops, setStops] = useState<Record<string, StopState>>({});
  // A stopped item that left the list (or waited too long) drops its 「正在停止…」.
  useEffect(() => {
    const live = new Set(summary.agents.flatMap((a) => a.items.map((i) => itemKey(a.cutexSessionId, i))));
    setStops((old) => {
      const next = Object.fromEntries(Object.entries(old).filter(([k, s]) => live.has(k) && !(s.phase === "stopping" && now - s.at > STOPPING_MS)));
      return Object.keys(next).length === Object.keys(old).length ? old : next;
    });
  }, [bg.data, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const setStop = (key: string, s: StopState | null) => setStops((old) => (s ? { ...old, [key]: s } : Object.fromEntries(Object.entries(old).filter(([k]) => k !== key))));
  if (!bg.loaded) return null;
  const open = runningOpen(state.runOpen, summary.total);
  const parts = (["subagent", "background", "job"] as const).filter((k) => summary.byKind[k]).map((k) => `${t(`project-view.run.kind.${k}` as MessageKey)} ${summary.byKind[k]}`);
  return (
    <div className="mx-2 mt-1 mb-1 shrink-0 rounded-xl bg-surface" data-testid="project-running" data-open={open}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setState({ ...state, runOpen: !open })}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-meta/[inherit] hover:bg-hover"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${summary.total ? "bg-ok" : "border border-subtle"}`} />
        <span className="shrink-0 font-semibold">{t("project-view.run.title")}</span>
        {summary.total > 0 && <span className="shrink-0 rounded-full bg-ok/10 px-1.5 text-caption/[inherit] font-medium text-ok-text tabular-nums">{summary.total}</span>}
        <span className="min-w-0 flex-1 truncate text-meta/[inherit] text-subtle">{summary.total ? parts.join(" · ") : summary.agents.length ? "" : t("project-view.run.none")}</span>
        {open ? <ChevronDown size={13} className="shrink-0 text-subtle" /> : <ChevronRight size={13} className="shrink-0 text-subtle" />}
      </button>
      {open && (
        <div className="max-h-[220px] overflow-y-auto pb-1">
          {summary.agents.map((a) => (
            <RunAgent key={a.cutexSessionId} hostId={hostId} agent={a} data={data} now={now} stops={stops} setStop={setStop} refresh={bg.refresh} t={t} />
          ))}
          {bg.data && !bg.data.jobsAvailable && summary.total > 0 && <div className="px-3 pb-1 text-caption/[inherit] text-subtle">{t("project-view.run.noJobs")}</div>}
        </div>
      )}
      {bg.error && <div className="px-3 pb-1.5 text-caption/[inherit] text-danger">{t("project-view.run.loadFailed", { reason: bg.error })}</div>}
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────────────────────────

type RowAvatar = { name: string; initial: string | undefined; color: string | null; image: ProjectData["members"][number]["row"]["session"]["avatar"]; seed: string } | null;
/** Two row avatars show the same (the panel builds a new object per row on every render). */
export function sameAvatar(a: RowAvatar, b: RowAvatar): boolean {
  return a === b || (!!a && !!b && a.name === b.name && a.initial === b.initial && a.color === b.color && a.image === b.image && a.seed === b.seed);
}

// Compared on what it shows: the panel re-renders on every project data change (a sidebar refresh, the minute
// tick) with a new avatar object per row, and every row used to render again with it (perf audit 2026-10-23).
const StreamRow = memo(function StreamRow({ e, hostId, who, avatar, t }: { e: ProjectEvent; hostId: string; who: string | null; avatar: RowAvatar; t: T }) {
  const v = describeRow(e);
  const target = rowTarget(e);
  if (e.kind === "journal.gap")
    return (
      <div className="mx-3 my-1 rounded-lg border border-dashed border-border px-2 py-1 text-meta/[inherit] text-subtle" data-testid="project-stream-gap">
        {e.detail || t("project-view.stream.gap")}
      </div>
    );
  const [Icon, iconTone] = BADGE[v.badge];
  const facts = [v.detail, v.durationMs !== null ? formatDuration(v.durationMs) : null, v.toolCalls !== null ? t("project-view.stream.tools", { n: v.toolCalls }) : null].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      disabled={!target}
      onClick={() => target && openStreamTarget(hostId, target)}
      data-testid="project-stream-row"
      data-kind={e.kind}
      className="flex w-full min-w-0 items-start gap-2 px-3 py-1 text-left enabled:hover:bg-hover disabled:cursor-default"
    >
      <span className="w-9 shrink-0 pt-px text-right text-caption/[inherit] text-subtle tabular-nums">{clockOf(e.at)}</span>
      <span className="relative mt-px shrink-0">
        {avatar ? (
          <Avatar name={avatar.name} initial={avatar.initial} color={avatar.color} avatar={avatar.image} seed={avatar.seed} size={20} />
        ) : (
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-surface-2 text-caption/[inherit] text-muted">{(who?.[0] ?? "·").toUpperCase()}</span>
        )}
        <span className={`absolute -right-1 -bottom-1 flex h-3 w-3 items-center justify-center rounded-full bg-background ${iconTone}`}>
          <Icon size={8} strokeWidth={2.6} />
        </span>
      </span>
      <span className="min-w-0 flex-1 text-meta/[inherit]">
        <span className="line-clamp-2">
          {who && <b className="font-semibold">{who} </b>}
          <span className={TONE[v.tone]}>{t(`project-view.ev.${v.text}` as MessageKey)}</span>
          {e.title && <span className={v.mono ? "font-mono text-caption/[inherit]" : ""}> {v.mono ? e.title : t("project-view.stream.quoted", { text: e.title })}</span>}
        </span>
        {facts && (
          <span className={`block truncate text-meta/[inherit] ${v.tone === "danger" ? "text-danger/80" : "text-subtle"}`} title={facts}>
            {facts}
          </span>
        )}
      </span>
    </button>
  );
}, (a, b) => a.e === b.e && a.hostId === b.hostId && a.who === b.who && a.t === b.t && sameAvatar(a.avatar, b.avatar));

function dayLabel(day: string, t: T, locale: string): string {
  if (day === "today") return t("project-view.stream.today");
  if (day === "yesterday") return t("project-view.stream.yesterday");
  const d = new Date(`${day}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale, { month: "short", day: "numeric", weekday: "short" }) : day;
}

function Chip({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick(e: MouseEvent<HTMLButtonElement>): void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex max-w-[160px] items-center gap-1 truncate rounded-full border px-2 py-px text-caption/[inherit] ${on ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-muted hover:bg-hover"} disabled:opacity-60`}
    >
      {children}
    </button>
  );
}

export function ProjectStream({ data, state, setState, now }: { data: ProjectData; state: ViewState; setState(s: ViewState): void; now: number }) {
  const { t, locale } = useI18n();
  const { hostId, projectId } = data.target!;
  const kinds = queryKinds(state.evKinds, state.needsOnly);
  const { key, feed } = useProjectFeed(hostId, projectId, kinds, state.evAgent);
  const rows = state.needsOnly ? attentionRows(feed.rows) : feed.rows;
  const scroller = useRef<HTMLDivElement>(null);
  const [seenSeq, setSeenSeq] = useState(-1);
  const [atTop, setAtTop] = useState(true);
  const autoPages = useRef({ key: "", n: 0 });
  const [reloadNote, setReloadNote] = useState(false);

  const topSeq = seqOf(rows[0]?.cursor);
  // At the top every row counts as seen; scrolled down, newer rows wait behind the pill.
  useEffect(() => {
    if (atTop) setSeenSeq(topSeq);
  }, [atTop, topSeq]);
  useEffect(() => setSeenSeq(-1), [key]);
  useEffect(() => {
    if (!feed.reloads) return;
    setReloadNote(true);
    const timer = setTimeout(() => setReloadNote(false), 6000);
    return () => clearTimeout(timer);
  }, [feed.reloads]);
  // Fill the view: read older pages while the list is shorter than the pane (bounded per filter).
  useEffect(() => {
    const el = scroller.current;
    if (!el || feed.phase !== "ready" || !feed.hasMore || feed.loadingMore) return;
    if (autoPages.current.key !== key) autoPages.current = { key, n: 0 };
    if (el.scrollHeight - el.clientHeight > NEAR_BOTTOM || autoPages.current.n >= AUTO_PAGES) return;
    autoPages.current.n++;
    void loadOlder(key);
  }, [key, feed.phase, feed.hasMore, feed.loadingMore, rows.length]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setAtTop(el.scrollTop < 8);
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM) void loadOlder(key);
  };
  const fresh = atTop || seenSeq < 0 ? 0 : newerThan(rows, seenSeq);

  const agentName = state.evAgent ? (data.nameOf(state.evAgent) ?? feed.rows.find((r) => r.cutexSessionId === state.evAgent)?.agentName ?? state.evAgent) : null;
  const pickAgent = (el: HTMLElement) => {
    const seen = new Map<string, string>();
    for (const m of data.members) seen.set(m.id, m.name);
    for (const r of feed.rows) if (r.cutexSessionId && !seen.has(r.cutexSessionId)) seen.set(r.cutexSessionId, r.agentName ?? r.cutexSessionId);
    openMenuFrom(el, [
      { label: t("project-view.stream.allAgents"), icon: state.evAgent ? <span className="inline-block w-[14px]" /> : <Check size={14} />, onSelect: () => setState({ ...state, evAgent: null }) },
      "separator",
      ...[...seen].map(([id, name]) => ({ label: name, icon: state.evAgent === id ? <Check size={14} /> : <span className="inline-block w-[14px]" />, onSelect: () => setState({ ...state, evAgent: id }) })),
    ]);
  };

  const avatarOf = (sessionId: string | null): RowAvatar => {
    const m = sessionId ? data.members.find((x) => x.id === sessionId) : undefined;
    return m ? { name: m.name, initial: m.row.initial, color: m.row.color, image: m.row.session.avatar, seed: m.row.session.cutexSessionId } : null;
  };
  const filtered = state.evKinds.length > 0 || !!state.evAgent || state.needsOnly;

  let body: ReactNode;
  if (feed.phase === "loading" && !rows.length) body = <Centered icon={<Loader2 size={16} className="animate-spin text-subtle" />} text={t("project-view.stream.loading")} />;
  else if (feed.phase === "gone") body = <Centered icon={<CircleAlert size={16} className="text-subtle" />} text={t("project-view.stream.gone")} />;
  else if ((feed.phase === "unavailable" || feed.phase === "error") && !rows.length)
    body = <Centered icon={<RefreshCw size={16} className="text-subtle" />} text={feed.phase === "unavailable" ? t("project-view.stream.unavailable") : t("project-view.stream.error", { reason: feed.error ?? "" })} />;
  else if (!rows.length && !feed.hasMore)
    body = (
      <Centered icon={<History size={16} className="text-subtle" />} text={t(filtered ? "project-view.stream.emptyFiltered" : "project-view.stream.empty")}>
        {filtered && (
          <button type="button" onClick={() => setState({ ...state, evKinds: [], evAgent: null, needsOnly: false })} className="mt-0.5 rounded-md border border-border px-2 py-0.5 text-meta/[inherit] text-muted hover:bg-hover">
            {t("project-view.clearFilter")}
          </button>
        )}
      </Centered>
    );
  else
    body = (
      <>
        {groupByDay(rows, now).map((g) => (
          <section key={g.day}>
            <div className="sticky top-0 z-[1] bg-background px-3 pt-1.5 pb-0.5 text-caption/[inherit] font-semibold text-subtle">{dayLabel(g.day, t, locale)}</div>
            {g.rows.map((e) => {
              const who = e.kind === "journal.gap" ? null : (data.nameOf(e.cutexSessionId, e.agentName) ?? e.agentName);
              return <StreamRow key={e.cursor} e={e} hostId={hostId} who={who} avatar={avatarOf(e.cutexSessionId)} t={t} />;
            })}
          </section>
        ))}
        <div className="px-3 py-2 text-center text-meta/[inherit] text-subtle" data-testid="project-stream-foot">
          {feed.loadingMore ? (
            t("project-view.stream.loadingMore")
          ) : feed.hasMore ? (
            // Several older pages held nothing this filter shows (cutex r252+ bounded scans): let the owner go on.
            feed.stalled ? (
              <button type="button" onClick={() => void loadOlder(key)} className="rounded-md border border-border px-2 py-0.5 text-meta/[inherit] text-muted hover:bg-hover">
                {t("project-view.stream.keepLooking")}
              </button>
            ) : (
              ""
            )
          ) : rows.length ? (
            t("project-view.stream.end")
          ) : (
            ""
          )}
        </div>
      </>
    );

  return (
    <div className={ACTIVITY_CLASS} data-testid="project-stream">
      <div className="flex min-w-0 shrink-0 items-center gap-1 px-3 pt-2 pb-0.5">
        <span className="text-meta/[inherit] font-semibold">{t("project-view.stream.title")}</span>
        <LiveDot live={feed.live} t={t} />
      </div>
      <RunningNow data={data} state={state} setState={setState} now={now} />
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1 px-3 pt-1 pb-1.5">
        {STREAM_GROUPS.map((g) => (
          <Chip key={g} on={state.evKinds.includes(g)} disabled={state.needsOnly} onClick={() => setState({ ...state, evKinds: toggleGroup(state.evKinds, g) })}>
            {t(`project-view.group.${g}` as MessageKey)}
          </Chip>
        ))}
        <Chip on={!!state.evAgent} onClick={(e) => pickAgent(e.currentTarget)}>
          <span className="truncate">{agentName ?? t("project-view.stream.allAgents")}</span>
          <ChevronDown size={11} className="shrink-0" />
        </Chip>
      </div>
      {reloadNote && <div className="mx-3 mb-1 rounded-lg border border-dashed border-border px-2 py-1 text-meta/[inherit] text-subtle">{t("project-view.stream.reloaded")}</div>}
      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto pb-2" data-testid="project-stream-list">
        {fresh > 0 && (
          <button
            type="button"
            data-testid="project-stream-new"
            onClick={() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className="sticky top-1 z-[2] mx-auto block w-max rounded-full bg-accent px-2.5 py-0.5 text-meta/[inherit] text-white shadow-md"
          >
            {t("project-view.stream.new", { n: fresh })}
          </button>
        )}
        {body}
      </div>
    </div>
  );
}

function Centered({ icon, text, children }: { icon: ReactNode; text: string; children?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[96px] flex-col items-center justify-center gap-1.5 px-6 py-4 text-center" data-testid="project-stream-empty">
      {icon}
      <div className="text-ui/[inherit] text-muted">{text}</div>
      {children}
    </div>
  );
}
