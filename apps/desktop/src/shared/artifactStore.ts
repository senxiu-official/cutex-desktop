// Artifact store (成果, cutex capability `artifacts`): the wire shapes of `/v2/artifact-store` and the
// `cutex/artifact/*` events, exactly as fixed in docs/research/artifacts-api-v1.md, plus the request
// builders the main process uses. Bodies and queries are rebuilt from known fields only, so a
// renderer bug cannot send cutex anything the contract does not name.
//
// Not to be confused with `GET /v2/artifacts/{id}` (a delegation's attachments, `ArtifactView` in ipc.ts).
import type { CutexRefusal } from "./ipc";

/** cutex capability of the artifact store. */
export const ARTIFACTS_FEATURE = "artifacts";
export const ARTIFACT_PUBLISHED_EVENT = "cutex/artifact/published";
export const ARTIFACT_UPDATED_EVENT = "cutex/artifact/updated";
/** cutex capability: `artifact_publish {show: true}` asks the desktop to open the artifact (event below). */
export const ARTIFACT_SHOW_FEATURE = "artifact-show";
export const ARTIFACT_SHOW_REQUESTED_EVENT = "cutex/artifact/showRequested";
/** The MCP tool agents publish with (timeline card). */
export const ARTIFACT_PUBLISH_TOOL = "artifact_publish";

export const ARTIFACT_KINDS = ["report", "figure", "table", "data", "plan", "handoff", "other"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** `af-<32 lowercase hex>`. */
export const ARTIFACT_ID = /^af-[0-9a-f]{32}$/;
/** `af-…@<n>` (pinned) or `af-…@latest`. */
export const ARTIFACT_REF = /^(af-[0-9a-f]{32})@(latest|[1-9][0-9]{0,8})$/;
/** Content page limits (`maxBytes` default / max). */
export const ARTIFACT_CONTENT_DEFAULT = 262_144;
export const ARTIFACT_CONTENT_MAX = 4 * 1024 * 1024;
export const ARTIFACT_LIST_MAX = 200;
export const ARTIFACT_RESOLVE_MAX = 200;

// ---------- wire ----------

export interface ArtifactScope {
  kind: "project" | "session";
  id: string;
}

export interface ArtifactCandidate {
  sessionId: string;
  /** null when cutex has no name for the session (one it no longer knows). */
  displayName: string | null;
  turnId: string | null;
}

export interface ArtifactProducer {
  kind: "agent" | "owner" | "auto";
  sessionId: string | null;
  /** null when cutex has no name for the session (the owner, or a session it no longer knows). */
  displayName: string | null;
  runtimeGeneration: number | null;
  turnId: string | null;
  askId: string | null;
  profile: string | null;
  model: string | null;
  /** Auto capture only; null for agent / owner. */
  attribution: "exclusive" | "ambiguous" | "unknown" | null;
  candidates: ArtifactCandidate[];
}

export interface ArtifactVersion {
  artifactId: string;
  version: number;
  ref: string;
  link: string;
  storage: "blob" | "external";
  sha256: string | null;
  bytes: number;
  mediaType: string;
  sourcePath: string;
  note: string | null;
  producer: ArtifactProducer;
  git: { commit: string; dirty: boolean } | null;
  createdAt: string;
}

export interface ArtifactSummary {
  artifactId: string;
  scope: ArtifactScope;
  name: string;
  kind: ArtifactKind;
  latestVersion: number;
  revision: number;
  starred: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latest: ArtifactVersion;
}

export interface ArtifactList {
  scope: ArtifactScope;
  items: ArtifactSummary[];
  nextCursor: string | null;
}

export interface ArtifactDetail {
  artifact: ArtifactSummary;
  /** Newest first. */
  versions: ArtifactVersion[];
}

export interface ArtifactContent {
  version: number;
  encoding: "utf8" | "base64";
  content: string;
  offset: number;
  totalBytes: number;
  truncated: boolean;
  mediaType: string;
  sha256: string | null;
  /** null for a blob; else whether the file on disk no longer matches the registered size / mtime / hash. */
  externalChanged: boolean | null;
}

export interface ArtifactDiff {
  from: number;
  to: number;
  binary: boolean;
  diff: string | null;
  truncated: boolean;
}

export type ArtifactResolveItem =
  | { ref: string; ok: true; artifactId: string; name: string; kind: ArtifactKind; version: number; latestVersion: number; mediaType: string; archived: boolean }
  | { ref: string; ok: false; error: "artifact_not_found" | "forbidden" };

export interface ArtifactUsage {
  bytes: number;
  blobs: number;
  artifacts: number;
  versions: number;
  quotaBytes: number;
  maxBlobBytes: number;
  hashExternalMaxBytes: number;
}

export interface ArtifactPublished {
  artifact: ArtifactSummary;
  version: ArtifactVersion;
  newVersion: boolean;
  /** `[<name> v<n>](cutex:artifact/<ref>)`, ready to paste. */
  markdown: string;
}

/** `cutex/artifact/published` params. */
export interface ArtifactPublishedEvent {
  artifactId: string;
  version: number;
  scope: ArtifactScope;
  name: string;
  kind: ArtifactKind;
  producer: ArtifactProducer;
  newVersion: boolean;
}

export type ArtifactChange = "renamed" | "kind" | "starred" | "archived" | "unarchived" | "deleted";
/** `cutex/artifact/updated` params. */
export interface ArtifactUpdatedEvent {
  artifactId: string;
  scope: ArtifactScope;
  change: ArtifactChange;
  revision: number;
}

// ---------- requests (renderer → main) ----------

export interface ArtifactListQuery {
  /** Exactly one of project / session / forSession (the scope that session publishes to). */
  project?: string;
  session?: string;
  forSession?: string;
  q?: string;
  kind?: ArtifactKind;
  producer?: string;
  archived?: "false" | "true" | "all";
  limit?: number;
  cursor?: string;
}

export interface ArtifactPublishRequest {
  /** Idempotency key; the same key returns the first result. */
  requestId: string;
  project?: string;
  session?: string;
  /** Absolute, or relative to the scope's workspace root. */
  path: string;
  name?: string;
  kind?: ArtifactKind;
  note?: string;
}

export interface ArtifactPatch {
  expectedRevision: number;
  name?: string;
  kind?: ArtifactKind;
  starred?: boolean;
  archived?: boolean;
}

export type ArtifactPublishResult = { ok: true; published: ArtifactPublished } | { ok: false; error: CutexRefusal };
/** A 409 `artifact_revision_conflict` carries the current revision (`details.revision`). */
export type ArtifactPatchResult = { ok: true; artifact: ArtifactSummary } | { ok: false; error: CutexRefusal; revision?: number };
export type ArtifactDeleteResult = { ok: true; artifactId: string } | { ok: false; error: CutexRefusal };

// ---------- refs ----------

export interface ArtifactRefParts {
  artifactId: string;
  /** A pinned version, or "latest". */
  version: number | "latest";
}

export function parseArtifactRef(ref: unknown): ArtifactRefParts | null {
  if (typeof ref !== "string") return null;
  const m = ARTIFACT_REF.exec(ref);
  if (!m) return null;
  return { artifactId: m[1]!, version: m[2] === "latest" ? "latest" : Number(m[2]) };
}

export function artifactRef(artifactId: string, version: number | "latest"): string {
  return `${artifactId}@${version}`;
}

/** `cutex:artifact/<ref>`. */
export function artifactLink(ref: string): string {
  return `cutex:artifact/${ref}`;
}

/** `[<text>](cutex:artifact/<ref>)`; brackets / backslashes in the text escaped. */
export function artifactMarkdown(text: string, ref: string): string {
  return `[${text.replace(/[\\[\]]/g, (c) => `\\${c}`)}](${artifactLink(ref)})`;
}

// ---------- validators (main process) ----------

const SCOPE_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isKind = (v: unknown): v is ArtifactKind => typeof v === "string" && (ARTIFACT_KINDS as readonly string[]).includes(v);

function text(v: unknown, max: number, what: string): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error(`bad ${what}`);
  return v;
}

export function artifactId(id: unknown): string {
  if (typeof id !== "string" || !ARTIFACT_ID.test(id)) throw new Error("bad artifact id");
  return id;
}

/** A version selector for the content route: a positive version number or "latest". */
export function artifactVersionSel(v: unknown): string {
  if (v === "latest") return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 1) return String(v);
  throw new Error("bad artifact version");
}

function versionNumber(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) throw new Error(`bad ${what}`);
  return v;
}

/** GET /v2/artifact-store query: only the contract's parameters, one scope selector. */
export function artifactListQuery(input: unknown): Record<string, string | number> {
  if (!isRecord(input)) throw new Error("bad artifact query");
  const out: Record<string, string | number> = {};
  const scopes = (["project", "session", "forSession"] as const).filter((k) => input[k] !== undefined);
  if (scopes.length > 1) throw new Error("one scope selector only");
  for (const k of scopes) {
    if (typeof input[k] !== "string" || !SCOPE_ID.test(input[k] as string)) throw new Error(`bad ${k}`);
    out[k] = input[k] as string;
  }
  if (input.q !== undefined && input.q !== "") out.q = text(input.q, 200, "q").trim();
  if (input.kind !== undefined) {
    if (!isKind(input.kind)) throw new Error("bad kind");
    out.kind = input.kind;
  }
  if (input.producer !== undefined) {
    if (typeof input.producer !== "string" || !SCOPE_ID.test(input.producer)) throw new Error("bad producer");
    out.producer = input.producer;
  }
  if (input.archived !== undefined) {
    if (input.archived !== "false" && input.archived !== "true" && input.archived !== "all") throw new Error("bad archived");
    out.archived = input.archived;
  }
  if (input.limit !== undefined) {
    if (typeof input.limit !== "number" || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > ARTIFACT_LIST_MAX) throw new Error("bad limit");
    out.limit = input.limit;
  }
  if (input.cursor !== undefined && input.cursor !== null) out.cursor = text(input.cursor, 1000, "cursor");
  return out;
}

/** Content page query: offset ≥ 0, 1 ≤ maxBytes ≤ 4 MiB (cutex defaults when omitted). */
export function artifactContentQuery(input: unknown): Record<string, number> {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) throw new Error("bad content query");
  const out: Record<string, number> = {};
  if (input.offset !== undefined) {
    if (typeof input.offset !== "number" || !Number.isSafeInteger(input.offset) || input.offset < 0) throw new Error("bad offset");
    out.offset = input.offset;
  }
  if (input.maxBytes !== undefined) {
    if (typeof input.maxBytes !== "number" || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > ARTIFACT_CONTENT_MAX) throw new Error("bad maxBytes");
    out.maxBytes = input.maxBytes;
  }
  return out;
}

export function artifactDiffQuery(from: unknown, to: unknown): { from: number; to: number } {
  return { from: versionNumber(from, "from version"), to: versionNumber(to, "to version") };
}

/** POST /v2/artifact-store/resolve body: well-formed refs only, deduplicated, at most 200. */
export function artifactResolveBody(refs: unknown): { refs: string[] } {
  if (!Array.isArray(refs) || refs.length === 0) throw new Error("bad refs");
  const out = [...new Set(refs)];
  if (out.length > ARTIFACT_RESOLVE_MAX || !out.every((r) => parseArtifactRef(r))) throw new Error("bad refs");
  return { refs: out as string[] };
}

/** POST /v2/artifact-store (owner publish). */
export function artifactPublishBody(input: unknown): ArtifactPublishRequest {
  if (!isRecord(input)) throw new Error("bad publish request");
  const body: ArtifactPublishRequest = { requestId: text(input.requestId, 200, "requestId"), path: text(input.path, 4096, "path").trim() };
  if (input.project !== undefined && input.session !== undefined) throw new Error("one scope only");
  if (input.project !== undefined) {
    if (typeof input.project !== "string" || !SCOPE_ID.test(input.project)) throw new Error("bad project");
    body.project = input.project;
  }
  if (input.session !== undefined) {
    if (typeof input.session !== "string" || !SCOPE_ID.test(input.session)) throw new Error("bad session");
    body.session = input.session;
  }
  if (input.name !== undefined && input.name !== "") body.name = text(input.name, 1000, "name").trim();
  if (input.kind !== undefined) {
    if (!isKind(input.kind)) throw new Error("bad kind");
    body.kind = input.kind;
  }
  if (input.note !== undefined && input.note !== "") body.note = text(input.note, 4000, "note").trim();
  return body;
}

/** PATCH /v2/artifact-store/{id}: expectedRevision plus at least one change. */
export function artifactPatchBody(input: unknown): ArtifactPatch {
  if (!isRecord(input)) throw new Error("bad patch");
  if (typeof input.expectedRevision !== "number" || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error("bad expectedRevision");
  const body: ArtifactPatch = { expectedRevision: input.expectedRevision };
  if (input.name !== undefined) body.name = text(input.name, 1000, "name").trim();
  if (input.kind !== undefined) {
    if (!isKind(input.kind)) throw new Error("bad kind");
    body.kind = input.kind;
  }
  if (input.starred !== undefined) {
    if (typeof input.starred !== "boolean") throw new Error("bad starred");
    body.starred = input.starred;
  }
  if (input.archived !== undefined) {
    if (typeof input.archived !== "boolean") throw new Error("bad archived");
    body.archived = input.archived;
  }
  if (Object.keys(body).length === 1) throw new Error("empty patch");
  return body;
}
