// 项目 › 概览 v2 (owner 2026-11-26: the page is about running the project, not a roll call). Two columns when there is room,
// one column in a side pane or on the owner's portrait screen:
//   wide    left: 进行中 → 需要你处理 (only when there is something) → 最近完成 → 最新成果
//           right: 成员 (Director + up to 5 working + 「x/y 在线 · 查看全部」) → 服务 → 记忆 · 最近更新 → MCP
//   narrow  成员 → 进行中 → 需要你处理 → 服务 → 最近完成 (folded) → 最新成果 (folded) → 记忆 → MCP
// Everything comes from what the host already sends (overviewModel.ts); no business rule is rebuilt here.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AskSummary, ProjectMemoryView, ServiceView } from "../../../../shared/ipc";
import type { ArtifactSummary } from "../../../../shared/artifactStore";
import { useI18n, type MessageKey } from "../../i18n";
import { AgentRowButton } from "../../components/AgentRows";
import { DelegationList } from "../../components/DelegationList";
import { ServiceLine } from "../../components/ServiceLine";
import { onlineCount, type AgentRow } from "../../lib/sidebar";
import { delegationBucket } from "../../lib/delegations";
import { loadClosedDelegations, useHostDelegations } from "../../lib/delegationStore";
import { useDelegationContext } from "../../lib/delegationsView";
import { openDelegationDetail } from "../../lib/delegationOpen";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { useSizeFlags, type SizeTest } from "../../lib/sizeFlags";
import { services } from "../app";
import { ARTIFACTS_SHOWN, busyMembers, closedKind, OVERVIEW_WIDE_REM, recentClosed, recentMemory, serviceProblems, type ClosedKind } from "./overviewModel";

const SIZES: Record<"wide", SizeTest> = { wide: (box, rem) => box.width >= OVERVIEW_WIDE_REM * rem };

export interface ProjectOverviewProps {
  hostId: string;
  projectId: string;
  /** The delegation store of this host is the focus host's (closed delegations load only there). */
  isFocus: boolean;
  team: { online: AgentRow[]; offline: AgentRow[] };
  directorId: string | null;
  /** Agents waiting for the owner (approval / question). */
  waiting: AgentRow[];
  services: ServiceView[];
  memory: ProjectMemoryView | null | undefined;
  mcp: { servers: Record<string, unknown> } | null | undefined;
  /** Which module tabs this host offers (blocks link to them, and 最新成果 needs the 成果库). */
  tabs: ReadonlySet<string>;
  setTab(tab: string): void;
  /** The 成员 heading's buttons (换主管 / 添加成员). */
  teamActions?: ReactNode;
  onError(message: string): void;
}

function Heading({ title, count, link, onLink, fold, actions }: { title: string; count?: ReactNode; link?: string; onLink?(): void; fold?: { open: boolean; toggle(): void }; actions?: ReactNode }) {
  const { t } = useI18n();
  const label = fold ? (
    <button onClick={fold.toggle} aria-expanded={fold.open} title={t(fold.open ? "projects.overview.collapse" : "projects.overview.expand")} className="press flex min-w-0 items-center gap-1 rounded-sm text-left">
      {fold.open ? <ChevronDown size={13} className="shrink-0 text-subtle" /> : <ChevronRight size={13} className="shrink-0 text-subtle" />}
      <span>{title}</span>
      {count !== undefined && <span className="font-normal text-subtle">{count}</span>}
    </button>
  ) : (
    <>
      <span>{title}</span>
      {count !== undefined && <span className="font-normal text-subtle">{count}</span>}
    </>
  );
  return (
    <h3 className="mb-2 flex min-w-0 items-center gap-1.5 text-sm font-semibold">
      {label}
      {(link || actions) && (
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
          {link && onLink && (
            <button onClick={onLink} className="press rounded-sm text-xs font-normal text-accent hover:underline">
              {link} →
            </button>
          )}
        </span>
      )}
    </h3>
  );
}

const Card = ({ children, tone }: { children: ReactNode; tone?: "warn" }) => (
  <div className={`rounded-xl border px-1 py-1 ${tone === "warn" ? "border-warn/40 bg-warn/5" : "border-border bg-surface"}`}>{children}</div>
);

function Footer({ children, link, onLink }: { children: ReactNode; link?: string; onLink?(): void }) {
  return (
    <div className="mt-1 flex items-center gap-1.5 border-t border-border px-2 pt-1.5 pb-1 text-xs text-subtle">
      <span className="min-w-0 truncate">{children}</span>
      {link && onLink && (
        <button onClick={onLink} className="press ml-auto shrink-0 rounded-sm text-accent hover:underline">
          {link}
        </button>
      )}
    </div>
  );
}

function When({ iso }: { iso: string | null | undefined }) {
  const { locale } = useI18n();
  const now = useClock();
  const ms = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return null;
  return <span className="shrink-0 text-xs text-subtle tabular-nums" title={formatAbsolute(ms / 1000)}>{formatWhen(ms / 1000, now, locale)}</span>;
}

const KIND_TONE: Record<ClosedKind, string> = { done: "bg-ok/15 text-ok", failed: "bg-danger/15 text-danger", stopped: "bg-surface-2 text-subtle" };

function TeamBlock(p: ProjectOverviewProps) {
  const { t } = useI18n();
  const all = [...p.team.online, ...p.team.offline];
  const director = all.find((r) => r.id === p.directorId) ?? null;
  const busy = busyMembers(p.team.online, p.directorId);
  return (
    <section data-overview-block="team">
      <Heading title={t("projects.team")} actions={p.teamActions} />
      <Card>
        {director && <AgentRowButton row={director} />}
        {busy.total > 0 && <p className="px-2 pt-1.5 pb-0.5 text-xs text-subtle">{t("projects.overview.busy", { n: busy.total })}</p>}
        {busy.shown.map((row) => <AgentRowButton key={row.id} row={row} />)}
        {busy.more > 0 && <p className="px-2 py-1 text-xs text-subtle">{t("projects.overview.busyMore", { n: busy.more })}</p>}
        {all.length === 0 ? (
          <p className="px-2 py-2 text-xs text-subtle">{t("projects.noMembers")}</p>
        ) : (
          <Footer link={t("projects.overview.allMembers")} onLink={() => p.setTab("agents")}>
            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-ok align-middle" />
            {t("projects.teamOnline", { online: onlineCount(p.team), total: all.length })}
          </Footer>
        )}
      </Card>
    </section>
  );
}

/** 需要你处理: agents waiting for the owner and delegations that need them; nothing at all when there is neither. */
function NeedsBlock({ waiting, needs, projectId }: { waiting: AgentRow[]; needs: number; projectId: string }) {
  const { t } = useI18n();
  if (waiting.length === 0 && needs === 0) return null;
  return (
    <section data-overview-block="needs">
      <Heading title={t("projects.needsYou")} count={waiting.length + needs} />
      {waiting.length > 0 && (
        <div className="mb-2">
          <Card tone="warn">{waiting.map((row) => <AgentRowButton key={row.id} row={row} />)}</Card>
        </div>
      )}
      {needs > 0 && <DelegationList projectId={projectId} only={["needsYou"]} />}
    </section>
  );
}

function ActiveBlock({ projectId, count, setTab }: { projectId: string; count: number; setTab(tab: string): void }) {
  const { t } = useI18n();
  return (
    <section data-overview-block="active">
      <Heading title={t("projects.activeTasks")} count={count || undefined} link={t("projects.allTasks")} onLink={() => setTab("tasks")} />
      {count > 0 ? <DelegationList projectId={projectId} only={["active"]} limit={5} /> : <p className="text-sm text-subtle">{t("projects.overview.noneActive")}</p>}
    </section>
  );
}

function DoneBlock({ hostId, rows, today, fold, setTab }: { hostId: string; rows: AskSummary[]; today: { done: number; failed: number }; fold?: { open: boolean; toggle(): void }; setTab(tab: string): void }) {
  const { t } = useI18n();
  if (rows.length === 0) return null;
  const open = !fold || fold.open;
  return (
    <section data-overview-block="done">
      <Heading title={t("projects.overview.recentDone")} count={t("projects.overview.today", { done: today.done, failed: today.failed })} fold={fold} link={t("projects.allTasks")} onLink={() => setTab("tasks")} />
      {open && (
        <Card>
          {rows.map((d) => {
            const kind = closedKind(d);
            const who = d.targetName ?? "";
            const result = d.answerPreview?.split("\n").find((line) => line.trim())?.trim() ?? "";
            return (
              <button key={d.askId} data-closed-kind={kind} onClick={() => openDelegationDetail(hostId, d.askId, { title: d.title, fallback: () => setTab("tasks") })}
                className="press flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2/60">
                <span className={`shrink-0 rounded-full px-1.5 py-px text-xs ${KIND_TONE[kind]}`}>{t(`projects.overview.kind.${kind}` as MessageKey)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm" title={d.title}>{d.title}</span>
                  {(who || result) && <span className="block truncate text-xs text-subtle" title={result || undefined}>{who && result ? `${who}：${result}` : who || result}</span>}
                </span>
                <When iso={d.closedAt ?? d.updatedAt} />
              </button>
            );
          })}
        </Card>
      )}
    </section>
  );
}

/** 最新成果: one page of the project's library (newest first); hidden while loading, on an error or with none. */
function useLatestArtifacts(hostId: string, projectId: string, enabled: boolean): { items: ArtifactSummary[]; more: boolean } | null {
  const [list, setList] = useState<{ key: string; items: ArtifactSummary[]; more: boolean } | null>(null);
  const key = `${hostId}|${projectId}`;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    services
      .daemonFor(hostId)
      .artifactStoreList({ project: projectId, archived: "false", limit: 20 })
      .then(
        (r) => live && setList({ key, items: [...(r?.items ?? [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), more: !!r?.nextCursor }),
        () => live && setList({ key, items: [], more: false }),
      );
    return () => { live = false; };
  }, [hostId, projectId, key, enabled]);
  return enabled && list && list.key === key ? list : null;
}

function ArtifactsBlock({ hostId, projectId, fold, setTab }: { hostId: string; projectId: string; fold?: { open: boolean; toggle(): void }; setTab(tab: string): void }) {
  const { t } = useI18n();
  const list = useLatestArtifacts(hostId, projectId, true);
  if (!list || list.items.length === 0) return null;
  const open = !fold || fold.open;
  return (
    <section data-overview-block="artifacts">
      <Heading title={t("projects.overview.latestArtifacts")} count={list.more ? `${list.items.length}+` : list.items.length} fold={fold} link={t("projects.overview.artifactsAll")} onLink={() => setTab("artifacts")} />
      {open && (
        <Card>
          {list.items.slice(0, ARTIFACTS_SHOWN).map((a) => (
            <button key={a.artifactId} onClick={() => setTab("artifacts")} className="press flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2/60">
              <span className="min-w-0 flex-1 truncate text-sm" title={a.name}>{a.name}</span>
              <When iso={a.updatedAt} />
            </button>
          ))}
        </Card>
      )}
    </section>
  );
}

function ServicesBlock({ hostId, list, tabs, setTab, onError }: { hostId: string; list: ServiceView[]; tabs: ReadonlySet<string>; setTab(tab: string): void; onError(m: string): void }) {
  const { t } = useI18n();
  if (list.length === 0) return null;
  const { problems, rest } = serviceProblems(list);
  return (
    <section data-overview-block="services">
      <Heading title={t("projects.services")} count={list.length} />
      <div className="rounded-xl border border-border bg-surface px-3">
        {problems.map((s) => <ServiceLine key={s.slug} s={s} onError={onError} hostId={hostId} />)}
        <div className={`flex items-center gap-1.5 py-2 text-xs text-subtle ${problems.length ? "border-t border-border" : ""}`}>
          <span className="inline-block size-1.5 shrink-0 rounded-full bg-ok" />
          <span className="min-w-0 truncate">{t(problems.length ? "projects.overview.servicesRest" : "projects.overview.servicesAllOk", { n: problems.length ? rest : list.length })}</span>
          {tabs.has("services") && (
            <button onClick={() => setTab("services")} className="press ml-auto shrink-0 rounded-sm text-accent hover:underline">
              {t("projects.overview.servicesAll")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function MemoryBlock({ memory, setTab }: { memory: ProjectMemoryView | null | undefined; setTab(tab: string): void }) {
  const { t } = useI18n();
  const recent = recentMemory(memory);
  if (memory === undefined) return null;
  return (
    <section data-overview-block="memory">
      <Heading title={recent.length ? t("projects.overview.memoryRecent") : t("projects.memory")} />
      <Card>
        {recent.map((e) => (
          <button key={e.file} onClick={() => setTab("memory")} className="press flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2/60">
            <span className="min-w-0 flex-1 truncate text-sm" title={e.description ?? e.name}>{e.name}</span>
            <When iso={e.updatedAt} />
          </button>
        ))}
        <Footer link={t("projects.overview.memoryAll")} onLink={() => setTab("memory")}>
          {memory ? t("projects.memoryCount", { n: memory.entries.length }) : "…"}
        </Footer>
      </Card>
    </section>
  );
}

function McpBlock({ mcp, setTab }: { mcp: ProjectOverviewProps["mcp"]; setTab(tab: string): void }) {
  const { t } = useI18n();
  return (
    <button onClick={() => setTab("settings")} className="press block w-full rounded-xl border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2/60">
      <div className="text-sm">{t("projects.mcp")}</div>
      <div className="truncate text-xs text-subtle">{mcp ? Object.keys(mcp.servers).join(" · ") || t("projects.mcpNone") : "…"}</div>
    </button>
  );
}

export function ProjectOverview(p: ProjectOverviewProps) {
  const [sizeRef, size] = useSizeFlags(SIZES);
  const now = useClock();
  const byId = useHostDelegations(p.hostId);
  const ctxOf = useDelegationContext();
  // Closed delegations load on demand, for the focus host (lib/delegationStore).
  useEffect(() => { if (p.isFocus) void loadClosedDelegations(); }, [p.isFocus]);
  const { needs, activeCount, closed } = useMemo(() => {
    const rows = Object.values(byId).filter((d) => d.projectId === p.projectId);
    const bucket = (b: string) => rows.filter((d) => delegationBucket(d, ctxOf(d)) === b).length;
    return { needs: bucket("needsYou"), activeCount: bucket("active"), closed: recentClosed(rows, p.projectId, now) };
  }, [byId, ctxOf, p.projectId, now]);
  // Narrow: 最近完成 and 最新成果 start folded (owner 2026-11-26); the owner's toggle wins until the layout changes.
  const [openDone, setOpenDone] = useState<boolean | null>(null);
  const [openArtifacts, setOpenArtifacts] = useState<boolean | null>(null);
  useEffect(() => { setOpenDone(null); setOpenArtifacts(null); }, [size.wide]);
  const fold = (state: boolean | null, set: (v: boolean) => void) => size.wide ? undefined : { open: state ?? false, toggle: () => set(!(state ?? false)) };

  const team = <TeamBlock {...p} />;
  const active = <ActiveBlock projectId={p.projectId} count={activeCount} setTab={p.setTab} />;
  const needsBlock = <NeedsBlock waiting={p.waiting} needs={needs} projectId={p.projectId} />;
  const done = <DoneBlock hostId={p.hostId} rows={closed.rows} today={closed.today} fold={fold(openDone, setOpenDone)} setTab={p.setTab} />;
  const artifacts = p.tabs.has("artifacts") ? <ArtifactsBlock hostId={p.hostId} projectId={p.projectId} fold={fold(openArtifacts, setOpenArtifacts)} setTab={p.setTab} /> : null;
  const servicesBlock = <ServicesBlock hostId={p.hostId} list={p.services} tabs={p.tabs} setTab={p.setTab} onError={p.onError} />;
  const memory = <MemoryBlock memory={p.memory} setTab={p.setTab} />;
  const mcp = <McpBlock mcp={p.mcp} setTab={p.setTab} />;

  return (
    <div ref={sizeRef} data-project-overview={size.wide ? "wide" : "narrow"}>
      {size.wide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_17.5rem] gap-6">
          <div className="flex min-w-0 flex-col gap-6">{active}{needsBlock}{done}{artifacts}</div>
          <aside className="flex min-w-0 flex-col gap-4">{team}{servicesBlock}{memory}{mcp}</aside>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-5">{team}{active}{needsBlock}{servicesBlock}{done}{artifacts}{memory}{mcp}</div>
      )}
    </div>
  );
}
