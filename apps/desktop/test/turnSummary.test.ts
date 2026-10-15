import { describe, expect, it } from "vitest";
import { countUnified, fileChangesByTurn, linkName, linkTypeOf, pickTurnLinks, startsExpanded, summarizeFileChanges, turnFileDiff, MAX_LINKS } from "../src/renderer/src/lib/turnSummary";
import type { RawItem, TimelineEntry } from "../src/renderer/src/lib/timeline";

const ROOT = "D:\\Apps\\app";
const at = (rel: string) => `${ROOT}\\${rel.replace(/\//g, "\\")}`;
let n = 0;
const fc = (changes: unknown[], status = "completed"): RawItem => ({ type: "fileChange", id: `f${n++}`, status, changes });
const add = (path: string, diff: string) => ({ path, kind: { type: "add" }, diff });
const del = (path: string, diff: string) => ({ path, kind: { type: "delete" }, diff });
const upd = (path: string, diff: string, move_path: string | null = null) => ({ path, kind: { type: "update", move_path }, diff });
const tool = (item: RawItem, turnId: string): TimelineEntry => ({ kind: "tool", id: item.id, turnId, item });

describe("summarizeFileChanges", () => {
  it("counts add / delete content lines and unified diff lines", () => {
    const files = summarizeFileChanges([fc([add("a.md", "one\ntwo\n"), del("b.md", "x\ny\nz"), upd("c.ts", "--- a/c.ts\n+++ b/c.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n+more\n same")])]);
    expect(files.map((f) => [f.path, f.status, f.added, f.deleted])).toEqual([
      ["a.md", "added", 2, 0],
      ["b.md", "deleted", 0, 3],
      ["c.ts", "modified", 2, 1],
    ]);
  });

  it("merges by path and follows moves", () => {
    const files = summarizeFileChanges([
      fc([upd(at("src/x.ts"), "@@ -1 +1 @@\n-a\n+b")]),
      fc([upd("D:\\apps\\APP\\src\\x.ts", "@@ -5 +5,2 @@\n-c\n+d\n+e")]),
      fc([upd(at("old/name.ps1"), "@@ -1 +1 @@\n-1\n+2", at("new/name.ps1"))]),
      fc([upd(at("new/name.ps1"), "@@ -3 +3 @@\n-x\n+y")]),
    ]);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ path: at("src/x.ts"), status: "modified", added: 3, deleted: 2 });
    expect(files[0]!.changes).toHaveLength(2);
    expect(files[1]).toMatchObject({ path: at("new/name.ps1"), from: at("old/name.ps1"), status: "moved", added: 2, deleted: 2 });
  });

  it("drops a file added and deleted in the same turn; a new file stays new after edits", () => {
    const files = summarizeFileChanges([fc([add("tmp.txt", "x"), add("n.md", "a\n")]), fc([del("tmp.txt", "x"), upd("n.md", "@@ -1 +1,2 @@\n a\n+b")])]);
    expect(files.map((f) => [f.path, f.status, f.added])).toEqual([["n.md", "added", 2]]);
  });

  it("ignores failed, declined and running items", () => {
    expect(summarizeFileChanges([fc([add("a", "x")], "failed"), fc([add("b", "x")], "declined"), fc([add("c", "x")], "inProgress")])).toEqual([]);
  });

  it("handles items without kind (older shape) as updates", () => {
    const files = summarizeFileChanges([fc([{ path: "z.rs" }])]);
    expect(files).toEqual([expect.objectContaining({ path: "z.rs", status: "modified", added: 0, deleted: 0 })]);
  });
});

describe("fileChangesByTurn", () => {
  it("groups per turn and leaves out turns without completed changes", () => {
    const entries: TimelineEntry[] = [
      tool(fc([add("a.md", "1\n2\n")]), "t1"),
      tool({ type: "commandExecution", id: "c1", status: "completed" }, "t1"),
      tool(fc([upd("b.ts", "@@ -1 +1 @@\n-x\n+y")]), "t1"),
      tool(fc([add("c.md", "x")], "failed"), "t2"),
      { kind: "agent", id: "m", turnId: "t3", text: "", streaming: false },
    ];
    const map = fileChangesByTurn(entries);
    expect([...map.keys()]).toEqual(["t1"]);
    expect(map.get("t1")).toMatchObject({ added: 3, deleted: 1 });
    expect(map.get("t1")!.files).toHaveLength(2);
    // Same content → same signature (memo comparison).
    expect(fileChangesByTurn(entries).get("t1")!.signature).toBe(map.get("t1")!.signature);
  });
});

describe("countUnified / turnFileDiff", () => {
  it("skips file headers before the first hunk only", () => {
    expect(countUnified("diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- removed dashes\n+++ added plus")).toEqual({ added: 1, deleted: 1 });
  });

  it("builds one diff from add / update / delete records", () => {
    const [file] = summarizeFileChanges([fc([add("n.md", "a\nb\n")]), fc([upd("n.md", "@@ -2 +2 @@\n-b\n+c")])]);
    const diff = turnFileDiff(file!);
    expect(diff).toContain("--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,2 @@\n+a\n+b");
    expect(diff).toContain("--- a/n.md\n+++ b/n.md\n@@ -2 +2 @@\n-b\n+c");
    const [gone] = summarizeFileChanges([fc([del("g.md", "x\n")])]);
    expect(turnFileDiff(gone!)).toBe("--- a/g.md\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x");
  });
});

describe("pickTurnLinks", () => {
  const changed = summarizeFileChanges([fc([add(at("docs/report.html"), "<p>x</p>"), upd(at("src/main.rs"), "@@ -1 +1 @@\n-a\n+b"), del(at("docs/old.md"), "x")])]);
  const opts = { root: ROOT, hostRead: true };

  it("keeps changed files, documents (to verify), local servers and explicit web links; skips code refs", () => {
    const text = [
      "Done: [main.rs](src/main.rs), see [main.rs:42](src/main.rs:42) and [lib.rs](src/lib.rs).",
      "Server: `http://localhost:5173/` and http://example.com/bare.",
      "Docs: [Guide](docs/guide.pdf), [site](https://example.com/docs).",
    ].join("\n");
    const links = pickTurnLinks(text, changed, opts);
    expect(links.map((l) => [l.kind, l.target, l.changed, l.verify])).toEqual([
      ["file", "src/main.rs", true, false],
      ["web", "http://localhost:5173/", false, false],
      ["file", "docs/guide.pdf", false, true],
      ["web", "https://example.com/docs", false, false],
    ]);
    expect(links[2]!.abs).toBe(at("docs/guide.pdf"));
  });

  it('pins "open" links first and dedupes by target', () => {
    const text = "See [notes](docs/notes.md) and http://127.0.0.1:8080 — the report: [Report](docs/report.html \"open\"), again [report.html](D:/Apps/app/docs/report.html).";
    const links = pickTurnLinks(text, changed, opts);
    expect(links.map((l) => l.target)).toEqual(["docs/report.html", "docs/notes.md", "http://127.0.0.1:8080"]);
    expect(links[0]).toMatchObject({ pinned: true, changed: true, label: "Report" });
  });

  it("without the host file read only changed files (and open picks) remain", () => {
    const text = "[guide](docs/guide.pdf) [report](docs/report.html) [mine](notes/x.md 'open')";
    const links = pickTurnLinks(text, changed, { root: ROOT, hostRead: false });
    expect(links.map((l) => [l.target, l.verify])).toEqual([
      ["notes/x.md", false],
      ["docs/report.html", false],
    ]);
  });

  it("ignores fenced code, deleted files and caps the list", () => {
    const fenced = "```sh\ncurl http://localhost:3000\n[a](docs/a.md)\n```\n[old](docs/old.md)";
    expect(pickTurnLinks(fenced, changed, opts).map((l) => l.target)).toEqual(["docs/old.md"]);
    expect(pickTurnLinks(fenced, changed, opts)[0]!.verify).toBe(true);
    const many = Array.from({ length: 10 }, (_, i) => `[d${i}](docs/d${i}.md)`).join(" ");
    expect(pickTurnLinks(many, changed, opts)).toHaveLength(MAX_LINKS);
  });

  it("names and types", () => {
    expect(linkName({ kind: "web", target: "http://localhost:5173/", label: null })).toBe("localhost:5173");
    expect(linkName({ kind: "file", target: "docs/a b.md", label: null })).toBe("a b.md");
    expect(linkTypeOf({ kind: "file", ext: "md" })).toEqual({ group: "doc", ext: "MD" });
    expect(linkTypeOf({ kind: "file", ext: "png" })).toEqual({ group: "image", ext: "PNG" });
    expect(linkTypeOf({ kind: "file", ext: "rs" })).toEqual({ group: "file", ext: "RS" });
    expect(linkTypeOf({ kind: "web", ext: "" })).toEqual({ group: "web", ext: "" });
  });
});

describe("startsExpanded", () => {
  it("expands only the latest turn with at most 5 files in latestExpanded mode", () => {
    expect(startsExpanded("collapsed", true, 1)).toBe(false);
    expect(startsExpanded("latestExpanded", true, 5)).toBe(true);
    expect(startsExpanded("latestExpanded", true, 6)).toBe(false);
    expect(startsExpanded("latestExpanded", false, 1)).toBe(false);
  });
});
