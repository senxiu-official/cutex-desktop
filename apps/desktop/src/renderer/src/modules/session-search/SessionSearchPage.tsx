// 查找旧任务 as a page (owner 2026-11-26; opened from the sidebar's 在页面中查找): a search of its own over the old-task
// search (cutex session-search-v1, lib/sessionSearchStore createTaskSearch), loosely like an IDE's Find in Files:
// - the text and filters on top: host, project, agent (cutex `sessionId`), 已归档; time, kind and sender (cutex r297
//   session-search-v2 hosts: applied by the host, a set one leaves v1 hosts out and names them; with no v2 host in the
//   search they stay greyed, the reason in the tip — components/SessionSearchParts);
// - the results newest first, flat or by agent; the selected one's turn on the right (history-turn-read, plain text,
//   the searched words marked) with 打开对话 at that turn (lib/jump through openTaskHit);
// - keys: Enter searches from the field, ↓ goes to the results; ↑↓ / Home / End select, Enter opens, Esc returns.
// The project filter: the host applies it on v2 (`projectId`); on v1 hosts it narrows the results found so far.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Archive, Loader2, Search } from "lucide-react";
import { useI18n } from "../../i18n";
import { formatAbsolute } from "../../lib/time";
import { apiFor } from "../../bridge";
import { featuresOf, useApp } from "../../store";
import { hostEpoch } from "../../../../shared/hosts";
import { HISTORY_TURN_READ_FEATURE, type SearchTurnPreview } from "../../../../shared/sessionSearch";
import { openModifiers } from "../../lib/openModifiers";
import { createTaskSearch, openTaskHit, taskSearchStatus, type TaskHit } from "../../lib/sessionSearchStore";
import { filtersOf, groupByAgent, hitTurnMs, newestFirst, NO_FILTERS, snippetAdds, type SearchFilterChoice } from "../../lib/sessionSearchView";
import { searchPageParams, type SearchLayout } from "../../lib/sessionSearchPage";
import { useSessionSearchHosts } from "../../lib/useSessionSearchHosts";
import { useScopedSidebar } from "../../lib/scopedSidebarView";
import { hostKey } from "../../lib/hostKeys";
import { GreyedFilter, HitBadges, HitTime, Marked, SearchFilterSelects, SenderFilterSelect } from "../../components/SessionSearchParts";
import { SearchableSelect, type SearchablePickerOption } from "../../components/SearchablePicker";
import { Segmented } from "../../components/settings/Form";
import type { PageParams } from "../slots";

type Preview = { state: "loading" } | { state: "ok"; turn: SearchTurnPreview } | { state: "missing" } | { state: "unsupported" } | { state: "error"; error: string };

const INDEPENDENT = "-";

export function SessionSearchPage({ params }: { params: PageParams }) {
  const { t } = useI18n();
  const search = useMemo(createTaskSearch, []);
  useEffect(() => () => search.clear(), [search]);
  const run = search.useStore((s) => s.run);
  const hits = search.useStore((s) => s.hits);
  const runHosts = search.useStore((s) => s.hosts);
  const scoped = useScopedSidebar({ reachableOnly: true });
  const { hosts } = useSessionSearchHosts(scoped, scoped.scope.multi);
  const focus = scoped.scope.focus;

  const [text, setText] = useState(() => searchPageParams(params).q);
  const [host, setHost] = useState(() => searchPageParams(params).host);
  const [archived, setArchived] = useState(() => searchPageParams(params).archived);
  const [project, setProject] = useState("");
  const [agent, setAgent] = useState("");
  const [layout, setLayout] = useState<SearchLayout>("time");
  const [choice, setChoice] = useState<SearchFilterChoice>(NO_FILTERS);
  const [selected, setSelected] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  // A search to start once the hosts are known (opened with text; filters changed after a search).
  const [pending, setPending] = useState<string | null>(() => searchPageParams(params).q || null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Opened again from the sidebar with other text: that search.
  useEffect(() => {
    const p = searchPageParams(params);
    setText(p.q);
    setHost(p.host);
    setArchived(p.archived);
    if (p.q) setPending(p.q);
  }, [params.q, params.host, params.archived]); // eslint-disable-line react-hooks/exhaustive-deps

  // The agents of the view (agent filter, project of a result).
  const agents = useMemo(() => {
    const out = new Map<string, { name: string; hostId: string; id: string; project: string; projectName: string }>();
    for (const g of scoped.model.groups) {
      for (const r of [...g.online, ...g.offline]) {
        const h = r.hostId ?? focus;
        out.set(hostKey(h, r.id), { name: r.name, hostId: h, id: r.id, project: g.kind === "project" ? hostKey(g.hostId ?? focus, g.id) : INDEPENDENT, projectName: g.kind === "project" ? g.name : t("session-search.noProject") });
      }
    }
    for (const r of scoped.model.chats) {
      const h = r.hostId ?? focus;
      out.set(hostKey(h, r.id), { name: r.name, hostId: h, id: r.id, project: INDEPENDENT, projectName: t("session-search.noProject") });
    }
    return out;
  }, [scoped.model, focus, t]);

  const capable = hosts.capable.map((h) => h.id);
  const lookOf = (id: string) => hosts.capable.find((h) => h.id === id);
  const agentRef = agent ? agents.get(agent) ?? null : null;
  // A project is one host's (its key is [host, project id]).
  const projectRef = project && project !== INDEPENDENT ? (JSON.parse(project) as [string, string]) : null;
  const pool = agentRef ? [agentRef.hostId] : projectRef && capable.includes(projectRef[0]) ? [projectRef[0]] : host && capable.includes(host) ? [host] : capable;
  const ownerPool = pool.filter((id) => hosts.owner.has(id));
  const canArchived = ownerPool.length > 0;
  const retired = archived && canArchived;
  const targets = (retired ? ownerPool : pool).filter((id) => capable.includes(id));
  const anyV2 = targets.some((id) => hosts.v2.has(id));
  // The host applies the project on v2 (and the rows say theirs); otherwise it narrows what was found.
  const serverProject = projectRef && hosts.v2.has(projectRef[0]) ? projectRef[1] : null;

  const start = (q: string) => {
    if (!q.trim() || targets.length === 0) return;
    setSelected(null);
    const filters = anyV2 ? { ...filtersOf(choice), ...(serverProject ? { projectId: serverProject } : {}) } : null;
    search.start({ q, targets: targets.map((id) => ({ hostId: id, epoch: hostEpoch(useApp.getState().hosts, id), v2: hosts.v2.has(id) })), retired, sessionId: retired ? null : (agentRef?.id ?? null), filters });
  };
  useEffect(() => {
    if (pending && targets.length > 0) {
      setPending(null);
      start(pending);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps -- runs once the hosts are known
  // A changed host / project / agent / 已归档 / v2 filter searches the same text again.
  const filterKey = JSON.stringify([host, project, agent, retired, anyV2 ? choice : null]);
  const lastFilter = useRef(filterKey);
  useEffect(() => {
    if (lastFilter.current === filterKey) return;
    lastFilter.current = filterKey;
    if (run) setPending(run.q);
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A v2 row says its project (null: none or unavailable); a v1 row's comes from the sidebar.
  const projectOf = (h: TaskHit) => (h.projectId !== undefined ? (h.projectId === null ? INDEPENDENT : hostKey(h.connectionId, h.projectId)) : (agents.get(hostKey(h.connectionId, h.cutexSessionId))?.project ?? null));
  const sorted = useMemo(() => newestFirst(hits), [hits]);
  const visible = useMemo(() => (project ? sorted.filter((h) => projectOf(h) === project) : sorted), [sorted, project, agents]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => (layout === "agent" ? groupByAgent(visible) : null), [layout, visible]);
  const order = groups ? groups.flatMap((g) => g.hits) : visible;
  const current = order.find((h) => h.key === selected) ?? null;
  // The first result is selected (and previewed) as results come in.
  useEffect(() => {
    if (!current && order.length > 0) setSelected(order[0]!.key);
  }, [current, order]);

  // The selected result's turn (one read per result; history-turn-read hosts only).
  useEffect(() => {
    if (!current || previews[current.key]) return;
    const hit = current;
    const set = (p: Preview) => setPreviews((all) => ({ ...all, [hit.key]: p }));
    if (!featuresOf(useApp.getState(), hit.connectionId).has(HISTORY_TURN_READ_FEATURE)) return set({ state: "unsupported" });
    set({ state: "loading" });
    apiFor(hit.connectionId)
      .sessionSearchTurn(hit.cutexSessionId, hit.turnId)
      .then((turn) => set(turn ? { state: "ok", turn } : { state: "missing" }), (e: unknown) => set({ state: "error", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }));
  }, [current, previews]);
  // A result's time: the host's (proposed turn times) or the preview's turn once read.
  const timeOf = (h: TaskHit) => {
    const own = hitTurnMs(h);
    if (own !== null) return own;
    const p = previews[h.key];
    return p?.state === "ok" && p.turn.startedAt ? p.turn.startedAt * 1000 : null;
  };

  const open = async (hit: TaskHit, beside = false) => {
    const result = await openTaskHit(hit, { beside });
    if (result.status === "host-offline") useApp.getState().notify(t("sidebar.sessionSearch.hostOffline"), "error");
  };
  const move = (to: number) => {
    const next = order[Math.max(0, Math.min(order.length - 1, to))];
    if (!next) return;
    setSelected(next.key);
    list.current?.querySelector(`[data-search-result="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const at = current ? order.indexOf(current) : -1;
  const onListKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(order.length - 1);
    else if (e.key === "Enter" && current) void open(current);
    else if (e.key === "Escape") field.current?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const status = taskSearchStatus(runHosts);
  const projectOptions: SearchablePickerOption[] = [
    { value: "", label: t("session-search.allProjects"), group: "" },
    ...scoped.model.groups.filter((g) => g.kind === "project").map((g) => ({ value: hostKey(g.hostId ?? focus, g.id), label: g.name, group: hosts.multi ? (lookOf(g.hostId ?? focus)?.label ?? "") : "" })),
    { value: INDEPENDENT, label: t("session-search.noProject"), group: "" },
  ];
  const agentOptions: SearchablePickerOption[] = [
    { value: "", label: t("session-search.allAgents"), group: "" },
    ...[...agents.entries()].filter(([, a]) => capable.includes(a.hostId) && (!host || a.hostId === host) && (!project || a.project === project)).map(([key, a]) => ({ value: key, label: a.name, group: hosts.multi ? `${a.projectName} · ${lookOf(a.hostId)?.label ?? a.hostId}` : a.projectName })),
  ];
  const noTime = visible.some((h) => hitTurnMs(h) === null);
  const skippedLabel = run ? run.skipped.map((id) => lookOf(id)?.label ?? id).join("、") : "";
  const failedLabel = status.failed.map((id) => lookOf(id)?.label ?? id).join("、");

  const row = (hit: TaskHit) => {
    const look = hosts.multi ? lookOf(hit.connectionId) : undefined;
    const ms = timeOf(hit);
    const on = hit.key === current?.key;
    return (
      <div
        key={hit.key}
        id={`search-result-${hit.key}`}
        role="option"
        aria-selected={on}
        data-search-result={hit.key}
        // Ctrl/⌘ + click, middle click: opened beside the focused agent (a plain click previews it here).
        onClick={(e) => (openModifiers(e).newInstance ? void open(hit, true) : setSelected(hit.key))}
        onAuxClick={(e) => e.button === 1 && void open(hit, true)}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onDoubleClick={() => void open(hit)}
        className={`flex min-w-0 cursor-default flex-col gap-0.5 rounded-ctl px-2 py-1.5 ${on ? "bg-accent/10" : "hover:bg-hover"}`}
      >
        <span className="truncate text-ui font-medium"><Marked text={hit.title.trim() || t("sidebar.sessionSearch.untitled")} q={run?.q ?? ""} /></span>
        {snippetAdds(hit.title, hit.snippet) && <span className="truncate text-caption text-muted"><Marked text={hit.snippet} q={run?.q ?? ""} /></span>}
        <span className="flex min-w-0 items-center gap-1 text-caption text-subtle">
          {!groups && <span className="truncate">{hit.displayName}</span>}
          {look && (
            <>
              {!groups && <span aria-hidden>·</span>}
              <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ backgroundColor: look.color }} aria-hidden />
              <span className="truncate">{look.label}</span>
            </>
          )}
          {hit.lifecycle === "retired" && <span className="shrink-0 rounded px-1 ring-1 ring-border">{t("sidebar.sessionSearch.archived")}</span>}
          {hit.turnStatus !== "completed" && <span className="shrink-0">{t(hit.turnStatus === "failed" ? "sidebar.sessionSearch.turnFailed" : "sidebar.sessionSearch.turnInterrupted")}</span>}
          <HitBadges hit={hit} />
          {ms !== null && <HitTime ms={ms} className="ml-auto pl-1" />}
        </span>
      </div>
    );
  };

  return (
    <div data-session-search-page="" className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-4 py-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(text);
        }}
      >
        <input
          ref={field}
          autoFocus
          data-search-query=""
          value={text}
          maxLength={128}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && order.length) {
              e.preventDefault();
              list.current?.focus();
            }
          }}
          placeholder={t("session-search.query")}
          aria-label={t("session-search.query")}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-ui outline-none placeholder:text-subtle focus:border-accent"
        />
        <button type="submit" data-search-start="" disabled={!text.trim() || targets.length === 0} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-ui text-on-accent disabled:opacity-50">
          <Search size={14} aria-hidden />
          {t("session-search.search")}
        </button>
      </form>
      <div data-search-filters="" className="flex flex-wrap items-center gap-1.5">
        {hosts.multi && hosts.capable.length > 1 && (
          <select data-search-host="" aria-label={t("session-search.allHosts")} value={host} onChange={(e) => { setHost(e.target.value); setAgent(""); }} className="h-7 rounded-md border border-border bg-background px-1.5 text-caption outline-none focus:border-accent">
            <option value="">{t("session-search.allHosts")}</option>
            {hosts.capable.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        )}
        <span data-search-project="" data-tip={t("session-search.projectHint")} className="inline-flex">
          <SearchableSelect value={project} label={t("session-search.allProjects")} width="w-40" triggerClassName="flex h-7 w-40 items-center justify-between gap-1 rounded-md border border-border bg-background px-1.5 text-caption" options={projectOptions} placeholder={t("session-search.allProjects")} emptyLabel={t("session-search.noAgents")} onChange={(v) => { setProject(v); setAgent(""); }} />
        </span>
        <span data-search-agent="" className="inline-flex">
          <SearchableSelect value={retired ? "" : agent} disabled={retired} label={t("session-search.allAgents")} width="w-44" triggerClassName="flex h-7 w-44 items-center justify-between gap-1 rounded-md border border-border bg-background px-1.5 text-caption disabled:opacity-50" options={agentOptions} placeholder={t("session-search.searchAgents")} emptyLabel={t("session-search.noAgents")} onChange={setAgent} />
        </span>
        {anyV2 ? (
          <>
            <SearchFilterSelects choice={choice} onChange={setChoice} custom selectClass="h-7 rounded-md px-1.5" />
            {choice.time === "custom" && (
              <span data-search-range="" className="inline-flex items-center gap-1 text-caption text-subtle">
                <input type="date" data-search-from="" aria-label={t("session-search.from")} value={choice.from ?? ""} max={choice.to || undefined} onChange={(e) => setChoice({ ...choice, from: e.target.value || undefined })} className="h-7 rounded-md border border-border bg-background px-1 text-caption outline-none focus:border-accent" />
                <span aria-hidden>–</span>
                <input type="date" data-search-to="" aria-label={t("session-search.to")} value={choice.to ?? ""} min={choice.from || undefined} onChange={(e) => setChoice({ ...choice, to: e.target.value || undefined })} className="h-7 rounded-md border border-border bg-background px-1 text-caption outline-none focus:border-accent" />
              </span>
            )}
          </>
        ) : (
          <>
            <GreyedFilter data="time" label={t("session-search.anyTime")} tip={t("session-search.timeUnavailable")} options={[t("session-search.anyTime")]} className="[&>select]:h-7" />
            <GreyedFilter data="kind" label={t("session-search.allKinds")} tip={t("session-search.kindUnavailable")} options={[t("session-search.allKinds")]} className="[&>select]:h-7" />
            <SenderFilterSelect className="[&>select]:h-7" />
          </>
        )}
        {canArchived && (
          <button type="button" data-search-archived="" aria-pressed={archived} data-tip={t("sidebar.sessionSearch.archivedHint")} onClick={() => setArchived((v) => !v)} className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-caption ${archived ? "bg-accent/10 text-accent" : "text-subtle hover:bg-hover"}`}>
            <Archive size={12} aria-hidden />
            {t("sidebar.sessionSearch.archived")}
          </button>
        )}
        <span className="ml-auto" />
        <Segmented<SearchLayout> label={t("session-search.layout")} value={layout} onChange={setLayout} options={[{ value: "time", label: t("session-search.byTime") }, { value: "agent", label: t("session-search.byAgent") }]} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,2fr)_minmax(0,3fr)] gap-3">
        <section className="flex min-h-0 flex-col rounded-md border border-border">
          <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-caption text-subtle">
            <span className="shrink-0 whitespace-nowrap tabular-nums" data-search-count="">{run ? t("session-search.count", { n: visible.length }) : ""}</span>
            {run && noTime && <span className="min-w-0 truncate" data-search-order-note="" data-tip={t("sidebar.sessionSearch.orderHint")}>{t("sidebar.sessionSearch.orderHint")}</span>}
            {/* v2 hosts visit agents by last update, not every turn in time order: more pages can bring newer ones. */}
            {run && !noTime && anyV2 && status.more && <span className="min-w-0 truncate" data-search-order-note="partial" data-tip={t("session-search.orderPartial")}>{t("session-search.orderPartial")}</span>}
          </div>
          <div ref={list} tabIndex={0} role="listbox" aria-label={t("session-search.results")} aria-activedescendant={current ? `search-result-${current.key}` : undefined} data-search-results="" onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
            {!run && <p className="px-2 py-6 text-center text-ui text-subtle">{targets.length === 0 ? t("session-search.noHosts") : t("session-search.start")}</p>}
            {groups
              ? groups.map((g) => {
                  const first = g.hits[0]!;
                  return (
                    <div key={g.key} role="group" aria-label={first.displayName} data-search-group={g.key} className="mb-1">
                      <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5 text-caption font-semibold text-muted">
                        <span className="truncate">{first.displayName}</span>
                        <span className="tabular-nums text-subtle">{g.hits.length}</span>
                      </div>
                      {g.hits.map(row)}
                    </div>
                  );
                })
              : visible.map(row)}
          </div>
          <div data-search-status="" aria-live="polite" className="flex flex-col gap-0.5 border-t border-border px-2 py-1 text-caption text-subtle">
            {status.pending && <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" aria-hidden />{t("sidebar.sessionSearch.searching")}</span>}
            {run && !status.pending && status.more && <button type="button" data-search-more="" onClick={search.more} className="self-start text-accent hover:underline">{t("sidebar.sessionSearch.more")}</button>}
            {run && status.complete && visible.length === 0 && !status.failed.length && <span>{t("sidebar.sessionSearch.none")}</span>}
            {status.partial && <span>{t("sidebar.sessionSearch.partial")}</span>}
            {status.failed.length > 0 && <span>{t("sidebar.sessionSearch.failed", { hosts: failedLabel })}</span>}
            {skippedLabel && <span data-search-skipped="">{t("sidebar.sessionSearch.skipped", { hosts: skippedLabel })}</span>}
            <span className="text-subtle/80">{t("session-search.keys")}</span>
          </div>
        </section>
        <SearchPreview hit={current} q={run?.q ?? ""} preview={current ? previews[current.key] : undefined} hostLabel={current && hosts.multi ? lookOf(current.connectionId)?.label : undefined} onOpen={open} />
      </div>
    </div>
  );
}

function SearchPreview({ hit, q, preview, hostLabel, onOpen }: { hit: TaskHit | null; q: string; preview: Preview | undefined; hostLabel: string | undefined; onOpen(hit: TaskHit): void }) {
  const { t } = useI18n();
  const body = useRef<HTMLDivElement>(null);
  // The first marked word in view once the turn shows.
  useEffect(() => {
    body.current?.querySelector("mark")?.scrollIntoView({ block: "center" });
  }, [preview]);
  if (!hit) return <section data-search-preview="" className="flex items-center justify-center rounded-md border border-border text-ui text-subtle">{t("session-search.pick")}</section>;
  const turn = preview?.state === "ok" ? preview.turn : null;
  const ms = hitTurnMs(hit) ?? (turn?.startedAt ? turn.startedAt * 1000 : null);
  const excerpt = (
    <div className="flex flex-col gap-2">
      <p className="whitespace-pre-wrap break-words text-ui font-medium"><Marked text={hit.title.trim() || t("sidebar.sessionSearch.untitled")} q={q} /></p>
      {snippetAdds(hit.title, hit.snippet) && <p className="whitespace-pre-wrap break-words text-ui text-muted"><Marked text={hit.snippet} q={q} /></p>}
    </div>
  );
  return (
    <section data-search-preview={hit.key} className="flex min-h-0 flex-col rounded-md border border-border">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-semibold">{hit.displayName}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-caption text-subtle [&>span]:whitespace-nowrap">
            {hostLabel && <span className="truncate">{hostLabel}</span>}
            {hostLabel && ms !== null && <span aria-hidden>·</span>}
            {ms !== null && <span data-search-preview-time="">{t("session-search.startedAt", { time: formatAbsolute(ms / 1000) })}</span>}
            {hit.matchedIn && <><span aria-hidden>·</span><span data-search-matched={hit.matchedIn}>{t(`session-search.matched.${hit.matchedIn}` as const)}</span></>}
          </span>
        </div>
        <button type="button" data-search-open="" data-tip={t("session-search.openHint")} onClick={() => onOpen(hit)} className="inline-flex h-7 shrink-0 items-center rounded-md bg-accent px-2.5 text-ui text-on-accent">
          {t("session-search.open")}
        </button>
      </header>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {(!preview || preview.state === "loading") && <p className="inline-flex items-center gap-1 text-caption text-subtle"><Loader2 size={12} className="animate-spin" aria-hidden />{t("session-search.loading")}</p>}
        {preview?.state === "unsupported" && <><p className="mb-2 text-caption text-subtle">{t("session-search.excerptOnly")}</p>{excerpt}</>}
        {preview?.state === "missing" && <><p className="mb-2 text-caption text-subtle">{t("session-search.missing")}</p>{excerpt}</>}
        {preview?.state === "error" && <><p className="mb-2 text-caption text-danger">{t("session-search.failed", { error: preview.error })}</p>{excerpt}</>}
        {turn && (
          <div className="flex flex-col gap-3" data-search-turn="">
            {turn.messages.length === 0 && excerpt}
            {turn.messages.map((m, i) => (
              <div key={i} data-search-message={m.role} className="flex flex-col gap-0.5">
                <span className="text-caption font-semibold text-muted">{t(m.role === "input" ? "session-search.input" : "session-search.reply")}</span>
                <p className="whitespace-pre-wrap break-words text-ui"><Marked text={m.text} q={q} /></p>
              </div>
            ))}
            {turn.truncated && <p className="text-caption text-subtle">{t("session-search.cut")}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
