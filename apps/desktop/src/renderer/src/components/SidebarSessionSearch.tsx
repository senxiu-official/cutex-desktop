// The sidebar's session search controls (harness C3, cutex r295 session-search-v1; state and paging in
// lib/sessionSearchStore): the 工作目录 field of the 筛选 panel (components/SidebarSearchFilters), the
// 「在消息记录里搜「…」」 row at the top of a search, and its results (design A, owner 2026-11-27).
// Only hosts with the capability get any of it; without one the sidebar search stays name / preview only.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { History, Loader2, X } from "lucide-react";
import { useI18n } from "../i18n";
import { useApp } from "../store";
import { openModifiers } from "../lib/openModifiers";
import type { HostLook } from "../lib/hostScope";
import {
  continueTaskSearch,
  clearTaskSearch,
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
import { HitBadges, HitTime, Marked } from "./SessionSearchParts";
import { SESSION_SEARCH_PAGE } from "../lib/sessionSearchPage";
import type { SessionSearchHosts } from "../lib/useSessionSearchHosts";


const targetOf = (hostId: string, v2: ReadonlySet<string>): SearchTarget => ({ hostId, epoch: hostEpoch(useApp.getState().hosts, hostId), v2: v2.has(hostId) });

/**
 * The directory filter in the 筛选 panel (its group names it): which host (several in scope), the path (typed, or one of
 * that host's agents' directories); × clears it while one is set.
 */
export function DirFilterRow({ hosts, cwdsOf, focus }: { hosts: SessionSearchHosts; cwdsOf: (hostId: string) => string[]; focus: string }) {
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
  };
  const hostLabel = (id: string) => hosts.capable.find((h) => h.id === id)?.label ?? id;
  const status = !dir ? null : !available ? t("sidebar.sessionSearch.dirUnavailable") : result?.error ? t("sidebar.sessionSearch.dirFailed", { error: result.error }) : result && !result.ids ? t("sidebar.sessionSearch.dirLoading") : result?.incomplete ? t("sidebar.sessionSearch.dirIncomplete") : null;
  return (
    <div data-sidebar-dir-filter="" className="flex flex-col gap-1">
      <div className={`flex items-center gap-1.5 ${!hosts.multi && !dir ? "hidden" : ""}`}>
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
        {dir && <button type="button" aria-label={t("sidebar.sessionSearch.dirClear")} data-tip={t("sidebar.sessionSearch.dirClear")} onClick={clear} className={`${hosts.multi ? "" : "ml-auto "}inline-flex size-5 shrink-0 items-center justify-center rounded-ctl text-subtle hover:bg-hover hover:text-foreground`}>
          <X size={12} aria-hidden />
        </button>}
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

/** At most this many message-history results in the sidebar; the rest are on the search page (owner 2026-11-27, design A). */
export const SIDEBAR_HISTORY_LIMIT = 5;

/**
 * 「在消息记录里搜「…」」 for the current text (the top of a search; design A, owner 2026-11-27) and its results: at most
 * SIDEBAR_HISTORY_LIMIT, then 「在页面中看全部 N 条」. `targets`: the hosts to search — the directory filter's host when one is
 * set, else every capable host of the scope. Its conditions (含已归档 / 发送方 / 类型 / 时间) are set in the 筛选 panel
 * (components/SidebarSearchFilters); a change searches again. `scopeKey`: the sidebar drops the results when it changes.
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
  // 含已归档: owner connections only (cutex answers owner_required otherwise).
  const ownerPool = pool.filter((id) => hosts.owner.has(id));
  const retired = archived && ownerPool.length > 0;
  const targets = retired ? ownerPool : pool;
  const status = taskSearchStatus(runHosts);
  // Newest first (owner 2026-11-26), over what has been found so far.
  const sorted = useMemo(() => newestFirst(hits), [hits]);
  const showAction = q !== "" && targets.length > 0 && (!run || run.q !== q || run.retired !== retired);
  // 发送方 / 类型 / 时间 work on session-search-v2 hosts (r297; a set filter leaves the others out, named in the footer).
  const anyV2 = targets.some((id) => hosts.v2.has(id));
  const startWith = (text: string, next: SearchFilterChoice) =>
    startTaskSearch({ q: text, targets: targets.map((id) => targetOf(id, hosts.v2)), cwd: dirHost ? dir!.path : null, retired, filters: anyV2 ? filtersOf(next) : null, key: scopeKey });
  // A condition changed in the 筛选 panel: the shown results are searched again with it.
  const seenChoice = useRef(choice);
  useEffect(() => {
    if (seenChoice.current === choice) return;
    seenChoice.current = choice;
    if (run) startWith(run.q, choice);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!showAction && !run) return null;
  // 在页面中打开: the search page with this text (and 含已归档 / the directory filter's host), its own search.
  const popOut = () => useApp.getState().openPage(SESSION_SEARCH_PAGE, { q: run && !showAction ? run.q : q, ...(retired ? { archived: "1" } : {}), ...(dirHost ? { host: dirHost } : {}) });
  const popOutLink = (
    <button type="button" data-old-tasks-popout="" data-tip={t("searchX.openPageHint")} onClick={popOut} className="shrink-0 rounded-ctl px-1 py-0.5 text-caption text-accent hover:underline">{t("searchX.openPage")}</button>
  );
  const shown = sorted.slice(0, SIDEBAR_HISTORY_LIMIT);
  const capped = sorted.length > SIDEBAR_HISTORY_LIMIT;
  return (
    <section data-old-tasks="" className="mb-1.5 flex flex-col gap-0.5 border-b border-border pb-1.5">
      {showAction && (
        <>
          <div className="flex items-center gap-1">
            <button type="button" data-old-tasks-start="" onClick={() => startWith(q, choice)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-ctl px-2 py-1 text-left text-ui text-accent hover:bg-hover">
              <History size={14} aria-hidden className="shrink-0" />
              <span className="truncate">{t("searchX.findIn", { q })}</span>
            </button>
            {popOutLink}
          </div>
          <p className="-mt-0.5 px-2 pl-[29px] text-caption text-subtle" data-old-tasks-hint="">{t(retired ? "searchX.findHintArchived" : "searchX.findHint")}</p>
        </>
      )}
      {run && (
        <div data-old-tasks-results="" className="flex flex-col">
          <div className="flex items-center gap-1 px-2 pt-1">
            <span className="min-w-0 flex-1 truncate text-caption font-semibold text-muted">{t(run.retired ? "searchX.historyArchived" : "searchX.history", { q: run.q })}</span>
            {hits.length > 0 && <span className="text-caption text-subtle tabular-nums">{hits.length}{status.more ? "+" : ""}</span>}
            {!showAction && popOutLink}
            <button type="button" data-old-tasks-close="" aria-label={t("sidebar.sessionSearch.close")} data-tip={t("sidebar.sessionSearch.close")} onClick={clearTaskSearch} className="inline-flex size-5 items-center justify-center rounded-ctl text-subtle hover:bg-hover hover:text-foreground">
              <X size={12} aria-hidden />
            </button>
          </div>
          <ul role="list" className="flex flex-col">
            {shown.map((hit) => <OldTaskRow key={hit.key} hit={hit} q={run.q} host={hosts.multi ? lookOf(hit.connectionId) : undefined} />)}
          </ul>
          {capped && (
            <button type="button" data-old-tasks-all="" onClick={popOut} className="self-start rounded-ctl px-2 py-0.5 text-caption text-accent hover:underline">
              {t(status.more ? "searchX.seeAllMore" : "searchX.seeAll", { n: sorted.length })}
            </button>
          )}
          <OldTaskFooter status={status} capped={capped} empty={hits.length === 0} failedLabel={status.failed.map((id) => lookOf(id)?.label ?? id).join("、")} skippedLabel={run.skipped.map((id) => lookOf(id)?.label ?? id).join("、")} />
        </div>
      )}
    </section>
  );
}

/** `capped`: more than the sidebar shows were found — 继续查找 belongs to the page then (the link above). */
function OldTaskFooter({ status, capped, empty, failedLabel, skippedLabel }: { status: ReturnType<typeof taskSearchStatus>; capped: boolean; empty: boolean; failedLabel: string; skippedLabel: string }) {
  const { t } = useI18n();
  return (
    <div data-old-tasks-status="" className="flex flex-col gap-0.5 px-2 pb-1 text-caption text-subtle" aria-live="polite">
      {status.pending && (
        <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" aria-hidden />{t("sidebar.sessionSearch.searching")}</span>
      )}
      {!status.pending && status.more && !capped && (
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
  // Ctrl/⌘ + click, middle click: beside the focused agent, as on the agent rows.
  const open = async (e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; button?: number }) => {
    const result = await openTaskHit(hit, { beside: !!e && openModifiers(e).newInstance });
    if (result.status === "host-offline") useApp.getState().notify(t("sidebar.sessionSearch.hostOffline"), "error");
  };
  const title = hit.title.trim() || t("sidebar.sessionSearch.untitled");
  const at = hitTurnMs(hit);
  return (
    <li>
      <button type="button" data-old-task={hit.key} onClick={(e) => void open(e)} onAuxClick={(e) => e.button === 1 && void open(e)} onMouseDown={(e) => e.button === 1 && e.preventDefault()} className="flex w-full min-w-0 flex-col gap-0.5 rounded-ctl px-2 py-1 text-left hover:bg-hover">
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
