import { rememberProject } from "./context";
// Project 视图 (prototype .claude/preview-design-v1.html §4): the header (project, host, counts, 只看需要你,
// picker), the persistent agents (the Director's card, then needs-you / running / recently active, the
// long idle ones folded into 「空闲 N 个」) and the recent activity (newest first, type chips). Components
// only; data in data.ts, rules in model.ts.
import { memo, useEffect, useState, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, Bot, Check, ChevronDown, ChevronRight, CircleAlert, FileBox, Globe, History, ListChecks, ListTree, Send, SquareTerminal, Target, Users } from "lucide-react";
import type { AskSummary } from "../../../../shared/ipc";
import { StatusAvatar } from "../../components/AgentStatus";
import { Avatar } from "../../components/Avatar";
import { ProjectBadge } from "../../components/ProjectBadge";
import { useI18n, type MessageKey } from "../../i18n";
import { formatElapsed, showsRunningRing } from "../../lib/agentAttention";
import { openMenuFrom } from "../../lib/contextMenu";
import { delegationStatus, requesterName, requesterSession, type StatusTone } from "../../lib/delegations";
import { useStatusWord } from "../../lib/delegationsView";
import { openDelegationDetail } from "../../lib/delegationOpen";
import { jobTitle } from "../../lib/jobs";
import { relativeTime } from "../../lib/sidebarView";
import { useSizeFlags, widthAtLeast } from "../../lib/sizeFlags";
import { subscribeTick } from "../../lib/ticker";
import { featuresOf, sidebarOf, useApp } from "../../store";
import { services } from "../app";
import type { SideBodyProps } from "../slots";
import { useProjectData, useProjectViewState, type Member, type ProjectData } from "./data";
import { ACTIVITY_CLASS, ACTIVITY_KINDS, UPPER_CLASS, emptyState, filterActivity, kindCounts, toggleKind, type ActivityItem, type ActivityKind, type ViewState } from "./model";
import { openAgentBeside, openProjectView, openTarget } from "./open";
import { PinButton } from "./pin";
import { Tag } from "../../components/Tag";
import { btn } from "../../components/Button";
import { ProjectStream, sameAvatar } from "./ProjectStream";
import { DirectorPanel } from "./DirectorPanel";
import { ServiceClaimStrip } from "../../components/ServiceClaimStrip";
import { useHasProjectEvents } from "./streamData";

type T = ReturnType<typeof useI18n>["t"];

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribeTick(ms, setNow), [ms]);
  return now;
}

const TONE: Record<StatusTone, string> = {
  warn: "text-warn-text bg-warn/10",
  danger: "text-danger bg-danger/10",
  green: "text-ok-text bg-ok/10",
  accent: "text-accent bg-accent/10",
  muted: "text-subtle bg-surface-2",
  neutral: "text-muted bg-surface-2",
};

function Pill({ tone, children, title }: { tone: StatusTone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex max-w-full shrink-0 items-center gap-1 truncate rounded-full px-1.5 py-px text-caption/[inherit] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

function memberTone(m: Member): StatusTone {
  switch (m.signal) {
    case "needsYou":
      return "warn";
    case "error":
      return "danger";
    case "running":
      return "green";
    case "done":
      return "accent";
    default:
      return "muted";
  }
}

function memberState(m: Member, t: T, now: number): string {
  if (m.signal === "running") return m.since ? `${t("project-view.state.running")} · ${formatElapsed(now - m.since)}` : t("project-view.state.running");
  if (m.signalText && (m.signal === "needsYou" || m.signal === "error")) return m.signalText;
  if (m.signal === "done") return t("project-view.state.done");
  if (m.signal === "unknown") return t("project-view.state.unknown");
  return t(m.online ? "project-view.state.idle" : "project-view.state.offline");
}

/** What the agent is doing: the running step, the error, else its last message. */
function stepText(m: Member, t: T): string {
  if (m.signal === "error" && m.error) return m.error;
  if (m.preview) return m.preview.kind === "input" ? `${t("project-view.you")}: ${m.preview.text}` : m.preview.text;
  return t("project-view.noStep");
}

function MemberAvatar({ m, size }: { m: Member; size: number }) {
  return (
    <StatusAvatar
      name={m.name}
      initial={m.row.initial}
      color={m.row.color}
      avatar={m.row.session.avatar}
      seed={m.row.session.cutexSessionId}
      size={size}
      signal={m.signal}
      running={showsRunningRing(m.signal, m.row.session)}
    />
  );
}

function PlanBar({ plan, t }: { plan: NonNullable<Member["plan"]>; t: T }) {
  const ratio = plan.total ? plan.done / plan.total : 0;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-caption/[inherit] text-muted" title={plan.step ?? undefined}>
      <ListChecks size={12} className="shrink-0 text-subtle" />
      <span className="shrink-0 tabular-nums">{t("project-view.plan", { done: plan.done, total: plan.total })}</span>
      <span className="relative h-1 w-12 shrink-0 overflow-hidden rounded-full bg-surface-2">
        <span className="absolute inset-y-0 left-0 rounded-full bg-ok" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
      {plan.step && <span className="min-w-0 truncate text-subtle">{plan.step}</span>}
    </span>
  );
}

/** One open delegation: direction, the other party, title, status word. Click = its detail. */
function DelegationChip({ d, dir, hostId, data, compact }: { d: AskSummary; dir: "in" | "out"; hostId: string; data: ProjectData; compact?: boolean }) {
  const { t } = useI18n();
  const word = useStatusWord();
  const other = dir === "in" ? data.nameOf(requesterSession(d.requester), requesterName(d.requester) ?? t("project-view.you")) : data.nameOf(d.target, d.targetName ?? null);
  const status = delegationStatus(d);
  const Icon = dir === "in" ? ArrowDownLeft : ArrowUpRight;
  const who = t(dir === "in" ? "project-view.dlgIn" : "project-view.dlgOut", { name: other ?? "" });
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-meta/[inherit] hover:bg-hover"
      title={`${who}: ${d.title}`}
      onClick={(e) => {
        e.stopPropagation();
        openDelegationDetail(hostId, d.askId, { title: d.title });
      }}
    >
      <Icon size={12} className={`shrink-0 ${dir === "in" ? "text-accent" : "text-subtle"}`} />
      <span className="shrink-0 text-muted">{compact ? other : who}</span>
      <span className="min-w-0 flex-1 truncate">{d.title}</span>
      <Pill tone={status.tone}>{word(status, other ?? "")}</Pill>
    </button>
  );
}

function Extras({ m, data, max = 4 }: { m: Member; data: ProjectData; max?: number }) {
  const { t } = useI18n();
  const lines: ReactNode[] = [
    ...m.dlgIn.map((d) => <DelegationChip key={`in:${d.askId}`} d={d} dir="in" hostId={m.hostId} data={data} />),
    ...m.dlgOut.map((d) => <DelegationChip key={`out:${d.askId}`} d={d} dir="out" hostId={m.hostId} data={data} />),
    ...m.jobs.map((j) => (
      <div key={`job:${j.jobId}`} className="flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-meta/[inherit]" title={t("project-view.job")}>
        <SquareTerminal size={12} className="shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 truncate font-mono text-caption/[inherit]">{jobTitle(j)}</span>
        <span className="shrink-0 text-caption/[inherit] text-subtle tabular-nums">{formatElapsed(Date.now() - j.createdAt * 1000)}</span>
      </div>
    )),
    ...m.terminals.map((x) => (
      <div key={`term:${x.itemId}`} className="flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-meta/[inherit]" title={t("project-view.terminal")}>
        <SquareTerminal size={12} className="shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 truncate font-mono text-caption/[inherit]">{x.command || t("project-view.terminal")}</span>
      </div>
    )),
    ...m.subagents.map((s) => (
      <div key={`sub:${s.threadId}`} className="flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-meta/[inherit]" title={s.message ?? s.task ?? undefined}>
        <Bot size={12} className="shrink-0 text-accent" />
        <span className="shrink-0 text-muted">{t("project-view.subagent")}</span>
        <span className="min-w-0 flex-1 truncate">{s.task ?? s.name}</span>
      </div>
    )),
  ];
  if (!lines.length) return null;
  const shown = lines.slice(0, max);
  return (
    <div className="mt-1 flex min-w-0 flex-col">
      {shown}
      {lines.length > shown.length && <span className="px-1 text-caption/[inherit] text-subtle">{t("project-view.more", { n: lines.length - shown.length })}</span>}
    </div>
  );
}

const MemberRow = memo(function MemberRow({ m, data, now, folded }: { m: Member; data: ProjectData; now: number; folded?: boolean }) {
  const { t } = useI18n();
  const open = () => openAgentBeside(m.hostId, m.id);
  if (folded)
    return (
      <button type="button" onClick={open} title={t("project-view.openBeside")} className="flex w-full min-w-0 items-center gap-2 px-3 py-1 text-left hover:bg-hover">
        <MemberAvatar m={m} size={20} />
        <span className="min-w-0 flex-1 truncate text-ui/[inherit] text-muted">{m.name}</span>
        <span className="shrink-0 text-caption/[inherit] text-subtle tabular-nums">{relativeTime(m.lastActivity)}</span>
      </button>
    );
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open())}
      title={t("project-view.openBeside")}
      data-testid="project-view-member"
      className="flex min-w-0 cursor-pointer gap-2.5 border-t border-border px-3 py-2 hover:bg-hover"
    >
      <div className="pt-0.5">
        <MemberAvatar m={m} size={28} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-ui/[inherit] font-semibold">{m.name}</span>
          <Pill tone={memberTone(m)}>{memberState(m, t, now)}</Pill>
          <span className="ml-auto shrink-0 pl-1 text-caption/[inherit] text-subtle tabular-nums">{relativeTime(m.lastActivity)}</span>
        </div>
        <div className={`mt-0.5 line-clamp-2 text-meta/[inherit] ${m.signal === "error" ? "text-danger" : "text-muted"}`}>{stepText(m, t)}</div>
        {(m.plan || m.goal) && (
          <div className="mt-1 flex min-w-0 flex-col gap-0.5">
            {m.plan && <PlanBar plan={m.plan} t={t} />}
            {m.goal && (
              <span className="flex min-w-0 items-center gap-1.5 text-caption/[inherit] text-muted">
                <Target size={12} className="shrink-0 text-subtle" />
                <span className="min-w-0 truncate">{t("project-view.goal", { text: m.goal })}</span>
              </span>
            )}
          </div>
        )}
        <Extras m={m} data={data} />
      </div>
    </div>
  );
});

function DirectorCard({ m, data, now }: { m: Member; data: ProjectData; now: number }) {
  const { t } = useI18n();
  const open = () => openAgentBeside(m.hostId, m.id);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open())}
      title={t("project-view.openBeside")}
      data-testid="project-view-director"
      className="mx-3 mt-2.5 mb-1 cursor-pointer rounded-xl border border-border bg-surface px-3 py-2.5 hover:bg-hover"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <MemberAvatar m={m} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-title/[inherit] font-semibold">{m.name}</span>
            <Tag>{t("project-view.director")}</Tag>
            <span className="ml-auto shrink-0 pl-1 text-caption/[inherit] text-subtle tabular-nums">{relativeTime(m.lastActivity)}</span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <Pill tone={memberTone(m)}>{memberState(m, t, now)}</Pill>
            <span className="min-w-0 truncate text-meta/[inherit] text-subtle">{t("project-view.delegations", { out: m.dlgOut.length, in: m.dlgIn.length })}</span>
          </div>
        </div>
      </div>
      <div className={`mt-1.5 line-clamp-2 text-meta/[inherit] ${m.signal === "error" ? "text-danger" : "text-muted"}`}>{stepText(m, t)}</div>
      {m.plan && (
        <div className="mt-1">
          <PlanBar plan={m.plan} t={t} />
        </div>
      )}
      <Extras m={m} data={data} max={5} />
    </div>
  );
}

function GroupHead({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <div className={`sticky top-0 z-[1] flex items-center gap-1.5 bg-background px-3 pt-2.5 pb-1 text-meta/[inherit] font-semibold ${tone}`}>
      {label}
      <span className="font-normal text-subtle">{n}</span>
    </div>
  );
}

function Agents({ data, state, setState, now }: { data: ProjectData; state: ViewState; setState(s: ViewState): void; now: number }) {
  const { t } = useI18n();
  const g = data.grouped;
  const groups: [MessageKey, Member[], string][] = [
    ["project-view.group.needs", g.needsYou, "text-warn-text"],
    ["project-view.group.running", g.running, "text-ok-text"],
    ["project-view.group.recent", g.recent, "text-subtle"],
  ];
  const others = g.needsYou.length + g.running.length + g.recent.length + g.idle.length;
  // Sized to its content inside the upper scroll region (UPPER_CLASS): with one or two agents the
  // activity below takes the rest instead of leaving a gap (owner 2026-10-21).
  return (
    <div className="pb-2" data-testid="project-view-agents">
      {g.director ? (
        <DirectorCard m={g.director} data={data} now={now} />
      ) : others > 0 ? (
        <div className="mx-3 mt-2.5 rounded-xl border border-dashed border-border px-3 py-2 text-meta/[inherit] text-subtle">{t("project-view.noDirector")}</div>
      ) : null}
      {others === 0 && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-meta/[inherit] text-subtle" data-testid="project-view-agents-empty">
          <Users size={14} className="shrink-0" />
          <span className="min-w-0">{t(state.needsOnly ? "project-view.noNeeds" : g.director ? "project-view.onlyDirector" : "project-view.noAgents")}</span>
        </div>
      )}
      {groups.map(([key, list, tone]) =>
        list.length ? (
          <section key={key}>
            <GroupHead label={t(key)} n={list.length} tone={tone} />
            {list.map((m) => (
              <MemberRow key={m.id} m={m} data={data} now={now} />
            ))}
          </section>
        ) : null,
      )}
      {g.idle.length > 0 && (
        <section className="border-t border-border">
          <button
            type="button"
            onClick={() => setState({ ...state, idleOpen: !state.idleOpen })}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-meta/[inherit] text-muted hover:bg-hover"
            aria-expanded={state.idleOpen}
          >
            {state.idleOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {state.idleOpen ? t("project-view.idleHide") : t("project-view.idle", { n: g.idle.length })}
            {!state.idleOpen && (
              <span className="ml-1 flex -space-x-1.5">
                {g.idle.slice(0, 6).map((m) => (
                  <Avatar key={m.id} name={m.name} initial={m.row.initial} color={m.row.color} avatar={m.row.session.avatar} seed={m.row.session.cutexSessionId} size={16} />
                ))}
              </span>
            )}
          </button>
          {state.idleOpen && g.idle.map((m) => <MemberRow key={m.id} m={m} data={data} now={now} folded />)}
        </section>
      )}
    </div>
  );
}

const KIND_ICON: Record<ActivityKind, typeof Send> = { delegate: Send, complete: Check, progress: ListChecks, publish: FileBox, needsYou: CircleAlert };
const KIND_TONE: Record<ActivityKind, string> = { delegate: "text-accent", complete: "text-ok-text", progress: "text-muted", publish: "text-accent", needsYou: "text-warn-text" };

function activityText(item: ActivityItem, data: ProjectData, t: T): string {
  const who = item.actor === null && !item.actorName ? t("project-view.you") : (data.nameOf(item.actor, item.actorName) ?? t("project-view.someone"));
  const reason = (r: string) => t(`project-view.reason.${r}` as MessageKey);
  switch (item.what) {
    case "delegate":
      return t("project-view.act.delegate", { from: who, to: data.nameOf(item.to, item.toName) ?? t("project-view.someone"), title: item.title });
    case "complete":
      return item.failed
        ? t("project-view.act.failed", { to: who, title: item.title })
        : t("project-view.act.complete", { to: who, from: item.from === null && !item.fromName ? t("project-view.you") : (data.nameOf(item.from, item.fromName) ?? t("project-view.someone")), title: item.title });
    case "note":
      return t("project-view.act.note", { who, text: item.text });
    case "plan":
      return item.done === item.total ? t("project-view.act.planDone", { who, total: item.total }) : t("project-view.act.plan", { who, done: item.done, total: item.total, step: item.step ?? "" });
    case "artifact":
      return t("project-view.act.artifact", { who, name: item.name });
    case "service":
      return t("project-view.act.service", { who, name: item.name });
    case "needsDelegation":
      return t("project-view.act.needsDelegation", { title: item.title, reason: reason(item.reason) });
    case "needsAgent":
      return item.error ? t("project-view.act.error", { who, text: item.text ?? "" }) : t("project-view.act.needs", { who, reason: item.text ?? reason("other") });
  }
}

/** One activity row. Memoised on what it shows (perf §9): the panel re-renders on every project data change
 *  (a sidebar refresh, a live status), and every row with its avatar used to re-render with it. */
const ActivityRow = memo(function ActivityRow({ item, hostId, text, when, avatar }: { item: ActivityItem; hostId: string; text: string; when: string; avatar: RowAvatar | null }) {
  const Icon = item.what === "service" ? Globe : KIND_ICON[item.kind];
  return (
    <button type="button" onClick={() => openTarget(hostId, item.open)} data-testid="project-view-activity-row" className="flex w-full min-w-0 items-start gap-2 px-3 py-1.5 text-left hover:bg-hover">
      <span className="w-8 shrink-0 pt-0.5 text-right text-caption/[inherit] text-subtle tabular-nums">{when}</span>
      <span className="relative mt-px shrink-0">
        {avatar ? (
          <Avatar name={avatar.name} initial={avatar.initial} color={avatar.color} avatar={avatar.image} seed={avatar.seed} size={20} />
        ) : (
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-surface-2 text-caption/[inherit] text-muted">{(text[0] ?? "?").toUpperCase()}</span>
        )}
        <span className={`absolute -right-1 -bottom-1 flex h-3 w-3 items-center justify-center rounded-full bg-background ${KIND_TONE[item.kind]}`}>
          <Icon size={9} strokeWidth={2.6} />
        </span>
      </span>
      <span className={`min-w-0 flex-1 line-clamp-2 text-meta/[inherit] ${item.kind === "needsYou" ? "text-warn-text" : ""}`}>{text}</span>
    </button>
  );
}, (a, b) => a.item === b.item && a.hostId === b.hostId && a.text === b.text && a.when === b.when && sameAvatar(a.avatar, b.avatar));

type RowAvatar = { name: string; initial: string | undefined; color: string | null; image: Member["row"]["session"]["avatar"]; seed: string };

function activityRowProps(item: ActivityItem, data: ProjectData, t: T) {
  const member = item.actor ? data.members.find((m) => m.id === item.actor) : undefined;
  const avatar: RowAvatar | null = member ? { name: member.name, initial: member.row.initial, color: member.row.color, image: member.row.session.avatar, seed: member.row.session.cutexSessionId } : null;
  return { item, hostId: data.target!.hostId, text: activityText(item, data, t), when: relativeTime(item.at), avatar };
}

function Activity({ data, state, setState }: { data: ProjectData; state: ViewState; setState(s: ViewState): void }) {
  const { t } = useI18n();
  const counts = kindCounts(data.activity);
  const rows = filterActivity(data.activity, state.kinds, state.needsOnly);
  return (
    <div className={ACTIVITY_CLASS} data-testid="project-view-activity">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1 px-3 pt-2 pb-1.5">
        <span className="mr-1 text-meta/[inherit] font-semibold">{t("project-view.activity")}</span>
        {ACTIVITY_KINDS.map((k) => {
          const on = state.needsOnly ? k === "needsYou" : state.kinds.includes(k);
          return (
            <button
              key={k}
              type="button"
              disabled={state.needsOnly}
              aria-pressed={on}
              onClick={() => setState({ ...state, kinds: toggleKind(state.kinds, k) })}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-caption/[inherit] ${on ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-muted hover:bg-hover"} disabled:opacity-60`}
            >
              {t(`project-view.kind.${k}` as MessageKey)}
              <span className="tabular-nums opacity-70">{counts[k]}</span>
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {rows.length === 0 ? (
          <div className="flex h-full min-h-[96px] flex-col items-center justify-center gap-1.5 px-6 py-4 text-center" data-testid="project-view-activity-empty">
            <History size={18} className="text-subtle" />
            <div className="text-ui/[inherit] text-muted">{t(data.activity.length ? "project-view.activityNone" : "project-view.activityEmpty")}</div>
            {data.activity.length ? (
              <button
                type="button"
                onClick={() => setState({ ...state, kinds: [], needsOnly: false })}
                className="mt-0.5 rounded-md border border-border px-2 py-0.5 text-meta/[inherit] text-muted hover:bg-hover"
              >
                {t("project-view.clearFilter")}
              </button>
            ) : (
              <div className="max-w-[280px] text-meta/[inherit] text-subtle">{t("project-view.activityEmptyHint")}</div>
            )}
          </div>
        ) : (
          rows.map((item) => <ActivityRow key={item.id} {...activityRowProps(item, data, t)} />)
        )}
      </div>
    </div>
  );
}

/** The header's measured width (lib/sizeFlags, no CSS size container): `wide` = Tailwind `@sm` (24rem). */
const HEADER_SIZES = { wide: widthAtLeast(24) };

function Header({ data, state, setState, onHandoverHistory }: { data: ProjectData; state: ViewState; setState(s: ViewState): void; onHandoverHistory?(): void }) {
  const { t } = useI18n();
  const hasTree = useApp(s => !!data.target && featuresOf(s, data.target.hostId).has("delegation-tree-stop-v1"));
  const hasHandover = useApp(s => !!data.target && ["director-address", "director-change-notices", "director-handover", "management-start-adoption"].some(feature => featuresOf(s, data.target!.hostId).has(feature)));
  const [sizeRef, sizeFlags] = useSizeFlags(HEADER_SIZES);
  const g = data.group;
  const pick = (el: HTMLElement) =>
    openMenuFrom(el, [
      { label: t("project-view.follow"), title: t("project-view.followHint"), icon: data.following ? <Check size={14} /> : <span className="inline-block w-[14px]" />, onSelect: () => setState({ ...state, hostId: null, projectId: null, evAgent: null }) },
      "separator",
      ...data.choices.map((c) => ({
        label: data.choices.filter((x) => x.name === c.name).length > 1 ? `${c.name} · ${c.hostId}` : c.name,
        hint: String(c.agents),
        icon: !data.following && data.target?.projectId === c.projectId && data.target.hostId === c.hostId ? <Check size={14} /> : <ProjectBadge badge={c.badge} color={c.color} size="sm" />,
        onSelect: () => setState({ ...state, hostId: c.hostId, projectId: c.projectId, evAgent: null }),
      })),
      ...(hasHandover && onHandoverHistory ? ["separator" as const, { label: t("project-view.directorUi.history"), onSelect: onHandoverHistory }] : []),
    ]);
  const c = data.counts;
  return (
    <div ref={sizeRef} className="shrink-0 border-b border-border px-3 pt-2.5 pb-2" data-testid="project-view-header">
      <div className="flex min-w-0 items-center gap-2">
        {g && <ProjectBadge badge={g.badge} color={g.color} size="lg" />}
        <button type="button" onClick={(e) => pick(e.currentTarget)} className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-hover" title={t("project-view.pick")}>
          <span className="min-w-0 truncate text-title/[inherit] font-semibold">{g?.name ?? t("project-view.pick")}</span>
          <ChevronDown size={14} className="shrink-0 text-subtle" />
        </button>
        {data.hostLabel && (
          <span className="inline-flex min-w-0 shrink items-center gap-1 rounded-full bg-surface-2 px-1.5 py-px text-caption/[inherit] text-muted">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: data.hostColor ?? undefined }} />
            <span className="truncate">{data.hostLabel}</span>
          </span>
        )}
        {hasTree && data.target && (
          <button type="button" className={`ml-auto ${btn({ size: "sm", variant: "ghost" })}`} title={t("delegations.upgrade.tree.open")} onClick={() => services.ui.openPage("delegations.treePage", { project: data.target!.projectId, host: data.target!.hostId })}>
            <ListTree size={13} aria-hidden />
            {/* A narrow project view (a side Shelf) keeps the icon only; the title says what it opens. */}
            {sizeFlags.wide && <span>{t("delegations.upgrade.tree.title")}</span>}
          </button>
        )}
      </div>
      {g && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta/[inherit] text-muted">
          <span>{t("project-view.count.agents", { n: c.total })}</span>
          <Count dot="bg-ok" n={c.online} label={t("project-view.count.online")} />
          <Count dot="bg-accent" n={c.running} label={t("project-view.count.running")} />
          <Count dot="bg-warn" n={c.needsYou} label={t("project-view.count.needs")} strong={c.needsYou > 0} />
          <span className="text-subtle">·</span>
          <Count n={data.totals.delegations} label={t("project-view.count.delegations")} />
          <Count n={data.totals.jobs} label={t("project-view.count.jobs")} />
          <Count n={data.totals.subagents} label={t("project-view.count.subagents")} />
        </div>
      )}
      {g && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            aria-pressed={state.needsOnly}
            onClick={() => setState({ ...state, needsOnly: !state.needsOnly })}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-meta/[inherit] ${state.needsOnly ? "border-warn/40 bg-warn/10 text-warn-text" : "border-border text-muted hover:bg-hover"}`}
          >
            <CircleAlert size={12} />
            {t("project-view.onlyNeeds")}
            <span className="tabular-nums">{c.needsYou}</span>
          </button>
          {data.hostOffline && data.hostLabel && <span className="truncate text-caption/[inherit] text-subtle">{t("project-view.hostOffline", { host: data.hostLabel })}</span>}
        </div>
      )}
    </div>
  );
}

function Count({ n, label, dot, strong }: { n: number; label: string; dot?: string; strong?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {dot && <i className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      <b className={`font-semibold tabular-nums ${strong ? "text-warn-text" : "text-foreground"}`}>{n}</b>
      {label}
    </span>
  );
}

/** The view for a state (the pane body and the project page tab share it). */
export function ProjectViewPanel({ state, setState }: { state: ViewState; setState(s: ViewState): void }) {
  const { t } = useI18n();
  const now = useNow(15_000);
  const data = useProjectData(state, now);
  // cutex project-events: 「动态」 (the project log) replaces the derived list; older hosts keep it as is.
  const stream = useHasProjectEvents(data.target?.hostId ?? null);
  // Former Directors (from 项目交接's settled changes) make their leftover session services claim candidates.
  const [former, setFormer] = useState<{ key: string; ids: Set<string> } | null>(null);
  const targetKey = data.target ? data.target.hostId + ":" + data.target.projectId : "";
  const [historyTarget, setHistoryTarget] = useState<string | null>(null);
  useEffect(() => setHistoryTarget(null), [targetKey]);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="project-view">
      <Header data={data} state={state} setState={setState} onHandoverHistory={() => setHistoryTarget(targetKey)} />
      {data.group ? (
        <>
          <div className={UPPER_CLASS} data-testid="project-view-upper">
            {data.target && <DirectorPanel key={targetKey} hostId={data.target.hostId} projectId={data.target.projectId} nameOf={data.nameOf} onFormerDirectors={(ids) => setFormer({ key: targetKey, ids })} historyOpen={historyTarget === targetKey} onCloseHistory={() => setHistoryTarget(null)} />}
            {data.target && <ServiceClaimStrip hostId={data.target.hostId} projectId={data.target.projectId} formerDirectors={former?.key === targetKey ? former.ids : undefined} className="mx-3 my-2" />}
            <Agents data={data} state={state} setState={setState} now={now} />
          </div>
          {stream ? <ProjectStream data={data} state={state} setState={setState} now={now} /> : <Activity data={data} state={state} setState={setState} />}
        </>
      ) : (
        <div className="px-4 py-6 text-ui/[inherit] text-subtle">{data.target ? t("project-view.gone") : t("project-view.empty")}</div>
      )}
    </div>
  );
}

export function ProjectViewBody(props: SideBodyProps<ViewState>) {
  const state = useProjectViewState(props.instance.id, props.instance.state);
  return <ProjectViewPanel state={state} setState={(next) => {
    if (next.hostId && next.projectId) rememberProject({ hostId: next.hostId, projectId: next.projectId });
    props.setState(next);
  }} />;
}

/** The 项目 page tab (`project.tab`): the same view for that project, kept in memory. */
export function ProjectViewTab({ hostId, projectId }: { hostId: string; projectId: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ViewState>({ ...emptyState(), hostId, projectId });
  const projectName = useApp((s) => sidebarOf(s, hostId)?.projects?.projects.find((p) => p.project_id === projectId)?.presentation.display_name || null);
  useEffect(() => setState((s) => ({ ...s, hostId, projectId })), [hostId, projectId]);
  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="flex items-center justify-end gap-1 px-3 pb-1">
        <PinButton hostId={hostId} projectId={projectId} name={projectName ?? projectId} />
        <button type="button" className={btn()} onClick={() => openProjectView({ hostId, projectId })}>
          {t("project-view.openInShelf")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
        <ProjectViewPanel state={state} setState={setState} />
      </div>
    </div>
  );
}
