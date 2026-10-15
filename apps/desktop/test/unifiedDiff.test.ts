// Unified diff parsing for the diff viewer (lib/unifiedDiff.ts): files, hunks, line numbers,
// "\ No newline", git rename / binary / mode headers, bare ---/+++ sections, folding and spans.
import { describe, expect, it } from "vitest";
import { type DiffFile, changedSpan, cleanPath, diffFilePath, hiddenBefore, hunkRows, parseUnifiedDiff, unquoteGitPath } from "../src/renderer/src/lib/unifiedDiff";

const GIT = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@ export function f() {",
  ' import x from "y";',
  "-const a = 1;",
  "+const a = 2;",
  "+const b = 3;",
  " export { a };",
  "@@ -20,2 +21,2 @@",
  " keep",
  "-old end",
  "\\ No newline at end of file",
  "+new end",
  "\\ No newline at end of file",
  "diff --git a/old name.md b/new name.md",
  "similarity index 90%",
  "rename from old name.md",
  "rename to new name.md",
  "diff --git a/logo.png b/logo.png",
  "new file mode 100644",
  "index 0000000..3333333",
  "Binary files /dev/null and b/logo.png differ",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-one",
  "-two",
  "",
].join("\n");

/** Every test indexes into the result; a missing element fails the assertion anyway. */
const parse = (text: string): DiffFile[] => parseUnifiedDiff(text);

describe("parseUnifiedDiff", () => {
  const files = parse(GIT);

  it("splits git sections into files with status and counts", () => {
    expect(files.map((f) => [diffFilePath(f), f.status, f.additions, f.deletions, f.binary])).toEqual([
      ["src/a.ts", "modified", 3, 2, false],
      ["old name.md → new name.md", "renamed", 0, 0, false],
      ["logo.png", "added", 0, 0, true],
      ["gone.txt", "deleted", 0, 2, false],
    ]);
    expect(files[1]!.meta).toEqual(["similarity index 90%"]);
  });

  it("numbers old / new lines and keeps the section text", () => {
    const h1 = files[0]!.hunks[0]!;
    const h2 = files[0]!.hunks[1]!;
    expect(h1.section).toBe("export function f() {");
    expect(h1.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ["ctx", 1, 1],
      ["del", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["ctx", 3, 4],
    ]);
    expect(h2.lines.map((l) => [l.kind, l.text, l.oldNo, l.newNo, !!l.noNewline])).toEqual([
      ["ctx", "keep", 20, 21, false],
      ["del", "old end", 21, null, true],
      ["add", "new end", null, 22, true],
    ]);
  });

  it("keeps each file's raw text for copying", () => {
    expect(files[0]!.raw.split("\n")[0]!).toBe("diff --git a/src/a.ts b/src/a.ts");
    expect(files[3]!.raw.endsWith("-two")).toBe(true);
  });

  it("reads bare ---/+++ sections (turn diffs) and a deleted line that looks like a header", () => {
    const text = ["--- /dev/null", "+++ b/new.txt", "@@ -0,0 +1,2 @@", "+a", "+b", "--- a/x", "+++ b/x", "@@ -1,2 +1,1 @@", "--- not a header", " kept"].join("\n");
    const fs = parse(text);
    expect(fs.map((f) => [diffFilePath(f), f.status])).toEqual([
      ["new.txt", "added"],
      ["x", "modified"],
    ]);
    expect(fs[1]!.hunks[0]!.lines.map((l) => [l.kind, l.text])).toEqual([
      ["del", "-- not a header"],
      ["ctx", "kept"],
    ]);
  });

  it("defaults omitted hunk counts to 1", () => {
    const f = parse('@@ -35 +35 @@\n-      return 1;\n+      return 2;')[0]!;
    expect(f.hunks[0]!.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ["del", 35, null],
      ["add", null, 35],
    ]);
  });

  it("reads bare @@ hunks without numbers", () => {
    const all = parse("--- a/x\n+++ b/x\n@@ fn main\n-a\n+b\n c\n--- a/y\n+++ b/y\n@@\n+z");
    const f = all[0]!;
    const g = all[1]!;
    expect(f.hunks[0]!.numbered).toBe(false);
    expect(f.hunks[0]!.section).toBe("fn main");
    expect(f.hunks[0]!.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ["del", null, null],
      ["add", null, null],
      ["ctx", null, null],
    ]);
    expect(diffFilePath(g)).toBe("y");
    expect(g.additions).toBe(1);
  });

  it("handles CRLF, a plain Binary line and non-diff text", () => {
    expect(parse("--- a/x\r\n+++ b/x\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n")[0]!.hunks[0]!.lines.map((l) => l.text)).toEqual(["a", "b"]);
    const bin = parse("Binary files a/x.bin and b/x.bin differ")[0]!;
    expect([diffFilePath(bin), bin.binary]).toEqual(["x.bin", true]);
    expect(parse("hello\nworld")).toEqual([]);
    expect(parse("")).toEqual([]);
  });

  it("marks the changed span of paired lines", () => {
    const f = parse("@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 22;")[0]!;
    const del = f.hunks[0]!.lines[0]!;
    const add = f.hunks[0]!.lines[1]!;
    expect(del.span).toEqual([10, 11]);
    expect(add.span).toEqual([10, 12]);
    expect(add.text.slice(...add.span!)).toBe("22");
  });
});

describe("helpers", () => {
  it("cleanPath strips prefixes, quotes, timestamps and /dev/null", () => {
    expect(cleanPath("a/src/x.ts")).toBe("src/x.ts");
    expect(cleanPath("b/x.ts\t2026-10-15 10:00:00")).toBe("x.ts");
    expect(cleanPath('"a/with \\"q\\".txt"')).toBe('with "q".txt');
    expect(cleanPath("/dev/null")).toBeNull();
  });

  it("hiddenBefore counts unchanged lines between hunks", () => {
    const f = parse(GIT)[0]!;
    expect(hiddenBefore(f, 0)).toBe(0);
    expect(hiddenBefore(f, 1)).toBe(16); // old lines 4..19
    const g = parse("@@ -10,2 +10,2 @@\n a\n-b\n+c")[0]!;
    expect(hiddenBefore(g, 0)).toBe(9);
  });

  it("hunkRows folds long context runs, keeping 3 lines next to changes", () => {
    const body = ["@@ -1,20 +1,20 @@", ...Array.from({ length: 10 }, (_, i) => ` c${i}`), "-x", "+y", ...Array.from({ length: 9 }, (_, i) => ` d${i}`)].join("\n");
    const lines = parse(body)[0]!.hunks[0]!.lines;
    const rows = hunkRows(lines);
    // Leading run: fold 0..7, keep c7..c9; trailing run: keep d0..d2, fold the rest.
    expect(rows[0]!).toEqual({ type: "fold", from: 0, to: 7 });
    expect(rows.filter((r) => r.type === "fold")).toEqual([
      { type: "fold", from: 0, to: 7 },
      { type: "fold", from: 15, to: 21 },
    ]);
    expect(hunkRows(lines, new Set([0, 15])).every((r) => r.type === "line")).toBe(true);
    // Short runs never fold.
    expect(hunkRows(parse(GIT)[0]!.hunks[0]!.lines).every((r) => r.type === "line")).toBe(true);
  });

  it("changedSpan gives up when nearly everything changed", () => {
    expect(changedSpan("abc", "xyz")).toBeNull();
    expect(changedSpan("foo(bar)", "foo(baz)")).toEqual([6, 7]);
  });
});

describe("review fixes (2026-10-15)", () => {
  it("decodes git's C-quoted paths: octal UTF-8 bytes and \\t \\n \\\" \\\\", () => {
    expect(cleanPath('"a/\\346\\226\\207.md"')).toBe("文.md");
    expect(unquoteGitPath('x\\ty\\nz\\"q\\\\w')).toBe('x\ty\nz"q\\w');
    expect(cleanPath('"b/\\346\\226\\207 \\"q\\".txt"\t2026-10-15')).toBe('文 "q".txt');
  });

  it("reads quoted diff --git paths, including an escaped quote", () => {
    const f = parse('diff --git "a/\\346\\226\\207 \\"x\\".md" "b/\\346\\226\\207 \\"x\\".md"\nindex 1..2 100644\n')[0]!;
    expect([f.oldPath, f.newPath]).toEqual(['文 "x".md', '文 "x".md']);
  });

  it("unquotes rename / copy from / to paths", () => {
    const text = [
      'diff --git "a/\\346\\227\\247.md" "b/\\346\\226\\260.md"',
      "similarity index 100%",
      'rename from "\\346\\227\\247.md"',
      'rename to "\\346\\226\\260.md"',
      "diff --git a/x b/y",
      "similarity index 90%",
      'copy from "a\\tb"',
      "copy to plain y",
    ].join("\n");
    const [r, c] = parse(text);
    expect([r!.status, r!.oldPath, r!.newPath]).toEqual(["renamed", "旧.md", "新.md"]);
    expect([c!.status, c!.oldPath, c!.newPath]).toEqual(["copied", "a\tb", "plain y"]);
  });

  it("a hunk whose counts exceed its body does not swallow the next file", () => {
    const text = ["--- a/x", "+++ b/x", "@@ -1,9 +1,9 @@", "-a", "+b", "--- a/y", "+++ b/y", "@@ -1 +1 @@", "-c", "+d"].join("\n");
    const fs = parse(text);
    expect(fs.map((f) => diffFilePath(f))).toEqual(["x", "y"]);
    expect(fs[0]!.hunks[0]!.lines.map((l) => l.kind)).toEqual(["del", "add"]);
    expect(fs[1]!.additions).toBe(1);
    const git = parse(["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,9 +1,9 @@", "-a", "diff --git a/y b/y", "--- a/y", "+++ b/y", "@@ -1 +1 @@", "+z"].join("\n"));
    expect(git.map((f) => diffFilePath(f))).toEqual(["x", "y"]);
  });

  it("in a hunk, a -- / ++ line pair without a following @@ is content", () => {
    const bare = parse(["--- a/x", "+++ b/x", "@@", "--- a", "+++ b", " ctx"].join("\n"));
    expect(bare).toHaveLength(1);
    expect(bare[0]!.hunks[0]!.lines.map((l) => [l.kind, l.text])).toEqual([
      ["del", "-- a"],
      ["add", "++ b"],
      ["ctx", "ctx"],
    ]);
    // Exactly one old / new line left: the pair is the hunk's last change even before the next @@.
    const numbered = parse(["@@ -1,2 +1,2 @@", " k", "--- a", "+++ b", "@@ -9 +9 @@", "-q", "+r"].join("\n"));
    expect(numbered).toHaveLength(1);
    expect(numbered[0]!.hunks.map((h) => h.lines.length)).toEqual([3, 2]);
  });
});
