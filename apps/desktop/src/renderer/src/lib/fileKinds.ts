// File links in messages (pure; test/fileKinds.test.ts): the icon kind for a path, image detection,
// and the <img> src for an image read through cutex fs/file (workspace or host path).
import type { FsFile } from "../../../shared/ipc";

export type FileKind = "markdown" | "text" | "code" | "image" | "pdf" | "data" | "archive" | "folder" | "file";

const EXT_KIND: Record<string, FileKind> = {};
const add = (kind: FileKind, exts: string) => exts.split(" ").forEach((e) => (EXT_KIND[e] = kind));
add("markdown", "md markdown mdx rst");
add("text", "txt log text out err");
add("code", "ts tsx js jsx mjs cjs rs py go java kt kts c h cc cpp hpp cs swift rb php sh bash zsh ps1 psm1 bat cmd lua vue svelte html htm css scss sass less sql dart scala ex exs zig nix");
add("image", "png jpg jpeg gif webp bmp svg ico avif");
add("pdf", "pdf");
add("data", "json jsonl ndjson yaml yml toml csv tsv xml ini env lock conf cfg db sqlite parquet");
add("archive", "zip tar gz tgz bz2 xz 7z rar zst");

/** Images we render as a thumbnail (`ico` / `avif` get the icon only). */
const THUMBNAIL_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const THUMBNAIL_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/svg+xml"]);

/** Non-standard spellings some tools / platforms record for these types. */
const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/jfif": "image/jpeg",
  "image/x-png": "image/png",
  "image/x-ms-bmp": "image/bmp",
  "image/x-bmp": "image/bmp",
  "image/svg": "image/svg+xml",
  "application/x-pdf": "application/pdf",
};

/** Lower-cased media type without parameters, aliases mapped to the standard name. */
export function canonicalMime(mime: string): string {
  const m = (mime.split(";")[0] ?? "").trim().toLowerCase();
  return MIME_ALIASES[m] ?? m;
}

/** Media types that say nothing about the format (a store's guess for an unknown name), so the extension decides. */
export function isGenericMime(mime: string): boolean {
  return ["", "application/octet-stream", "binary/octet-stream", "application/unknown", "application/x-unknown", "unknown/unknown", "text/plain"].includes(canonicalMime(mime));
}

const EXT_IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml" };

/** `mime` in its standard spelling, or — when it is generic — the image type of `name`'s extension. */
export function imageMimeFor(mime: string, name: string): string {
  const m = canonicalMime(mime);
  return !THUMBNAIL_MIMES.has(m) && isGenericMime(m) ? (EXT_IMAGE_MIME[extensionOf(name)] ?? m) : m;
}

/** Image type by the first bytes of a base64 body (PNG / JPEG / GIF / WebP / BMP), null when none matches. */
export function sniffImageMime(base64: string): string | null {
  let head: string;
  try {
    head = atob(base64.slice(0, 24));
  } catch {
    return null;
  }
  const b = (i: number) => head.charCodeAt(i);
  if (head.startsWith("\x89PNG\r\n\x1a\n")) return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) return "image/gif";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  if (head.startsWith("BM") && head.length >= 14) return "image/bmp";
  return null;
}

/** Thumbnails above this size show the icon link instead (also the `maxBytes` asked of fs/file). */
export const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

/** Lower-cased extension of the last path segment ("" when none; dot files have none). */
export function extensionOf(path: string): string {
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Icon kind for a file link; a trailing `/` or `\` marks a folder. */
export function fileKind(path: string): FileKind {
  if (/[\\/]$/.test(path)) return "folder";
  const ext = extensionOf(path);
  if (ext) return EXT_KIND[ext] ?? "file";
  const name = path.split(/[\\/]/).pop() ?? "";
  return /^(Dockerfile|Makefile|Justfile|Rakefile)$/i.test(name) ? "code" : /^\.\w/.test(name) ? "data" : "file";
}

/** A path we try to show as an inline thumbnail. */
export function isThumbnailPath(path: string): boolean {
  return !/[\\/]$/.test(path) && THUMBNAIL_EXTS.has(extensionOf(path));
}

/**
 * `<img>` src for an fs/file body, or null when it is not a complete renderable image: a
 * truncated read, over [`THUMBNAIL_MAX_BYTES`], a non-image mime (aliases such as `image/jpg` count; a
 * generic recorded type is decided by `name`'s extension, else by a base64 body's image signature). SVG comes back as utf8 text and
 * becomes a data: URL too (an <img> never runs its scripts; it is never put into the DOM inline).
 */
export function thumbnailSrc(file: Pick<FsFile, "encoding" | "content" | "mime" | "size" | "truncated">, name = ""): string | null {
  if (file.truncated || file.size > THUMBNAIL_MAX_BYTES) return null;
  // The bytes decide for a binary body (a store may have recorded a generic or misspelled type);
  // a generic type otherwise falls back to `name`'s extension.
  let mime = imageMimeFor(file.mime, name);
  if (!THUMBNAIL_MIMES.has(mime) && isGenericMime(mime) && file.encoding === "base64") mime = sniffImageMime(file.content) ?? mime;
  if (!THUMBNAIL_MIMES.has(mime)) return null;
  if (file.encoding === "base64") return /^[A-Za-z0-9+/]*={0,2}$/.test(file.content) && file.content ? `data:${mime};base64,${file.content}` : null;
  if (mime !== "image/svg+xml" || !/<svg[\s>]/i.test(file.content)) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`;
}
