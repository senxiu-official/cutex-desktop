// Delegation overview (DESIGN: 委托 overview), used by the 委托 page, a project's 委托 tab and the
// project Overview (compact). Rows are bucketed — 需要你 / 等待·受阻 / 进行中 — with 已结束 folded
// below and loaded on first open (50 shown, then 更多). Row: status (glyph + word) · #N title
// (+ activity / latest progress) · requester → target · time · ⋯ (the delegation menu). Without
// cutex asks there is nothing to list: compact shows nothing, the full list a short note.
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import type { SessionAvatar } from "@cutex-desktop/protocol";
import type { AskSummary } from "../../../shared/ipc";
import { useI18n, type MessageKey } from "../i18n";
import { contextMenu, openMenuFrom } from "../lib/contextMenu";
import { delegationMenu } from "../lib/delegationMenu";
import { ASKS_FEATURE, delegationBucket, delegationStatus, formatSpan, isOwnerRequest, peerSideOf, requesterName, requesterSession, rowSeconds, sortDelegations, type DelegationBucket } from "../lib/delegations";
import { hasDelegationViews, loadClosedDelegations, useDelegations, useHostDelegations } from "../lib/delegationStore";
import { hostKey } from "../lib/hostKeys";
import { useTargetFeatures, useTargetHostId, useTargetIsFocus, useTargetSelect, useTargetSidebar } from "../lib/targetHost";
import { useDelegationContext } from "../lib/delegationsView";
import { openDelegationDetail } from "../lib/delegationOpen";
import { focusDelegation } from "../lib/focusRequest";
import { taskTag } from "../lib/tasks";
import { formatAbsolute, formatWhen, useClock } from "../lib/time";
import { Avatar } from "./Avatar";
import { DataTable, type Column } from "./DataTable";
import { DelegationHops, DelegationStatusMark, DelegationTag } from "./DelegationParts";
import { PeerParty } from "./PeerParty";
import { PageToolbar } from "./Page";
import { Select } from "./settings/Form";

const OPEN_BUCKETS: DelegationBucket[] = ["needsYou", "waiting", "active"];
const DONE_PAGE = 50;

type Party = { name: string; avatar?: SessionAvatar | null };

function useParties(): (id: string | null) => Party {
  // The list's host (a project page of another host: TargetHostContext).
  const sidebar = useTargetSidebar();
  return useMemo(() => {
    const byId = new Map([...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].map((s) => [s.cutexSessionId, s]));
    return (id) => {
      const s = id ? byId.get(id) : undefined;
      return { name: s?.displayName ?? id ?? "—", avatar: s?.avatar };
    };
  }, [sidebar]);
}

function When({ d, bucket }: { d: AskSummary; bucket: DelegationBucket }) {
  const { locale } = useI18n();
  const now = useClock();
  const s = rowSeconds(d, bucket, now);
  if (s !== null) return <span className="text-[11px] text-subtle tabular-nums">{formatSpan(s)}</span>;
  const at = d.closedAt ?? d.updatedAt;
  if (!at) return null;
  const sec = Date.parse(at) / 1000;
  return (
    <span className="text-[11px] text-subtle" title={formatAbsolute(sec)}>
      {formatWhen(sec, now, locale)}
    </span>
  );
}

function useColumns(compact: boolean): Column<AskSummary>[] {
  const { t } = useI18n();
  const select = useTargetSelect();
  const hostId = useTargetHostId();
  const views = hasDelegationViews(useTargetFeatures());
  const party = useParties();
  const nameOf = (id: string) => party(id).name;
  const progress = useDelegations((s) => s.progress);
  const ctxOf = useDelegationContext();
  const columns: Column<AskSummary>[] = [
    {
      key: "status",
      header: t("table.status"),
      width: compact ? "7rem" : "9rem",
      cell: (d) => <DelegationStatusMark status={delegationStatus(d, ctxOf(d))} name={d.remote?.targetName ?? d.targetName ?? nameOf(d.target)} error={d.attempt?.lastError ?? d.remote?.lastError} className="max-w-full text-xs" />,
    },
    {
      key: "delegation",
      header: t("delegations.col.delegation"),
      cell: (d) => {
        const requester = requesterSession(d.requester);
        // The detail on the right side (the list's host). Not available: the old jump — an incoming
        // peer ask opens its local target; a mirror opens the local requester's card.
        const jump = () => (requester ? focusDelegation(requester, d.askId, hostId) : d.remote ? undefined : void select(d.target));
        const open = () => openDelegationDetail(hostId, d.askId, { title: d.title, fallback: jump });
        const note = d.attempt?.activity?.line ?? progress[hostKey(hostId, d.askId)]?.at(-1)?.text ?? d.attempt?.progress?.at(-1)?.text ?? null;
        return (
          <div className="flex min-w-0 items-center gap-2">
            <DelegationTag askId={d.askId} />
            <button onClick={open} className={`${compact || !note ? "min-w-0" : "max-w-[60%] shrink-0"} truncate text-left hover:underline`} title={d.title}>
              {d.title}
            </button>
            {!compact && note && <span className="min-w-0 truncate text-xs text-subtle">{note}</span>}
            {!compact && <DelegationHops hops={d.hops} />}
          </div>
        );
      },
    },
    {
      key: "people",
      header: t("delegations.col.people"),
      width: compact ? "7rem" : "12rem",
      cell: (d) => {
        const requester = requesterSession(d.requester);
        const from = requester ? party(requester) : { name: requesterName(d.requester) ?? "" };
        const to = party(d.target);
        const peer = peerSideOf(d);
        return (
          <div className="flex min-w-0 items-center gap-1 text-xs text-muted">
            {!compact &&
              (peer?.side === "requester" ? (
                <PeerParty text={peer.name} label={peer.label} size={16} quiet />
              ) : isOwnerRequest(d.requester) ? (
                <span className="shrink-0 font-medium text-foreground">{t("delegation.you")}</span>
              ) : (
                <button onClick={() => requester && void select(requester)} title={from.name} className="shrink-0">
                  <Avatar name={from.name} avatar={from.avatar} seed={requester} size={16} minor />
                </button>
              ))}
            {!compact && <ArrowRight size={11} className="shrink-0 text-subtle" />}
            {peer?.side === "target" ? (
              <PeerParty text={peer.name} label={peer.label} size={16} quiet />
            ) : (
              <button onClick={() => void select(d.target)} className="flex min-w-0 items-center gap-1 hover:text-foreground">
                <Avatar name={d.targetName ?? to.name} avatar={to.avatar} seed={d.target} size={16} minor />
                <span className="truncate">{d.targetName ?? to.name}</span>
              </button>
            )}
          </div>
        );
      },
    },
    { key: "time", header: t("delegations.col.time"), width: "5rem", align: "right", cell: (d) => <When d={d} bucket={delegationBucket(d, ctxOf(d))} /> },
    {
      key: "menu",
      header: "",
      width: "2rem",
      cell: (d) => (
        <button onClick={(e) => openMenuFrom(e.currentTarget, delegationMenu(d, t, nameOf, { host: hostId, views }))} aria-label={t("delegation.more")} className="rounded p-0.5 text-subtle opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100">
          <MoreHorizontal size={14} />
        </button>
      ),
    },
  ];
  return compact ? columns.filter((c) => c.key !== "menu") : columns;
}

function Fold({ label, count, open, onToggle }: { label: string; count?: number | null; open: boolean; onToggle(): void }) {
  return (
    <button onClick={onToggle} aria-expanded={open} className="mt-4 flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-muted hover:text-foreground">
      {open ? <ChevronDown size={12} className="text-subtle" /> : <ChevronRight size={12} className="text-subtle" />}
      {label}
      {count != null && <span className="font-normal text-subtle">{count}</span>}
    </button>
  );
}

/**
 * `projectId` locks to one project. `only` (compact: no toolbar, no header, no 已结束) limits to
 * some buckets, `limit` caps the rows. `agent` presets the agent filter (delegations.page `params.agent`).
 */
export function DelegationList({ projectId, only, limit, agent: preset }: { projectId?: string; only?: DelegationBucket[]; limit?: number; agent?: string }) {
  const { t } = useI18n();
  const enabled = useTargetFeatures().has(ASKS_FEATURE);
  if (!enabled) return only || limit ? null : <p className="text-sm text-subtle">{t("delegations.unavailable")}</p>;
  return <Delegations projectId={projectId} only={only} limit={limit} preset={preset} />;
}

function Delegations({ projectId, only, limit, preset }: { projectId?: string; only?: DelegationBucket[]; limit?: number; preset?: string }) {
  const { t } = useI18n();
  // The target host's records (the focus host: the overview's; another host is followed while shown).
  const hostId = useTargetHostId();
  const own = useTargetIsFocus();
  const byId = useHostDelegations(hostId);
  const focusLoadedAt = useDelegations((s) => s.loadedAt);
  const hostLoadedAt = useDelegations((s) => s.hostLoadedAt[hostId] ?? null);
  const loadedAt = own ? focusLoadedAt : hostLoadedAt;
  const closedLoading = useDelegations((s) => s.closedLoading);
  const closedLoaded = useDelegations((s) => s.closedIds !== null);
  const party = useParties();
  const compact = !!only;
  const [agent, setAgent] = useState(preset ?? "");
  useEffect(() => setAgent(preset ?? ""), [preset]);
  const [query, setQuery] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);
  const [doneShown, setDoneShown] = useState(DONE_PAGE);
  const columns = useColumns(compact);
  const ctxOf = useDelegationContext();

  const scoped = Object.values(byId).filter((d) => !projectId || d.projectId === projectId);
  const agentIds = [...new Set(scoped.flatMap((d) => [d.remote ? null : d.target, requesterSession(d.requester)]).filter((x): x is string => !!x))];
  const q = query.trim().toLowerCase();
  const visible = scoped
    .filter((d) => !agent || d.target === agent || requesterSession(d.requester) === agent)
    .filter((d) => !q || `${taskTag(d.askId).label} ${d.title} ${d.targetName ?? ""} ${requesterName(d.requester) ?? ""}`.toLowerCase().includes(q));
  const inBucket = (b: DelegationBucket) => sortDelegations(b, visible.filter((d) => delegationBucket(d, ctxOf(d)) === b));
  const buckets = only ?? OPEN_BUCKETS;
  const flat = buckets.flatMap(inBucket);
  const shownOpen = limit ? flat.slice(0, limit) : flat;
  const groups = compact
    ? [{ key: "open", label: null, rows: shownOpen }]
    : buckets.map((b) => ({ key: b, label: t(`delegations.bucket.${b}` as MessageKey), rows: inBucket(b) })).filter((g) => g.rows.length > 0);
  const done = compact ? [] : inBucket("done");
  const toggleDone = () => {
    if (!doneOpen) void loadClosedDelegations();
    setDoneOpen(!doneOpen);
  };
  const rowMenu = (d: AskSummary) => contextMenu(() => delegationMenu(d, t, (id) => party(id).name, { host: hostId }));

  return (
    <>
      {!compact && (
        <PageToolbar>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("delegations.search")} className="mr-auto w-48 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent" />
          <Select value={agent} options={[{ value: "", label: t("delegations.allAgents") }, ...[...new Set([...agentIds, ...(agent ? [agent] : [])])].map((id) => ({ value: id, label: party(id).name }))]} onChange={setAgent} />
        </PageToolbar>
      )}
      {loadedAt === null && scoped.length === 0 && <p className="text-sm text-subtle">{t("delegations.loading")}</p>}
      {loadedAt !== null && shownOpen.length === 0 && <p className="py-2 text-sm text-subtle">{t(compact ? "delegations.allClear" : "delegations.none")}</p>}
      {shownOpen.length > 0 && <DataTable columns={columns} groups={groups} rowKey={(d) => d.askId} foldPrefix="delegations" hideHeader={compact} onRowContextMenu={(e, d) => rowMenu(d)(e)} />}
      {!compact && own && (
        <>
          <Fold label={t("delegations.bucket.done")} count={closedLoaded ? done.length : null} open={doneOpen} onToggle={toggleDone} />
          {doneOpen && closedLoading && done.length === 0 && <p className="px-2 text-sm text-subtle">{t("delegations.loading")}</p>}
          {doneOpen && done.length > 0 && (
            <>
              <DataTable columns={columns} groups={[{ key: "done", label: null, rows: done.slice(0, doneShown) }]} rowKey={(d) => d.askId} foldPrefix="delegations" hideHeader onRowContextMenu={(e, d) => rowMenu(d)(e)} />
              {done.length > doneShown && (
                <button onClick={() => setDoneShown(doneShown + DONE_PAGE)} className="mt-1 px-2 text-xs text-accent hover:underline">
                  {t("delegations.more", { n: Math.min(DONE_PAGE, done.length - doneShown) })}
                </button>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
