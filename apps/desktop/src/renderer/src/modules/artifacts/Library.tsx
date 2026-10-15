// 成果库 (artifacts.library): the artifacts of the selected agent's project (or its own session scope),
// newest first — search / type / archived from cutex, producer filter and sort here, list or grid.
// A row opens the artifact following its latest version; the menu has the pinned version, the link
// and the owner's edits. 「从工作区发布…」 publishes a workspace file as the owner (POST /v2/artifact-store).
// The 项目 page's 成果库 tab (`project.tab`, §21) is the same view for one project's scope (LibraryPanel).
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowLeftRight, LayoutGrid, List, Loader2, Search, Star, Upload } from "lucide-react";
import { ARTIFACT_KINDS, artifactRef, type ArtifactKind, type ArtifactList, type ArtifactScope, type ArtifactSummary } from "../../../../shared/artifactStore";
import { useI18n } from "../../i18n";
import { contextMenu } from "../../lib/contextMenu";
import { useThumbnail } from "../../lib/fileThumbnails";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { services } from "../app";
import { agentHost, useApp } from "../../store";
import type { SideBodyProps, SideOpen } from "../slots";
import { artifactMenu, openDelegation, openVersion, refusalText } from "./actions";
import { arrangeLibrary, DEFAULT_LIBRARY, initView, parseViewParams, VIEW, type ViewState, LIBRARY_SORTS, libraryQuery, libraryScopeKey, producerLabel, producerOptions, type ArchivedFilter, type LibraryScope, type LibrarySort, type LibraryState } from "./model";
import { KIND_ICON } from "./refTarget";
import { invalidateArtifact, loadContent, useEpoch } from "./store";
import { ViewActions, ViewBody } from "./View";

const PAGE = 100;
const SELECT = "rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-accent";
const FIELD = "w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const seconds = (iso: string) => (Date.parse(iso) || 0) / 1000;

function Thumb({ hostId, a }: { hostId: string; a: ArtifactSummary }) {
  const image = a.latest.mediaType.toLowerCase().startsWith("image/");
  const { ref, state } = useThumbnail(image ? `${hostId}|artifact|${a.artifactId}@${a.latestVersion}` : null, () =>
    loadContent(hostId, a.artifactId, a.latestVersion, 2 * 1024 * 1024).then((c) => {
      if (!c) throw new Error("gone");
      return { mime: c.mediaType, encoding: c.encoding, content: c.content, size: c.totalBytes, truncated: c.truncated };
    }),
  );
  const Icon = KIND_ICON[a.kind];
  return (
    <span ref={ref} className="flex h-20 items-center justify-center overflow-hidden rounded-md bg-surface-2">
      {state.status === "ok" ? <img src={state.src} alt="" draggable={false} className="h-full w-full object-contain" /> : <Icon size={22} strokeWidth={1.5} className="text-subtle" />}
    </span>
  );
}

function Meta({ hostId, a, now }: { hostId: string; a: ArtifactSummary; now: number }) {
  const { t, locale } = useI18n();
  const p = a.latest.producer;
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11px] text-subtle">
      <span className={`min-w-0 truncate ${p.kind === "auto" && p.attribution === "ambiguous" ? "text-warn" : ""}`} title={producerLabel(p, t)}>
        {producerLabel(p, t)}
      </span>
      <span className="shrink-0">·</span>
      <span className="shrink-0" title={formatAbsolute(seconds(a.updatedAt))}>
        {formatWhen(seconds(a.updatedAt), now, locale)}
      </span>
      {p.askId && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void openDelegation(hostId, p.askId!, p.sessionId);
          }}
          title={p.askId}
          className="flex shrink-0 items-center gap-0.5 rounded bg-surface-2 px-1 text-[10.5px] hover:text-accent"
        >
          <ArrowLeftRight size={10} />
          {t("artifacts.delegation")}
        </button>
      )}
      {a.archivedAt && <span className="shrink-0 rounded bg-surface-2 px-1 text-[10.5px]">{t("artifacts.archivedTag")}</span>}
    </span>
  );
}

function Row({ hostId, a, open, layout, now }: { hostId: string; a: ArtifactSummary; open: SideOpen; layout: "list" | "grid"; now: number }) {
  const { t } = useI18n();
  const Icon = KIND_ICON[a.kind];
  const activate = () => openVersion(open, artifactRef(a.artifactId, "latest"), a.name);
  const menu = contextMenu(() => artifactMenu(hostId, a, open));
  const title = (
    <span className="flex min-w-0 items-center gap-1.5">
      {layout === "list" && <Icon size={13} className="shrink-0 text-subtle" />}
      <span className="min-w-0 truncate text-[13px] text-foreground" title={a.name}>
        {a.name}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-subtle">{t("artifacts.version", { n: a.latestVersion })}</span>
      {a.starred && <Star size={11} fill="currentColor" className="shrink-0 text-warn" aria-label={t("artifacts.starredTag")} />}
    </span>
  );
  if (layout === "grid")
    return (
      <div role="button" tabIndex={0} onClick={activate} onKeyDown={(e) => e.key === "Enter" && activate()} onContextMenu={menu} className="flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border border-border bg-surface p-1.5 hover:bg-hover">
        <Thumb hostId={hostId} a={a} />
        {title}
        <Meta hostId={hostId} a={a} now={now} />
      </div>
    );
  return (
    <div role="button" tabIndex={0} onClick={activate} onKeyDown={(e) => e.key === "Enter" && activate()} onContextMenu={menu} className="flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1 hover:bg-hover">
      {title}
      <span className="pl-[19px]">
        <Meta hostId={hostId} a={a} now={now} />
      </span>
    </div>
  );
}

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function PublishForm({ hostId, scope, open, onDone }: { hostId: string; scope: ArtifactScope; open: SideOpen; onDone(): void }) {
  const { t } = useI18n();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ArtifactKind | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One request id per form: a retry after a lost answer returns the first result (idempotent).
  const [requestId] = useState(newRequestId);
  const submit = async () => {
    if (!path.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await services.daemonFor(hostId).artifactStorePublish({
        requestId,
        ...(scope.kind === "project" ? { project: scope.id } : { session: scope.id }),
        path: path.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(kind ? { kind } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (!r.ok) {
        setError(refusalText(r.error));
        return;
      }
      const { artifact, version, newVersion } = r.published;
      invalidateArtifact(hostId, artifact.artifactId);
      services.ui.notice(t(newVersion ? "artifacts.published" : "artifacts.unchanged", { name: artifact.name, n: version.version }));
      openVersion(open, version.ref, artifact.name);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mx-2 mb-2 flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="font-medium text-foreground">{t("artifacts.publishTitle")}</div>
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-subtle">{t("artifacts.publishPath")}</span>
        <input autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder={t("artifacts.publishPathHint")} className={`${FIELD} font-mono`} />
      </label>
      <div className="flex gap-1.5">
        <label className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] text-subtle">{t("artifacts.publishName")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("artifacts.publishNameHint")} className={FIELD} />
        </label>
        <label className="flex shrink-0 flex-col gap-0.5">
          <span className="text-[11px] text-subtle">{t("artifacts.publishKind")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ArtifactKind | "")} className={`${FIELD} w-auto`}>
            <option value="">{t("artifacts.publishKindAuto")}</option>
            {ARTIFACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`artifacts.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-subtle">{t("artifacts.publishNote")}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t("artifacts.publishNoteHint")} className={`${FIELD} resize-y`} />
      </label>
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="rounded-md px-2 py-1 text-muted hover:bg-hover">
          {t("artifacts.cancel")}
        </button>
        <button type="submit" disabled={!path.trim() || busy} className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-white hover:opacity-90 disabled:opacity-50">
          {busy && <Loader2 size={12} className="animate-spin" />}
          {t("artifacts.publishSubmit")}
        </button>
      </div>
    </form>
  );
}

type Loaded = { key: string; list: ArtifactList; error?: undefined } | { key: string; list?: undefined; error: string };

export function LibraryBody({ instance, hostId, sessionId, setState, visible, open }: SideBodyProps<LibraryState>) {
  const { t } = useI18n();
  if (!hostId || !sessionId) return <p className="p-3 text-xs text-subtle">{t("artifacts.noScope")}</p>;
  return <LibraryPanel hostId={hostId} scope={{ forSession: sessionId }} state={instance.state} setState={setState} visible={visible} open={open} />;
}

const INLINE_ID = "artifacts.projectTab.inline";

/**
 * The 项目 page's 成果库 tab: the project's scope. Versions open on the right, bound to the project's
 * host — but the right side shows only the open agent's host (useSideView), so a project of another
 * host (a remote host's project while a local agent is open, or the other way round) opens its
 * versions here in the tab instead: on the side they would open invisibly.
 */
export function ProjectLibraryTab({ hostId, projectId }: { hostId: string; projectId: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<LibraryState>(DEFAULT_LIBRARY);
  const onSide = useApp(agentHost) === hostId;
  const scopeKey = `${hostId}|${projectId}`;
  const [inline, setInline] = useState<{ key: string; view: ViewState } | null>(null);
  const view = !onSide && inline?.key === scopeKey ? inline.view : null;
  const open = useMemo<SideOpen>(
    () =>
      onSide
        ? (kind, params, opts) => services.side.open(kind, params, { binding: { kind: "host", hostId }, ...opts })
        : (kind, params, opts) => {
            // Other components (对比 → the diff card) carry their content (the diff text): they open on
            // the side of the open agent's host, where they are visible.
            if (kind !== VIEW) {
              const { binding: _binding, ...rest } = opts ?? {};
              return services.side.open(kind, params, rest);
            }
            const parsed = parseViewParams(params ?? {});
            if (!parsed) return { status: "unavailable", reason: "bad-params" };
            setInline((prev) => ({ key: scopeKey, view: initView(parsed, prev?.key === scopeKey ? prev.view : null) }));
            return { status: "opened", instanceId: INLINE_ID, where: "card", pageId: null, reused: false };
          },
    [hostId, onSide, scopeKey],
  );
  if (view) {
    const props: SideBodyProps<ViewState> = {
      instance: { id: INLINE_ID, kind: VIEW, binding: { kind: "host", hostId }, state: view, pinned: true },
      hostId,
      sessionId: null,
      setState: (next) => setInline({ key: scopeKey, view: next }),
      visible: true,
      active: true,
      mode: "normal",
      where: "card",
      revealed: 0,
      close: () => setInline(null),
      open,
      keepMounted: () => false,
      held: false,
      keep: () => {},
    };
    return (
      <div className="flex h-[min(70vh,48rem)] min-h-[18rem] min-w-0 flex-col overflow-hidden rounded-lg border border-border">
        <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-1.5 py-1 text-xs">
          <button onClick={() => setInline(null)} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted hover:bg-hover hover:text-foreground">
            <ArrowLeft size={12} />
            {t("artifacts.backToLibrary")}
          </button>
          <span className="ml-auto">
            <ViewActions {...props} />
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <ViewBody {...props} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-[18rem] min-w-0 flex-col">
      <LibraryPanel hostId={hostId} scope={{ project: projectId }} state={state} setState={setState} visible open={open} emptyKey="artifacts.projectEmpty" />
    </div>
  );
}

interface PanelProps {
  hostId: string;
  scope: LibraryScope;
  state: LibraryState;
  setState(next: LibraryState): void;
  visible: boolean;
  open: SideOpen;
  /** The text for a scope without artifacts (default artifacts.empty). */
  emptyKey?: "artifacts.empty" | "artifacts.projectEmpty";
}

function LibraryPanel({ hostId, scope, state, setState, visible, open, emptyKey = "artifacts.empty" }: PanelProps) {
  const { t } = useI18n();
  const set = (patch: Partial<LibraryState>) => setState({ ...state, ...patch });
  const epoch = useEpoch(hostId);
  const q = useDebounced(state.q.trim(), 250);
  const now = useClock();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [more, setMore] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const queryKey = `${hostId}|${libraryScopeKey(scope)}|${q}|${state.kind}|${state.archived}`;
  const filter = { q, kind: state.kind, archived: state.archived };

  useEffect(() => {
    if (!visible) return;
    let live = true;
    services
      .daemonFor(hostId)
      .artifactStoreList(libraryQuery(scope, filter, PAGE))
      .then(
        (list) => live && setLoaded(list ? { key: queryKey, list } : { key: queryKey, error: t("artifacts.err.artifact_not_found") }),
        (e: unknown) => live && setLoaded({ key: queryKey, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      live = false;
    };
    // queryKey covers hostId / scope / q / kind / archived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, epoch, visible]);

  const list = loaded?.list;
  const items = useMemo(() => (list ? arrangeLibrary(list.items, state) : []), [list, state.producer, state.sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const producers = useMemo(() => producerOptions(list?.items ?? []), [list]);

  const loadMore = async () => {
    if (!list?.nextCursor || more) return;
    setMore(true);
    try {
      const next = await services.daemonFor(hostId).artifactStoreList(libraryQuery(scope, filter, PAGE, list.nextCursor));
      if (next) setLoaded({ key: queryKey, list: { ...next, items: [...list.items, ...next.items.filter((n) => !list.items.some((o) => o.artifactId === n.artifactId))] } });
    } finally {
      setMore(false);
    }
  };

  const stale = loaded && loaded.key !== queryKey;
  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <div className="flex shrink-0 flex-col gap-1.5 p-2">
        <div className="flex items-center gap-1.5">
          <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 focus-within:border-accent">
            <Search size={12} className="shrink-0 text-subtle" />
            <input
              value={state.q}
              onChange={(e) => set({ q: e.target.value.slice(0, 200) })}
              onKeyDown={(e) => {
                if (e.key === "Escape" && state.q) {
                  e.preventDefault();
                  e.stopPropagation();
                  set({ q: "" });
                }
              }}
              placeholder={t("artifacts.search")}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-subtle"
            />
          </label>
          <button onClick={() => setPublishing((v) => !v)} disabled={!list} className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-hover disabled:opacity-50 ${publishing ? "bg-surface-2 text-foreground" : "text-accent"}`}>
            <Upload size={12} />
            {t("artifacts.publish")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={state.kind} onChange={(e) => set({ kind: e.target.value as ArtifactKind | "" })} aria-label={t("artifacts.publishKind")} className={SELECT}>
            <option value="">{t("artifacts.kindAll")}</option>
            {ARTIFACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`artifacts.kind.${k}`)}
              </option>
            ))}
          </select>
          <select value={state.producer} onChange={(e) => set({ producer: e.target.value })} aria-label={t("artifacts.src.producer")} className={`${SELECT} max-w-36`}>
            <option value="">{t("artifacts.producerAll")}</option>
            {producers.map((p) => (
              <option key={p.key} value={p.key}>
                {p.kind === "auto" ? t("artifacts.producerAuto") : p.kind === "owner" ? t("artifacts.producer.owner") : p.name}
              </option>
            ))}
            {state.producer && !producers.some((p) => p.key === state.producer) && <option value={state.producer}>{state.producer.replace(/^agent:/, "")}</option>}
          </select>
          <select value={state.archived} onChange={(e) => set({ archived: e.target.value as ArchivedFilter })} aria-label={t("artifacts.archived.label")} className={SELECT}>
            {(["false", "true", "all"] as const).map((v) => (
              <option key={v} value={v}>
                {t(`artifacts.archived.${v}`)}
              </option>
            ))}
          </select>
          <select value={state.sort} onChange={(e) => set({ sort: e.target.value as LibrarySort })} aria-label={t("artifacts.sort.label")} className={SELECT}>
            {LIBRARY_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`artifacts.sort.${s}`)}
              </option>
            ))}
          </select>
          <span className="ml-auto flex items-center gap-1 text-[11px] text-subtle">
            {list && t("artifacts.count", { n: items.length })}
            <span role="group" className="ml-1 flex overflow-hidden rounded-md border border-border">
              {(["list", "grid"] as const).map((l) => {
                const Icon = l === "list" ? List : LayoutGrid;
                return (
                  <button key={l} onClick={() => set({ layout: l })} aria-pressed={state.layout === l} title={t(`artifacts.layout.${l}`)} className={`px-1 py-0.5 ${state.layout === l ? "bg-surface-2 text-foreground" : "hover:bg-hover"}`}>
                    <Icon size={12} />
                  </button>
                );
              })}
            </span>
          </span>
        </div>
      </div>
      {publishing && list && <PublishForm hostId={hostId} scope={list.scope} open={open} onDone={() => setPublishing(false)} />}
      <div className={`min-h-0 flex-1 overflow-y-auto px-1 pb-2 ${stale ? "opacity-60" : ""}`}>
        {!loaded ? (
          <p className="p-3 text-subtle">{t("artifacts.loading")}</p>
        ) : loaded.error ? (
          <p className="p-3 text-danger">{t("artifacts.loadFailed", { error: loaded.error })}</p>
        ) : !items.length ? (
          <p className="p-3 leading-relaxed text-subtle">{state.q || state.kind || state.producer || state.archived !== "false" ? t("artifacts.noMatch") : t(emptyKey)}</p>
        ) : state.layout === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5 px-1">
            {items.map((a) => (
              <Row key={a.artifactId} hostId={hostId} a={a} open={open} layout="grid" now={now} />
            ))}
          </div>
        ) : (
          items.map((a) => <Row key={a.artifactId} hostId={hostId} a={a} open={open} layout="list" now={now} />)
        )}
        {list?.nextCursor && (
          <button onClick={() => void loadMore()} disabled={more} className="mx-2 mt-1 text-accent hover:underline disabled:opacity-50">
            {t("artifacts.loadMore")}
          </button>
        )}
      </div>
    </div>
  );
}
