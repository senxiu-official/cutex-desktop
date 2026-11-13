// Workspace scope + file-link helpers for the side pane (DESIGN §4.6).
import type { SidebarSnapshot, WorkspaceScope } from "../../../shared/ipc";

/** Project scope when the agent's project has a workspace_root, else the agent's cwd. */
export function scopeFor(sidebar: SidebarSnapshot | null, sessionId: string | null): WorkspaceScope | null {
  if (!sidebar || !sessionId) return null;
  const projectId = sidebar.hostRows[sessionId]?.projectId;
  const project = projectId ? sidebar.projects?.projects.find((p) => p.project_id === projectId) : undefined;
  if (project?.workspace_root) return { kind: "project", id: project.project_id };
  const session = [...sidebar.active, ...sidebar.retired].find((s) => s.cutexSessionId === sessionId);
  return session?.cwd ? { kind: "session", id: sessionId } : null;
}

export function scopeKey(scope: WorkspaceScope): string {
  return `${scope.kind}:${scope.id}`;
}

/** Absolute root path for a scope (for "copy absolute path"). */
export function rootFor(sidebar: SidebarSnapshot | null, scope: WorkspaceScope): string | null {
  if (!sidebar) return null;
  if (scope.kind === "project") return sidebar.projects?.projects.find((p) => p.project_id === scope.id)?.workspace_root ?? null;
  return [...sidebar.active, ...sidebar.retired].find((s) => s.cutexSessionId === scope.id)?.cwd ?? null;
}

/** Display form of a directory: user home → "~", Windows verbatim prefix (\\?\) dropped. */
export function shortenHome(path: string): string {
  return path
    .replace(/^\\\\\?\\/, "")
    .replace(/^[A-Za-z]:\\Users\\[^\\]+/i, "~")
    .replace(/^\/home\/[^/]+/, "~")
    .replace(/^\/Users\/[^/]+/, "~");
}

/** cutex capability: `GET /v2/fs/file?path=<absolute>` (owner-only host file read). */
export const HOST_FILE_READ_FEATURE = "fs-file-read";

/**
 * A workspace read refusal in words: cutex refuses a non-owner (users-p2-access) an agent / project
 * whose root is a filesystem root, the host user's home or contains the cutex home (403
 * `workspace_root_too_broad`). Anything else stays the message as is.
 */
export function workspaceErrorText(error: unknown, tooBroad: () => string): string {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:^|[^a-z_])workspace_root_too_broad\b/.test(message) ? tooBroad() : message;
}

/** Last path segment of a `/` or `\` separated path (tab labels). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export interface FileLinkTarget {
  path: string;
  line: number | null;
}

/** A markdown link that points at a file on the agent's host (not necessarily inside its workspace). */
export interface FileRef {
  /** The path as written: decoded, `file://` and the line suffix stripped. */
  path: string;
  /** Absolute path on the host when known (absolute href, `~` with a known home, relative + root). */
  abs: string | null;
  /** Root-relative path when the file is inside the workspace root (previewable through `fs/file`). */
  rel: string | null;
  line: number | null;
}

const EXTERNAL = /^(https?|mailto|tel|data|blob):/i;
/** A URL scheme (two or more letters, so a drive letter `C:` is not one). */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;
const DRIVE = /^[a-zA-Z]:[\\/]/;
/** Windows verbatim prefix `\\?\`. */
const VERBATIM = /^\\\\\?\\/;
const BACKSLASH = /\\/g;
/** `README.md:12` looks like scheme `readme.md:` but is a file name with a line suffix. */
const FILE_WITH_LINE = /^[^:/\\]+\.[A-Za-z0-9]+:\d+(?::\d+)?$/;

/**
 * Markdown sanitizing (hast-util-sanitize) drops hrefs whose part before the first `:` is not an
 * allowed protocol: `D:/x`, `file:///x`, `README.md:12`. File-looking hrefs of that shape are
 * carried through it as `#cutex-file:<encoded>` (a fragment is never protocol-checked).
 */
export const FILE_HREF_ESCAPE = "#cutex-file:";

export function escapeFileHref(href: string): string | null {
  const colon = href.indexOf(":");
  if (colon < 0 || /[/?#]/.test(href.slice(0, colon))) return null;
  return resolveFileHref(href, null) ? FILE_HREF_ESCAPE + encodeURIComponent(href) : null;
}

/** A Windows absolute path as written: `C:\…` or a UNC `\\server\…`. */
const WINDOWS_ABSOLUTE = /^(?:[a-zA-Z]:\\|\\\\[^\\])/;
/** CommonMark's backslash escapes: a backslash before ASCII punctuation stands for that character. */
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g;
/** The destination of a link / image source (`[text](dest "title")`, `![alt](<dest>)`), at its end. */
const LINK_DESTINATION = /\]\(\s*(<[^<>\n]*>|[^\s<>]+?)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)$/;

/**
 * The Windows path a markdown link / image was written with, when CommonMark's backslash escapes changed it:
 * `C:\Users\me\.cutex\a.png` parses as `C:\Users\me.cutex\a.png` (`\.` is an escaped `.`), a path that does not
 * exist. Agents write host paths verbatim, so a Windows path keeps its backslashes. `source` is the markdown of
 * the link / image node; `parsed` the destination the parser made of it (null: nothing to restore).
 */
export function writtenWindowsPath(source: string, parsed: string): string | null {
  const m = LINK_DESTINATION.exec(source);
  if (!m) return null;
  const written = m[1]!.startsWith("<") ? m[1]!.slice(1, -1) : m[1]!;
  if (!WINDOWS_ABSOLUTE.test(written) || markdownEscapedPath(written)) return null;
  const unescaped = written.replace(MARKDOWN_ESCAPE, "$1");
  if (unescaped === written) return null;
  // Only the destination the parser read from this very source (it may come back percent-encoded).
  let decoded = parsed;
  try {
    decoded = decodeURI(parsed);
  } catch {
    /* not percent-encoded */
  }
  return parsed === unescaped || decoded === unescaped ? written : null;
}

/**
 * A path written with every separator doubled (`C:\\Users\\me`, `\\\\server\\share`): the writer escaped it for
 * Markdown on purpose, so CommonMark's reading (`C:\Users\me`) is the meant path. A single backslash anywhere
 * (`C:\Users\me`, a UNC `\\server\share`) means it was written verbatim.
 */
function markdownEscapedPath(written: string): boolean {
  const runs = written.match(/\\+/g);
  return !!runs && runs.every((run) => run.length % 2 === 0);
}

/**
 * A Windows path in Markdown prose: `C:\…` or a UNC `\\server\…`, not inside a word or after another backslash.
 * It runs to the next whitespace; a space continues it when the next word goes on with a backslash
 * (`C:\Program Files\x`). Spilling into the words after it is harmless: only its backslash escapes matter.
 */
const WINDOWS_PATH_IN_TEXT = /(?<![\w\\])(?:[a-zA-Z]:\\|\\\\(?=[\w.$-]+\\))[^\s<>"|?*]*(?: [^\s<>"|?*\\]+\\[^\s<>"|?*]*)*/g;

/**
 * A Markdown text node with the Windows paths in it as they were written. CommonMark reads a backslash before
 * ASCII punctuation as an escape, so plain prose `C:\Users\me\.cutex\a.md` renders `C:\Users\me.cutex\a.md` and
 * `\\server\share` renders `\server\share`; agents write host paths verbatim. `source` is the node's markdown,
 * `value` the text the parser made of it; null when nothing needs restoring (or the text is not a plain reading
 * of the source, e.g. it holds character references: then it stays as parsed).
 */
export function writtenWindowsText(source: string, value: string): string | null {
  if (!source.includes("\\")) return null;
  let out = value;
  let from = 0;
  let changed = false;
  // Every path is located in turn, also one that needs nothing, so the same text earlier in the line is never the one
  // restored (`C:\a.b then C:\a\.b` restores the second).
  for (const m of source.matchAll(WINDOWS_PATH_IN_TEXT)) {
    const written = m[0];
    const parsed = written.replace(MARKDOWN_ESCAPE, "$1");
    const at = out.indexOf(parsed, from);
    if (at < 0) continue;
    if (parsed === written || markdownEscapedPath(written)) {
      from = at + parsed.length;
      continue;
    }
    out = out.slice(0, at) + written + out.slice(at + parsed.length);
    from = at + written.length;
    changed = true;
  }
  return changed ? out : null;
}

export function unescapeFileHref(href: string): string {
  if (!href.startsWith(FILE_HREF_ESCAPE)) return href;
  try {
    return decodeURIComponent(href.slice(FILE_HREF_ESCAPE.length));
  } catch {
    return href;
  }
}

/** Resolve `.` / `..` segments of a `/`-separated relative path; null when it escapes upwards. */
function lexicalNormalize(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join("/");
}

/** `base` + `rest` in the base's separator style (Windows `\` when the base has no `/`). */
function joinHost(base: string, rest: string): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const tail = rest.replace(/^[\\/]+/, "");
  return tail ? `${base.replace(/[\\/]+$/, "")}${sep}${tail.replace(/[\\/]/g, sep)}` : base;
}

/**
 * Parse a markdown link href that looks like a file: relative paths, `./x`, `~/x`, `file://`, absolute
 * POSIX / Windows paths, with an optional `:line[:col]` or `#L12` suffix (ZCode `markdownFileLink`
 * semantics, simplified). `rel` is set when the file lies inside `root`; `~` expands with the host's
 * `home` when known. Returns null for web links, other URL schemes and anchors.
 */
export function resolveFileHref(href: string, root: string | null, home: string | null = null): FileRef | null {
  if (!href || href.startsWith("#") || href.startsWith("?") || href.startsWith("//") || EXTERNAL.test(href)) return null;
  let raw = href;
  try {
    raw = decodeURI(raw);
  } catch {
    // keep raw
  }
  if (/^file:/i.test(raw)) {
    // file:///home/x → /home/x; file:///C:/x → C:/x; file://host/x → /x.
    raw = raw.replace(/^file:(\/\/[^/]*)?/i, "");
    if (/^\/[a-zA-Z]:\//.test(raw)) raw = raw.slice(1);
  } else if (SCHEME.test(raw) && !FILE_WITH_LINE.test(raw)) return null;
  let line: number | null = null;
  const hash = /#L(\d+)(?:-L?\d+)?$/i.exec(raw);
  if (hash) {
    line = Number(hash[1]);
    raw = raw.slice(0, hash.index);
  } else {
    const suffix = /:(\d+)(?::\d+)?$/.exec(raw);
    if (suffix && !/^[a-zA-Z]$/.test(raw.slice(0, suffix.index))) {
      line = Number(suffix[1]);
      raw = raw.slice(0, suffix.index);
    }
  }
  raw = raw.replace(VERBATIM, "");
  if (!raw.trim()) return null;
  const path = raw;
  let abs: string | null = null;
  if (/^~(?=$|[\\/])/.test(raw)) abs = home ? joinHost(home.replace(VERBATIM, ""), raw.slice(1)) : null;
  else if (DRIVE.test(raw) || raw.startsWith("/") || raw.startsWith("\\")) abs = raw;
  const normRoot = root?.replace(VERBATIM, "").replace(BACKSLASH, "/").replace(/\/+$/, "") || null;
  let rel: string | null = null;
  if (abs) {
    if (normRoot) {
      const a = abs.replace(BACKSLASH, "/");
      // Windows roots compare case-insensitively, POSIX roots exactly.
      const fold = DRIVE.test(`${normRoot}/`) ? (x: string) => x.toLowerCase() : (x: string) => x;
      if (fold(a).startsWith(`${fold(normRoot)}/`)) rel = lexicalNormalize(a.slice(normRoot.length + 1)) || null;
    }
  } else if (!raw.startsWith("~")) {
    rel = lexicalNormalize(raw.replace(BACKSLASH, "/")) || null;
    if (rel && root) abs = joinHost(root.replace(VERBATIM, ""), rel);
  }
  return { path, abs, rel, line };
}

/** Workspace-relative target of a link (side-pane preview); null when it is not inside the root. */
export function parseFileLink(href: string, root: string | null, home: string | null = null): FileLinkTarget | null {
  const ref = resolveFileHref(href, root, home);
  return ref?.rel ? { path: ref.rel, line: ref.line } : null;
}

/** Shiki language id from a file name (fallback: plain text). */
export function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js", json: "json", rs: "rust", py: "python", go: "go",
    md: "markdown", toml: "toml", yaml: "yaml", yml: "yaml", css: "css", html: "html", sh: "bash", ps1: "powershell",
    java: "java", kt: "kotlin", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", sql: "sql", xml: "xml", vue: "vue",
  };
  return map[ext] ?? "text";
}
