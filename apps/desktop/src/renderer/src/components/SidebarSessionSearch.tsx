// The sidebar's session search controls (harness C3, cutex r295 session-search-v1; state and paging in
// lib/sessionSearchStore): the 工作目录 filter button and row, the 查找旧任务 row at the top of a search, and its results.
// Only hosts with the capability get any of it; without one the sidebar search stays name / preview only.
import { useEffect, useId, useMemo, useState } from "react";
import { Archive, FolderSearch, History, Loader2, PanelRightOpen, X } from "lucide-react";
import { useI18n } from "../i18n";
import { useApp } from "../store";
import type { HostLook } from "../lib/hostScope";
import {
  continueTaskSearch,
  clearTaskSearch,
  setArchivedSearch,
  setSearchChoice,
  openTaskHit,
  setDirFilter,
  startTaskSearch,
  taskSearchStatus,
  useSessionSearch,
  type SearchTarget,
  type TaskHit,
} from "../lib/sessionSearchStore";
import { hostEpoch } from "../../../shared/hosts";
import { filtersOf, hitTurnMs, newestFirst, snippetAdds, type SearchFilterChoice } from "../lib/sessionSearchView";
import { HitBadges, HitTime, Marked, SearchFilterSelects, SenderFilterSelect } from "./SessionSearchParts";
import { SESSION_SEARCH_PAGE } from "../lib/sessionSearchPage";
import type { SessionSearchHosts } from "../lib/useSessionSearchHosts";


const targetOf = (hostId: string, v2: ReadonlySet<string>): SearchTarget => ({ hostId, epoch: hostEpoch(useApp.getState().hosts, hostId), v2: v2.has(hostId) });

/** The 工作目录 toggle beside the search field. */
export function DirFilterButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const active = useSessionSearch((s) => s.dir !== null);
  const label = t("sidebar.sessionSearch.dirButton");
  return (
    <button type="button" data-sidebar-dir-toggle="" aria-pressed={open || active} aria-label={label} data-tip={label} onClick={onToggle} className={`inline-flex size-6 shrink-0 items-center justify-center rounded-ctl hover:bg-hover ${open || active ? "text-accent" : "text-muted"}`}>
      <FolderSearch size={14} aria-hidden />
    </button>
  );
}

/** The directory filter: which host (several in scope), the path (typed, or one of that host's agents' directories). */
export function DirFilterRow({ hosts, cwdsOf, focus, onClose }: { hosts: SessionSearchHosts; cwdsOf: (hostId: string) => string[]; focus: string; onClose: () => void }) {
  const { t } = useI18n();
  const dir = useSessionSearch((s) => s.dir);
  const result = useSessionSearch((s) => s.dirResult);
  const listId = useId();
  const firstCapable = hosts.capable.find((h) => h.id === focus)?.id ?? hosts.capable[0]?.id ?? focus;
  const [hostId, setHostId] = useState(dir?.hostId ?? firstCapable);
  const [path, setPath] = useState(dir?.path ?? "");
  // The filter was cleared / changed elsewhere (another layout's row): follow it.
  useEffect(() => {
    if (dir) {
      setHostId(dir.hostId);
      setPath(dir.path);
    }
  }, [dir]);
  const available = hosts.capable.some((h) => h.id === hostId);
  // No filter set and the picked host left (scope / offline): the picker falls back to one that can filter.
  useEffect(() => {
    if (!dir && !available && hosts.capable.length) setHostId(firstCapable);
  }, [dir, available, firstCapable, hosts.capable.length]);
  const apply = (nextHost = hostId, nextPath = path) => {
    // Only a host in scope, online and capable is asked (a suspended filter's host is not, on blur either).
    if (!hosts.capable.some((h) => h.id === nextHost)) return;
    const p = nextPath.trim();
    if (p === (dir?.path ?? "") && nextHost === (dir?.hostId ?? nextHost)) return;
    void setDirFilter(p ? { hostId: nextHost, path: p } : null, hostEpoch(useApp.getState().hosts, nextHost));
  };
  const clear = () => {
    setPath("");
    void setDirFilter(null);
    onClose();
  };
  const hostLabel = (id: string) => hosts.capable.find((h) => h.id === id)?.label ?? id;
  const status = !dir ? null : !available ? t("sidebar.sessionSearch.dirUnavailable") : result?.error ? t("sidebar.sessionSearch.dirFailed", { error: result.error }) : result && !result.ids ? t("sidebar.sessionSearch.dirLoading") : result?.incomplete ? t("sidebar.sessionSearch.dirIncomplete") : null;
  return (
    <div data-sidebar-dir-filter="" className="mx-2 mb-1.5 flex flex-col gap-1 rounded-ctl border border-border bg-surface px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-caption font-medium text-muted">{t("sidebar.sessionSearch.dirLabel")}</span>
        {hosts.multi && (
          hosts.capable.length > 1 ? (
            <select
              data-sidebar-dir-host=""
              aria-label={t("sidebar.sessionSearch.dirHost")}
              value={hostId}
              onChange={(e) => {
                setHostId(e.target.value);
                if (path.trim()) apply(e.target.value, path);
              }}
              className="ml-auto h-5 min-w-0 max-w-[50%] truncate rounded-ctl border border-border bg-background px-1 text-caption outline-none focus:border-accent"
            >
              {hosts.capable.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
            </select>
          ) : (
            <span data-sidebar-dir-host="" className="ml-auto truncate text-caption text-subtle">{hostLabel(hostId)}</span>
          )
        )}
        <button type="button" aria-label={t("sidebar.sessionSearch.dirClear")} data-tip={t("sidebar.sessionSearch.dirClear")} onClick={clear} className={`${hosts.multi ? "" : "ml-auto "}inline-flex size-5 shrink-0 items-center justify-center rounded-ctl text-subtle hover:bg-hover hover:text-foreground`}>
          <X size={12} aria-hidden />
        </button>
      </div>
      <input
        data-sidebar-dir-path=""
        list={listId}
        value={path}
        spellCheck={false}
        placeholder={t("sidebar.sessionSearch.dirPlaceholder")}
        aria-label={t("sidebar.sessionSearch.dirLabel")}
        onChange={(e) => {
          setPath(e.target.value);
          // Picked from the list: applied at once.
          if ((e.nativeEvent as InputEvent).inputType === "insertReplacementText") apply(hostId, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
          if (e.key === "Escape" && path) {
            e.stopPropagation();
            clear();
          }
        }}
        onBlur={() => apply()}
        className="h-6 min-w-0 rounded-ctl border border-border bg-background px-1.5 font-mono text-caption outline-none placeholder:font-sans placeholder:text-subtle focus:border-accent"
      />
      <datalist id={listId}>{cwdsOf(hostId).map((c) => <option key={c} value={c} />)}</datalist>
      {status && <p data-sidebar-dir-status="" className="text-caption text-subtle">{status}</p>}
    </div>
  );
}

/**
 * 查找旧任务 for the current text (the top of a search), and its results. `targets`: the hosts to search — the directory
 * filter's host when one is set, else every capable host of the scope. `scopeKey`: the sidebar drops the results when it changes.
 */
export function OldTaskSearch({ query, hosts, lookOf, scopeKey }: { query: string; hosts: SessionSearchHosts; lookOf: (hostId: string) => HostLook | undefined; scopeKey: string }) {
  const { t } = useI18n();
  const run = useSessionSearch((s) => s.run);
  const hits = useSessionSearch((s) => s.hits);
  const runHosts = useSessionSearch((s) => s.hosts);
  const dir = useSessionSearch((s) => s.dir);
  const archived = useSessionSearch((s) => s.archived);
  const choice = useSessionSearch((s) => s.choice);
  const q = query.trim();
  const dirHost = dir && hosts.capable.some((h) => h.id === dir.hostId) ? dir.hostId : null;
  // A filter whose host left the scope / went offline is suspended: the search goes to the capable hosts in view.
  const pool = dirHost ? [dirHost] : hosts.capable.map((h) => h.id);
  // 已归档: owner connections only (cutex answers owner_required otherwise).
  const ownerPool = pool.filter((id) => hosts.owner.has(id));
  const canArchived = ownerPool.length > 0;
  const retired = archived && canArchived;
  const targets = retired ? ownerPool : pool;
  const status = taskSearchStatus(runHosts);
  // Newest first (owner 2026-11-26), over what has been found so far.
  const sorted = useMemo(() => newestFirst(hits), [hits]);
  const showAction = q !== "" && targets.length > 0 && (!run || run.q !== q || run.retired !== retired);
  if (!showAction && !run) return null;
  // 在页面中查找: the search page with this text (and 已归档 / the directory filter's host), its own search.
  const popOut = () => useApp.getState().openPage(SESSION_SEARCH_PAGE, { q: run && !showAction ? run.q : q, ...(retired ? { archived: "1" } : {}), ...(dirHost ? { host: dirHost } : {}) });
  const popOutButton = (
    <button type="button" data-old-tasks-popout="" aria-label={t("sidebar.sessionSearch.popOut")} data-tip={t("sidebar.sessionSearch.popOut")} onClick={popOut} className="inline-flex size-5 shrink-0 items-center justify-center rounded-ctl text-subtle hover:bg-hover hover:text-foreground">
      <PanelRightOpen size={12} aria-hidden />
    </button>
  );
  // 发送方 / 类型 / 时间 (owner 2026-11-26; cutex r297 session-search-v2): working on v2 hosts (a set filter leaves the
  // others out, named in the footer); without any v2 host 发送方 stays greyed with why. A change searches again.
  const anyV2 = targets.some((id) => hosts.v2.has(id));
  const startWith = (text: string, next: SearchFilterChoice) =>
    startTaskSearch({ q: text, targets: targets.map((id) => targetOf(id, hosts.v2)), cwd: dirHost ? dir!.path : null, retired, filters: anyV2 ? filtersOf(next) : null, key: scopeKey });
  const filterRow = anyV2 ? (
    <div data-old-tasks-filters="" className="flex min-w-0 items-center gap-1 px-2">
      <SearchFilterSelects
        choice={choice}
        selectClass="h-5 flex-1"
        onChange={(next) => {
          setSearchChoice(next);
          if (run) startWith(run.q, next);
        }}
      />
    </div>
  ) : (
    <div data-old-tasks-sender="" className="flex items-center gap-1.5 px-2">
      <span className="text-caption text-subtle">{t("sidebar.sessionSearch.sender")}</span>
      <SenderFilterSelect className="min-w-0 [&>select]:h-5" />
    </div>
  );
  const start = () => startWith(q, choice);
  // 已归档 (owner connections): beside the action, or in the results' header once searched (switching drops the results).
  const archivedToggle = canArchived && (
    <button type="button" data-old-tasks-archived="" aria-pressed={archived} data-tip={t("sidebar.sessionSearch.archivedHint")} onClick={() => setArchivedSearch(!archived)} className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-ctl px-1.5 text-caption ${archived ? "bg-accent/10 text-accent" : "text-subtle hover:bg-hover"}`}>
      <Archive size={12} aria-hidden />
      {t("sidebar.sessionSearch.archived")}
    </button>
  );
  return (
    <section data-old-tasks="" className="mb-1.5 flex flex-col gap-0.5 border-b border-border pb-1.5">
      {showAction && (
        <div className="flex items-center gap-1">
          <button type="button" data-old-tasks-start="" onClick={start} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-ctl px-2 py-1 text-left text-ui text-accent hover:bg-hover">
            <History size={14} aria-hidden className="shrink-0" />
            <span className="truncate">{t("sidebar.sessionSearch.findOld", { q })}</span>
          </button>
          {archivedToggle}
          {popOutButton}
        </div>
      )}
      {filterRow}
      {run && (
        <div data-old-tasks-results="" className="flex flex-col">
          <div className="flex items-center gap-1 px-2 pt-1">
            <span className="min-w-0 flex-1 truncate text-caption font-semibold text-muted">{t(run.retired ? "sidebar.sessionSearch.resultsArchived" : "sidebar.sessionSearch.results", { q: run.q })}</span>
            {hits.length > 0 && <span className="text-caption text-subtle tabular-nums">{hits.length}</span>}
            {!showAction && archivedToggle}
            {!showAction && popOutButton}
            <button type="button" data-old-tasks-close="" aria-label={t("sidebar.sessionSearch.close")} data-tip={t("sidebar.sessionSearch.close")} onClick={clearTaskSearch} className="inline-flex size-5 items-center justify-center rounded-ctl text-subtle hover:bg-hover hover:text-foreground">
              <X size={12} aria-hidden />
            </button>
          </div>
          <ul role="list" className="flex flex-col">
            {sorted.map((hit) => <OldTaskRow key={hit.key} hit={hit} q={run.q} host={hosts.multi ? lookOf(hit.connectionId) : undefined} />)}
          </ul>
          <OldTaskFooter status={status} empty={hits.length === 0} failedLabel={status.failed.map((id) => lookOf(id)?.label ?? id).join("、")} skippedLabel={run.skipped.map((id) => lookOf(id)?.label ?? id).join("、")} />
        </div>
      )}
    </section>
  );
}

function OldTaskFooter({ status, empty, failedLabel, skippedLabel }: { status: ReturnType<typeof taskSearchStatus>; empty: boolean; failedLabel: string; skippedLabel: string }) {
  const { t } = useI18n();
  return (
    <div data-old-tasks-status="" className="flex flex-col gap-0.5 px-2 pb-1 text-caption text-subtle" aria-live="polite">
      {status.pending && (
        <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" aria-hidden />{t("sidebar.sessionSearch.searching")}</span>
      )}
      {!status.pending && status.more && (
        <button type="button" data-old-tasks-more="" onClick={continueTaskSearch} className="self-start rounded-ctl py-0.5 text-accent hover:underline">{t("sidebar.sessionSearch.more")}</button>
      )}
      {/* Empty only once every host has no cursor left. */}
      {status.complete && empty && !status.failed.length && <span data-old-tasks-none="">{t("sidebar.sessionSearch.none")}</span>}
      {status.partial && <span data-old-tasks-partial="">{t("sidebar.sessionSearch.partial")}</span>}
      {status.failed.length > 0 && <span data-old-tasks-failed="">{t("sidebar.sessionSearch.failed", { hosts: failedLabel })}</span>}
      {skippedLabel && <span data-old-tasks-skipped="">{t("sidebar.sessionSearch.skipped", { hosts: skippedLabel })}</span>}
    </div>
  );
}

function OldTaskRow({ hit, q, host }: { hit: TaskHit; q: string; host: HostLook | undefined }) {
  const { t } = useI18n();
  const open = async () => {
    const result = await openTaskHit(hit);
    if (result.status === "host-offline") useApp.getState().notify(t("sidebar.sessionSearch.hostOffline"), "error");
  };
  const title = hit.title.trim() || t("sidebar.sessionSearch.untitled");
  const at = hitTurnMs(hit);
  return (
    <li>
      <button type="button" data-old-task={hit.key} onClick={() => void open()} className="flex w-full min-w-0 flex-col gap-0.5 rounded-ctl px-2 py-1 text-left hover:bg-hover">
        <span className="line-clamp-2 break-words text-ui font-medium" data-old-task-title=""><Marked text={title} q={q} /></span>
        {snippetAdds(hit.title, hit.snippet) && <span className="line-clamp-2 break-words text-caption text-muted" data-old-task-snippet=""><Marked text={hit.snippet} q={q} /></span>}
        <span className="flex min-w-0 items-center gap-1 text-caption text-subtle">
          <span className="truncate">{hit.displayName}</span>
          {host && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ backgroundColor: host.color }} aria-hidden />
              <span className="truncate">{host.label}</span>
            </>
          )}
          {hit.lifecycle === "retired" && <span className="shrink-0 rounded px-1 ring-1 ring-border">{t("sidebar.sessionSearch.archived")}</span>}
          {hit.turnStatus !== "completed" && <span className="shrink-0">{t(hit.turnStatus === "failed" ? "sidebar.sessionSearch.turnFailed" : "sidebar.sessionSearch.turnInterrupted")}</span>}
          <HitBadges hit={hit} />
          {at !== null && <HitTime ms={at} className="ml-auto pl-1" />}
        </span>
      </button>
    </li>
  );
}
