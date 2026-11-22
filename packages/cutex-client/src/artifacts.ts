// Artifacts and workspace files for clients without the desktop's main process (the phone): the
// artifact store (docs/research/artifacts-api-v1.md, capability `artifacts`) and the workspace file
// read (`{scope}/fs/file`; `/v2/fs/file` with capability `fs-file-read`, owner only). The host has no
// raw-bytes route: content comes as JSON pages (utf8 or base64, at most 4 MiB each), so `readArtifact`
// stitches the pages and checks the version's sha256. Browser-safe (WebCrypto, no Node built-ins).
import type { CutexClient } from "./client";
import { CutexApiError } from "./errors";

export type ArtifactKind = "report" | "figure" | "table" | "data" | "plan" | "handoff" | "other" | string;

export interface ArtifactProducer {
  kind: "agent" | "owner" | "auto" | string;
  sessionId: string | null;
  displayName: string | null;
}

export interface ArtifactVersion {
  artifactId: string;
  version: number;
  ref: string;
  link: string;
  storage: "blob" | "external" | string;
  sha256: string | null;
  bytes: number;
  mediaType: string;
  sourcePath?: string | null;
  note?: string | null;
  producer?: ArtifactProducer | null;
  createdAt: string;
}

export interface ArtifactSummary {
  artifactId: string;
  scope: { kind: "project" | "session" | string; id: string };
  name: string;
  kind: ArtifactKind;
  latestVersion: number;
  revision: number;
  starred?: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latest: ArtifactVersion;
}

export interface ArtifactPage {
  items: ArtifactSummary[];
  nextCursor: string | null;
}

export interface ArtifactContentPage {
  version: number;
  encoding: "utf8" | "base64";
  content: string;
  offset: number;
  totalBytes: number;
  truncated: boolean;
  mediaType: string;
  sha256: string | null;
  externalChanged: boolean | null;
}

export type ArtifactResolved =
  | { ref: string; ok: true; artifactId: string; name: string; kind: ArtifactKind; version: number; latestVersion: number; mediaType: string; archived: boolean }
  | { ref: string; ok: false; error: string };

export interface WorkspaceFile {
  path: string;
  size: number;
  modifiedAt: string;
  encoding: "utf8" | "base64";
  content: string;
  truncated: boolean;
  mime: string;
}

/** Where a workspace path is read: a project's or a session's workspace root; null = the host file route (owner). */
export type FileScope = { kind: "project" | "session"; id: string } | null;

export const ARTIFACT_PAGE_BYTES = 4 * 1024 * 1024;

/** `cutex:artifact/<ref>` → the ref (`af-…@3`, `af-…@latest` or a bare id); null when it is not one. */
export function artifactRefOf(href: string): string | null {
  const m = /^cutex:artifact\/([A-Za-z0-9._~-]+(?:@(?:\d+|latest))?)$/.exec(href.trim());
  return m ? m[1]! : null;
}

/** `af-…@3` → id + version (`latest` when absent). */
export function splitArtifactRef(ref: string): { artifactId: string; version: number | "latest" } {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return { artifactId: ref, version: "latest" };
  const v = ref.slice(at + 1);
  return { artifactId: ref.slice(0, at), version: v === "latest" ? "latest" : Number(v) };
}

const enc = encodeURIComponent;

/**
 * One page of the artifact store. `scope` is an exact scope filter (at most one of project, session,
 * forSession). `producer` (a session id) keeps artifacts that session produced a version of, in any
 * scope — an agent's own files, since project members publish into the project scope; `publisher`
 * filters by the latest version's producer ("owner" for the owner's).
 */
export function listArtifacts(
  client: CutexClient,
  scope: { project?: string; session?: string; forSession?: string },
  options: { q?: string; kind?: string; producer?: string; publisher?: string; source?: "all" | "collected" | "published"; limit?: number; cursor?: string; archived?: "false" | "true" | "all"; signal?: AbortSignal } = {},
): Promise<ArtifactPage> {
  const { signal, ...rest } = options;
  return client.request("GET", "/v2/artifact-store", { query: { ...scope, ...rest } as Record<string, string | number | undefined>, ...(signal ? { signal } : {}) });
}

export function getArtifact(client: CutexClient, artifactId: string, signal?: AbortSignal): Promise<{ artifact: ArtifactSummary; versions: ArtifactVersion[] }> {
  return client.request("GET", `/v2/artifact-store/${enc(artifactId)}`, signal ? { signal } : {});
}

export async function resolveArtifacts(client: CutexClient, refs: string[]): Promise<ArtifactResolved[]> {
  if (refs.length === 0) return [];
  return (await client.request<{ items: ArtifactResolved[] }>("POST", "/v2/artifact-store/resolve", { body: { refs: refs.slice(0, 200) } })).items;
}

export function artifactContentPage(client: CutexClient, artifactId: string, version: number | "latest", offset = 0, maxBytes = ARTIFACT_PAGE_BYTES, signal?: AbortSignal): Promise<ArtifactContentPage> {
  return client.request("GET", `/v2/artifact-store/${enc(artifactId)}/versions/${version}/content`, { query: { offset, maxBytes }, ...(signal ? { signal } : {}) });
}

export class ArtifactIntegrityError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`artifact content does not match its sha256 (${expected.slice(0, 12)}… ≠ ${actual.slice(0, 12)}…)`);
    this.name = "ArtifactIntegrityError";
  }
}

/** The content changed while it was read page by page (external files without a sha256), or a page did not fit. */
export class ArtifactChangedError extends Error {
  constructor(readonly reason: string) {
    super(`artifact content changed while reading (${reason})`);
    this.name = "ArtifactChangedError";
  }
}

export class ArtifactTooLargeError extends Error {
  constructor(readonly totalBytes: number, readonly limit: number) {
    super(`artifact is ${totalBytes} bytes; the limit here is ${limit}`);
    this.name = "ArtifactTooLargeError";
  }
}

function decodePage(page: ArtifactContentPage | WorkspaceFile): Uint8Array {
  if (page.encoding === "utf8") return new TextEncoder().encode(page.content);
  const bin = atob(page.content);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ArtifactBytes {
  bytes: Uint8Array;
  mediaType: string;
  version: number;
  sha256: string | null;
  /** External file whose disk copy no longer matches what was registered. */
  externalChanged: boolean | null;
}

/**
 * The whole content of one version: pages of `pageBytes` stitched in order, then checked against the
 * sha256 the host reports (external files over the hash limit have none). `maxBytes` refuses large
 * files before the first page beyond the first one is read.
 */
export async function readArtifact(
  client: CutexClient,
  artifactId: string,
  version: number | "latest",
  options: { maxBytes?: number; pageBytes?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ArtifactBytes> {
  const pageBytes = Math.min(options.pageBytes ?? ARTIFACT_PAGE_BYTES, ARTIFACT_PAGE_BYTES);
  const first = await artifactContentPage(client, artifactId, version, 0, pageBytes, options.signal);
  if (options.maxBytes !== undefined && first.totalBytes > options.maxBytes) throw new ArtifactTooLargeError(first.totalBytes, options.maxBytes);
  const total = first.totalBytes;
  const firstBytes = decodePage(first);
  if (first.offset !== 0 || firstBytes.length > total) throw new ArtifactChangedError("first page");
  const chunks: Uint8Array[] = [firstBytes];
  let done = firstBytes.length;
  options.onProgress?.(done, total);
  // Pin the version the first page answered with, so `latest` cannot move under the later pages. Every
  // later page must be that version, at the offset asked, of the same total, unchanged, and make
  // progress (review R4: external files are reread per page and may change or vanish).
  while (done < total) {
    const page = await artifactContentPage(client, artifactId, first.version, done, pageBytes, options.signal);
    if (page.version !== first.version || page.offset !== done) throw new ArtifactChangedError("page out of place");
    if (page.totalBytes !== total) throw new ArtifactChangedError("size changed");
    if (page.externalChanged && !first.externalChanged) throw new ArtifactChangedError("file changed on disk");
    const bytes = decodePage(page);
    if (bytes.length === 0) throw new ArtifactChangedError("no progress");
    done += bytes.length;
    if (done > total) throw new ArtifactChangedError("more than stated");
    if (options.maxBytes !== undefined && done > options.maxBytes) throw new ArtifactTooLargeError(done, options.maxBytes);
    chunks.push(bytes);
    options.onProgress?.(done, total);
  }
  const bytes = new Uint8Array(done);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  if (first.sha256) {
    const actual = await sha256Hex(bytes);
    if (actual !== first.sha256.toLowerCase()) throw new ArtifactIntegrityError(first.sha256, actual);
  }
  return { bytes, mediaType: first.mediaType, version: first.version, sha256: first.sha256, externalChanged: first.externalChanged };
}

/** One workspace file (`scope` null: the owner-only host route, capability `fs-file-read`). */
/** The host's limit for one fs/file read (`maxBytes` above it is a 400). */
export const WORKSPACE_FILE_MAX = 10 * 1024 * 1024;

export function readWorkspaceFile(client: CutexClient, scope: FileScope, path: string, options: { maxBytes?: number; signal?: AbortSignal } = {}): Promise<WorkspaceFile> {
  const route = scope ? `/v2/${scope.kind === "project" ? "projects" : "sessions"}/${enc(scope.id)}/fs/file` : "/v2/fs/file";
  const maxBytes = options.maxBytes !== undefined ? Math.min(Math.max(1, Math.floor(options.maxBytes)), WORKSPACE_FILE_MAX) : undefined;
  return client.request("GET", route, { query: { path, ...(maxBytes !== undefined ? { maxBytes } : {}) }, ...(options.signal ? { signal: options.signal } : {}) });
}

/** The bytes of a workspace file answer. */
export function workspaceFileBytes(file: WorkspaceFile): Uint8Array {
  return decodePage(file);
}

/** Capability of the raw-bytes route (`GET|HEAD /v2/artifact-store/{id}/versions/{n|latest}/raw`). */
export const ARTIFACT_RAW_DOWNLOAD = "artifact-raw-download";

/** The raw route of one version (for a shell that streams it to a file itself). */
export function artifactRawPath(artifactId: string, version: number | "latest"): string {
  return `/v2/artifact-store/${enc(artifactId)}/versions/${version}/raw`;
}

/**
 * What the raw route says about integrity: the sha256 to check (X-Cutex-Sha256, else a strong ETag that
 * is one), or none (`identityOnly`: files over the host's hash limit, weak ETag) — then the owner is
 * told the file is unverified.
 */
export function rawIntegrity(headers: Headers): { sha256: string | null; identityOnly: boolean } {
  const identityOnly = (headers.get("x-cutex-integrity") ?? "").trim().toLowerCase() === "identity-only";
  if (identityOnly) return { sha256: null, identityOnly };
  const header = (headers.get("x-cutex-sha256") ?? "").trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(header)) return { sha256: header, identityOnly };
  // The host's strong ETag is "sha256-<hex>" (a bare 64-hex form is accepted too).
  const etag = /^"(?:sha256-)?([0-9a-f]{64})"$/i.exec((headers.get("etag") ?? "").trim())?.[1];
  return { sha256: etag ? etag.toLowerCase() : null, identityOnly };
}

/**
 * One version's bytes from the raw route, in memory (browsers and shells without a streaming download;
 * no size limit unless `maxBytes`), checked against the sha256 it states (rawIntegrity). `verified`
 * false: the host stated none. `onProgress` follows Content-Length.
 */
export async function downloadArtifactRaw(
  client: CutexClient,
  artifactId: string,
  version: number | "latest",
  options: { maxBytes?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ArtifactBytes & { name: string | null; verified: boolean }> {
  const res = await client.fetchRaw(client.url(artifactRawPath(artifactId, version)), { headers: client.headers({ Accept: "*/*" }), ...(options.signal ? { signal: options.signal } : {}) }, { jsonErrorsOnly: true });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw CutexApiError.fromBody(res.status, body);
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  if (options.maxBytes !== undefined && total > options.maxBytes) throw new ArtifactTooLargeError(total, options.maxBytes);
  const chunks: Uint8Array[] = [];
  let done = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      chunks.push(value);
      done += value.length;
      if (options.maxBytes !== undefined && done > options.maxBytes) {
        await reader.cancel();
        throw new ArtifactTooLargeError(done, options.maxBytes);
      }
      options.onProgress?.(done, total || done);
    }
  } else {
    const all = new Uint8Array(await res.arrayBuffer());
    chunks.push(all);
    done = all.length;
  }
  const bytes = new Uint8Array(done);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  const expected = rawIntegrity(res.headers).sha256;
  if (expected) {
    const actual = await sha256Hex(bytes);
    if (actual !== expected) throw new ArtifactIntegrityError(expected, actual);
  }
  const versionHeader = Number(res.headers.get("x-cutex-artifact-version") ?? (typeof version === "number" ? version : 0));
  const disposition = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="([^"]+)"/i.exec(disposition)?.[1];
  let name: string | null = null;
  try {
    name = star ? decodeURIComponent(star) : (plainName ?? null);
  } catch {
    name = plainName ?? null;
  }
  return { bytes, mediaType: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim(), version: versionHeader, sha256: expected, externalChanged: null, name, verified: expected !== null };
}
