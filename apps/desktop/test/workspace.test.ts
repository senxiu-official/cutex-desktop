import { describe, expect, it } from "vitest";
import { escapeFileHref, FILE_HREF_ESCAPE, parseFileLink, resolveFileHref, unescapeFileHref } from "../src/renderer/src/lib/workspace";

describe("parseFileLink", () => {
  const root = "D:\\Apps\\cutex-desktop";
  it("parses relative links with line suffixes", () => {
    expect(parseFileLink("src/profiles/quota.rs:42", root)).toEqual({ path: "src/profiles/quota.rs", line: 42 });
    expect(parseFileLink("./docs/DESIGN.md#L10-L20", root)).toEqual({ path: "docs/DESIGN.md", line: 10 });
    expect(parseFileLink("apps/desktop/src/main/index.ts", root)).toEqual({ path: "apps/desktop/src/main/index.ts", line: null });
  });
  it("maps absolute paths under the root and rejects others", () => {
    expect(parseFileLink("D:/Apps/cutex-desktop/AGENTS.md", root)).toEqual({ path: "AGENTS.md", line: null });
    expect(parseFileLink("file:///D:/Apps/cutex-desktop/PLAN.md:3", root)).toEqual({ path: "PLAN.md", line: 3 });
    expect(parseFileLink("C:/Windows/notepad.exe", root)).toBeNull();
    expect(parseFileLink("../outside.md", root)).toBeNull();
  });
  it("ignores web links and anchors", () => {
    expect(parseFileLink("https://example.com/a.md", root)).toBeNull();
    expect(parseFileLink("#section", root)).toBeNull();
  });
});

describe("resolveFileHref", () => {
  const root = "/mnt/data/Projects/Cutex/cutex";
  const home = "/home/jy";
  it("keeps absolute paths outside the root as host paths (not previewable)", () => {
    expect(resolveFileHref("/home/jy/.cutex/reports/issue.md", root)).toEqual({ path: "/home/jy/.cutex/reports/issue.md", abs: "/home/jy/.cutex/reports/issue.md", rel: null, line: null });
    expect(resolveFileHref("C:\\Users\\sam\\notes.md:7", "D:\\Apps\\cutex-desktop")).toEqual({ path: "C:\\Users\\sam\\notes.md", abs: "C:\\Users\\sam\\notes.md", rel: null, line: 7 });
  });
  it("maps paths inside the root; POSIX roots compare case-sensitively", () => {
    expect(resolveFileHref("/mnt/data/Projects/Cutex/cutex/src/main.rs:12", root)).toMatchObject({ rel: "src/main.rs", line: 12 });
    expect(resolveFileHref("/mnt/data/projects/cutex/cutex/src/main.rs", root)?.rel).toBeNull();
    expect(resolveFileHref("/mnt/data/Projects/Cutex/cutex/../secret", root)?.rel).toBeNull();
  });
  it("expands ~ with the host home when known", () => {
    expect(resolveFileHref("~/notes/a.md", root, home)).toEqual({ path: "~/notes/a.md", abs: "/home/jy/notes/a.md", rel: null, line: null });
    expect(resolveFileHref("~/notes/a.md", root, null)).toEqual({ path: "~/notes/a.md", abs: null, rel: null, line: null });
    expect(resolveFileHref("~/x.md", "C:\\Users\\sam", "C:\\Users\\sam")).toMatchObject({ abs: "C:\\Users\\sam\\x.md", rel: "x.md" });
  });
  it("handles file:// URLs on both platforms and percent-encoding", () => {
    expect(resolveFileHref("file:///home/jy/a%20b.md", root)).toMatchObject({ abs: "/home/jy/a b.md", rel: null });
    expect(resolveFileHref("file:///D:/Apps/x.md", null)).toMatchObject({ abs: "D:/Apps/x.md" });
  });
  it("relative paths: workspace-relative with a root, still a file ref without one", () => {
    expect(resolveFileHref("docs/issue.md#L4", root)).toEqual({ path: "docs/issue.md", abs: "/mnt/data/Projects/Cutex/cutex/docs/issue.md", rel: "docs/issue.md", line: 4 });
    expect(resolveFileHref("docs/issue.md", null)).toEqual({ path: "docs/issue.md", abs: null, rel: "docs/issue.md", line: null });
    expect(resolveFileHref("../up.md", root)).toEqual({ path: "../up.md", abs: null, rel: null, line: null });
  });
  it("a bare file name with a line suffix is a file, not a scheme", () => {
    expect(resolveFileHref("README.md:12", root)).toMatchObject({ rel: "README.md", line: 12 });
  });
  it("escapes hrefs the markdown sanitizer would drop, round-trip", () => {
    for (const href of ["D:/Apps/x.md:3", "file:///home/jy/a%20b.md", "README.md:12"]) {
      const escaped = escapeFileHref(href);
      expect(escaped?.startsWith(FILE_HREF_ESCAPE)).toBe(true);
      expect(unescapeFileHref(escaped!)).toBe(href);
    }
    for (const href of ["src/a.rs:3", "/home/jy/a.md", "javascript:alert(1)", "https://x.y", "vscode://file/a"]) expect(escapeFileHref(href)).toBeNull();
  });
  it("is not a file for web links, other schemes and anchors", () => {
    for (const href of ["https://x.y/a.md", "mailto:a@b.c", "vscode://file/a", "javascript:alert(1)", "#top", "//cdn/x.js", ""]) expect(resolveFileHref(href, root)).toBeNull();
  });
});

describe("shortenHome", () => {
  it("abbreviates home directories and drops the verbatim prefix", async () => {
    const { shortenHome } = await import("../src/renderer/src/lib/workspace");
    expect(shortenHome("C:\\Users\\sam\\proj")).toBe("~\\proj");
    expect(shortenHome("\\\\?\\C:\\Users\\sam\\.cutex-desktop-dev\\workspace")).toBe("~\\.cutex-desktop-dev\\workspace");
    expect(shortenHome("/home/jy/code/cutex")).toBe("~/code/cutex");
    expect(shortenHome("D:\\Apps\\cutex-desktop")).toBe("D:\\Apps\\cutex-desktop");
  });
});
