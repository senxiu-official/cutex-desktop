// 成果 (artifacts) pure helpers (tested in test/artifacts.test.ts): side component params / state,
// version identity (pinned vs latest, after the research demo's workspaceTabs.ts), producer and
// attribution text, preview kinds, a small CSV reader, and the `artifact_publish` tool call.
// Wire shapes: shared/artifactStore.ts (docs/research/artifacts-api-v1.md).
import { ARTIFACT_KINDS, ARTIFACT_PUBLISH_TOOL, parseArtifactRef, type ArtifactContent, type ArtifactDetail, type ArtifactDiff, type ArtifactKind, type ArtifactListQuery, type ArtifactProducer, type ArtifactSummary, type ArtifactVersion } from "../../../../shared/artifactStore";
import { toolArgs, toolResult } from "../../lib/taskRows";
import type { MessageKey } from "../../i18n";
import type { RawItem } from "../../lib/timeline";
import type { Json } from "../types";

export const LIBRARY = "artifacts.library";
export const VIEW = "artifacts.view";
/** The `ref.target` kind of `cutex:artifact/<ref>` links. */
export const ARTIFACT_REF_KIND = "artifact";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const MAX_NAME = 200;

// ── artifacts.view ───────────────────────────────────────────────────────────────────────────────

export type ViewPane = "preview" | "source" | "compare";
const PANES: readonly ViewPane[] = ["preview", "source", "compare"];
export interface ViewParams {
  /** `af-…@<n>` or `af-…@latest`: the tab identity (pinned and latest are two tabs). */
  ref: string;
  /** Known name, for the tab title before the artifact loads. */
  name?: string;
}
export interface ViewState {
  ref: string;
  pane: ViewPane;
  name?: string;
  /** An HTML page shown as its source code instead of the rendered page (「源代码」). */
  code?: true;
}

export function parseViewParams(raw: Json): ViewParams | null {
  if (!isRecord(raw) || typeof raw.ref !== "string" || !parseArtifactRef(raw.ref)) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, MAX_NAME) : undefined;
  return name ? { ref: raw.ref, name } : { ref: raw.ref };
}

/** Same ref = same tab; `af-x@3` and `af-x@latest` never share one. */
export function viewKey(p: Pick<ViewParams, "ref">): string {
  return p.ref;
}

export function initView(p: ViewParams, previous: ViewState | null): ViewState {
  const same = previous?.ref === p.ref;
  const pane = previous && same ? previous.pane : "preview";
  const name = p.name ?? (same ? previous?.name : undefined);
  return { ref: p.ref, pane, ...(name ? { name } : {}), ...(same && previous?.code ? { code: true as const } : {}) };
}

export function restoreView(raw: Json, version: number): ViewState | null {
  if (version !== 1 || !isRecord(raw)) return null;
  const p = parseViewParams(raw);
  if (!p) return null;
  const pane = PANES.includes(raw.pane as ViewPane) ? (raw.pane as ViewPane) : "preview";
  return { ref: p.ref, pane, ...(p.name ? { name: p.name } : {}), ...(raw.code === true ? { code: true as const } : {}) };
}

/**
 * The version a tab shows: exactly the pinned one, or the artifact's current latest. Never falls
 * back from a missing pinned version to the latest (the demo's resolveWorkspaceArtifact rule).
 */
export function resolveVersion(detail: ArtifactDetail | null | undefined, sel: number | "latest"): ArtifactVersion | undefined {
  if (!detail) return undefined;
  const want = sel === "latest" ? detail.artifact.latestVersion : sel;
  return detail.versions.find((v) => v.version === want);
}

/** A pinned tab looking at something older than the latest. */
export function isOldVersion(sel: number | "latest", latestVersion: number): boolean {
  return sel !== "latest" && sel < latestVersion;
}

/** The version shown before / after `to` for 对比 (newest-first list). */
export function previousVersion(versions: readonly Pick<ArtifactVersion, "version">[], to: number): number | null {
  let best: number | null = null;
  for (const v of versions) if (v.version < to && (best === null || v.version > best)) best = v.version;
  return best;
}

/**
 * Why cutex sent no text diff: `diff: null` without `binary` means it did not diff at all — an
 * external version (only its path is registered, no bytes per version) or input over cutex's diff
 * limit. null = there is a diff (an empty one means the versions are identical).
 */
export type DiffGap = "external" | "large";
export function diffGap(d: Pick<ArtifactDiff, "binary" | "diff">, from: Pick<ArtifactVersion, "storage"> | undefined, to: Pick<ArtifactVersion, "storage"> | undefined): DiffGap | null {
  if (d.binary || d.diff !== null) return null;
  return from?.storage === "external" || to?.storage === "external" ? "external" : "large";
}

/** An external version whose file changed after it was registered: cutex sends no content then. */
export function externalGone(c: Pick<ArtifactContent, "externalChanged" | "content">): boolean {
  return c.externalChanged === true && c.content === "";
}

// ── artifacts.library ────────────────────────────────────────────────────────────────────────────

export type LibrarySort = "updated" | "created" | "name" | "kind";
export const LIBRARY_SORTS: readonly LibrarySort[] = ["updated", "created", "name", "kind"];
export type ArchivedFilter = "false" | "true" | "all";
export interface LibraryState {
  q: string;
  kind: ArtifactKind | "";
  /** "" = anyone; "owner" / "auto" / `agent:<sessionId>`. */
  producer: string;
  sort: LibrarySort;
  layout: "list" | "grid";
  archived: ArchivedFilter;
}
export const DEFAULT_LIBRARY: LibraryState = { q: "", kind: "", producer: "", sort: "updated", layout: "list", archived: "false" };

/** Whose library: the scope a session publishes to (side card) or one project (项目 page tab, §21). */
export type LibraryScope = { forSession: string } | { project: string };

/** The list request of a library view (one page; `cursor` for the next). */
export function libraryQuery(scope: LibraryScope, filter: { q: string; kind: ArtifactKind | ""; archived: ArchivedFilter }, limit: number, cursor?: string): ArtifactListQuery {
  return {
    ...("project" in scope ? { project: scope.project } : { forSession: scope.forSession }),
    ...(filter.q ? { q: filter.q } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
    archived: filter.archived,
    limit,
    ...(cursor ? { cursor } : {}),
  };
}

/** A stable key of a library scope (reload when it changes). */
export const libraryScopeKey = (scope: LibraryScope): string => ("project" in scope ? `p:${scope.project}` : `s:${scope.forSession}`);

export function restoreLibrary(raw: Json): LibraryState {
  if (!isRecord(raw)) return DEFAULT_LIBRARY;
  return {
    q: typeof raw.q === "string" ? raw.q.slice(0, 200) : "",
    kind: (ARTIFACT_KINDS as readonly string[]).includes(raw.kind as string) ? (raw.kind as ArtifactKind) : "",
    producer: typeof raw.producer === "string" && raw.producer.length <= 300 ? raw.producer : "",
    sort: LIBRARY_SORTS.includes(raw.sort as LibrarySort) ? (raw.sort as LibrarySort) : "updated",
    layout: raw.layout === "grid" ? "grid" : "list",
    archived: raw.archived === "true" || raw.archived === "all" ? raw.archived : "false",
  };
}

/** A producer's / candidate's name; cutex sends null when it has none for the session, then its id. */
export function sessionName(s: { displayName: string | null; sessionId: string | null }): string {
  return s.displayName?.trim() || s.sessionId || "";
}

/** The producer filter key of a version: owner / auto / agent:<sessionId>. */
export function producerKey(p: ArtifactProducer): string {
  if (p.kind === "owner") return "owner";
  if (p.kind === "auto") return "auto";
  return `agent:${p.sessionId ?? p.displayName ?? ""}`;
}

/** Distinct producers of a list (filter options), agents by name. */
export function producerOptions(items: readonly ArtifactSummary[]): { key: string; name: string; kind: ArtifactProducer["kind"] }[] {
  const seen = new Map<string, { key: string; name: string; kind: ArtifactProducer["kind"] }>();
  for (const a of items) {
    const p = a.latest.producer;
    const key = producerKey(p);
    if (!seen.has(key)) seen.set(key, { key, name: sessionName(p), kind: p.kind });
  }
  const order = { agent: 0, owner: 1, auto: 2 } as const;
  return [...seen.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

/** Client-side producer filter + sort of a loaded page (search, kind and archived are cutex's). */
export function arrangeLibrary(items: readonly ArtifactSummary[], state: Pick<LibraryState, "producer" | "sort">): ArtifactSummary[] {
  const rows = state.producer ? items.filter((a) => producerKey(a.latest.producer) === state.producer) : [...items];
  const byName = (a: ArtifactSummary, b: ArtifactSummary) => a.name.localeCompare(b.name);
  const time = (s: string) => Date.parse(s) || 0;
  switch (state.sort) {
    case "name":
      return rows.sort(byName);
    case "kind":
      return rows.sort((a, b) => ARTIFACT_KINDS.indexOf(a.kind) - ARTIFACT_KINDS.indexOf(b.kind) || byName(a, b));
    case "created":
      return rows.sort((a, b) => time(b.createdAt) - time(a.createdAt) || byName(a, b));
    default:
      return rows.sort((a, b) => time(b.updatedAt) - time(a.updatedAt) || byName(a, b));
  }
}

// ── producers / attribution ───────────────────────────────────────────────────────────────────────

/**
 * Who made a version, in one line: the agent's name, the owner, or for an auto capture
 * 「自动 · A」 (exclusive), 「自动 · 可能是 A / B」 (ambiguous), 「自动 · 来源不明」 (unknown).
 */
export function producerLabel(p: ArtifactProducer, t: T): string {
  if (p.kind === "owner") return t("artifacts.producer.owner");
  if (p.kind === "agent") return sessionName(p);
  const names = p.candidates.map(sessionName).filter(Boolean);
  if (p.attribution === "exclusive" && names.length) return t("artifacts.producer.autoExclusive", { name: names[0]! });
  if (p.attribution === "ambiguous" && names.length) return t("artifacts.producer.autoAmbiguous", { names: names.join(" / ") });
  return t("artifacts.producer.autoUnknown");
}

/** The 来源 panel's attribution sentence for an auto capture (null for agent / owner). */
export function attributionText(p: ArtifactProducer, t: T): string | null {
  if (p.kind !== "auto") return null;
  const names = p.candidates.map(sessionName).filter(Boolean);
  if (p.attribution === "exclusive" && names.length) return t("artifacts.src.exclusive", { name: names[0]! });
  if (p.attribution === "ambiguous" && names.length) return t("artifacts.src.ambiguous", { names: names.join(" / ") });
  return t("artifacts.src.unknown");
}

// ── preview ──────────────────────────────────────────────────────────────────────────────────────

/** `html`: a page rendered in the offline opaque frame (§10.2), with its source a toggle away. */
export type PreviewKind = "markdown" | "html" | "image" | "csv" | "tsv" | "text" | "binary";

const TEXT_APPS = /^application\/(json|xml|x-yaml|yaml|toml|javascript|x-javascript|x-sh|x-python|sql|x-tex|ld\+json)$|\+(json|xml)$/;
const EXT_TEXT = /^(txt|log|json|jsonl|ya?ml|toml|ini|cfg|conf|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|r|rmd|jl|m|rs|go|java|kt|c|h|cpp|hpp|cs|sh|ps1|bat|sql|tex|bib|ipynb)$/;

function extOf(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : "";
}

/** How to preview a version: by media type first, then by the name's extension. */
export function previewKind(mediaType: string, name: string): PreviewKind {
  const mime = (mediaType.split(";")[0] ?? "").trim().toLowerCase();
  const ext = extOf(name);
  if (mime === "text/markdown" || mime === "text/x-markdown" || ext === "md" || ext === "markdown") return "markdown";
  if (mime.startsWith("image/")) return "image";
  if (mime === "text/html" || mime === "application/xhtml+xml" || ext === "html" || ext === "htm" || ext === "xhtml") return "html";
  if (mime === "text/csv" || ext === "csv") return "csv";
  if (mime === "text/tab-separated-values" || ext === "tsv") return "tsv";
  if (mime.startsWith("text/") || TEXT_APPS.test(mime) || EXT_TEXT.test(ext)) return "text";
  return "binary";
}

/** Rows of a CSV / TSV text (quotes, doubled quotes, CRLF), at most `maxRows`; `more` = there were further rows. */
export function parseDelimited(text: string, delimiter: "," | "\t", maxRows: number): { rows: string[][]; more: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    field = "";
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
      if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), more: true };
    } else field += c;
    i++;
  }
  if (field !== "" || row.length) endRow();
  return rows.length > maxRows ? { rows: rows.slice(0, maxRows), more: true } : { rows, more: false };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** A code fence that survives backticks inside the text. */
export function fence(text: string, lang: string): string {
  let ticks = "```";
  while (text.includes(ticks)) ticks += "`";
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

// ── artifact_publish (timeline card) ──────────────────────────────────────────────────────────────

export interface PublishCall {
  status: "running" | "done" | "failed";
  /** The artifact name: the result's `name`, else its markdown label, else the name / path argument. */
  name: string;
  path: string | null;
  ref: string | null;
  version: number | null;
  newVersion: boolean | null;
}

const MD_LINK = /^\[((?:\\.|[^\]\\])*)\]\(cutex:artifact\/[^)\s]+\)$/;

/** `[<label> v<n>](cutex:artifact/…)` → label (escapes undone, the trailing ` v<n>` dropped). cutex
 * labels the link with the name's last path segment only. */
export function nameFromMarkdown(md: unknown): string | null {
  if (typeof md !== "string") return null;
  const m = MD_LINK.exec(md.trim());
  if (!m) return null;
  return m[1]!.replace(/\\(.)/g, "$1").replace(/\s+v\d+$/, "").trim() || null;
}

export function isPublishTool(item: RawItem): boolean {
  return item.type === "mcpToolCall" && item.server === "cutex" && item.tool === ARTIFACT_PUBLISH_TOOL;
}

export function publishCallOf(item: RawItem): PublishCall | null {
  if (!isPublishTool(item)) return null;
  const a = toolArgs(item);
  const r = toolResult(item);
  const path = typeof a.path === "string" && a.path ? a.path : null;
  const argName = typeof a.name === "string" && a.name.trim() ? a.name.trim() : null;
  const fallback = argName ?? (path ? (path.split(/[\\/]/).filter(Boolean).pop() ?? path) : "");
  const running = item.status === "inProgress" || item.status === "running";
  const refused = r?.ok === false || (isRecord(item.result) && item.result.isError === true) || item.status === "failed" || item.status === "errored";
  const ref = typeof r?.ref === "string" && parseArtifactRef(r.ref) ? r.ref : null;
  if (running) return { status: "running", name: fallback, path, ref: null, version: null, newVersion: null };
  if (refused || !ref) return { status: "failed", name: fallback, path, ref: null, version: null, newVersion: null };
  return {
    status: "done",
    // The full artifact name, as in the library; the markdown label is only its last segment.
    name: (typeof r?.name === "string" && r.name.trim() ? r.name.trim() : null) ?? nameFromMarkdown(r?.markdown) ?? argName ?? fallback,
    path,
    ref,
    version: typeof r?.version === "number" ? r.version : null,
    newVersion: typeof r?.new_version === "boolean" ? r.new_version : null,
  };
}

// ── JSON records ─────────────────────────────────────────────────────────────────────────────────

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A text version whose whole content is one JSON object or array (an acceptance record, a manifest):
 *  the parsed value, else null (truncated content, other text, a bare scalar). Any extension: agents
 *  often save these as .txt or without one. */
export function jsonRecordOf(content: string, truncated: boolean): JsonValue[] | { [key: string]: JsonValue } | null {
  if (truncated) return null;
  const text = content.trim();
  if (!(text.startsWith("{") && text.endsWith("}")) && !(text.startsWith("[") && text.endsWith("]"))) return null;
  try {
    const value = JSON.parse(text) as JsonValue;
    return value !== null && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** A record key as a label: `director_verification` / `inputManifest` → "director verification" / "input manifest". */
export function jsonKeyLabel(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().toLowerCase() || key;
}

/** Scalars only (an array of these shows inline, comma-separated). */
export function isJsonScalar(value: JsonValue): value is string | number | boolean | null {
  return value === null || typeof value !== "object";
}
