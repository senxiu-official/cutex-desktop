// The 文件 explorer's rules (docs/design/019-file-explorer.md): rows (sorting, merged folders, hidden / ignored /
// changes only, filter, the 2,000 cap), git marks, history, reveal / follow, type-ahead, the gallery default,
// remembered state and the old v1 card state, dragged paths.
import { describe, expect, it } from "vitest";
import type { FsEntry, GitStatus } from "../src/shared/ipc";
import {
  absoluteOf,
  autoGallery,
  buildRows,
  DEFAULT_OPTIONS,
  emptyHistory,
  folderView,
  foldersBetween,
  gitMarks,
  MAX_CHILDREN,
  NO_MARKS,
  parentRowIndex,
  parseRootView,
  planFollow,
  planReveal,
  pushHistory,
  relativeTo,
  rowIndexOf,
  sortEntries,
  stepHistory,
  stickyAncestors,
  typeAhead,
  withExpanded,
  type EntryRow,
  type Listing,
  type RowsInput,
} from "../src/renderer/src/modules/workspace/explorer/model";
import { parseExplorerStore } from "../src/renderer/src/modules/workspace/explorer/store";
import { restoreFiles } from "../src/renderer/src/modules/workspace/explorer/state";
import { mentionText, parseDraggedPaths } from "../src/renderer/src/lib/workspaceDrag";

type Spec = Record<string, (string | [string, Partial<FsEntry>])[]>;
/** Listings from `{ dir: ["name/", "file", ...] }` (a trailing / = folder). */
function listings(spec: Spec): Map<string, Listing> {
  const out = new Map<string, Listing>();
  for (const [dir, names] of Object.entries(spec)) {
    out.set(dir, {
      error: null,
      entries: names.map((n) => {
        const [raw, extra] = typeof n === "string" ? [n, {}] : n;
        const isDir = raw.endsWith("/");
        const name = isDir ? raw.slice(0, -1) : raw;
        const path = dir ? `${dir}/${name}` : name;
        return { name, path, kind: isDir ? "dir" : "file", targetKind: null, size: isDir ? null : 10, modifiedAt: "2026-10-01T00:00:00Z", ignored: false, ...extra } as FsEntry;
      }),
    });
  }
  return out;
}
const input = (spec: Spec, over: Partial<RowsInput> = {}): RowsInput => ({
  listings: listings(spec),
  loc: "",
  expanded: new Set(),
  options: DEFAULT_OPTIONS,
  hidden: false,
  marks: NO_MARKS,
  ...over,
});
const names = (r: ReturnType<typeof buildRows>) => r.rows.map((x) => (x.type === "entry" ? `${"  ".repeat(x.depth)}${x.chain.map((c) => c.name).join("/")}${x.dir ? (x.open ? " v" : " >") : ""}` : `${"  ".repeat(x.depth)}<${x.type}>`));

describe("explorer rows", () => {
  it("folders first, natural names, hidden files off by default (decision 3)", () => {
    const r = buildRows(input({ "": ["file10.txt", "file2.txt", ".github/", "src/", "B.md", "a.md"] }));
    expect(names(r)).toEqual(["src >", "a.md", "B.md", "file2.txt", "file10.txt"]);
    expect(names(buildRows(input({ "": [".github/", "a"] }, { hidden: true })))).toEqual([".github >", "a"]);
  });

  it("sorts by time / size / kind, descending, folders mixed in", () => {
    const spec: Spec = { "": [["old.ts", { modifiedAt: "2026-01-01T00:00:00Z", size: 5 }], ["new.md", { modifiedAt: "2026-09-01T00:00:00Z", size: 1 }], "dir/"] };
    const l = listings(spec).get("")!.entries!;
    expect(sortEntries(l, { sort: "mtime", desc: false, foldersFirst: true }).map((e) => e.name)).toEqual(["dir", "new.md", "old.ts"]);
    expect(sortEntries(l, { sort: "size", desc: false, foldersFirst: false }).map((e) => e.name)).toEqual(["old.ts", "new.md", "dir"]);
    expect(sortEntries(l, { sort: "kind", desc: false, foldersFirst: true }).map((e) => e.name)).toEqual(["dir", "new.md", "old.ts"]);
    expect(sortEntries(l, { sort: "name", desc: true, foldersFirst: true }).map((e) => e.name)).toEqual(["dir", "old.ts", "new.md"]);
  });

  it("merges single-folder chains, opens them as one row and asks for the next folder", () => {
    const spec: Spec = { "": ["apps/", "x.md"], apps: ["desktop/"], "apps/desktop": ["src/", "package.json"] };
    expect(names(buildRows(input(spec)))).toEqual(["apps/desktop >", "x.md"]);
    const open = buildRows(input(spec, { expanded: new Set(["apps"]) }));
    expect(names(open)).toEqual(["apps/desktop v", "  src >", "  package.json", "x.md"]);
    expect(open.wanted).toEqual(expect.arrayContaining(["", "apps/desktop"]));
    // Compact off: one row per folder.
    expect(names(buildRows(input(spec, { options: { ...DEFAULT_OPTIONS, compact: false }, expanded: new Set(["apps"]) })))).toEqual(["apps v", "  desktop >", "x.md"]);
    // Opening a folder whose only child is a folder reads that one too (the chain grows).
    const half = buildRows(input({ "": ["a/"], a: ["b/"] }, { expanded: new Set(["a"]) }));
    expect(half.wanted).toContain("a/b");
  });

  it("loading and error rows; dimmed ignored files stay, hidden ones go", () => {
    const spec: Spec = { "": ["src/", ["node_modules/", { ignored: true }], "a"] };
    expect(names(buildRows(input(spec, { expanded: new Set(["src"]) })))).toEqual(["node_modules >", "src v", "  <loading>", "a"]);
    const errs = listings(spec);
    errs.set("src", { entries: null, error: "permission_denied" });
    const r = buildRows({ ...input(spec), listings: errs, expanded: new Set(["src"]) });
    expect(r.rows.find((x) => x.type === "error")).toMatchObject({ text: "permission_denied", depth: 1 });
    expect(names(buildRows(input(spec, { options: { ...DEFAULT_OPTIONS, ignored: "hide" } })))).toEqual(["src >", "a"]);
  });

  it("git marks on files, a dot on folders with changes; changes only", () => {
    const git = { isRepo: true, files: [{ path: "src/a.ts", status: "modified", staged: false }, { path: "new.md", status: "untracked", staged: false }, { path: "src/b.ts", status: "added", staged: true }] } as unknown as GitStatus;
    const marks = gitMarks(git);
    expect(marks.files.get("src/a.ts")).toBe("M");
    expect(marks.files.get("new.md")).toBe("U");
    expect([...marks.dirty].sort()).toEqual(["", "src"]);
    const spec: Spec = { "": ["src/", "lib/", "new.md", "old.md"], src: ["a.ts", "b.ts", "c.ts"] };
    const r = buildRows(input(spec, { marks, expanded: new Set(["src"]) }));
    const row = (p: string) => r.rows.find((x): x is EntryRow => x.type === "entry" && x.path === p)!;
    expect(row("src").dirty).toBe(true);
    expect(row("lib").dirty).toBe(false);
    expect(row("src/a.ts").git).toBe("M");
    expect(names(buildRows(input(spec, { marks, expanded: new Set(["src"]), options: { ...DEFAULT_OPTIONS, changesOnly: true } })))).toEqual(["src v", "  a.ts", "  b.ts", "new.md"]);
    // A shown sub-root: paths relative to it.
    expect(gitMarks(git, "src").files.get("a.ts")).toBe("M");
  });

  it("the filter looks only in folders already read, keeps parents, no merging", () => {
    const spec: Spec = { "": ["apps/", "docs/", "pane.md"], apps: ["desktop/"], "apps/desktop": ["paneLayout.ts", "store.ts"], docs: ["x.md"] };
    const r = buildRows(input(spec, { filter: "pane" }));
    expect(names(r)).toEqual(["apps v", "  desktop v", "    paneLayout.ts", "pane.md"]);
    // Nothing there: one empty row (the explorer offers 全部搜索).
    expect(buildRows(input(spec, { filter: "zzz" })).rows).toEqual([{ type: "empty", path: "", depth: 0 }]);
  });

  it("a reveal shows a hidden target and its hidden parents, marked", () => {
    const spec: Spec = { "": [".github/", "a"], ".github": ["ci.yml"] };
    const r = buildRows(input(spec, { force: ".github/ci.yml", expanded: new Set([".github"]) }));
    expect(names(r)).toEqual([".github v", "  ci.yml", "a"]);
    // The hidden one on the way carries the mark (its child is an ordinary name).
    expect((r.rows[0] as EntryRow).forced).toBe(true);
    expect((r.rows[1] as EntryRow).forced).toBe(false);
  });

  it("draws at most MAX_CHILDREN children and says how many more", () => {
    const many = Array.from({ length: MAX_CHILDREN + 5 }, (_, i) => `f${i}`);
    const r = buildRows(input({ "": many }));
    expect(r.rows).toHaveLength(MAX_CHILDREN + 1);
    expect(r.rows.at(-1)).toEqual({ type: "more", path: "", depth: 0, count: 5 });
  });

  it("row lookups: inside a merged chain, the parent row, sticky parents, type-ahead", () => {
    const spec: Spec = { "": ["apps/", "beta.md", "alpha.md"], apps: ["desktop/"], "apps/desktop": ["a.ts", "b.ts"] };
    const { rows } = buildRows(input(spec, { expanded: new Set(["apps/desktop"]) }));
    expect(rowIndexOf(rows, "apps")).toBe(0);
    expect(rowIndexOf(rows, "apps/desktop/b.ts")).toBe(2);
    expect(parentRowIndex(rows, 2)).toBe(0);
    expect(parentRowIndex(rows, 0)).toBe(-1);
    expect(stickyAncestors(rows, 2)).toEqual([0]);
    expect(typeAhead(rows, 0, "a")).toBe(1);
    expect(typeAhead(rows, 1, "a")).toBe(3);
    expect(typeAhead(rows, 3, "al")).toBe(3);
    expect(typeAhead(rows, 0, "zz")).toBe(-1);
  });
});

describe("explorer navigation", () => {
  it("history: push drops forward entries, back / forward keep where you were", () => {
    let h = emptyHistory({ root: "default", loc: "", sel: null, scroll: 0 });
    h = pushHistory(h, { root: "default", loc: "", sel: "src", scroll: 40 }, { root: "default", loc: "src", sel: null, scroll: 0 });
    h = pushHistory(h, { root: "default", loc: "src", sel: "src/lib", scroll: 0 }, { root: "default", loc: "src/lib", sel: null, scroll: 0 });
    const back = stepHistory(h, { root: "default", loc: "src/lib", sel: "src/lib/x.ts", scroll: 12 }, -1)!;
    expect(back.entries[back.index]).toEqual({ root: "default", loc: "src", sel: "src/lib", scroll: 0 });
    const twice = stepHistory(back, back.entries[back.index]!, -1)!;
    expect(twice.entries[twice.index]).toMatchObject({ loc: "", sel: "src", scroll: 40 });
    expect(stepHistory(twice, twice.entries[0]!, -1)).toBeNull();
    // Forward returns to the entry left with its selection.
    const fwd = stepHistory(twice, twice.entries[0]!, 2)!;
    expect(fwd.entries[fwd.index]).toMatchObject({ loc: "src/lib", sel: "src/lib/x.ts", scroll: 12 });
    // Going somewhere new from the middle drops what was forward.
    const branch = pushHistory(back, back.entries[back.index]!, { root: "default", loc: "docs", sel: null, scroll: 0 });
    expect(branch.entries.map((e) => e.loc)).toEqual(["", "src", "docs"]);
  });

  it("history keeps the last 50", () => {
    let h = emptyHistory({ root: "default", loc: "0", sel: null, scroll: 0 });
    for (let i = 1; i < 60; i++) h = pushHistory(h, h.entries[h.index]!, { root: "default", loc: String(i), sel: null, scroll: 0 });
    expect(h.entries).toHaveLength(50);
    expect(h.entries[h.index]!.loc).toBe("59");
  });

  it("reveal: inside the current folder → stay and open the way; outside → its folder (019 §3)", () => {
    expect(planReveal("src/lib/a.ts", "", false)).toEqual({ loc: null, expand: ["src", "src/lib"], sel: "src/lib/a.ts" });
    expect(planReveal("src/lib/a.ts", "src", false)).toEqual({ loc: null, expand: ["src/lib"], sel: "src/lib/a.ts" });
    expect(planReveal("docs/x.md", "src", false)).toEqual({ loc: "docs", expand: [], sel: "docs/x.md" });
    // A folder is opened too (as 打开文件夹 did).
    expect(planReveal("image-references/cafe", "", true)).toEqual({ loc: null, expand: ["image-references", "image-references/cafe"], sel: "image-references/cafe" });
    expect(planReveal("src", "src", true)).toEqual({ loc: null, expand: [], sel: "src" });
  });

  it("follow never moves: only inside the current folder", () => {
    expect(planFollow("src/a.ts", "src")).toEqual({ loc: null, expand: [], sel: "src/a.ts" });
    expect(planFollow("docs/a.md", "src")).toBeNull();
    expect(foldersBetween("", "a/b/c.txt")).toEqual(["a", "a/b"]);
  });

  it("paths against a root, POSIX and Windows", () => {
    expect(relativeTo("/home/u/proj/src/a.ts", "/home/u/proj")).toBe("src/a.ts");
    expect(relativeTo("/home/u/proj", "/home/u/proj/")).toBe("");
    expect(relativeTo("/home/u/project2/a", "/home/u/proj")).toBeNull();
    expect(relativeTo("d:\\Apps\\Cutex\\docs\\x.md", "D:\\Apps\\cutex")).toBe("docs/x.md");
    expect(absoluteOf("D:\\Apps\\cutex", "docs/x.md")).toBe("D:\\Apps\\cutex\\docs\\x.md");
    expect(absoluteOf("/home/u/proj/", "")).toBe("/home/u/proj");
  });
});

describe("explorer gallery and state", () => {
  it("a folder of ≥ 4 images that are ≥ 80 % of its files opens as thumbnails; a choice wins (decision 4)", () => {
    const imgs = listings({ r: ["a.png", "b.jpg", "c.webp", "d.png", "sub/"] }).get("r")!.entries;
    expect(autoGallery(imgs)).toBe(true);
    expect(autoGallery(listings({ r: ["a.png", "b.png", "c.png", "notes.md"] }).get("r")!.entries)).toBe(false);
    expect(autoGallery(listings({ r: ["a.png", "b.png", "c.png", "d.png", "notes.md"] }).get("r")!.entries)).toBe(true);
    const view = parseRootView({ views: { r: "list" } });
    expect(folderView(view, "r", imgs)).toBe("list");
    expect(folderView(view, "other", imgs)).toBe("gallery");
  });

  it("stored state: unknown values dropped, caps kept", () => {
    const parsed = parseExplorerStore({
      options: { follow: false, sort: "bogus", split: 3, thumb: 7 },
      roots: { "local|session:a": { loc: "src", expanded: ["src", "../etc", "/abs"], sel: 5, hidden: true, views: { r: "gallery", s: "tiles" } }, nokey: {} },
    });
    expect(parsed.options).toMatchObject({ follow: false, sort: "name", split: 0.8, thumb: 1, preview: true });
    expect(parsed.roots["local|session:a"]).toMatchObject({ loc: "src", expanded: ["src"], sel: null, hidden: true, views: { r: "gallery" } });
    expect(parsed.roots.nokey).toBeUndefined();
    expect(withExpanded(["a", "b"], "a", true)).toEqual(["b", "a"]);
    expect(withExpanded(["a", "b"], "a", false)).toEqual(["b"]);
  });

  it("the v1 card state (only the search text) still restores", () => {
    expect(restoreFiles({ q: "daemon" })).toEqual({ q: "daemon" });
    expect(restoreFiles({ q: "x", root: "cwd", reveal: "a", revealSeq: 3 })).toEqual({ q: "x", root: "cwd" });
    expect(restoreFiles(null)).toEqual({ q: "" });
  });

  it("dragged paths become `path` mentions", () => {
    expect(parseDraggedPaths(JSON.stringify(["src/a.ts", 3, "", "b.md"]))).toEqual(["src/a.ts", "b.md"]);
    expect(parseDraggedPaths("not json")).toEqual([]);
    expect(mentionText(["src/a.ts", "b.md"])).toBe("`src/a.ts` `b.md` ");
  });
});
