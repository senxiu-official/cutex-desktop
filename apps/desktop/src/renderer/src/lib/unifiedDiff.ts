// Unified diff parsing for the diff viewer (components/UnifiedDiff.tsx): files (git `diff --git`
// sections or bare `---` / `+++` pairs), hunks with old / new line numbers, `\ No newline at end of
// file`, binary / rename / mode headers; plus the view helpers — per-file +/− counts, the unchanged
// lines between hunks, long context runs to fold, and the changed span of paired −/+ lines.
// Pure (no React) so the component file keeps Fast Refresh and the rules are unit-tested.

export type DiffLineKind = "add" | "del" | "ctx";

export interface DiffLine {
  kind: DiffLineKind;
  /** The line without its +/−/space marker. */
  text: string;
  oldNo: number | null;
  newNo: number | null;
  /** Followed by `\ No newline at end of file`. */
  noNewline?: boolean;
  /** Changed part of a paired −/+ line ([start, end) in `text`); absent = whole line / unpaired. */
  span?: [number, number];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Text after the closing `@@` (git's function context), trimmed. */
  section: string;
  /** false = a bare `@@` / `@@ context` header (apply_patch style): no line numbers, no counts. */
  numbered: boolean;
  lines: DiffLine[];
}

export type DiffFileStatus = "modified" | "added" | "deleted" | "renamed" | "copied";

export interface DiffFile {
  /** null = /dev/null (added file) or unknown. */
  oldPath: string | null;
  newPath: string | null;
  status: DiffFileStatus;
  binary: boolean;
  /** Mode / similarity / index lines worth showing (e.g. "new mode 100755"). */
  meta: string[];
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** This file's raw section of the input (copy). */
  raw: string;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const BARE_HUNK = /^@@(?: (.*))?$/;

const SIMPLE_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/**
 * Git's C-quoted path body (between the quotes) → the path: `\NNN` octal escapes are raw bytes
 * (git quotes every non-ASCII byte of a UTF-8 name), decoded as UTF-8 together with the rest.
 */
export function unquoteGitPath(body: string): string {
  const bytes: number[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== "\\" || i + 1 >= body.length) {
      const cp = body.codePointAt(i)!;
      const piece = String.fromCodePoint(cp);
      for (const b of enc.encode(piece)) bytes.push(b);
      i += piece.length - 1;
      continue;
    }
    const next = body[i + 1]!;
    const oct = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4));
    if (oct) {
      bytes.push(parseInt(oct[0], 8) & 0xff);
      i += oct[0].length;
    } else if (next in SIMPLE_ESCAPES) {
      bytes.push(SIMPLE_ESCAPES[next]!);
      i += 1;
    } else {
      for (const b of enc.encode(next)) bytes.push(b);
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** A path as git prints it on a header line: `"…"` = C-quoted, anything else is literal. */
function headerPath(raw: string): string {
  const p = raw.trim();
  return p.length >= 2 && p.startsWith('"') && p.endsWith('"') ? unquoteGitPath(p.slice(1, -1)) : p;
}

/** `a/x` / `b/x` → `x`; `/dev/null` → null; strips git's quoting and a trailing tab + timestamp. */
export function cleanPath(raw: string): string | null {
  let p = raw.replace(/\t.*$/, "").trim();
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = unquoteGitPath(p.slice(1, -1));
  if (p === "/dev/null" || p === "") return null;
  return p.replace(/^[ab]\//, "");
}

/** Length of the quoted token at the start of `s` (`"…"` with backslash escapes), or 0. */
function quotedLength(s: string): number {
  if (!s.startsWith('"')) return 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === '"') return i + 1;
  }
  return 0;
}

/** `diff --git a/x b/y` → [x, y] (best effort for paths with spaces: split on " b/"). */
function gitPaths(rest: string): [string | null, string | null] {
  const q = quotedLength(rest);
  if (q > 0 && rest[q] === " ") return [cleanPath(rest.slice(0, q)), cleanPath(rest.slice(q + 1))];
  const tailQuote = rest.lastIndexOf(' "');
  if (tailQuote > 0 && rest.endsWith('"') && quotedLength(rest.slice(tailQuote + 1)) === rest.length - tailQuote - 1) {
    return [cleanPath(rest.slice(0, tailQuote)), cleanPath(rest.slice(tailQuote + 1))];
  }
  const at = rest.indexOf(" b/");
  if (rest.startsWith("a/") && at > 0) return [cleanPath(rest.slice(0, at)), cleanPath(rest.slice(at + 1))];
  const parts = rest.split(" ");
  return [cleanPath(parts[0] ?? ""), cleanPath(parts.slice(1).join(" "))];
}

function gitHeaderLine(f: DiffFile, line: string): void {
  if (line.startsWith("new file mode")) {
    f.status = "added";
    f.oldPath = null;
    f.meta.push(line);
  } else if (line.startsWith("deleted file mode")) {
    f.status = "deleted";
    f.newPath = null;
    f.meta.push(line);
  } else if (line.startsWith("rename from ")) {
    f.status = "renamed";
    f.oldPath = headerPath(line.slice(12));
  } else if (line.startsWith("rename to ")) {
    f.status = "renamed";
    f.newPath = headerPath(line.slice(10));
  } else if (line.startsWith("copy from ")) {
    f.status = "copied";
    f.oldPath = headerPath(line.slice(10));
  } else if (line.startsWith("copy to ")) {
    f.status = "copied";
    f.newPath = headerPath(line.slice(8));
  } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
    f.binary = true;
  } else if (/^(old mode|new mode|similarity index|dissimilarity index)/.test(line)) {
    f.meta.push(line);
  }
}

function newFile(): DiffFile {
  return { oldPath: null, newPath: null, status: "modified", binary: false, meta: [], hunks: [], additions: 0, deletions: 0, raw: "" };
}

/** Parse unified diff text into files. Never throws; text that is no diff at all gives []. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let start = 0;
  let hunk: DiffHunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  /** Inside `diff --git` headers (before the first hunk). */
  let gitHeader = false;

  const close = (end: number) => {
    if (!file) return;
    file.raw = lines.slice(start, end).join("\n");
    if (file.status === "modified" && file.oldPath === null && file.newPath !== null && (file.hunks.length > 0 || file.binary)) file.status = "added";
    if (file.status === "modified" && file.newPath === null && file.oldPath !== null && (file.hunks.length > 0 || file.binary)) file.status = "deleted";
    if (file.status === "modified" && file.oldPath && file.newPath && file.oldPath !== file.newPath) file.status = "renamed";
    for (const h of file.hunks) markSpans(h.lines);
    files.push(file);
    file = null;
    hunk = null;
  };
  const open = (i: number) => {
    close(i);
    file = newFile();
    start = i;
  };
  const inHunk = () => hunk !== null && (oldLeft > 0 || newLeft > 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (inHunk()) {
      const h = hunk!;
      const c = line[0];
      // The next file's header ends the hunk even when its counts promised more lines (LLM-written
      // patches): a `diff --git` line, or a `---` / `+++` pair followed by a hunk header. Without the
      // `@@` the pair is a deleted `-- …` and an added `++ …` line. In a numbered hunk with exactly
      // one old and one new line left the pair is that hunk's last change, so it stays content.
      const nextFile =
        line.startsWith("diff --git ") ||
        (line.startsWith("--- ") &&
          lines[i + 1]?.startsWith("+++ ") === true &&
          lines[i + 2]?.startsWith("@@") === true &&
          !(h.numbered && oldLeft === 1 && newLeft === 1));
      if (nextFile) {
        oldLeft = 0;
        newLeft = 0;
        i--;
        continue;
      }
      if (c === "+" && newLeft > 0) {
        h.lines.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: h.numbered ? newNo++ : null });
        newLeft--;
        file!.additions++;
        continue;
      }
      if (c === "-" && oldLeft > 0) {
        h.lines.push({ kind: "del", text: line.slice(1), oldNo: h.numbered ? oldNo++ : null, newNo: null });
        oldLeft--;
        file!.deletions++;
        continue;
      }
      if ((c === " " || line === "") && oldLeft > 0 && newLeft > 0) {
        h.lines.push({ kind: "ctx", text: line.slice(1), oldNo: h.numbered ? oldNo++ : null, newNo: h.numbered ? newNo++ : null });
        oldLeft--;
        newLeft--;
        continue;
      }
      if (c === "\\") {
        const last = h.lines[h.lines.length - 1];
        if (last) last.noNewline = true;
        continue;
      }
      // Counts did not match the body (hand-written diff): end the hunk and read the line as a header.
      oldLeft = 0;
      newLeft = 0;
    }
    if (line.startsWith("\\")) {
      const last = hunk ? hunk.lines[hunk.lines.length - 1] : undefined;
      if (last) last.noNewline = true;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      open(i);
      const [a, b] = gitPaths(line.slice(11));
      file!.oldPath = a;
      file!.newPath = b;
      gitHeader = true;
      continue;
    }
    if (line.startsWith("--- ") && i + 1 < lines.length && lines[i + 1]!.startsWith("+++ ")) {
      if (!gitHeader || !file) open(i);
      gitHeader = false;
      const f = file!;
      f.oldPath = cleanPath(line.slice(4));
      f.newPath = cleanPath(lines[i + 1]!.slice(4));
      if (f.oldPath === null && f.newPath !== null) f.status = "added";
      else if (f.newPath === null && f.oldPath !== null) f.status = "deleted";
      i++;
      continue;
    }
    const m = HUNK.exec(line);
    const bare = m ? null : BARE_HUNK.exec(line);
    if (m || bare) {
      if (!file) open(i);
      gitHeader = false;
      const h: DiffHunk = m
        ? {
            oldStart: Number(m[1]),
            oldLines: m[2] === undefined ? 1 : Number(m[2]),
            newStart: Number(m[3]),
            newLines: m[4] === undefined ? 1 : Number(m[4]),
            section: (m[5] ?? "").trim(),
            numbered: true,
            lines: [],
          }
        : { oldStart: 0, oldLines: Infinity, newStart: 0, newLines: Infinity, section: (bare![1] ?? "").trim(), numbered: false, lines: [] };
      file!.hunks.push(h);
      hunk = h;
      oldLeft = h.oldLines;
      newLeft = h.newLines;
      oldNo = h.oldStart;
      newNo = h.newStart;
      continue;
    }
    if (file && gitHeader) {
      gitHeaderLine(file, line);
      continue;
    }
    if (line.startsWith("Binary files ")) {
      // A bare "Binary files a and b differ" (diff -u without git headers).
      open(i);
      const bm = line.match(/^Binary files (.+) and (.+) differ$/);
      file!.oldPath = bm ? cleanPath(bm[1]!) : null;
      file!.newPath = bm ? cleanPath(bm[2]!) : null;
      file!.binary = true;
      continue;
    }
    // Anything else (a preamble, `index …`, trailing junk) is ignored.
  }
  close(lines.length);
  return files;
}

/** What a file's header shows: the new path (old → new for a rename / copy). */
export function diffFilePath(f: DiffFile): string {
  const a = f.oldPath;
  const b = f.newPath;
  if ((f.status === "renamed" || f.status === "copied") && a && b && a !== b) return `${a} → ${b}`;
  return b ?? a ?? "";
}

export function diffLineCount(f: DiffFile): number {
  let n = 0;
  for (const h of f.hunks) n += h.lines.length;
  return n;
}

/** Unchanged lines hidden before hunk `i` (from line 1, or from the previous hunk); 0 = adjacent / unknown. */
export function hiddenBefore(f: DiffFile, i: number): number {
  const h = f.hunks[i];
  if (!h || !h.numbered) return 0;
  const p = i > 0 ? f.hunks[i - 1] : null;
  if (p && !p.numbered) return 0;
  const lastShown = !p ? 0 : p.oldLines === 0 ? p.oldStart : p.oldStart + p.oldLines - 1;
  const firstShown = h.oldLines === 0 ? h.oldStart + 1 : h.oldStart;
  return Math.max(0, firstShown - lastShown - 1);
}

/** A row of a hunk as the viewer shows it: a line, or a folded run of context lines. */
export type HunkRow = { type: "line"; line: DiffLine; index: number } | { type: "fold"; from: number; to: number };

/**
 * Context runs longer than `keep * 2 + min` inside a hunk fold down to `keep` lines on each side
 * (or only the side next to a change at the hunk's start / end). `open` = fold starts already expanded.
 */
export function hunkRows(lines: readonly DiffLine[], open: ReadonlySet<number> = new Set(), keep = 3, min = 4): HunkRow[] {
  const rows: HunkRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "ctx") {
      rows.push({ type: "line", line: lines[i]!, index: i });
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j]!.kind === "ctx") j++;
    const head = i === 0 ? 0 : keep;
    const tail = j === lines.length ? 0 : keep;
    const from = i + head;
    const to = j - tail;
    if (to - from >= min && !open.has(from)) {
      for (let k = i; k < from; k++) rows.push({ type: "line", line: lines[k]!, index: k });
      rows.push({ type: "fold", from, to });
      for (let k = to; k < j; k++) rows.push({ type: "line", line: lines[k]!, index: k });
    } else {
      for (let k = i; k < j; k++) rows.push({ type: "line", line: lines[k]!, index: k });
    }
    i = j;
  }
  return rows;
}

/** Changed span of `b` against `a` by common prefix / suffix; null when (almost) everything changed. */
export function changedSpan(a: string, b: string): [number, number] | null {
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const changed = Math.max(a.length, b.length) - p - s;
  if (p + s === 0 || changed > Math.max(a.length, b.length) * 0.7) return null;
  return [p, b.length - s];
}

/** Pair each run of −lines with the following run of +lines (same length) and mark their changed spans. */
function markSpans(lines: DiffLine[]): void {
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "del") {
      i++;
      continue;
    }
    let d = i;
    while (d < lines.length && lines[d]!.kind === "del") d++;
    let a = d;
    while (a < lines.length && lines[a]!.kind === "add") a++;
    const dels = d - i;
    if (dels > 0 && a - d === dels && dels <= 20) {
      for (let k = 0; k < dels; k++) {
        const del = lines[i + k]!;
        const add = lines[d + k]!;
        const forward = changedSpan(del.text, add.text);
        const back = changedSpan(add.text, del.text);
        if (forward && back) {
          add.span = forward;
          del.span = back;
        }
      }
    }
    i = Math.max(a, i + 1);
  }
}
