// 项目看板 window (main/board.ts): portrait-first, dark, read-only. Two views of the same per-project summaries:
//   卡片      — one wide card per project down the screen: health, the 主管 and what it is doing, plan bar (backend
//               G10; hidden until a host provides it), counts, the first problem.
//   缩略视图  — two columns of shrunken 项目视图: counts, a two-line 主管卡, avatar tiers, the latest 动态 lines.
// A click asks main to show the main window at that project / agent / delegation. No send box, no timelines.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CircleCheck, CircleHelp, CircleX, Eye, EyeOff, LayoutGrid, Layers, Moon, Pin, PinOff, RefreshCw, Rows3, Send, Server, Settings2, Square, Target, TrendingUp, TriangleAlert, Type } from "lucide-react";
import type { BoardActivityKind, BoardBridge, BoardMemberState, BoardMemberView, BoardPrefsPatch, BoardProjectView, BoardState, BoardTarget } from "../../../shared/board";
import { healthOf, orderProjects } from "../../../shared/boardModel";
import { agoText, boardText, projectColor, type BoardText } from "./i18n";
import { usePending } from "../lib/usePending";
import { ProjectBadgeView } from "../components/ProjectBadgeView";

type Open = (target: BoardTarget | null) => void;

const DOT: Record<BoardMemberState, string> = { busy: "bg-accent", idle: "bg-ok", paused: "bg-warn", error: "bg-danger", offline: "bg-subtle/50" };

function Tile({ m, color, size = "md", open, t }: { m: BoardMemberView; color: string; size?: "sm" | "md" | "lg"; open: Open; t: BoardText }) {
  const box = size === "lg" ? "size-11 text-sm" : size === "sm" ? "size-7 text-[0.65rem]" : "size-9 text-xs";
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); open({ kind: "agent", hostId: m.hostId, sessionId: m.sessionId }); }}
      title={`${m.name} · ${t.state[m.state]}${m.doing ? ` · ${m.doing}` : ""}`}
      className={`press-avatar relative inline-flex ${box} shrink-0 items-center justify-center rounded-lg border-2 bg-surface-2 font-semibold hover:brightness-110 ${m.state === "offline" ? "opacity-45" : ""}`} style={{ borderColor: color }}>
      {m.initials}
      <span className={`absolute -right-1 -bottom-1 size-3 rounded-full border-2 border-background ${DOT[m.state]} ${m.state === "busy" ? "animate-pulse" : ""}`} />
    </button>
  );
}

function HostChips({ p, s }: { p: BoardProjectView; s: BoardState }) {
  return (
    <span className="flex flex-wrap gap-1">
      {[...new Set(p.places.map((x) => x.hostId))].map((id) => {
        const h = s.hosts.find((x) => x.hostId === id);
        const down = h && h.state !== "connected";
        return <span key={id} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.7rem] ${down ? "bg-danger/20 text-danger-text" : "bg-surface-2 text-muted"}`}><Server className="size-3" />{h?.label ?? id}</span>;
      })}
    </span>
  );
}

function HealthChip({ p, now, t }: { p: BoardProjectView; now: number; t: BoardText }) {
  const h = healthOf(p, now);
  const tone = h === "problem" ? "bg-danger/20 text-danger-text" : h === "quiet" || h === "unknown" ? "bg-surface-2 text-subtle" : "bg-ok/15 text-ok-text";
  return (
    <span data-board-health={h} title={h === "unknown" ? t.unknownHint : undefined} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {h === "problem" ? <TriangleAlert className="size-3.5" /> : h === "quiet" ? <Moon className="size-3.5" /> : h === "unknown" ? <CircleHelp className="size-3.5" /> : <CircleCheck className="size-3.5" />}
      {h === "problem" ? t.health.problem(p.problemCount) : h === "quiet" ? t.health.quiet(agoText(t, now - (p.lastActivityAt ?? now))) : h === "unknown" ? t.health.unknown : t.health.ok}
    </span>
  );
}

function NeedsYou({ n, open, t }: { n: number | null; open: Open; t: BoardText }) {
  // Unknown (a place could not read it): a muted dash, never hidden as if there were none.
  if (n === null) return <span title={t.unknownHint} className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs text-subtle">{t.needsYouUnknown}</span>;
  if (!n) return null;
  return <button type="button" onClick={(e) => { e.stopPropagation(); open({ kind: "needsYou" }); }} className="press-solid inline-flex items-center gap-1 rounded-full bg-warn/20 px-2 py-0.5 text-xs font-medium text-warn-text hover:bg-warn/30">{t.needsYou(n)}</button>;
}

function PlanBar({ p, t, wide }: { p: BoardProjectView; t: BoardText; wide?: boolean }) {
  if (!p.plan) return null;
  const pct = Math.round((p.plan.done / p.plan.total) * 100);
  return (
    <span className={`flex min-w-0 items-center gap-2 ${wide ? "flex-1" : ""}`}>
      <span className="shrink-0 text-sm text-muted">{t.plan}</span>
      <span className={`h-2 ${wide ? "min-w-24 flex-1" : "w-24"} overflow-hidden rounded-full bg-surface-2`}><span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></span>
      <span className="shrink-0 font-mono text-sm tabular-nums">{p.plan.done}/{p.plan.total}</span>
      {p.plan.current && <span className="min-w-0 truncate text-sm text-muted">{t.current(p.plan.current)}</span>}
    </span>
  );
}

function Counts({ p, t, big }: { p: BoardProjectView; t: BoardText; big?: boolean }) {
  const c = p.counts;
  const num = big ? "text-lg" : "";
  const item = (n: number, label: string, dot: string, dim = false) => (
    <span className={`inline-flex items-center gap-1 ${dim ? "text-subtle" : ""}`}><span className={`size-2 rounded-full ${dot}`} /><b className={`${num} tabular-nums`}>{n}</b>{label}</span>
  );
  return (
    <span className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${big ? "text-sm" : "text-xs"} text-muted`}>
      {item(c.busy, t.state.busy, "bg-accent")}
      {item(c.idle, t.state.idle, "bg-ok")}
      {c.paused > 0 && item(c.paused, t.state.paused, "bg-warn")}
      {c.error > 0 && item(c.error, t.state.error, "bg-danger")}
      {item(c.offline, t.state.offline, "bg-subtle/50", true)}
      {c.openDelegations === null ? <span title={t.unknownHint}>· {t.openUnknown}</span> : <span>· {t.open(c.openDelegations)}</span>}
      {p.today ? (
        <span>· {t.today} <b className={`${num} tabular-nums text-ok-text`}>{p.today.done}</b>{p.today.failed > 0 && <> · {t.failed} <b className="tabular-nums text-danger-text">{p.today.failed}</b></>}</span>
      ) : <span>· {t.todayUnknown}</span>}
    </span>
  );
}

function FirstProblem({ p, open, t }: { p: BoardProjectView; open: Open; t: BoardText }) {
  const a = p.problems[0];
  if (!a) return null;
  const tone = a.soft ? "bg-warn/10 text-warn-text hover:bg-warn/20" : "bg-danger/10 text-danger-text hover:bg-danger/20";
  return (
    <button type="button" data-board-problem={a.soft ? "soft" : "hard"} onClick={(e) => { e.stopPropagation(); open(a.target); }} className={`press flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-sm ${tone}`}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{a.group ? t.problemGroup(a.kind, a.group.count, a.group.names) : t.problem(a.kind, a.subject, a.detail)}</span>
      {p.problemCount > (a.group?.count ?? 1) && <span className="shrink-0 text-xs">{t.moreProblems(p.problemCount - (a.group?.count ?? 1))}</span>}
    </button>
  );
}

function DirectorNow({ p, open, t, now, lines = 1 }: { p: BoardProjectView; open: Open; t: BoardText; now: number; lines?: 1 | 2 }) {
  const d = p.director;
  if (!d) return <p className="text-sm text-subtle">{t.noDirector}</p>;
  const color = projectColor(p.color);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Tile m={d} color={color} size="lg" open={open} t={t} />
      <button type="button" onClick={(e) => { e.stopPropagation(); open({ kind: "agent", hostId: d.hostId, sessionId: d.sessionId }); }} className="press -mx-1 min-w-0 flex-1 rounded-md px-1 text-left hover:bg-surface-2/60">
        <span className="flex items-baseline gap-2 text-sm"><b className="truncate text-base">{d.name}</b><span className="shrink-0 text-accent">{t.directorWord}</span><span className="shrink-0 text-subtle">{t.state[d.state]}{d.since ? ` · ${agoText(t, now - Date.parse(d.since))}` : ""}</span></span>
        {d.doing && <span className={`block text-[0.95rem] ${d.state === "offline" ? "text-subtle" : "text-foreground/90"} ${lines === 2 ? "line-clamp-2" : "truncate"}`}>{d.doing}</span>}
      </button>
    </div>
  );
}

function ProjectTitle({ p, s, open, t, now, pinned, size = "xl" }: { p: BoardProjectView; s: BoardState; open: Open; t: BoardText; now: number; pinned: boolean; size?: "xl" | "lg" }) {
  const place = p.places[0];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ProjectBadgeView icon={p.icon} badge={p.badge} hex={projectColor(p.color)} size={size === "xl" ? "lg" : "sm"} className="self-center" />
      <button type="button" onClick={() => open(place ? { kind: "project", hostId: place.hostId, projectId: place.projectId } : null)} className={`press min-w-0 truncate rounded ${size === "xl" ? "text-xl" : "text-lg"} font-semibold hover:underline`}>{p.name}</button>
      {pinned && <Pin className="size-3.5 text-subtle" />}
      <HostChips p={p} s={s} />
      <span className="ml-auto flex shrink-0 items-center gap-1.5"><NeedsYou n={p.needsYou} open={open} t={t} /><HealthChip p={p} now={now} t={t} /></span>
    </div>
  );
}

// ---------- 卡片 ----------

function Card({ p, s, open, t, now, pinned }: { p: BoardProjectView; s: BoardState; open: Open; t: BoardText; now: number; pinned: boolean }) {
  const quiet = healthOf(p, now) === "quiet";
  const workers = p.members.filter((m) => m.state === "busy" || m.state === "error" || m.state === "paused");
  return (
    <article data-board-card={p.key} className={`flex flex-col gap-2.5 rounded-xl border bg-raised/60 p-4 ${p.hardProblems > 0 ? "border-danger/50" : "border-border"} ${quiet ? "opacity-70" : ""}`} style={{ borderLeft: `4px solid ${projectColor(p.color)}` }}>
      <ProjectTitle p={p} s={s} open={open} t={t} now={now} pinned={pinned} />
      {!quiet && <DirectorNow p={p} open={open} t={t} now={now} />}
      {!quiet && (p.plan || p.goal || p.goalUnknown) && (
        <div className="flex items-center gap-4">
          <PlanBar p={p} t={t} wide />
          {p.goal && <span className="flex max-w-[45%] min-w-0 shrink items-center gap-1 truncate text-sm text-muted"><Target className="size-3.5 shrink-0" /><span className="truncate">{p.goal}</span></span>}
          {!p.goal && p.goalUnknown && <span title={t.goalUnknownHint} className="flex shrink-0 items-center gap-1 text-sm text-subtle"><Target className="size-3.5 shrink-0" />{t.goalUnknown}</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Counts p={p} t={t} big />
        {workers.length > 0 && <span className="ml-auto flex flex-wrap items-center gap-1.5">{workers.slice(0, 12).map((m) => <Tile key={`${m.hostId}/${m.sessionId}`} m={m} color={projectColor(p.color)} size="sm" open={open} t={t} />)}{workers.length > 12 && <span className="text-xs text-subtle">{t.more(workers.length - 12)}</span>}</span>}
      </div>
      {quiet && p.recent[0] && <p className="truncate text-sm text-subtle">{t.last(p.recent[0].text, agoText(t, now - Date.parse(p.recent[0].at)))}</p>}
      <FirstProblem p={p} open={open} t={t} />
    </article>
  );
}

// ---------- 缩略视图 ----------

const KIND_ICON: Record<BoardActivityKind, ReactNode> = {
  started: <Send className="size-3.5 shrink-0 text-accent" />, done: <CircleCheck className="size-3.5 shrink-0 text-ok-text" />, progress: <TrendingUp className="size-3.5 shrink-0 text-muted" />,
  failed: <CircleX className="size-3.5 shrink-0 text-danger-text" />, stopped: <Square className="size-3.5 shrink-0 text-subtle" />,
};

function Tier({ label, members, color, open, t }: { label: string; members: BoardMemberView[]; color: string; open: Open; t: BoardText }) {
  if (!members.length) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1.5 w-12 shrink-0 text-xs text-subtle">{label}</span>
      <span className="flex flex-wrap gap-1.5">{members.slice(0, 16).map((m) => <Tile key={`${m.hostId}/${m.sessionId}`} m={m} color={color} size="sm" open={open} t={t} />)}{members.length > 16 && <span className="self-center text-xs text-subtle">{t.more(members.length - 16)}</span>}</span>
    </div>
  );
}

function Mini({ p, s, open, t, now, pinned }: { p: BoardProjectView; s: BoardState; open: Open; t: BoardText; now: number; pinned: boolean }) {
  const quiet = healthOf(p, now) === "quiet";
  const color = projectColor(p.color);
  const by = (...st: BoardMemberState[]) => p.members.filter((m) => st.includes(m.state));
  return (
    <article data-board-card={p.key} className={`flex min-w-0 flex-col gap-2.5 rounded-xl border bg-raised/60 p-3 ${p.hardProblems > 0 ? "border-danger/50" : "border-border"} ${quiet ? "opacity-70" : ""}`} style={{ borderTop: `4px solid ${color}` }}>
      <ProjectTitle p={p} s={s} open={open} t={t} now={now} pinned={pinned} size="lg" />
      <Counts p={p} t={t} />
      <div className="flex flex-col gap-2 rounded-lg bg-surface-2/60 p-2.5">
        <DirectorNow p={p} open={open} t={t} now={now} lines={2} />
        <PlanBar p={p} t={t} />
      </div>
      <FirstProblem p={p} open={open} t={t} />
      <div className="flex flex-col gap-1.5">
        <Tier label={t.tier.error} members={by("error")} color={color} open={open} t={t} />
        <Tier label={t.tier.busy} members={by("busy")} color={color} open={open} t={t} />
        <Tier label={t.tier.idle} members={by("idle", "paused")} color={color} open={open} t={t} />
        <Tier label={t.tier.offline} members={by("offline")} color={color} open={open} t={t} />
      </div>
      {p.recent.length > 0 && (
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-2">
          {p.recent.slice(0, 3).map((r, i) => (
            <button key={i} type="button" onClick={() => open(r.target)} className="press flex items-center gap-1.5 rounded text-left text-sm hover:text-foreground">
              {KIND_ICON[r.kind]}<span className="min-w-0 flex-1 truncate text-foreground/85">{r.text}</span>
              {r.toolSince && <span className="shrink-0 rounded bg-surface-2 px-1 text-xs text-muted">{t.toolRunning(agoText(t, now - Date.parse(r.toolSince)))}</span>}
              <span className="shrink-0 text-xs text-subtle">{agoText(t, now - Date.parse(r.at))}</span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

// ---------- window chrome ----------

function Toggle({ on, onClick, icon, label, hint }: { on: boolean; onClick: () => void; icon: ReactNode; label: string; hint: string }) {
  return (
    <button type="button" onClick={onClick} title={hint} aria-pressed={on}
      className={`press inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${on ? "bg-accent/20 text-accent hover:bg-accent/25" : "text-muted hover:bg-surface-2"}`}>{icon}{label}</button>
  );
}

function Manage({ s, t, set }: { s: BoardState; t: BoardText; set: (patch: BoardPrefsPatch) => void }) {
  const known = s.projects.map((p) => p.key);
  const order = [...s.prefs.order.filter((k) => known.includes(k)), ...orderProjects(s.projects, { order: s.prefs.order, pinned: s.prefs.pinned, hidden: [] }).map((p) => p.key).filter((k) => !s.prefs.order.includes(k))];
  const move = (i: number, by: number) => { const o = [...order]; const [x] = o.splice(i, 1); o.splice(i + by, 0, x!); set({ order: o }); };
  const flip = (list: string[], k: string) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  return (
    <div className="float absolute top-full right-0 z-20 mt-1 max-h-[70vh] w-80 overflow-y-auto p-2">
      <p className="mb-1 px-1 text-xs text-subtle">{t.manageNote}</p>
      {order.map((k, i) => {
        const p = s.projects.find((x) => x.key === k)!;
        const hidden = s.prefs.hidden.includes(k), pinned = s.prefs.pinned.includes(k);
        return (
          <div key={k} className={`flex items-center gap-1.5 rounded px-1 py-1 text-sm ${hidden ? "opacity-50" : ""}`}>
            <ProjectBadgeView icon={p.icon} badge={p.badge} hex={projectColor(p.color)} size="md" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <button type="button" title={t.up} disabled={i === 0} onClick={() => move(i, -1)} className="press-icon rounded text-muted hover:text-foreground disabled:opacity-30"><ArrowUp className="size-4" /></button>
            <button type="button" title={t.down} disabled={i === order.length - 1} onClick={() => move(i, 1)} className="press-icon rounded text-muted hover:text-foreground disabled:opacity-30"><ArrowDown className="size-4" /></button>
            <button type="button" title={pinned ? t.unpin : t.pin} onClick={() => set({ pinned: flip(s.prefs.pinned, k) })} className="press-icon rounded text-muted hover:text-foreground">{pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}</button>
            <button type="button" title={hidden ? t.show : t.hide} onClick={() => set({ hidden: flip(s.prefs.hidden, k) })} className="press-icon rounded text-muted hover:text-foreground">{hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}</button>
          </div>
        );
      })}
      <label className="mt-1 flex items-center gap-2 border-t border-border px-1 pt-2 text-sm">
        <input type="checkbox" checked={s.prefs.openOnLaunch} onChange={(e) => set({ openOnLaunch: e.target.checked })} />{t.openOnLaunch}
      </label>
    </div>
  );
}

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** What the entry (main.tsx, this window's own document) applies: root font size, language, title. */
export interface BoardDocument { bigText: boolean; lang: string; title: string }

export function BoardApp({ bridge, applyDocument }: { bridge: BoardBridge; applyDocument: (d: BoardDocument) => void }) {
  const [s, setS] = useState<BoardState | null>(null);
  const [manage, setManage] = useState(false);
  // ↻ shows the read running (press-feedback audit 2026-11-18: 1.5 s with no change looked like nothing happened).
  const refreshing = usePending();
  const now = useNow(5_000);
  useEffect(() => {
    bridge.onState(setS);
    void bridge.state().then(setS);
  }, [bridge]);
  const t = useMemo(() => (s ? boardText(s.locale, s.terms) : null), [s]);
  useEffect(() => {
    if (s && t) applyDocument({ bigText: s.prefs.bigText, lang: s.locale, title: t.title });
  }, [s, t, applyDocument]);
  if (!s || !t) return null;
  const set = (patch: BoardPrefsPatch) => void bridge.setPrefs(patch).then(setS);
  const open: Open = (target) => { if (target) void bridge.open(target); };
  const projects = orderProjects(s.projects, s.prefs);
  const pinned = new Set(s.prefs.pinned);
  const needs = projects.reduce((n, p) => n + (p.needsYou ?? 0), 0);
  const readAt = s.hosts.map((h) => h.readAt).filter((x): x is number => x !== null);
  const oldest = readAt.length ? Math.min(...readAt) : null;
  const View = s.prefs.view === "thumbnail" ? Mini : Card;
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2">
        <Layers className="size-5 text-accent" />
        <span className="text-base font-semibold">{t.title}</span>
        {s.demo && <span className="rounded bg-warn/20 px-1.5 text-xs text-warn-text">{t.demo}</span>}
        <span className="flex flex-wrap gap-1.5">
          {s.hosts.length === 0 && <span className="text-xs text-subtle">{t.noHosts}</span>}
          {s.hosts.map((h) => (
            <span key={h.hostId} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${h.state === "connected" ? "bg-surface-2 text-muted" : "bg-danger/20 text-danger-text"}`}>
              <span className={`size-2 rounded-full ${h.state === "connected" ? "bg-ok" : h.state === "connecting" ? "bg-warn" : "bg-danger"}`} />{h.label}{h.state !== "connected" && ` · ${t.hostState[h.state]}`}
            </span>
          ))}
        </span>
        <span className="text-xs text-subtle">{oldest ? t.updated(agoText(t, now - oldest)) : t.never}</span>
        {needs > 0 && <button type="button" onClick={() => open({ kind: "needsYou" })} className="press rounded text-xs text-warn-text hover:underline">{t.needsYouAll(needs)}</button>}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <span className="mr-1 inline-flex rounded-md bg-surface-2 p-0.5">
            <button type="button" onClick={() => set({ view: "cards" })} className={`press inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${s.prefs.view === "cards" ? "bg-raised text-foreground" : "text-muted hover:text-foreground"}`}><Rows3 className="size-3.5" />{t.cards}</button>
            <button type="button" onClick={() => set({ view: "thumbnail" })} className={`press inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${s.prefs.view === "thumbnail" ? "bg-raised text-foreground" : "text-muted hover:text-foreground"}`}><LayoutGrid className="size-3.5" />{t.thumbnail}</button>
          </span>
          <Toggle on={s.prefs.bigText} onClick={() => set({ bigText: !s.prefs.bigText })} icon={<Type className="size-3.5" />} label={t.bigText} hint={t.bigTextHint} />
          <Toggle on={s.prefs.alwaysOnTop} onClick={() => set({ alwaysOnTop: !s.prefs.alwaysOnTop })} icon={<Pin className="size-3.5" />} label={t.onTop} hint={t.onTopHint} />
          <button type="button" title={t.refresh} aria-label={t.refresh} aria-busy={refreshing.pending || undefined} data-pending={refreshing.pending ? "" : undefined} data-board-refresh="" onClick={() => refreshing.run(() => bridge.refresh())} className="press-icon rounded-md px-1.5 py-1 text-muted hover:bg-surface-2"><RefreshCw className={`size-3.5 ${refreshing.pending ? "animate-spin" : ""}`} /></button>
          <span className="relative">
            <Toggle on={manage} onClick={() => setManage((v) => !v)} icon={<Settings2 className="size-3.5" />} label={t.projects} hint={t.projectsHint} />
            {manage && <Manage s={s} t={t} set={set} />}
          </span>
        </span>
      </header>
      {projects.length === 0 ? (
        <p className="m-auto max-w-sm text-center text-sm text-subtle">{t.noProjects}</p>
      ) : (
        <main className={s.prefs.view === "thumbnail" ? "grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-3 overflow-y-auto p-3" : "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"}>
          {projects.map((p) => <View key={p.key} p={p} s={s} open={open} t={t} now={now} pinned={pinned.has(p.key)} />)}
        </main>
      )}
    </div>
  );
}
