// 成果 view (artifacts.view): one artifact at a pinned version or following its latest, in one row of
// tabs — 预览 (markdown rendered, HTML page in the offline opaque frame, image, CSV / TSV table, text /
// code, PDF / DOCX), 源代码 (markdown / HTML / CSV / TSV only: the text itself), 出处 (producer, turn,
// delegation, git, path, sha, note, auto-capture attribution; pane id "source") and 对比 (two text
// versions; also as a diff card). The version
// picker opens the other identity as its own tab (pinned and latest are different tabs); an old
// pinned version says so with a 「看最新」 banner. Never falls back from a missing version to the latest.
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeftRight, Copy, ExternalLink, History, Loader2, RefreshCw } from "lucide-react";
import { artifactRef, parseArtifactRef, type ArtifactContent, type ArtifactDetail, type ArtifactDiff, type ArtifactVersion } from "../../../../shared/artifactStore";
import { DocumentPreview } from "../../components/DocumentPreview";
import { Markdown } from "../../components/Markdown";
import { UnifiedDiff } from "../../components/UnifiedDiff";
import { useI18n, type MessageKey } from "../../i18n";
import { contextMenu } from "../../lib/contextMenu";
import { docKindOf, loadWindowedDoc } from "../../lib/docPreview";
import { extensionOf, thumbnailSrc } from "../../lib/fileKinds";
import { copyText } from "../../lib/menus";
import { DIFF_COMPONENT } from "../../lib/sideKinds";
import { useModelName } from "../../lib/modelDisplay";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { languageFor } from "../../lib/workspace";
import { services } from "../app";
import type { SideBodyProps, SideOpen } from "../slots";
import { artifactMenu, copyArtifactLink, explainOpen, openDelegation, openVersion, useDelegationTitle } from "./actions";
import { attributionText, currentTab, diffGap, externalGone, fence, formatBytes, isOldVersion, jsonRecordOf, parseDelimited, previewKind, previousVersion, producerLabel, resolveVersion, sessionName, typePath, viewTabs, withTab, type ViewState, type ViewTab } from "./model";
import { JsonRecord } from "./JsonRecord";
import { PageFrame, type PageProblem } from "./PageFrame";
import { TextPreview } from "./TextPreview";
import { KIND_ICON } from "./refTarget";
import { loadContent, loadDiff, useCachedDetail, useDetail } from "./store";

const CSV_ROWS = 300;
const TEXT_BYTES = 256 * 1024;
const TABLE_BYTES = 1024 * 1024;
const IMAGE_BYTES = 4 * 1024 * 1024;
const seconds = (iso: string) => (Date.parse(iso) || 0) / 1000;

function Note({ tone = "muted", children }: { tone?: "muted" | "warn" | "danger"; children: ReactNode }) {
  const cls = tone === "warn" ? "border-warn/40 bg-warn/10 text-warn" : tone === "danger" ? "border-danger/40 bg-danger/10 text-danger" : "border-border bg-surface-2 text-subtle";
  return <div className={`mx-2 my-1.5 rounded-md border px-2 py-1 text-[11px] leading-relaxed ${cls}`}>{children}</div>;
}

// ── preview ──────────────────────────────────────────────────────────────────────────────────────

function Table({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    <div className="overflow-auto px-2">
      <table className="border-collapse text-[11.5px]">
        {head && (
          <thead>
            <tr>
              {head.map((c, i) => (
                <th key={i} className="sticky top-0 border border-border bg-surface-2 px-1.5 py-0.5 text-left font-medium whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="odd:bg-surface/60">
              {r.map((c, j) => (
                <td key={j} className="border border-border px-1.5 py-0.5 whitespace-nowrap">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 「整理 / 原文」 of a JSON record (Markdown / HTML / tables use the 源代码 tab instead). */
function PageToggle({ code, setCode, labels }: { code: boolean; setCode(code: boolean): void; labels: [MessageKey, MessageKey] }) {
  const { t } = useI18n();
  const item = (value: boolean, label: string) => (
    <button
      role="radio"
      aria-checked={code === value}
      onClick={() => setCode(value)}
      className={`rounded px-1.5 py-px text-[11px] ${code === value ? "bg-surface-2 font-medium text-foreground" : "text-muted hover:bg-hover"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label={t("artifacts.page.toggle")} className="flex shrink-0 items-center justify-end gap-0.5 px-2 pb-1">
      {item(false, t(labels[0]))}
      {item(true, t(labels[1]))}
    </div>
  );
}

const PAGE_PROBLEM_KEY: Record<PageProblem, MessageKey> = {
  unavailable: "artifacts.page.unavailable",
  failed: "artifacts.page.failed",
  navigated: "artifacts.page.failed",
  "not-found": "artifacts.page.failed",
  "host-offline": "artifacts.page.hostOffline",
  "not-text": "artifacts.page.notText",
  "too-large": "artifacts.page.tooLarge",
  "external-changed": "artifacts.externalGone",
};

/** `code`: the 源代码 tab (hasCodeView kinds; the caller remounts on a switch, so a page problem is retried). */
function Preview({ hostId, name, version, code = false }: { hostId: string; name: string; version: ArtifactVersion; code?: boolean }) {
  const { t } = useI18n();
  const typed = typePath(name, version.sourcePath) || version.sourcePath;
  const kind = previewKind(version.mediaType, name, version.sourcePath);
  const maxBytes = kind === "image" ? IMAGE_BYTES : kind === "csv" || kind === "tsv" ? TABLE_BYTES : TEXT_BYTES;
  const [content, setContent] = useState<{ key: string; value: ArtifactContent | null; error?: string } | null>(null);
  const key = `${version.artifactId}@${version.version}`;
  // A page main could not prepare (or no desktop bridge: the browser preview without frames) shows its source.
  const [problem, setProblem] = useState<{ key: string; problem: PageProblem } | null>(null);
  const [rawJson, setRawJson] = useState(false);
  const pageProblem = problem?.key === key ? problem.problem : null;
  const asPage = kind === "html" && !code && !pageProblem;
  useEffect(() => {
    if (kind === "binary" || asPage) return;
    let live = true;
    loadContent(hostId, version.artifactId, version.version, maxBytes).then(
      (value) => live && setContent({ key, value }),
      (e: unknown) => live && setContent({ key, value: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [hostId, key, kind, maxBytes, version.artifactId, version.version, asPage]);
  const size = formatBytes(version.bytes);
  // PDF / DOCX (and the office formats we only describe): components/DocumentPreview.tsx.
  const doc = kind === "binary" ? docKindOf(typed, version.mediaType) : null;
  if (doc)
    return (
      <div className="flex min-h-72 flex-1 flex-col">
        <DocumentPreview
          name={extensionOf(name) === extensionOf(typed) ? name : (typed.split(/[\\/]/).pop() ?? name)}
          mime={version.mediaType}
          loadKey={`${hostId}|${key}`}
          load={() =>
            loadWindowedDoc(doc, typed, version.bytes, async (offset, maxBytes) => {
              const c = await services.daemonFor(hostId).artifactStoreContent(version.artifactId, version.version, { offset, maxBytes });
              if (c && externalGone(c)) throw new Error(t("artifacts.externalGone"));
              return c;
            })
          }
        />
      </div>
    );
  if (asPage) return <PageFrame hostId={hostId} artifactId={version.artifactId} version={version.version} title={name} onProblem={(p) => setProblem({ key, problem: p })} />;
  if (kind === "binary") return <Note>{t("artifacts.binary", { type: version.mediaType || "?", size })}</Note>;
  if (!content || content.key !== key) return <p className="p-3 text-xs text-subtle">{t("artifacts.loading")}</p>;
  if (content.error) return <Note tone="danger">{t("artifacts.loadFailed", { error: content.error })}</Note>;
  const c = content.value;
  if (!c) return <Note tone="danger">{t("artifacts.versionGone", { n: version.version })}</Note>;
  // The registered bytes of an external version are gone once its file changed (cutex sends none).
  if (externalGone(c)) return <Note tone="warn">{t("artifacts.externalGone")}</Note>;
  const warnings = (
    <>
      {pageProblem && pageProblem !== "navigated" && <Note tone={pageProblem === "unavailable" ? "muted" : "warn"}>{t(PAGE_PROBLEM_KEY[pageProblem])}</Note>}
      {c.externalChanged && <Note tone="warn">{t("artifacts.externalChanged")}</Note>}
      {c.truncated && kind !== "image" && <Note>{t("artifacts.truncated", { size: formatBytes(c.content.length) })}</Note>}
    </>
  );
  if (kind === "image") {
    const src = thumbnailSrc({ mime: c.mediaType || version.mediaType, encoding: c.encoding, content: c.content, size: c.totalBytes, truncated: c.truncated }, typed);
    return (
      <>
        {warnings}
        {src ? <img src={src} alt={name} draggable={false} className="mx-auto my-2 block h-auto max-w-[calc(100%-1rem)] rounded-md border border-border bg-surface-2 object-contain" /> : <Note>{t("artifacts.imageTooLarge", { size })}</Note>}
      </>
    );
  }
  if (c.encoding === "base64") return <Note>{t("artifacts.binary", { type: version.mediaType || "?", size })}</Note>;
  if ((kind === "csv" || kind === "tsv") && !code) {
    const { rows, more } = parseDelimited(c.content, kind === "csv" ? "," : "\t", CSV_ROWS + 1);
    return (
      <>
        {warnings}
        {(more || c.truncated) && <Note>{t("artifacts.csvMore", { n: Math.max(0, rows.length - 1) })}</Note>}
        <Table rows={rows} />
      </>
    );
  }
  // A JSON object / array (acceptance records, manifests — any extension) reads as a record; 原文 shows the JSON.
  const record = kind === "text" ? jsonRecordOf(c.content, !!c.truncated) : null;
  if (record)
    return (
      <>
        {warnings}
        <PageToggle code={rawJson} setCode={setRawJson} labels={["artifacts.json.record", "artifacts.json.raw"]} />
        {rawJson ? (
          <div className="px-3 py-1">
            <Markdown text={fence(JSON.stringify(record, null, 2), "json")} />
          </div>
        ) : (
          <JsonRecord value={record} />
        )}
      </>
    );
  return (
    <>
      {warnings}
      <div className="px-3 py-1">
        <TextPreview kind={kind} text={c.content} code={code} lang={kind === "html" ? "html" : languageFor(typed)} />
      </div>
    </>
  );
}

// ── 出处 ─────────────────────────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-[11px] whitespace-nowrap text-subtle">{label}</dt>
      <dd className="min-w-0 text-xs break-words text-foreground">{children}</dd>
    </>
  );
}

const LINK = "text-accent hover:underline";

function TurnLink({ hostId, sessionId, turnId, label }: { hostId: string; sessionId: string; turnId: string; label: string }) {
  const { t } = useI18n();
  return (
    <button
      className={LINK}
      title={turnId}
      onClick={() =>
        void services.timeline.focusTurn(hostId, sessionId, turnId).then((r) => {
          if (r.status === "focused" || r.status === "stale") return;
          services.ui.notice(t("artifacts.src.turnMissing", { reason: r.status === "host-offline" ? t("gutter.reason.host-offline") : t(r.reason === "reverted" ? "gutter.reason.reverted" : "gutter.reason.gone") }), "error");
        })
      }
    >
      {label}
    </button>
  );
}

function Source({ hostId, version }: { hostId: string; version: ArtifactVersion }) {
  const { t } = useI18n();
  const p = version.producer;
  const delegation = useDelegationTitle(hostId, p.askId);
  const attribution = attributionText(p, t);
  const modelName = useModelName();
  const runtime = [p.profile, p.model ? modelName(p.model, null, p.profile) : null].filter(Boolean).join(" · ");
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 py-2">
      <Field label={t("artifacts.src.producer")}>
        <span className={p.kind === "auto" && p.attribution === "ambiguous" ? "text-warn" : ""}>{producerLabel(p, t)}</span>
        {runtime && <span className="ml-1.5 text-[11px] text-subtle">{runtime}</span>}
        {p.runtimeGeneration !== null && <span className="ml-1.5 text-[11px] text-subtle">gen {p.runtimeGeneration}</span>}
      </Field>
      {p.sessionId && p.turnId && (
        <Field label={t("artifacts.src.turn")}>
          <TurnLink hostId={hostId} sessionId={p.sessionId} turnId={p.turnId} label={t("artifacts.src.jumpTurn")} />
        </Field>
      )}
      {p.askId && (
        <Field label={t("artifacts.src.delegation")}>
          <button className={`${LINK} inline-flex items-center gap-1`} title={p.askId} onClick={() => void openDelegation(hostId, p.askId!, p.sessionId)}>
            <ArrowLeftRight size={11} />
            {delegation ?? t("artifacts.src.openDelegation")}
          </button>
        </Field>
      )}
      {attribution && (
        <Field label={t("artifacts.src.attribution")}>
          <div className={p.attribution === "ambiguous" ? "text-warn" : ""}>{attribution}</div>
          {p.candidates.length > 0 && (
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {p.candidates.map((c) => (
                <li key={`${c.sessionId}:${c.turnId ?? ""}`} className="flex items-center gap-1.5">
                  <span>{sessionName(c)}</span>
                  {c.turnId && <TurnLink hostId={hostId} sessionId={c.sessionId} turnId={c.turnId} label={t("artifacts.src.jumpTurn")} />}
                </li>
              ))}
            </ul>
          )}
        </Field>
      )}
      <Field label={t("artifacts.src.git")}>
        {version.git ? (
          <span>
            <code className="font-mono" title={version.git.commit}>
              {version.git.commit.slice(0, 10)}
            </code>
            <span className={`ml-1.5 text-[11px] ${version.git.dirty ? "text-warn-text" : "text-subtle"}`}>{t(version.git.dirty ? "artifacts.src.dirty" : "artifacts.src.clean")}</span>
          </span>
        ) : (
          <span className="text-subtle">{t("artifacts.src.noGit")}</span>
        )}
      </Field>
      <Field label={t("artifacts.src.path")}>
        <span className="inline-flex max-w-full items-start gap-1">
          <code className="min-w-0 font-mono break-all">{version.sourcePath}</code>
          <button title={t("artifacts.src.copy")} aria-label={t("artifacts.src.copy")} onClick={() => copyText(version.sourcePath)} className="shrink-0 text-subtle hover:text-foreground">
            <Copy size={11} />
          </button>
        </span>
      </Field>
      <Field label={t("artifacts.src.sha")}>{version.sha256 ? <code className="font-mono break-all text-[11px]">{version.sha256}</code> : <span className="text-subtle">{t("artifacts.src.noSha")}</span>}</Field>
      <Field label={t("artifacts.src.size")}>
        {formatBytes(version.bytes)} · <code className="font-mono text-[11px]">{version.mediaType}</code>
      </Field>
      <Field label={t("artifacts.src.storage")}>{t(version.storage === "external" ? "artifacts.src.external" : "artifacts.src.blob")}</Field>
      <Field label={t("artifacts.src.note")}>{version.note ? <span className="whitespace-pre-wrap">{version.note}</span> : <span className="text-subtle">{t("artifacts.src.none")}</span>}</Field>
      <Field label={t("artifacts.src.created")}>{formatAbsolute(seconds(version.createdAt))}</Field>
    </dl>
  );
}

// ── 对比 ─────────────────────────────────────────────────────────────────────────────────────────

function Compare({ hostId, detail, version, open }: { hostId: string; detail: ArtifactDetail; version: ArtifactVersion; open: SideOpen }) {
  const { t } = useI18n();
  const versions = detail.versions;
  const [to, setTo] = useState(version.version);
  const [from, setFrom] = useState(() => previousVersion(versions, version.version) ?? version.version);
  const [diff, setDiff] = useState<{ key: string; value: ArtifactDiff | null; error?: string } | null>(null);
  const key = `${from}:${to}`;
  useEffect(() => {
    if (from === to) return;
    let live = true;
    loadDiff(hostId, detail.artifact.artifactId, from, to).then(
      (value) => live && setDiff({ key, value }),
      (e: unknown) => live && setDiff({ key, value: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [hostId, detail.artifact.artifactId, from, to, key]);
  if (versions.length < 2) return <Note>{t("artifacts.cmp.onlyOne")}</Note>;
  const pick = (value: number, onChange: (n: number) => void, label: string) => (
    <label className="flex items-center gap-1">
      <span className="text-[11px] text-subtle">{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-accent">
        {versions.map((v) => (
          <option key={v.version} value={v.version}>
            v{v.version}
          </option>
        ))}
      </select>
    </label>
  );
  const d = diff && diff.key === key ? diff : null;
  const gap = d?.value ? diffGap(d.value, versions.find((v) => v.version === from), versions.find((v) => v.version === to)) : null;
  const text = d?.value && !d.value.binary && !gap ? (d.value.diff ?? "") : null;
  const openCard = () => {
    if (text === null) return;
    const title = t("artifacts.cmp.title", { name: detail.artifact.name, from, to });
    const r = open(DIFF_COMPONENT, { source: "text", key: `${detail.artifact.artifactId}:${from}:${to}`, title, diff: text }, { binding: { kind: "host", hostId }, focus: true });
    if (r.status !== "opened") explainOpen(r.status === "stale" ? r : { status: "unavailable", reason: r.reason === "capability" ? "capability" : "module-off" });
  };
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        {pick(from, setFrom, t("artifacts.cmp.from"))}
        {pick(to, setTo, t("artifacts.cmp.to"))}
        {text && (
          <button onClick={openCard} className="ml-auto inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
            <ExternalLink size={11} />
            {t("artifacts.cmp.openCard")}
          </button>
        )}
      </div>
      {from === to ? (
        <Note>{t("artifacts.cmp.same")}</Note>
      ) : !d ? (
        <p className="p-3 text-xs text-subtle">{t("artifacts.loading")}</p>
      ) : d.error ? (
        <Note tone="danger">{t("artifacts.loadFailed", { error: d.error })}</Note>
      ) : !d.value ? (
        <Note tone="danger">{t("artifacts.gone")}</Note>
      ) : d.value.binary ? (
        <Note>{t("artifacts.cmp.binary")}</Note>
      ) : gap ? (
        <Note>{t(gap === "external" ? "artifacts.cmp.external" : "artifacts.cmp.tooLarge")}</Note>
      ) : !text ? (
        <Note>{t("artifacts.cmp.same")}</Note>
      ) : (
        <>
          {d.value.truncated && <Note>{t("artifacts.cmp.truncated")}</Note>}
          <UnifiedDiff text={text} className="px-2 pb-2" />
        </>
      )}
    </div>
  );
}

// ── the card ─────────────────────────────────────────────────────────────────────────────────────

const TAB_LABEL: Record<ViewTab, MessageKey> = { preview: "artifacts.pane.preview", code: "artifacts.page.code", origin: "artifacts.pane.origin", compare: "artifacts.pane.compare" };

export function ViewBody({ instance, hostId, setState, open }: SideBodyProps<ViewState>) {
  const { t, locale } = useI18n();
  const now = useClock();
  const state = instance.state;
  const parts = parseArtifactRef(state.ref);
  const { detail, error } = useDetail(hostId, parts?.artifactId ?? null);
  if (!parts || !hostId) return <Note tone="danger">{t("gutter.reason.bad-ref")}</Note>;
  if (error && detail === undefined) return <Note tone="danger">{t("artifacts.loadFailed", { error })}</Note>;
  if (detail === undefined)
    return (
      <p className="flex items-center gap-1.5 p-3 text-xs text-subtle">
        <Loader2 size={12} className="animate-spin" />
        {t("artifacts.loading")}
      </p>
    );
  if (detail === null) return <Note tone="danger">{t("artifacts.gone")}</Note>;
  const a = detail.artifact;
  const version = resolveVersion(detail, parts.version);
  const Icon = KIND_ICON[a.kind];
  const kind = version ? previewKind(version.mediaType, a.name, version.sourcePath) : "binary";
  const selected = currentTab(state, kind);
  const pickVersion = (value: string) => openVersion(open, artifactRef(a.artifactId, value === "latest" ? "latest" : Number(value)), a.name);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-1 text-xs" onContextMenu={contextMenu(() => artifactMenu(hostId, a, open))}>
        <Icon size={13} className="shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 truncate font-medium" title={a.name}>
          {a.name}
        </span>
        {parts.version === "latest" && (
          <span title={t("artifacts.followsLatest")} className="shrink-0 text-subtle">
            <RefreshCw size={11} />
          </span>
        )}
        <select
          value={parts.version === "latest" ? "latest" : String(parts.version)}
          onChange={(e) => pickVersion(e.target.value)}
          aria-label={t("artifacts.versionPick")}
          title={parts.version === "latest" ? t("artifacts.followsLatest") : t("artifacts.pinnedHint")}
          className="max-w-44 shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-accent"
        >
          <option value="latest">{t("artifacts.latestOption", { n: a.latestVersion })}</option>
          {detail.versions.map((v) => (
            <option key={v.version} value={String(v.version)}>
              {t("artifacts.pinnedOption", { n: v.version, when: formatWhen(seconds(v.createdAt), now, locale), who: producerLabel(v.producer, t) })}
            </option>
          ))}
        </select>
      </div>
      {isOldVersion(parts.version, a.latestVersion) && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn-text">
          <History size={12} className="shrink-0" />
          <span className="min-w-0 flex-1">{t("artifacts.oldBanner", { n: parts.version as number, latest: a.latestVersion })}</span>
          <button onClick={() => pickVersion("latest")} className="shrink-0 font-medium hover:underline">
            {t("artifacts.showLatest")}
          </button>
        </div>
      )}
      {!version ? (
        <div className="flex items-start gap-1.5 p-3 text-xs text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {t("artifacts.versionGone", { n: parts.version === "latest" ? a.latestVersion : parts.version })}
        </div>
      ) : (
        <>
          <div role="tablist" className="flex shrink-0 gap-0.5 px-2 pt-1">
            {viewTabs(kind).map((tab) => (
              <button
                key={tab}
                role="tab"
                data-tab={tab}
                aria-selected={selected === tab}
                title={tab === "origin" ? t("artifacts.pane.originHint") : undefined}
                onClick={() => setState(withTab(state, tab))}
                className={`shrink-0 rounded-md px-2 py-0.5 text-[11.5px] whitespace-nowrap ${selected === tab ? "bg-surface-2 font-medium text-foreground" : "text-muted hover:bg-hover"}`}
              >
                {t(TAB_LABEL[tab])}
              </button>
            ))}
            <span className="ml-auto self-center truncate pl-2 text-[11px] text-subtle" title={producerLabel(version.producer, t)}>
              v{version.version} · {producerLabel(version.producer, t)}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto pb-2">
            {state.pane === "source" ? (
              <Source hostId={hostId} version={version} />
            ) : state.pane === "compare" ? (
              <Compare key={version.version} hostId={hostId} detail={detail} version={version} open={open} />
            ) : (
              <>
                {version.storage === "external" && <Note>{t("artifacts.externalNote")}</Note>}
                <Preview key={selected} hostId={hostId} name={a.name} version={version} code={selected === "code"} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Card header button: the version's markdown link to the clipboard. */
export function ViewActions({ instance, hostId }: SideBodyProps<ViewState>) {
  const { t } = useI18n();
  const parts = parseArtifactRef(instance.state.ref);
  const detail = useCachedDetail(hostId, parts?.artifactId ?? null);
  return (
    <button
      title={t("artifacts.copyLink")}
      aria-label={t("artifacts.copyLink")}
      onClick={() => copyArtifactLink(instance.state.ref, detail?.artifact.name ?? instance.state.name ?? instance.state.ref)}
      className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground"
    >
      <Copy size={13} />
    </button>
  );
}
