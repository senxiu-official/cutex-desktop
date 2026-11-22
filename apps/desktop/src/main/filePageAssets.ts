// File pages (owner 2026-11-20 「这个改了」: a review page with 79 screenshots next to it showed none of them): the
// page's own files — images, style sheets, scripts, fonts it names by a relative path — are read by main from the
// same host and written into the document (data: URLs, inline <style> / <script>); the frame stays offline.
// Trust (cross-review 2026-11-20): every file is read through the host's fs-file-read route, which answers with the
// path as the host resolved it (links / junctions followed); a file is used only when that resolved path is inside
// the page's own resolved folder. The caller (main/frames.ts) finds that folder the same way; without it nothing is
// inlined. Web addresses, absolute paths, ../ out of the folder and anything over the limits stay out, and are counted.
// Two budgets: the files read (FILE_PAGE_ASSETS_TOTAL_BYTES, each once) and what is written into the page
// (FILE_PAGE_INLINE_MAX_BYTES, every reference counted: one picture used 500 times is written 500 times).
import { FILE_PAGE_ASSETS_MAX, FILE_PAGE_ASSET_MAX_BYTES, FILE_PAGE_ASSETS_TOTAL_BYTES, FILE_PAGE_INLINE_MAX_BYTES } from "../shared/frames";
import type { FsFile } from "../shared/ipc";

/** Reads one file of the page's host by its absolute path through fs-file-read (answers with the resolved path). */
export type HostReader = (path: string, maxBytes: number) => Promise<FsFile>;

export interface InlinedPage {
  html: string;
  /** Files written into the page. */
  loaded: number;
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
  css: "text/css", js: "text/javascript", mjs: "text/javascript", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm",
};
const mimeOf = (path: string, given: string) => (given && given !== "application/octet-stream" ? given : MIME[/\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream");

/** The separator a path is written with (a Windows host path may use either). */
const sepOf = (path: string) => (path.includes("/") || !path.includes("\\") ? "/" : "\\");
export const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

/** `rel` (a workspace-relative path) under `root` (an absolute folder), in the root's own separator. */
export function joinPath(root: string, rel: string): string {
  const sep = sepOf(root);
  return root.replace(/[\\/]+$/, "") + sep + rel.split(/[\\/]+/).filter(Boolean).join(sep);
}

/**
 * A page reference as a path of its host, or null when it is not a file of the page's own tree: a web address /
 * any scheme, a protocol-relative or absolute path, one that climbs out of `base` (`floor` levels above it may be
 * climbed: a style sheet in a sub-folder back up to the page's folder). The query and fragment are dropped.
 */
export function resolveAssetPath(base: string, ref: string, floor = 0): string | null {
  let value = ref.trim();
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || /^[\\/]/.test(value)) return null;
  value = value.replace(/[?#].*$/s, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!value || /[\u0000-\u001f]/.test(value) || /^[a-z]:/i.test(value) || /^[\\/]/.test(value)) return null;
  const parts: string[] = [];
  let up = 0;
  for (const part of value.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length) parts.pop();
      else if (++up > floor) return null;
    } else parts.push(part);
  }
  if (!parts.length) return null;
  const sep = sepOf(base || "/");
  let dir = base;
  for (let i = 0; i < up; i++) dir = dirOf(dir.replace(/[\\/]+$/, ""));
  return dir + parts.join(sep);
}

/** Whether `child` (a host's resolved path) is inside the folder `dir` (resolved, absolute). */
export function insideDir(dir: string, child: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const d = norm(dir).replace(/\/*$/, "/");
  const c = norm(child);
  if (!/^(?:[a-z]:)?\//i.test(d) || norm(child).split("/").includes("..")) return false;
  // Windows paths compare case-insensitively (a drive letter); others exactly.
  return /^[a-z]:\//i.test(d) ? c.toLowerCase().startsWith(d.toLowerCase()) : c.startsWith(d);
}

/** At most this many file reads at once (a page of 80 screenshots does not flood its host). */
const PARALLEL_READS = 4;

interface Got {
  /** The host's resolved path. */
  real: string;
  mime: string;
  bytes: Buffer;
  /** Its data: URL, made once (every reference shares the string). */
  url?: string;
}

/**
 * Writes the page's local files into it. `pageDir` = the page's folder as the host resolved it (absolute); every
 * reference is resolved against it and read through `read` (fs-file-read), and used only when the host's resolved
 * path is inside it.
 */
export async function inlineLocalAssets(html: string, pageDir: string, read: HostReader): Promise<InlinedPage> {
  // 1. Read every file the page (and its style sheets) names, each once, within the read budgets.
  const files = new Map<string, Promise<Got | null>>();
  let readBytes = 0;
  let running = 0;
  const queue: (() => void)[] = [];
  const limited = async <T>(job: () => Promise<T>): Promise<T> => {
    if (running >= PARALLEL_READS) await new Promise<void>((r) => queue.push(r));
    running++;
    try {
      return await job();
    } finally {
      running--;
      queue.shift()?.();
    }
  };
  const fetchFile = (path: string): Promise<Got | null> => {
    let got = files.get(path);
    if (got) return got;
    if (files.size >= FILE_PAGE_ASSETS_MAX) return Promise.resolve(null);
    got = (async () => {
      let f: FsFile;
      try {
        f = await limited(() => read(path, FILE_PAGE_ASSET_MAX_BYTES));
      } catch {
        return null;
      }
      // Whole files only, inside the page's folder as the host resolves it (a link / junction out is refused).
      if (f.truncated || !insideDir(pageDir, f.path)) return null;
      const bytes = f.encoding === "base64" ? Buffer.from(f.content, "base64") : Buffer.from(f.content, "utf8");
      if (readBytes + bytes.byteLength > FILE_PAGE_ASSETS_TOTAL_BYTES) return null;
      readBytes += bytes.byteLength;
      return { real: f.path, mime: mimeOf(path, f.mime), bytes };
    })();
    files.set(path, got);
    return got;
  };
  /** The path a reference names (relative to `dir`, a folder at or below the page's), or null. */
  const pathOf = (value: string, dir: string) => resolveAssetPath(dir, value, depthBelow(pageDir, dir));
  const got = new Map<string, Got>();
  const fetchAll = async (paths: Iterable<string>) => {
    await Promise.all([...new Set(paths)].map(async (p) => {
      const f = await fetchFile(p);
      if (f) got.set(p, f);
    }));
  };
  const sheets = new Set<string>();
  const wanted: string[] = [];
  for (const m of html.matchAll(LINK_TAG)) {
    const href = attr(m[0], "href");
    const path = href === null ? null : pathOf(href, pageDir);
    if (!path) continue;
    wanted.push(path);
    if (isStyleSheet(m[0])) sheets.add(path);
  }
  for (const m of html.matchAll(SCRIPT_ELEMENT)) {
    const src = attr(m[1]!, "src");
    const path = src === null ? null : pathOf(src, pageDir);
    if (path) wanted.push(path);
  }
  for (const m of html.matchAll(SRC_ATTR)) {
    const path = pathOf(m[2] ?? m[3] ?? m[4] ?? "", pageDir);
    if (path) wanted.push(path);
  }
  for (const m of html.matchAll(SRCSET_ATTR))
    for (const part of (m[2] ?? m[3] ?? "").split(",")) {
      const path = pathOf(part.trim().split(/\s+/)[0] ?? "", pageDir);
      if (path) wanted.push(path);
    }
  for (const m of html.matchAll(CSS_URL)) {
    const path = pathOf(m[1] ?? m[2] ?? m[3] ?? "", pageDir);
    if (path) wanted.push(path);
  }
  await fetchAll(wanted);
  // A style sheet's own url()s, relative to the sheet's folder.
  const sheetDir = (path: string) => dirOf(path);
  const inSheets: string[] = [];
  for (const s of sheets) {
    const f = got.get(s);
    if (!f) continue;
    for (const m of f.bytes.toString("utf8").matchAll(CSS_URL)) {
      const path = pathOf(m[1] ?? m[2] ?? m[3] ?? "", sheetDir(s));
      if (path) inSheets.push(path);
    }
  }
  await fetchAll(inSheets);

  // 2. Write them in, in document order, while the written budget lasts (every reference counts).
  let left = FILE_PAGE_INLINE_MAX_BYTES;
  const used = new Set<string>();
  const spend = (path: string, text: string): string | null => {
    // UTF-8 bytes, as the document will be (a data: URL is ASCII; a style sheet or script may not be).
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > left) return null;
    left -= bytes;
    used.add(path);
    return text;
  };
  const dataUrl = (value: string, dir: string): string | null => {
    const path = pathOf(value, dir);
    const f = path ? got.get(path) : undefined;
    if (!path || !f) return null;
    f.url ??= `data:${f.mime};base64,${f.bytes.toString("base64")}`;
    return spend(path, f.url);
  };
  // Unquoted: a base64 data: URL has no quote, space or parenthesis, and a style="" attribute keeps its quotes.
  const inlineCss = (css: string, dir: string) => css.replace(CSS_URL, (m, dq?: string, sq?: string, bare?: string) => {
    const url = dataUrl(dq ?? sq ?? bare ?? "", dir);
    return url ? `url(${url})` : m;
  });

  // <link rel=stylesheet href> → <style> keeping its media (its own url()s inlined); other <link href> → data: URL.
  let out = html.replace(LINK_TAG, (tag) => {
    const href = attr(tag, "href");
    const path = href === null ? null : pathOf(href, pageDir);
    const f = path ? got.get(path) : undefined;
    if (!path || !f) return tag;
    if (isStyleSheet(tag)) {
      const media = attr(tag, "media");
      // Its url()s are counted as they are written in; then the rest of the sheet (or none of it, if over).
      const [before, usedBefore] = [left, new Set(used)];
      const css = inlineCss(f.bytes.toString("utf8"), sheetDir(path)).replace(/<\/style/gi, "<\\/style");
      const style = `<style data-inlined="${escapeAttr(href!)}"${media !== null ? ` media="${escapeAttr(media)}"` : ""}>${css}</style>`;
      const rest = Buffer.byteLength(style, "utf8") - (before - left);
      if (rest > left) {
        left = before;
        used.clear();
        for (const p of usedBefore) used.add(p);
        return tag;
      }
      left -= rest;
      used.add(path);
      return style;
    }
    const url = dataUrl(href!, pageDir);
    return url ? setAttr(tag, "href", url) : tag;
  });
  // <script src> → its text inline. Classic defer / async scripts run where they would: after the document is parsed
  // (moved to its end, in order); module scripts stay (an inline module script is deferred too).
  const later: string[] = [];
  out = out.replace(SCRIPT_ELEMENT, (element, open: string) => {
    const src = attr(open, "src");
    const path = src === null ? null : pathOf(src, pageDir);
    const f = path ? got.get(path) : undefined;
    if (!path || !f || !/javascript|ecmascript|^text\/plain$|octet-stream/i.test(f.mime)) return element;
    const type = (attr(open, "type") ?? "").trim().toLowerCase();
    if (type && type !== "module" && !/javascript|ecmascript/.test(type)) return element;
    const module = type === "module";
    const deferred = !module && (hasAttr(open, "defer") || hasAttr(open, "async"));
    let tag = removeAttr(removeAttr(open, "src"), "integrity");
    if (deferred) tag = removeAttr(removeAttr(tag, "defer"), "async");
    const text = spend(path, `${tag}${f.bytes.toString("utf8").replace(/<\/script/gi, "<\\/script")}</script>`);
    if (!text) return element;
    if (!deferred) return text;
    later.push(text);
    return "";
  });
  if (later.length) out += later.join("");
  // src / poster / srcset of images and media.
  out = out.replace(SRC_ATTR, (m, name: string, dq?: string, sq?: string, bare?: string) => {
    const url = dataUrl(dq ?? sq ?? bare ?? "", pageDir);
    return url ? `${name}="${url}"` : m;
  });
  out = out.replace(SRCSET_ATTR, (m, name: string, dq?: string, sq?: string) => {
    let changed = false;
    const parts = (dq ?? sq ?? "").split(",").map((part) => {
      const [value = "", ...rest] = part.trim().split(/\s+/);
      const url = value ? dataUrl(value, pageDir) : null;
      if (!url) return part.trim();
      changed = true;
      return [url, ...rest].join(" ");
    });
    return changed ? `${name}="${parts.join(", ")}"` : m;
  });
  // url() in <style> blocks and style="" attributes (an inlined sheet's are data: URLs by now: left alone).
  out = inlineCss(out, pageDir);
  return { html: out, loaded: used.size };
}

/** How many folders `dir` is below `base` (a style sheet in a sub-folder may climb that much). */
function depthBelow(base: string, dir: string): number {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const b = norm(base), d = norm(dir);
  if (!d.startsWith(b)) return 0;
  return d.slice(b.length).split("/").filter(Boolean).length;
}

const LINK_TAG = /<link\b[^>]*>/gi;
/** A script element with its opening tag (group 1); only those with a src are rewritten. */
const SCRIPT_ELEMENT = /(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi;
// (Not iframe / embed / object: the document allows no frames or plugins, so they would not show even inlined.)
const SRC_ATTR = /(?<=<(?:img|source|video|audio|input|track)\b[^>]*?\s)(src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
const SRCSET_ATTR = /(?<=<(?:img|source)\b[^>]*?\s)(srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/gi;

/** A style sheet the page applies (not an alternate one, not disabled). */
const isStyleSheet = (tag: string) => {
  const rel = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
  return rel.includes("stylesheet") && !rel.includes("alternate") && !hasAttr(tag, "disabled");
};
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}
const hasAttr = (tag: string, name: string) => new RegExp(`\\s${name}(?=[\\s=>/])`, "i").test(tag);
function setAttr(tag: string, name: string, value: string): string {
  return tag.replace(new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>"']+)`, "i"), `$1"${value}"`);
}
function removeAttr(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>"']+))?(?=[\\s>/])`, "i"), "");
}
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
