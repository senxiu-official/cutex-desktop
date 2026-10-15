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
 * truncated read, over [`THUMBNAIL_MAX_BYTES`], a non-image mime. SVG comes back as utf8 text and
 * becomes a data: URL too (an <img> never runs its scripts; it is never put into the DOM inline).
 */
export function thumbnailSrc(file: Pick<FsFile, "encoding" | "content" | "mime" | "size" | "truncated">): string | null {
  if (file.truncated || file.size > THUMBNAIL_MAX_BYTES) return null;
  const mime = (file.mime.split(";")[0] ?? "").trim().toLowerCase();
  if (!THUMBNAIL_MIMES.has(mime)) return null;
  if (file.encoding === "base64") return /^[A-Za-z0-9+/]*={0,2}$/.test(file.content) && file.content ? `data:${mime};base64,${file.content}` : null;
  if (mime !== "image/svg+xml" || !/<svg[\s>]/i.test(file.content)) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`;
}
