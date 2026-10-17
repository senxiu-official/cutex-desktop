// Document previews (pure; test/docPreview.test.ts): which renderer a file gets (PDF through pdf.js,
// DOCX converted to sanitised HTML, other office formats a clear "not here" card), the size cap, and
// the state a preview shows for the bytes cutex returned (fs/file or an artifact version). The bytes
// always come from the daemon (workspace / host file read, artifact content) — never a file:// or
// remote URL — so a remote host previews the same as the local one.
import type { FsFile } from "../../../shared/ipc";
import { extensionOf } from "./fileKinds";

/**
 * Largest document we preview. cutex's fs/file accepts `maxBytes` up to 10 MiB
 * (`MAX_FILE_BYTES_LIMIT`), artifact content up to 4 MiB per window (read in windows up to this cap).
 * Raising it past 10 MiB needs a larger fs/file limit in cutex.
 */
export const DOC_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

/** `pdf` / `docx` render here; `office` = a known document format we deliberately don't render. */
export type DocKind = "pdf" | "docx" | "office";

/**
 * Per-type decisions (see the report in docs / CHANGELOG): DOCX-family through mammoth (macros in
 * .docm are never run — mammoth reads only word/document.xml); legacy binary Office (doc / xls / ppt),
 * OOXML spreadsheets / slides, OpenDocument, RTF and Apple iWork have no small, maintained, safe JS
 * renderer, so they get the "open it on the host" card instead of garbage.
 */
const RENDERED: Record<string, DocKind> = { pdf: "pdf", docx: "docx", docm: "docx", dotx: "docx" };
const OFFICE = new Set(["doc", "dot", "rtf", "xls", "xlsx", "xlsm", "xlsb", "ppt", "pptx", "pptm", "odt", "ods", "odp", "pages", "numbers", "key", "epub", "vsdx"]);

const MIME_KIND: Record<string, DocKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "office",
  "application/vnd.ms-excel": "office",
  "application/vnd.ms-powerpoint": "office",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "office",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "office",
};

/** The document renderer for a path (extension first, then the media type); null = not a document. */
export function docKindOf(path: string, mime = ""): DocKind | null {
  const ext = /[\\/]$/.test(path) ? "" : extensionOf(path);
  if (RENDERED[ext]) return RENDERED[ext]!;
  if (OFFICE.has(ext)) return "office";
  return MIME_KIND[(mime.split(";")[0] ?? "").trim().toLowerCase()] ?? null;
}

/** Short type label for the cards ("PDF", "DOCX", "XLSX"…); the media type when there is no extension. */
export function docTypeLabel(path: string, mime = ""): string {
  const ext = extensionOf(path);
  return ext ? ext.toUpperCase() : (mime.split(";")[0] ?? "").trim() || "?";
}

/** Why an `office` file is not previewed: a legacy binary (OLE) format, or one we have no renderer for. */
export function officeReason(path: string): "legacy" | "unsupported" {
  return ["doc", "dot", "xls", "ppt"].includes(extensionOf(path)) ? "legacy" : "unsupported";
}

export type DocState =
  | { state: "ready"; kind: "pdf" | "docx"; bytes: Uint8Array }
  | { state: "office"; reason: "legacy" | "unsupported"; size: number }
  | { state: "too-large"; size: number; max: number }
  /** The bytes are not that format (wrong magic, text, bad base64). */
  | { state: "invalid"; size: number };

type Body = Pick<FsFile, "encoding" | "content" | "size" | "truncated">;

/**
 * What a document preview shows for a read: `size` is the file's full size (fs/file `size`, artifact
 * `totalBytes`). Over the cap or cut short → too-large; not base64 or not the format's magic → invalid.
 */
export function docState(kind: DocKind, path: string, body: Body, max = DOC_PREVIEW_MAX_BYTES): DocState {
  const size = body.size;
  if (kind === "office") return { state: "office", reason: officeReason(path), size };
  if (size > max || body.truncated) return { state: "too-large", size, max };
  if (body.encoding !== "base64") return { state: "invalid", size };
  const bytes = decodeBase64(body.content);
  if (!bytes || !hasMagic(kind, bytes)) return { state: "invalid", size };
  return { state: "ready", kind, bytes };
}

/** The state before reading the bytes, from the size alone (an fs/file stat read, an artifact's `bytes`): null = read them. */
export function docStateBySize(kind: DocKind, path: string, size: number, max = DOC_PREVIEW_MAX_BYTES): DocState | null {
  if (kind === "office") return { state: "office", reason: officeReason(path), size };
  return size > max ? { state: "too-large", size, max } : null;
}

export function decodeBase64(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "");
  if (!clean || clean.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  try {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** `%PDF-` within the first KiB (PDF allows leading junk), `PK\x03\x04` (a zip) for DOCX. */
export function hasMagic(kind: "pdf" | "docx", bytes: Uint8Array): boolean {
  if (kind === "docx") return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 5 <= head.length; i++) if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true;
  return false;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

// ── PDF viewer helpers ───────────────────────────────────────────────────────────────────────────

export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] as const;
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

/** The next zoom step above (`dir` 1) or below (-1) `zoom`. */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? ZOOM_MIN;
}

export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) : 1;
}

/** A typed page number, clamped to 1…count; null when it is not a number. */
export function parsePage(text: string, count: number): number | null {
  const n = Number.parseInt(text.trim(), 10);
  return Number.isFinite(n) ? Math.min(Math.max(1, n), Math.max(1, count)) : null;
}

/** 1-based page whose box contains `y` (scroll offset + a bit), given each page's top offset (ascending). */
export function pageAt(tops: readonly number[], y: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid]! <= y) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found + 1;
}

// ── loading through the daemon ───────────────────────────────────────────────────────────────────

/**
 * A workspace / host file (cutex fs/file): a 1-byte read first for the size (office formats and
 * files over the cap stop there), then the whole file up to the cap.
 */
export async function loadFsDoc(kind: DocKind, path: string, read: (maxBytes: number) => Promise<Body>, max = DOC_PREVIEW_MAX_BYTES): Promise<DocState> {
  const stat = await read(1);
  const early = docStateBySize(kind, path, stat.size, max);
  if (early) return early;
  return docState(kind, path, stat.truncated ? await read(max) : stat, max);
}

/** Largest window cutex's artifact content route returns (`MAX_MAX_BYTES`). */
export const ARTIFACT_WINDOW_BYTES = 4 * 1024 * 1024;

type ContentWindow = { encoding: "utf8" | "base64"; content: string; truncated: boolean; totalBytes: number };

/**
 * An artifact version (`size` = its registered bytes), read in windows of at most
 * [`ARTIFACT_WINDOW_BYTES`] and joined. null from `read` = the version is gone (an error).
 */
export async function loadWindowedDoc(kind: DocKind, name: string, size: number, read: (offset: number, maxBytes: number) => Promise<ContentWindow | null>, max = DOC_PREVIEW_MAX_BYTES, windowBytes = ARTIFACT_WINDOW_BYTES): Promise<DocState> {
  const early = docStateBySize(kind, name, size, max);
  if (early) return early;
  const parts: Uint8Array[] = [];
  let offset = 0;
  let total = size;
  for (;;) {
    const w = await read(offset, windowBytes);
    if (!w) throw new Error("content unavailable");
    total = w.totalBytes;
    if (total > max) return { state: "too-large", size: total, max };
    if (w.encoding !== "base64") return { state: "invalid", size: total };
    const bytes = decodeBase64(w.content) ?? (w.content === "" ? new Uint8Array() : null);
    if (!bytes) return { state: "invalid", size: total };
    parts.push(bytes);
    offset += bytes.length;
    if (!w.truncated || bytes.length === 0) break;
  }
  const joined = new Uint8Array(offset);
  let at = 0;
  for (const p of parts) {
    joined.set(p, at);
    at += p.length;
  }
  if (kind === "office" || offset < total) return { state: "too-large", size: total, max };
  return hasMagic(kind, joined) ? { state: "ready", kind, bytes: joined } : { state: "invalid", size: total };
}
