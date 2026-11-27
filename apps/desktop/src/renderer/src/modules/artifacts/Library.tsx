// 成果库 (artifacts.library): the artifacts of the selected agent's project (or its own session scope),
// newest first — search / type / archived from cutex, producer filter and sort here, list or grid.
// A row opens the artifact following its latest version; the menu has the pinned version, the link
// and the owner's edits. 「从工作区发布…」 publishes a workspace file as the owner (POST /v2/artifact-store).
// The 项目 page's 成果库 tab (`project.tab`, §21) is the same view for one project's scope (LibraryPanel).
import { isImeComposing } from "../../lib/ime";
import { useEffect, useMemo, useRef, useState } from "react";
import { ReadIssueLine } from "../../components/ReadIssueLine";
import { readIssue, retryDelay, type ReadIssue } from "../../lib/transientError";
import { ArrowLeft, ArrowLeftRight, ArrowUpRight, LayoutGrid, List, Loader2, Search, Star, Upload } from "lucide-react";
import { ARTIFACT_AUDIENCE_FEATURE, ARTIFACT_FILE_KINDS, ARTIFACT_KINDS, ARTIFACT_PURPOSE_FILTERS, ARTIFACT_PURPOSES, artifactRef, type ArtifactKind, type ArtifactPurpose, type ArtifactPurposeFilter, type ArtifactView, type ArtifactList, type ArtifactScope, type ArtifactSummary } from "../../../../shared/artifactStore";
import { useI18n } from "../../i18n";
import { contextMenu } from "../../lib/contextMenu";
import { imageMimeFor, isGenericMime } from "../../lib/fileKinds";
import { useThumbnail } from "../../lib/fileThumbnails";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { services } from "../app";
import { agentHost, featuresOf, useApp } from "../../store";
import type { SideBodyProps, SideOpen } from "../slots";
import { artifactMenu, openDelegation, openVersion, refusalText, toggleStar } from "./actions";
import { arrangeLibrary, DEFAULT_LIBRARY, initView, parseViewParams, previewKind, typePath, VIEW, type ViewState, LIBRARY_SORTS, libraryFiltered, libraryFilterKey, libraryQuery, libraryScopeKey, producerLabel, producerOptions, type ArchivedFilter, type LibraryScope, type LibrarySort, type LibraryState } from "./model";
import { KIND_ICON } from "./refTarget";
import { invalidateArtifact, loadContent, useEpoch } from "./store";
import { ViewBody } from "./View";
import { ViewActions } from "./ViewActions";
import { Tag } from "../../components/Tag";
import { btn } from "../../components/Button";
import { EntitySelect } from "../../components/EntitySelect";
import { EntityMention } from "../../components/EntityIcon";

const PAGE = 100;
const SELECT = "rounded-md border border-border bg-background px-1.5 py-0.5 text-caption/[inherit] outline-none focus:border-accent";
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
  const image = previewKind(a.latest.mediaType, a.name, a.latest.sourcePath) === "image" || (a.kind === "figure" && isGenericMime(a.latest.mediaType));
  const { ref, state } = useThumbnail(image ? `${hostId}|artifact|${a.artifactId}@${a.latestVersion}` : null, () =>
    loadContent(hostId, a.artifactId, a.latestVersion, 2 * 1024 * 1024).then((c) => {
      if (!c) throw new Error("gone");
      return { mime: imageMimeFor(c.mediaType, typePath(a.name, a.latest.sourcePath)), encoding: c.encoding, content: c.content, size: c.totalBytes, truncated: c.truncated };
    }), { revalidate: a.latest.storage === "external" },
  );
  const Icon = KIND_ICON[a.kind];
  return (
    <span ref={ref} className="flex h-20 items-center justify-center overflow-hidden rounded-md bg-surface-2">
      {state.status === "ok" ? <img src={state.src} alt="" draggable={false} className="h-full w-full object-contain" /> : <Icon size={22} strokeWidth={1.5} className="text-subtle" />}
    </span>
  );
}

function Meta({ hostId, a, now, internal }: { hostId: string; a: ArtifactSummary; now: number; internal: boolean }) {
  const { t, locale } = useI18n();
  const p = a.latest.producer;
  return (
    <span className="flex min-w-0 items-center gap-1 text-caption/[inherit] text-subtle">
      <span className={`min-w-0 truncate ${p.kind === "auto" && p.attribution === "ambiguous" ? "text-warn" : ""}`} title={producerLabel(p, t)}>
        <EntityMention entity={p.kind === "agent" && p.sessionId ? { kind: "agent", id: p.sessionId, name: producerLabel(p, t) } : null}>{producerLabel(p, t)}</EntityMention>
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
          className="press flex shrink-0 items-center gap-0.5 rounded bg-surface-2 px-1 text-caption/[inherit] hover:text-accent"
        >
          <ArrowLeftRight size={10} />
          {t("artifacts.delegation")}
        </button>
      )}
      {internal && <Tag title={t("artifacts.internalHint")}>{t("artifacts.internalTag")}</Tag>}
      {a.archivedAt && <Tag>{t("artifacts.archivedTag")}</Tag>}
    </span>
  );
}

/** 加星 / 取消加星 in place: always shown when starred, on hover / focus otherwise. */
function StarButton({ hostId, a }: { hostId: string; a: ArtifactSummary }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const label = t(a.starred ? "artifacts.unstar" : "artifacts.star");
  return (
    <button
      type="button"
      aria-pressed={a.starred}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        setBusy(true);
        void toggleStar(hostId, a).finally(() => setBusy(false));
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`press -m-0.5 shrink-0 rounded-sm p-0.5 ${a.starred ? "text-warn" : "text-subtle opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"}`}
    >
      <Star size={11} fill={a.starred ? "currentColor" : "none"} />
    </button>
  );
}

/** `internal`: show 「内部」 on a team artifact (the 全部 view of an `artifact-audience` host). */
function Row({ hostId, a, open, layout, now, internal }: { hostId: string; a: ArtifactSummary; open: SideOpen; layout: "list" | "grid"; now: number; internal: boolean }) {
  const { t } = useI18n();
  const Icon = KIND_ICON[a.kind];
  const activate = () => openVersion(open, artifactRef(a.artifactId, "latest"), a.name);
  const menu = contextMenu(() => artifactMenu(hostId, a, open));
  const isInternal = internal && a.audience === "team";
  const title = (
    <span className="flex min-w-0 items-center gap-1.5">
      {layout === "list" && <Icon size={13} className="shrink-0 text-subtle" />}
      <span className="min-w-0 truncate text-ui/[inherit] text-foreground" title={a.name}>
        {a.name}
      </span>
      <span className="shrink-0 font-mono text-caption/[inherit] text-subtle">{t("artifacts.version", { n: a.latestVersion })}</span>
      <StarButton hostId={hostId} a={a} />
    </span>
  );
  if (layout === "grid")
    return (
      <div role="button" tabIndex={0} onClick={activate} onKeyDown={(e) => e.key === "Enter" && activate()} onContextMenu={menu} className="press group flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border border-border bg-surface p-1.5 hover:bg-hover">
        <Thumb hostId={hostId} a={a} />
        {title}
        <Meta hostId={hostId} a={a} now={now} internal={isInternal} />
      </div>
    );
  return (
    <div role="button" tabIndex={0} onClick={activate} onKeyDown={(e) => e.key === "Enter" && activate()} onContextMenu={menu} className="press group flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1 hover:bg-hover">
      {title}
      <span className="pl-[19px]">
        <Meta hostId={hostId} a={a} now={now} internal={isInternal} />
      </span>
    </div>
  );
}

const CHIP = "press inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-caption/[inherit] whitespace-nowrap";
const chipClass = (on: boolean) => `${CHIP} ${on ? "bg-accent-soft text-accent" : "bg-surface-2/70 text-muted hover:text-foreground"}`;

/**
 * 呈阅 / 全部 and the file-kind / purpose chips (`artifact-audience` hosts). A chip toggles (one of each
 * group at most); the row wraps in a narrow side window.
 */
function AudienceFilters({ state, set, onServices }: { state: LibraryState; set(patch: Partial<LibraryState>): void; onServices: (() => void) | null }) {
  const { t } = useI18n();
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <div role="tablist" aria-label={t("artifacts.view.label")} className="flex shrink-0 rounded-full bg-surface-2 p-0.5" data-artifacts-view="">
          {(["forOwner", "all"] as const satisfies readonly ArtifactView[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={state.view === v}
              title={v === "forOwner" ? t("artifacts.view.forOwnerHint") : undefined}
              onClick={() => set({ view: v })}
              className={`rounded-full px-2.5 py-0.5 text-xs ${state.view === v ? "bg-background text-foreground shadow-e1" : "text-muted hover:text-foreground"}`}
            >
              {t(`artifacts.view.${v}`)}
            </button>
          ))}
        </div>
        {onServices && (
          <button type="button" onClick={onServices} title={t("artifacts.projectServicesHint")} className="press ml-auto flex min-w-0 items-center gap-0.5 rounded-sm text-caption/[inherit] text-accent hover:underline" data-artifacts-services="">
            <span className="truncate">{t("artifacts.projectServices")}</span>
            <ArrowUpRight size={11} className="shrink-0" />
          </button>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1" data-artifacts-chips="">
        <span role="group" aria-label={t("artifacts.fileKind.label")} className="contents">
          {ARTIFACT_FILE_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={state.fileKind === k} onClick={() => set({ fileKind: state.fileKind === k ? "" : k })} className={chipClass(state.fileKind === k)}>
              {t(`artifacts.fileKind.${k}`)}
            </button>
          ))}
        </span>
        <span aria-hidden className="mx-0.5 h-3 w-px shrink-0 bg-border" />
        <span role="group" aria-label={t("artifacts.purpose.label")} className="contents">
          {ARTIFACT_PURPOSE_FILTERS.map((p: ArtifactPurposeFilter) => (
            <button key={p} type="button" aria-pressed={state.purpose === p} onClick={() => set({ purpose: state.purpose === p ? "" : p })} className={chipClass(state.purpose === p)}>
              {t(p === "unset" ? "artifacts.purposeUnset" : `artifacts.purpose.${p}`)}
            </button>
          ))}
        </span>
      </div>
    </>
  );
}

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function PublishForm({ hostId, scope, open, onDone, audience }: { hostId: string; scope: ArtifactScope; open: SideOpen; onDone(): void; audience: boolean }) {
  const { t } = useI18n();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ArtifactKind | "">("");
  const [note, setNote] = useState("");
  const [purpose, setPurpose] = useState<ArtifactPurpose | "">("");
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
        ...(audience && purpose ? { purpose } : {}),
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
        if (!isImeComposing(e)) void submit();
      }}
    >
      <div className="font-medium text-foreground">{t("artifacts.publishTitle")}</div>
      <label className="flex flex-col gap-0.5">
        <span className="text-caption/[inherit] text-subtle">{t("artifacts.publishPath")}</span>
        <input autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder={t("artifacts.publishPathHint")} className={`${FIELD} font-mono`} />
      </label>
      <div className="flex gap-1.5">
        <label className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-caption/[inherit] text-subtle">{t("artifacts.publishName")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("artifacts.publishNameHint")} className={FIELD} />
        </label>
        <label className="flex shrink-0 flex-col gap-0.5">
          <span className="text-caption/[inherit] text-subtle">{t("artifacts.publishKind")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ArtifactKind | "")} className={`${FIELD} w-auto`}>
            <option value="">{t("artifacts.publishKindAuto")}</option>
            {ARTIFACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`artifacts.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        {audience && (
          <label className="flex shrink-0 flex-col gap-0.5">
            <span className="text-caption/[inherit] text-subtle">{t("artifacts.purpose.label")}</span>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value as ArtifactPurpose | "")} className={`${FIELD} w-auto`}>
              <option value="">{t("artifacts.purposeNone")}</option>
              {ARTIFACT_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {t(`artifacts.purpose.${p}`)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-caption/[inherit] text-subtle">{t("artifacts.publishNote")}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t("artifacts.publishNoteHint")} className={`${FIELD} resize-y`} />
      </label>
      {error && <p className="text-caption/[inherit] text-danger">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="press rounded-md px-2 py-1 text-muted hover:bg-hover">
          {t("artifacts.cancel")}
        </button>
        <button type="submit" disabled={!path.trim() || busy} className={btn({ variant: "primary" })}>
          {busy && <Loader2 size={12} className="animate-spin" />}
          {t("artifacts.publishSubmit")}
        </button>
      </div>
    </form>
  );
}

/** `issue` on a list: the last refresh failed transiently; the list stays, with the retry line above it. */
type Loaded = { key: string; list: ArtifactList; error?: undefined; issue?: ReadIssue } | { key: string; list?: undefined; error: string; issue?: ReadIssue };

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
          <button onClick={() => setInline(null)} className="press flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted hover:bg-hover hover:text-foreground">
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
  // A failed list read: transient ones read again by themselves (1, 2, 5, 10, 30 s); 重新加载 bumps `attempt`.
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  const [more, setMore] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // cutex artifact-audience: 呈阅 / 全部 and the file-kind / purpose chips; an older host lists as before.
  const audience = useApp((s) => featuresOf(s, hostId).has(ARTIFACT_AUDIENCE_FEATURE));
  const servicesOn = useApp((s) => featuresOf(s, hostId).has("services"));
  const focusHost = useApp((s) => s.hosts?.active ?? "local");
  const filter = { q, kind: state.kind, archived: state.archived, view: state.view, fileKind: state.fileKind, purpose: state.purpose };
  const queryKey = `${hostId}|${libraryScopeKey(scope)}|${libraryFilterKey(filter, audience)}`;

  useEffect(() => {
    failures.current = 0;
  }, [queryKey]);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    services
      .daemonFor(hostId)
      .artifactStoreList(libraryQuery(scope, filter, PAGE, undefined, audience))
      .then(
        (list) => {
          if (!live) return;
          failures.current = 0;
          setLoaded(list ? { key: queryKey, list } : { key: queryKey, error: t("artifacts.err.artifact_not_found") });
        },
        (e: unknown) => {
          if (!live) return;
          const issue = readIssue(e);
          // The last list of this query stays on screen while it retries.
          setLoaded((prev) => (prev?.list && prev.key === queryKey && issue.retrying ? { ...prev, issue } : { key: queryKey, error: issue.detail, issue }));
          if (issue.retrying) retry = setTimeout(() => live && setAttempt((n) => n + 1), retryDelay(failures.current++));
        },
      );
    return () => {
      live = false;
      clearTimeout(retry);
    };
    // queryKey covers hostId / scope / the filters (and whether the host has artifact-audience).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, epoch, visible, attempt]);

  const list = loaded?.list;
  const items = useMemo(() => (list ? arrangeLibrary(list.items, state) : []), [list, state.producer, state.sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const producers = useMemo(() => producerOptions(list?.items ?? []), [list]);

  const loadMore = async () => {
    if (!list?.nextCursor || more) return;
    setMore(true);
    try {
      const next = await services.daemonFor(hostId).artifactStoreList(libraryQuery(scope, filter, PAGE, list.nextCursor, audience));
      if (next) setLoaded({ key: queryKey, list: { ...next, items: [...list.items, ...next.items.filter((n) => !list.items.some((o) => o.artifactId === n.artifactId))] } });
    } finally {
      setMore(false);
    }
  };

  const stale = loaded && loaded.key !== queryKey;
  // 本项目网页服务: the project page's 服务 tab (running sites stay on the Services side; a session scope has none).
  const projectId = list?.scope.kind === "project" ? list.scope.id : "project" in scope ? scope.project : null;
  const onServices = audience && servicesOn && projectId ? () => services.ui.openPage("projects.page", { project: projectId, tab: "services", ...(hostId !== focusHost ? { host: hostId } : {}) }) : null;
  const filtered = libraryFiltered(state, audience);
  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <div className="flex shrink-0 flex-col gap-1.5 p-2">
        <div className="flex items-center gap-1.5">
          <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 focus-within:border-accent">
            <Search size={12} className="shrink-0 text-subtle" />
            <input
              value={state.q}
              maxLength={200}
              onChange={(e) => set({ q: e.target.value })}
              onKeyDown={(e) => {
                if (!isImeComposing(e) && e.key === "Escape" && state.q) {
                  e.preventDefault();
                  e.stopPropagation();
                  set({ q: "" });
                }
              }}
              placeholder={t("artifacts.search")}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-subtle"
            />
          </label>
          <button onClick={() => setPublishing((v) => !v)} disabled={!list} className={`press flex shrink-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent ${publishing ? "bg-surface-2 text-foreground" : "text-accent"}`}>
            <Upload size={12} />
            {t("artifacts.publish")}
          </button>
        </div>
        {audience && <AudienceFilters state={state} set={set} onServices={onServices} />}
        <div className="flex flex-wrap items-center gap-1.5">
          {!audience && <select value={state.kind} onChange={(e) => set({ kind: e.target.value as ArtifactKind | "" })} aria-label={t("artifacts.publishKind")} className={SELECT}>
            <option value="">{t("artifacts.kindAll")}</option>
            {ARTIFACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`artifacts.kind.${k}`)}
              </option>
            ))}
          </select>}
          <EntitySelect value={state.producer} onChange={(v) => set({ producer: v })} label={t("artifacts.src.producer")} className={`flex w-36 max-w-36 items-center justify-between gap-1 ${SELECT}`}
            options={[{ value: "", label: t("artifacts.producerAll") },
              ...producers.map((p) => ({ value: p.key, label: p.kind === "auto" ? t("artifacts.producerAuto") : p.kind === "owner" ? t("artifacts.producer.owner") : p.name, entity: p.kind === "agent" ? { kind: "agent" as const, id: p.key.replace(/^agent:/, ""), name: p.name } : null })),
              ...(state.producer && !producers.some((p) => p.key === state.producer) ? [{ value: state.producer, label: state.producer.replace(/^agent:/, "") }] : [])]} />
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
          <span className="ml-auto flex items-center gap-1 text-caption/[inherit] text-subtle">
            {list && t("artifacts.count", { n: items.length })}
            <span role="group" className="ml-1 flex overflow-hidden rounded-md border border-border">
              {(["list", "grid"] as const).map((l) => {
                const Icon = l === "list" ? List : LayoutGrid;
                return (
                  <button key={l} onClick={() => set({ layout: l })} aria-pressed={state.layout === l} title={t(`artifacts.layout.${l}`)} className={`press px-1 py-0.5 ${state.layout === l ? "bg-surface-2 text-foreground" : "hover:bg-hover"}`}>
                    <Icon size={12} />
                  </button>
                );
              })}
            </span>
          </span>
        </div>
      </div>
      {publishing && list && <PublishForm hostId={hostId} scope={list.scope} open={open} onDone={() => setPublishing(false)} audience={audience} />}
      <div className={`min-h-0 flex-1 overflow-y-auto px-1 pb-2 ${stale ? "opacity-60" : ""}`}>
        {loaded?.list && loaded.issue && <ReadIssueLine className="px-2 py-1.5" issue={loaded.issue} retryingText={t("artifacts.listRetrying")} failedText={t("artifacts.listFailed")} onReload={() => { failures.current = 0; setAttempt((n) => n + 1); }} />}
        {!loaded ? (
          <p className="p-3 text-subtle">{t("artifacts.loading")}</p>
        ) : loaded.error ? (
          loaded.issue
            ? <ReadIssueLine className="p-3" issue={loaded.issue} retryingText={t("artifacts.listRetrying")} failedText={t("artifacts.listFailed")} onReload={() => { failures.current = 0; setAttempt((n) => n + 1); }} />
            : <p className="p-3 text-danger">{t("artifacts.loadFailed", { error: loaded.error })}</p>
        ) : !items.length ? (
          filtered ? (
            <p className="p-3 leading-relaxed text-subtle">{t("artifacts.noMatch")}</p>
          ) : audience && state.view === "forOwner" ? (
            <div className="flex flex-col items-start gap-1.5 p-3 leading-relaxed text-subtle" data-artifacts-for-owner-empty="">
              <p>{t("artifacts.forOwnerEmpty")}</p>
              <button type="button" onClick={() => set({ view: "all" })} className="press rounded-sm text-accent hover:underline">
                {t("artifacts.showAll")}
              </button>
            </div>
          ) : (
            <p className="p-3 leading-relaxed text-subtle">{t(emptyKey)}</p>
          )
        ) : state.layout === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5 px-1">
            {items.map((a) => (
              <Row key={a.artifactId} hostId={hostId} a={a} open={open} layout="grid" now={now} internal={audience && state.view === "all"} />
            ))}
          </div>
        ) : (
          items.map((a) => <Row key={a.artifactId} hostId={hostId} a={a} open={open} layout="list" now={now} internal={audience && state.view === "all"} />)
        )}
        {list?.nextCursor && (
          <button onClick={() => void loadMore()} disabled={more} aria-busy={more || undefined} className="press mx-2 mt-1 rounded-sm text-accent enabled:hover:underline disabled:cursor-default disabled:opacity-50">
            {t("artifacts.loadMore")}
          </button>
        )}
      </div>
    </div>
  );
}
