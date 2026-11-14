// A fake of cutex's fs/file read (workspace `{scope}/fs/file` and host `/v2/fs/file`) over a byte buffer, for file
// page tests: at most one read (10 MiB) starting at `offset`, the window cut at a UTF-8 character boundary and
// `offset` echoed (capability fs-file-window). `windowed: false` = an older cutex: no `offset`, always from byte 0.
import type { FileWindow } from "../../src/main/frames";
import { FILE_PAGE_WINDOW_BYTES } from "../../src/shared/frames";

export const MiB = 1024 * 1024;

export function cutexFileWindow(bytes: Buffer, offset: number, maxBytes: number, opts: { windowed?: boolean; modifiedAt?: string; size?: number; path?: string; revision?: string } = {}): FileWindow {
  const windowed = opts.windowed ?? true;
  const from = windowed ? offset : 0;
  const size = opts.size ?? bytes.length;
  const modifiedAt = opts.modifiedAt ?? "2026-11-14T00:00:00Z";
  let end = Math.min(from + Math.min(maxBytes, FILE_PAGE_WINDOW_BYTES), bytes.length);
  const truncated = end < size;
  // Never end inside a character: back up to its first byte.
  if (end < bytes.length) while (end > from && (bytes[end]! & 0xc0) === 0x80) end--;
  return {
    path: opts.path ?? "p.html",
    size,
    modifiedAt,
    encoding: "utf8",
    content: bytes.subarray(from, end).toString("utf8"),
    truncated,
    mime: "text/html",
    ...(windowed ? { offset: from, revision: opts.revision ?? `${size}:${modifiedAt}` } : {}),
  };
}

/** An HTML page of about `bytes` bytes whose multi-byte characters (2, 3 and 4 bytes) straddle window boundaries. */
export function bigPage(bytes: number): Buffer {
  const unit = "<p>é 中文 ✓ 𝄞</p>\n";
  const head = "<!doctype html><title>big</title>";
  return Buffer.from(head + unit.repeat(Math.ceil(bytes / Buffer.byteLength(unit))) + "<i>END</i>", "utf8");
}
