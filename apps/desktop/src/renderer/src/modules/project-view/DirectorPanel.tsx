import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  DirectorHandover,
  DirectorStartReview,
  ProjectDirector,
  DirectorScopeCandidate,
  DirectorReviewContent,
} from "@cutex-desktop/cutex-client";
import { DIRECTOR_CHANGED_EVENT, directorChangedServiceCount, formerDirectorsOf } from "../../lib/projectServices";
import { apiFor, bridge } from "../../bridge";
import { btn } from "../../components/Button";
import { useI18n, type MessageKey } from "../../i18n";
import { featuresOf, useApp } from "../../store";
import {
  canAdopt,
  directorConflict,
  handoverAttention,
  scopeIds,
  recentDirectorNotice,
  directorNoticeDismissed,
  dismissDirectorNotice,
} from "./directorModel";

type Snapshot = {
  director: ProjectDirector;
  handovers: DirectorHandover[];
  starts: DirectorStartReview[];
};
type Action = (
  | {
      kind: "handover" | "start-reviews";
      id: string;
      revision: number;
      decision: "accept" | "discard";
    }
  | { kind: "scope"; ids: string[]; id: string }
) & { epoch: number };

export function DirectorPanel({
  hostId,
  projectId,
  nameOf,
  onFormerDirectors,
  historyOpen = false,
  onCloseHistory,
}: {
  hostId: string;
  projectId: string;
  nameOf(id: string | null, fallback?: string | null): string | null;
  /** The old Directors of this project's settled changes (the services claim strip's 前任 Director). */
  onFormerDirectors?(ids: Set<string>): void;
  historyOpen?: boolean;
  onCloseHistory?(): void;
}) {
  const { t } = useI18n();
  const address = useApp((s) => featuresOf(s, hostId).has("director-address"));
  const notices = useApp((s) =>
    featuresOf(s, hostId).has("director-change-notices"),
  );
  const handover = useApp((s) =>
    featuresOf(s, hostId).has("director-handover"),
  );
  const adoption = useApp((s) =>
    featuresOf(s, hostId).has("management-start-adoption"),
  );
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [tick, refresh] = useState(0);
  const [armed, setArmed] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("");
  const [scopeOpen, showScope] = useState(false);
  const [candidates, setCandidates] = useState<DirectorScopeCandidate[]>([]);
  const [contents, setContents] = useState<
    Record<string, DirectorReviewContent>
  >({});
  const sequence = useRef(0);
  // r267 services-project-scope: `directorChanged.projectServiceCount` of the last change seen here.
  const [serviceCount, setServiceCount] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const reportFormer = useRef(onFormerDirectors);
  reportFormer.current = onFormerDirectors;
  const active = address || notices || handover || adoption;
  // Only current work can keep 项目交接 on the page. History is an explicit menu destination.
  const needsOwner = !!data && handoverAttention(data, { handover, adoption });
  const attention = !!error || needsOwner;
  const [openPref, setOpenPref] = useState<boolean | null>(null);
  useEffect(() => {
    setOpenPref(null);
    if (!attention) { setArmed(null); showScope(false); }
  }, [attention]);
  const open = historyOpen || (attention && (openPref ?? true));
  const visibleNotices = notices && !historyOpen ? (data?.director.changes ?? []).filter(c =>
    recentDirectorNotice(c, now) && !dismissed.has(c.changeId) && !directorNoticeDismissed(hostId, projectId, c.changeId)) : [];
  async function loadScope() {
    showScope(!scopeOpen);
    setArmed(null);
    if (scopeOpen) return;
    try {
      const r = await apiFor(hostId).directorScopeCandidates(projectId);
      if (r.ok) setCandidates(r.value.items);
      else setError(r.message);
    } catch (e) {
      setError(String(e));
    }
  }
  async function readContent(item: DirectorStartReview) {
    try {
      const r = await apiFor(hostId).directorReviewContent(
        projectId,
        item.reviewId,
      );
      if (r.ok)
        setContents((old) => ({
          ...old,
          [`${item.reviewId}:${item.revision}`]: r.value,
        }));
      else setError(r.message);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    if (!active) return;
    let live = true;
    const seq = ++sequence.current;
    const api = apiFor(hostId);
    void Promise.all([
      api.projectDirector(projectId),
      handover
        ? api.directorHandovers(projectId)
        : Promise.resolve({ ok: true as const, value: { items: [] } }),
      adoption
        ? api.directorStartReviews(projectId)
        : Promise.resolve({ ok: true as const, value: { items: [] } }),
    ])
      .then(([d, h, s]) => {
        if (!live || seq !== sequence.current) return;
        if (!d.ok || !h.ok || !s.ok) {
          setData(null);
          const failure = [d, h, s].find((r) => !r.ok);
          setError(failure && !failure.ok ? failure.message : "");
          return;
        }
        reportFormer.current?.(formerDirectorsOf(d.value.changes, d.value.directorSessionId));
        setData({
          director: d.value,
          handovers: h.value.items,
          starts: s.value.items,
        });
      })
      .catch((e: Error) => {
        if (live) {
          setData(null);
          setError(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [hostId, projectId, active, handover, adoption, tick]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (!document.hidden) { setNow(Date.now()); refresh((n) => n + 1); }
    }, 15_000);
    const stop = bridge.on("hostEvent", (e) => {
      const params = e.envelope.cutex?.params as { projectId?: unknown } | undefined;
      if (e.hostId === hostId && e.envelope.cutex?.method === DIRECTOR_CHANGED_EVENT && params?.projectId === projectId)
        setServiceCount(directorChangedServiceCount(params));
      if (
        e.hostId === hostId &&
        [
          "cutex/project/directorChanged",
          "cutex/project/handoverUpdated",
          "cutex/ask/handover",
          "cutex/agentManagement/actionCompleted",
        ].includes(e.envelope.cutex?.method ?? "")
      )
        refresh((n) => n + 1);
    });
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [active, hostId, projectId]);
  async function commit(action: Action) {
    if (!data || busy) return;
    if (
      !data.director.directorSessionId &&
      (action.kind === "scope" || action.decision === "accept")
    ) {
      setArmed(null);
      setError(t("project-view.directorUi.vacant"));
      return;
    }
    setBusy(true);
    setError("");
    // Capture the displayed epoch and revision. Never retry a mutation after an uncertain result.
    try {
      const api = apiFor(hostId);
      const result =
        action.kind === "scope"
          ? await api.approveDirectorScope(projectId, {
              id: action.id,
              expectedEpoch: action.epoch,
              askIds: action.ids,
            })
          : await api.decideDirectorItem(
              projectId,
              action.kind,
              action.id,
              action.decision,
              {
                expectedEpoch: action.epoch,
                expectedRevision: action.revision,
              },
            );
      if (!result.ok)
        setError(
          directorConflict(result.code)
            ? t("project-view.directorUi.conflict")
            : result.message,
        );
      else if (action.kind === "scope") {
        setScope("");
        showScope(false);
      }
    } catch {
      setError(t("project-view.directorUi.uncertain"));
    } finally {
      setBusy(false);
      setArmed(null);
      refresh((n) => n + 1);
    }
  }
  if (!active) return null;
  const name = (id: string | null) =>
    id ? nameOf(id) ?? id : t("project-view.directorUi.none");
  const label = (state: string) =>
    t(`project-view.directorUi.state.${state}` as MessageKey);
  function actions(
    kind: "handover" | "start-reviews",
    id: string,
    revision: number,
    accept: boolean,
  ) {
    const selected =
      armed && armed.kind !== "scope" && armed.kind === kind && armed.id === id
        ? armed
        : null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {selected ? (
          <>
            <span className="text-warn-text">
              {t(
                selected.decision === "discard"
                  ? "project-view.directorUi.confirmDiscard"
                  : kind === "handover"
                    ? "project-view.directorUi.confirmHandover"
                    : "project-view.directorUi.confirmAdopt",
              )}
            </span>
            <button
              className={btn()}
              disabled={busy || (selected.decision === "accept" && !accept)}
              onClick={() => void commit(selected)}
            >
              {t("project-view.directorUi.confirm")}
            </button>
            <button
              className={btn()}
              disabled={busy}
              onClick={() => setArmed(null)}
            >
              {t("project-view.directorUi.cancel")}
            </button>
          </>
        ) : (
          <>
            <button
              className={btn()}
              disabled={busy || !accept}
              onClick={() =>
                setArmed({
                  kind,
                  id,
                  revision,
                  epoch: data!.director.authorityEpoch,
                  decision: "accept",
                })
              }
            >
              {t(
                kind === "handover"
                  ? "project-view.directorUi.accept"
                  : "project-view.directorUi.adopt",
              )}
            </button>
            <button
              className={btn()}
              disabled={busy}
              onClick={() =>
                setArmed({
                  kind,
                  id,
                  revision,
                  epoch: data!.director.authorityEpoch,
                  decision: "discard",
                })
              }
            >
              {t("project-view.directorUi.discard")}
            </button>
          </>
        )}
      </div>
    );
  }
  return (
    <>
      {visibleNotices.map(c => <div role="note" key={c.changeId} className="mx-3 my-2 flex items-start gap-2 rounded bg-surface-2 px-2 py-1.5 text-meta text-muted" data-testid="director-change-notice">
        <span className="min-w-0 flex-1">{c.cleared || c.newDirector === null ? t("project-view.directorUi.cleared") : t("project-view.directorUi.changed", { from: name(c.oldDirector), to: name(c.newDirector) })}</span>
        <button className={btn({ size: "sm", variant: "ghost" })} onClick={() => {
          dismissDirectorNotice(hostId, projectId, c.changeId);
          setDismissed(old => new Set([...old, c.changeId]));
        }}>{t("project-view.directorUi.dismiss")}</button>
      </div>)}
    {(attention || historyOpen) && <section
      aria-label={t(historyOpen ? "project-view.directorUi.history" : "project-view.directorUi.title")}
      className={`border-b border-border px-3 text-meta/[inherit] ${open ? "py-2" : "py-1.5"}`}
      data-testid="director-panel"
      data-open={open}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => historyOpen ? onCloseHistory?.() : setOpenPref(!open)}
          className="-ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-hover"
          data-testid="director-panel-toggle"
        >
          {open ? (
            <ChevronDown size={13} className="shrink-0 text-subtle" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-subtle" />
          )}
          <b>{t(historyOpen ? "project-view.directorUi.history" : "project-view.directorUi.title")}</b>
        </button>
        {historyOpen && <button className={btn({ size: "sm", variant: "ghost" })} onClick={onCloseHistory}>{t("project-view.directorUi.closeHistory")}</button>}
        {data && (
          <span
            className="rounded bg-accent/10 px-1.5 text-accent"
            title={data.director.directorSessionId ?? ""}
          >
            {data.director.directorSessionId ? (
              <>
                {t("project-view.director")} ·{" "}
                {name(data.director.directorSessionId)}
              </>
            ) : (
              t("project-view.directorUi.cleared")
            )}
          </span>
        )}
        {!!serviceCount && (
          <span className="rounded bg-surface-2 px-1.5 text-muted" data-testid="director-panel-services">
            {t("project-view.directorUi.services", { n: serviceCount })}
          </span>
        )}
        {!open && data && (
          <span className="text-subtle" data-testid="director-panel-quiet">
            {t("project-view.directorUi.quiet")}
          </span>
        )}
        {open && (
          <button
            className={`${btn()} ml-auto`}
            disabled={busy}
            onClick={() => {
              setArmed(null);
              setError("");
              refresh((n) => n + 1);
            }}
          >
            {t("project-view.directorUi.refresh")}
          </button>
        )}
      </div>
      {open && error && (
        <p role="alert" className="my-2 text-warn-text">
          {error}
        </p>
      )}
      {open && !data && !error && (
        <p>{t("project-view.directorUi.loading")}</p>
      )}
      {open && data && (
        <>
          {!data.director.directorSessionId && (
            <p className="my-2 text-warn-text">
              {t("project-view.directorUi.vacant")}
            </p>
          )}
          {historyOpen && notices &&
            data.director.changes
              .filter(
                (c) =>
                  c.state === "finalized" && c.oldDirector !== c.newDirector,
              )
              .map((c) => (
                <div
                  role="note"
                  key={c.changeId}
                  className="my-2 rounded bg-surface-2 px-2 py-1.5 text-muted"
                >
                  <span>
                    {c.cleared || c.newDirector === null
                      ? t("project-view.directorUi.cleared")
                      : t("project-view.directorUi.changed", {
                          from: name(c.oldDirector),
                          to: name(c.newDirector),
                        })}
                  </span>
                  <details>
                    <summary>{t("project-view.directorUi.evidence")}</summary>
                    <p className="break-all">
                      {c.settledAt ?? c.preparedAt} · {c.reason} · {c.changeId}
                    </p>
                  </details>
                </div>
              ))}
          {handover && (
            <details open>
              <summary className="cursor-pointer py-1 font-medium">
                {t("project-view.directorUi.handovers")} ·{" "}
                {data.handovers.filter((h) => h.state === "pending").length}
              </summary>
              {!data.handovers.length && (
                <p className="py-1 text-subtle">
                  {t("project-view.directorUi.empty")}
                </p>
              )}
              {data.handovers.map((h) => (
                <article
                  key={h.id}
                  className="my-2 rounded-lg border border-border p-2"
                >
                  <div className="flex justify-between gap-2">
                    <b className="break-all">{h.askId}</b>
                    <span>{label(h.state)}</span>
                  </div>
                  <p>
                    {t(
                      h.state === "accepted"
                        ? "project-view.directorUi.responsibility"
                        : "project-view.directorUi.proposed",
                      {
                        from: name(h.from),
                        to: name(
                          h.state === "accepted"
                            ? (h.resolvedTo ?? h.to)
                            : h.to,
                        ),
                      },
                    )}
                  </p>
                  {h.ownerOnly && (
                    <p className="mt-1 text-warn-text">
                      {t("project-view.directorUi.ownerOnly")}
                    </p>
                  )}
                  {h.resolvedTo && (
                    <p>
                      {t("project-view.directorUi.resolved", {
                        name: name(h.resolvedTo),
                      })}
                    </p>
                  )}
                  <details>
                    <summary>{t("project-view.directorUi.evidence")}</summary>
                    <p className="break-all">
                      {h.reason} · {h.changeId} ·{" "}
                      {t(
                        h.provenanceKnown
                          ? "project-view.directorUi.known"
                          : h.reason === "ownerApprovedScope"
                            ? "project-view.directorUi.ownerScope"
                            : "project-view.directorUi.unverified",
                      )}
                      {h.actor ? ` · ${h.actor}` : ""}
                    </p>
                  </details>
                  {/* These HTTP resources are owner/root only; root may resolve stale destinations.
                      ownerOnly is a server-enforced restriction on agent tools, not on the owner. */}
                  {["pending", "superseded", "discarded"].includes(h.state) &&
                    actions(
                      "handover",
                      h.id,
                      h.revision,
                      !!data.director.directorSessionId,
                    )}
                </article>
              ))}
              <button
                className={btn()}
                disabled={busy}
                onClick={() => void loadScope()}
              >
                {t("project-view.directorUi.scope")}
              </button>
              {scopeOpen && (
                <div className="my-2 rounded-lg border border-border p-2">
                  {candidates.map((c) => (
                    <label
                      key={c.askId}
                      className="my-1 flex items-start gap-2"
                    >
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={scopeIds(scope).includes(c.askId)}
                        onChange={(e) => {
                          setScope((old) =>
                            (e.target.checked
                              ? [...scopeIds(old), c.askId]
                              : scopeIds(old).filter((id) => id !== c.askId)
                            ).join("\n"),
                          );
                          setArmed(null);
                        }}
                      />
                      <span>
                        {c.title} · {name(c.requester.cutexSessionId)} →{" "}
                        {name(c.targetSession)}
                        <br />
                        <code>{c.askId}</code>
                        <span className="ml-2 text-subtle">
                          {t(
                            c.provenanceKnown
                              ? "project-view.directorUi.known"
                              : "project-view.directorUi.unverified",
                          )}
                        </span>
                      </span>
                    </label>
                  ))}
                  <label className="block">
                    {t("project-view.directorUi.scopeHelp")}
                    <textarea
                      className="mt-2 w-full rounded border border-border bg-background p-2 font-mono"
                      value={scope}
                      disabled={busy}
                      onChange={(e) => {
                        setScope(e.target.value);
                        setArmed(null);
                      }}
                      rows={3}
                    />
                  </label>
                  <p>
                    {t("project-view.directorUi.selected", {
                      n: scopeIds(scope).length,
                    })}
                  </p>
                  {armed?.kind === "scope" ? (
                    <div className="mt-2 flex gap-2">
                      <span>{t("project-view.directorUi.confirmScope")}</span>
                      <button
                        className={btn()}
                        disabled={busy || !data.director.directorSessionId}
                        onClick={() => void commit(armed)}
                      >
                        {t("project-view.directorUi.confirm")}
                      </button>
                      <button className={btn()} onClick={() => setArmed(null)}>
                        {t("project-view.directorUi.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      className={btn()}
                      disabled={
                        busy ||
                        !data.director.directorSessionId ||
                        scopeIds(scope).length === 0 ||
                        scopeIds(scope).length > 500
                      }
                      onClick={() =>
                        setArmed({
                          kind: "scope",
                          ids: scopeIds(scope),
                          epoch: data.director.authorityEpoch,
                          id: crypto.randomUUID(),
                        })
                      }
                    >
                      {t("project-view.directorUi.approveScope")}
                    </button>
                  )}
                </div>
              )}
            </details>
          )}
          {adoption && (
            <details open>
              <summary className="cursor-pointer py-1 font-medium">
                {t("project-view.directorUi.starts")} ·{" "}
                {
                  data.starts.filter((s) =>
                    ["open", "deliveryUnknown"].includes(s.state),
                  ).length
                }
              </summary>
              {!data.starts.length && (
                <p className="py-1 text-subtle">
                  {t("project-view.directorUi.empty")}
                </p>
              )}
              {data.starts.map((s) => (
                <article
                  key={s.reviewId}
                  className="my-2 rounded-lg border border-border p-2"
                >
                  <div className="flex justify-between gap-2">
                    <b>{name(s.targetSession)}</b>
                    <span>{label(s.state)}</span>
                  </div>
                  <p>
                    {t("project-view.directorUi.source", {
                      name: name(s.originalRequester),
                    })}
                  </p>
                  <details>
                    <summary>{t("project-view.directorUi.evidence")}</summary>
                    <p className="break-all">
                      {s.sourceOperation} · {s.sourceActionId} ·{" "}
                      {s.sourceMessageId}
                      <br />
                      {s.createdAt} · SHA-256 {s.contentSha256}
                      {s.adoptionId ? ` · ${s.adoptionId}` : ""}
                    </p>
                  </details>
                  <button className={btn()} onClick={() => void readContent(s)}>
                    {t("project-view.directorUi.readBrief")}
                  </button>
                  {contents[s.reviewId + ":" + s.revision] && (
                    <div className="mt-2 rounded bg-surface-2 p-2">
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-sans">
                        {contents[s.reviewId + ":" + s.revision]!.content}
                      </pre>
                      <p className="mt-1 text-subtle">
                        {
                          contents[s.reviewId + ":" + s.revision]!.delivery
                            .state
                        }{" "}
                        ·{" "}
                        {
                          contents[s.reviewId + ":" + s.revision]!.delivery
                            .outcome
                        }
                      </p>
                    </div>
                  )}
                  {s.state === "deliveryUnknown" && (
                    <p className="mt-1 text-warn-text">
                      {t("project-view.directorUi.unknown")}
                    </p>
                  )}
                  {["open", "deliveryUnknown"].includes(s.state) &&
                    actions(
                      "start-reviews",
                      s.reviewId,
                      s.revision,
                      !!data.director.directorSessionId &&
                        canAdopt(s, data.director.authorityEpoch) &&
                        contents[s.reviewId + ":" + s.revision]?.delivery
                          .outcome === "not_delivered",
                    )}
                </article>
              ))}
            </details>
          )}
        </>
      )}
    </section>}
    </>
  );
}
