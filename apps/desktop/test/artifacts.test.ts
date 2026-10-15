// 成果 (artifact store P0; docs/research/artifacts-api-v1.md, docs/desktop-modules.md v1.7 §19.6):
// `cutex:` link parsing / escaping (core), the shared wire helpers and request builders (main
// process), and the module's pure helpers — version identity (pinned vs latest, after the research
// demo's workspaceTabs tests), attribution text, previews, CSV, the artifact_publish tool call.
import { describe, expect, it } from "vitest";
import {
  artifactContentQuery,
  artifactDiffQuery,
  artifactId,
  artifactLink,
  artifactListQuery,
  artifactMarkdown,
  artifactPatchBody,
  artifactPublishBody,
  artifactRef,
  artifactResolveBody,
  artifactVersionSel,
  parseArtifactRef,
  type ArtifactDetail,
  type ArtifactProducer,
  type ArtifactSummary,
  type ArtifactVersion,
} from "../src/shared/artifactStore";
import { CUTEX_HREF_ESCAPE, cutexHref, cutexLinkRef, escapeCutexHref, linkableKind, parseCutexLink, unescapeCutexHref } from "../src/renderer/src/lib/cutexLinks";
import { parseRef } from "../src/renderer/src/lib/refs";
import { escapeFileHref } from "../src/renderer/src/lib/workspace";
import {
  arrangeLibrary,
  attributionText,
  DEFAULT_LIBRARY,
  diffGap,
  externalGone,
  fence,
  formatBytes,
  initView,
  isOldVersion,
  nameFromMarkdown,
  parseDelimited,
  parseViewParams,
  previewKind,
  previousVersion,
  producerKey,
  producerLabel,
  producerOptions,
  publishCallOf,
  resolveVersion,
  restoreLibrary,
  restoreView,
  sessionName,
  viewKey,
} from "../src/renderer/src/modules/artifacts/model";

const ID = "af-3f9a1c2e7b8d4e05a1c2d3e4f5a6b7c8";
const OTHER = "af-8b2d4f6a1c3e5b7d9f0a2c4e6b8d0f13";

describe("cutex: links (core, §19.6)", () => {
  it("parses cutex:<kind>/<key>; the kind follows the ref kind rule, the key is decoded once", () => {
    expect(parseCutexLink(`cutex:artifact/${ID}@2`)).toEqual({ kind: "artifact", key: `${ID}@2` });
    expect(parseCutexLink("CUTEX:artifact/af-x@latest")).toEqual({ kind: "artifact", key: "af-x@latest" });
    expect(parseCutexLink("cutex:note.page/a%20b")).toEqual({ kind: "note.page", key: "a b" });
    expect(parseCutexLink("cutex:k/%E0%A4%A")).toEqual({ kind: "k", key: "%E0%A4%A" });
    for (const bad of ["cutex://artifact/x", "cutex:artifact", "cutex:/x", "cutex:Artifact/x", "cutex:artifact/", "cutex:artifact/a b", "cutex:artifact/x?y=1", "cutex:artifact/x#f", "cutex:artifact/%0Ax", "https://x/y", "artifact/x", "", null, undefined])
      expect(parseCutexLink(bad as string), String(bad)).toBeNull();
    expect(parseCutexLink(`cutex:k/${"x".repeat(2001)}`)).toBeNull();
  });

  it("escapes through sanitize and back; other hrefs are left to the file-link escape", () => {
    const href = `cutex:artifact/${ID}@2`;
    const escaped = escapeCutexHref(href)!;
    expect(escaped.startsWith(CUTEX_HREF_ESCAPE)).toBe(true);
    expect(escaped).not.toContain("cutex:artifact");
    expect(unescapeCutexHref(escaped)).toBe(href);
    expect(escapeCutexHref("https://example.com")).toBeNull();
    expect(escapeCutexHref("D:/x.md")).toBeNull();
    expect(unescapeCutexHref("https://example.com")).toBeNull();
    expect(unescapeCutexHref("#cutex-file:D%3A%2Fx")).toBeNull();
    // A fragment that only looks escaped but decodes to something else is not a cutex link.
    expect(unescapeCutexHref(`${CUTEX_HREF_ESCAPE}${encodeURIComponent("javascript:alert(1)")}`)).toBeNull();
    expect(unescapeCutexHref(`${CUTEX_HREF_ESCAPE}%E0%A4%A`)).toBeNull();
    // The file escape does not claim cutex links (Markdown checks cutex first anyway).
    expect(escapeFileHref(href)).toBeNull();
  });

  it("a link's ref is a valid CutexRef (title = link text, else the key); built-in kinds never link", () => {
    const ref = cutexLinkRef("local", { kind: "artifact", key: `${ID}@2` }, "  regression.md\n v2 ");
    expect(ref).toEqual({ hostId: "local", kind: "artifact", key: `${ID}@2`, title: "regression.md v2", params: {} });
    expect(parseRef(ref)).toEqual(ref);
    expect(cutexLinkRef("local", { kind: "artifact", key: "k" }, "").title).toBe("k");
    expect(cutexLinkRef("local", { kind: "artifact", key: "k" }, "x".repeat(300)).title).toHaveLength(200);
    for (const kind of ["turn", "agent", "main.page", "side.page"]) expect(linkableKind(kind)).toBe(false);
    expect(linkableKind("artifact")).toBe(true);
    expect(cutexHref({ kind: "artifact", key: `${ID}@latest` })).toBe(`cutex:artifact/${ID}@latest`);
  });
});

describe("artifact store wire (shared/artifactStore.ts)", () => {
  it("refs: af-<32 hex>@<n|latest>", () => {
    expect(parseArtifactRef(`${ID}@4`)).toEqual({ artifactId: ID, version: 4 });
    expect(parseArtifactRef(`${ID}@latest`)).toEqual({ artifactId: ID, version: "latest" });
    for (const bad of [`${ID}@0`, `${ID}@01`, `${ID}`, `${ID}@`, `AF-${ID.slice(3)}@1`, `${ID.toUpperCase()}@1`, "af-123@1", `${ID}@1@2`, 42]) expect(parseArtifactRef(bad), String(bad)).toBeNull();
    expect(artifactRef(ID, 3)).toBe(`${ID}@3`);
    expect(artifactLink(`${ID}@3`)).toBe(`cutex:artifact/${ID}@3`);
    expect(artifactMarkdown("a [draft] \\ v3", `${ID}@3`)).toBe(`[a \\[draft\\] \\\\ v3](cutex:artifact/${ID}@3)`);
  });

  it("list query: one scope selector and only the contract's parameters", () => {
    expect(artifactListQuery({ forSession: "cutex.abc", q: " reg ", kind: "report", archived: "all", limit: 200, cursor: "c1", extra: "x" })).toEqual({ forSession: "cutex.abc", q: "reg", kind: "report", archived: "all", limit: 200, cursor: "c1" });
    expect(artifactListQuery({ project: "scp", q: "" })).toEqual({ project: "scp" });
    expect(() => artifactListQuery({ project: "a", session: "b" })).toThrow();
    expect(() => artifactListQuery({ project: "a/b" })).toThrow();
    expect(() => artifactListQuery({ project: "a", kind: "poster" })).toThrow();
    expect(() => artifactListQuery({ project: "a", limit: 201 })).toThrow();
    expect(() => artifactListQuery({ project: "a", archived: "yes" })).toThrow();
  });

  it("ids, version selectors, content and diff queries, resolve bodies", () => {
    expect(artifactId(ID)).toBe(ID);
    expect(() => artifactId("../x")).toThrow();
    expect(artifactVersionSel("latest")).toBe("latest");
    expect(artifactVersionSel(3)).toBe("3");
    for (const bad of [0, -1, 1.5, "3"]) expect(() => artifactVersionSel(bad)).toThrow();
    expect(artifactContentQuery(undefined)).toEqual({});
    expect(artifactContentQuery({ offset: 10, maxBytes: 4 * 1024 * 1024 })).toEqual({ offset: 10, maxBytes: 4 * 1024 * 1024 });
    expect(() => artifactContentQuery({ maxBytes: 4 * 1024 * 1024 + 1 })).toThrow();
    expect(() => artifactContentQuery({ offset: -1 })).toThrow();
    expect(artifactDiffQuery(1, 3)).toEqual({ from: 1, to: 3 });
    expect(() => artifactDiffQuery(0, 3)).toThrow();
    expect(artifactResolveBody([`${ID}@1`, `${ID}@1`, `${OTHER}@latest`])).toEqual({ refs: [`${ID}@1`, `${OTHER}@latest`] });
    expect(() => artifactResolveBody([])).toThrow();
    expect(() => artifactResolveBody(["x"])).toThrow();
    expect(() => artifactResolveBody(Array.from({ length: 201 }, (_, i) => `${ID}@${i + 1}`))).toThrow();
  });

  it("owner publish and patch bodies", () => {
    expect(artifactPublishBody({ requestId: "r1", project: "scp", path: " reports/a.md ", name: "", kind: "report", note: " n ", other: 1 })).toEqual({ requestId: "r1", project: "scp", path: "reports/a.md", kind: "report", note: "n" });
    expect(artifactPublishBody({ requestId: "r1", path: "a.md" })).toEqual({ requestId: "r1", path: "a.md" });
    expect(() => artifactPublishBody({ requestId: "r1", project: "a", session: "b", path: "a.md" })).toThrow();
    expect(() => artifactPublishBody({ requestId: "r1", path: "  " })).toThrow();
    expect(() => artifactPublishBody({ path: "a.md" })).toThrow();
    expect(() => artifactPublishBody({ requestId: "r1", path: "a.md", kind: "poster" })).toThrow();
    expect(artifactPatchBody({ expectedRevision: 7, starred: true, junk: 1 })).toEqual({ expectedRevision: 7, starred: true });
    expect(artifactPatchBody({ expectedRevision: 0, name: " b.md ", archived: false })).toEqual({ expectedRevision: 0, name: "b.md", archived: false });
    expect(() => artifactPatchBody({ expectedRevision: 7 })).toThrow();
    expect(() => artifactPatchBody({ starred: true })).toThrow();
    expect(() => artifactPatchBody({ expectedRevision: 1, starred: "yes" })).toThrow();
  });
});

const producer = (over: Partial<ArtifactProducer> = {}): ArtifactProducer => ({ kind: "agent", sessionId: "cutex.a", displayName: "A", runtimeGeneration: 3, turnId: "t1", askId: null, profile: null, model: null, attribution: null, candidates: [], ...over });
const ver = (n: number, over: Partial<ArtifactVersion> = {}): ArtifactVersion => ({
  artifactId: ID,
  version: n,
  ref: `${ID}@${n}`,
  link: `cutex:artifact/${ID}@${n}`,
  storage: "blob",
  sha256: "x",
  bytes: 10,
  mediaType: "text/markdown",
  sourcePath: "D:\\r\\reports\\a.md",
  note: null,
  producer: producer(),
  git: null,
  createdAt: `2026-10-10T0${n}:00:00Z`,
  ...over,
});
const summary = (id: string, name: string, over: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  artifactId: id,
  scope: { kind: "project", id: "p" },
  name,
  kind: "report",
  latestVersion: 1,
  revision: 1,
  starred: false,
  archivedAt: null,
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "2026-10-10T00:00:00Z",
  latest: ver(1),
  ...over,
});

describe("artifacts.view identity and versions (after the research demo's workspaceTabs)", () => {
  it("pinned and latest are distinct tab identities; same ref = same tab", () => {
    const latest = parseViewParams({ ref: `${ID}@latest`, name: " a.md " })!;
    const pinned = parseViewParams({ ref: `${ID}@1` })!;
    expect(latest).toEqual({ ref: `${ID}@latest`, name: "a.md" });
    expect(viewKey(latest)).not.toBe(viewKey(pinned));
    expect(viewKey(pinned)).toBe(viewKey({ ref: `${ID}@1` }));
    expect(viewKey({ ref: `${ID}@1` })).not.toBe(viewKey({ ref: `${OTHER}@1` }));
    for (const bad of [null, {}, { ref: "x" }, { ref: `${ID}@0` }, [`${ID}@1`]]) expect(parseViewParams(bad as never)).toBeNull();
  });

  it("init keeps the pane for the same ref; restore validates", () => {
    const s = initView({ ref: `${ID}@2` }, { ref: `${ID}@2`, pane: "source", name: "a.md" });
    expect(s).toEqual({ ref: `${ID}@2`, pane: "source", name: "a.md" });
    expect(initView({ ref: `${ID}@3` }, s)).toEqual({ ref: `${ID}@3`, pane: "preview" });
    expect(restoreView({ ref: `${ID}@latest`, pane: "compare" }, 1)).toEqual({ ref: `${ID}@latest`, pane: "compare" });
    expect(restoreView({ ref: `${ID}@latest`, pane: "evil" }, 1)).toEqual({ ref: `${ID}@latest`, pane: "preview" });
    expect(restoreView({ ref: `${ID}@latest` }, 2)).toBeNull();
    expect(restoreView({ ref: "nope" }, 1)).toBeNull();
  });

  it("latest follows updates, pinned keeps its version, a missing version never falls back to latest", () => {
    const detail: ArtifactDetail = { artifact: summary(ID, "a.md", { latestVersion: 1 }), versions: [ver(1)] };
    expect(resolveVersion(detail, "latest")?.version).toBe(1);
    detail.versions = [ver(2), ver(1)];
    detail.artifact = { ...detail.artifact, latestVersion: 2 };
    expect(resolveVersion(detail, "latest")?.version).toBe(2);
    expect(resolveVersion(detail, 1)?.version).toBe(1);
    expect(resolveVersion(detail, 9)).toBeUndefined();
    detail.artifact = { ...detail.artifact, latestVersion: 5 };
    expect(resolveVersion(detail, "latest")).toBeUndefined();
    expect(resolveVersion(null, "latest")).toBeUndefined();
    expect(isOldVersion(1, 2)).toBe(true);
    expect(isOldVersion(2, 2)).toBe(false);
    expect(isOldVersion("latest", 9)).toBe(false);
    expect(previousVersion([ver(4), ver(2), ver(1)], 4)).toBe(2);
    expect(previousVersion([ver(4), ver(2), ver(1)], 1)).toBeNull();
  });
});

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join("|")})` : key);

describe("producers and auto-capture attribution", () => {
  it("one line per producer; ambiguous names every candidate", () => {
    expect(producerLabel(producer(), t as never)).toBe("A");
    expect(producerLabel(producer({ kind: "owner", sessionId: null }), t as never)).toBe("artifacts.producer.owner");
    const cand = (name: string) => ({ sessionId: `cutex.${name}`, displayName: name, turnId: "t" });
    expect(producerLabel(producer({ kind: "auto", attribution: "exclusive", candidates: [cand("B")] }), t as never)).toBe("artifacts.producer.autoExclusive(B)");
    expect(producerLabel(producer({ kind: "auto", sessionId: null, attribution: "ambiguous", candidates: [cand("A"), cand("B")] }), t as never)).toBe("artifacts.producer.autoAmbiguous(A / B)");
    expect(producerLabel(producer({ kind: "auto", sessionId: null, attribution: "unknown", candidates: [] }), t as never)).toBe("artifacts.producer.autoUnknown");
    expect(attributionText(producer(), t as never)).toBeNull();
    expect(attributionText(producer({ kind: "auto", attribution: "ambiguous", candidates: [cand("A"), cand("B")] }), t as never)).toBe("artifacts.src.ambiguous(A / B)");
    expect(attributionText(producer({ kind: "auto", attribution: "unknown" }), t as never)).toBe("artifacts.src.unknown");
  });

  it("cutex sends displayName null (the owner, unknown sessions): the session id stands in, nothing crashes", () => {
    const nameless = producer({ sessionId: "cutex.gone", displayName: null });
    expect(producerLabel(nameless, t as never)).toBe("cutex.gone");
    expect(sessionName({ displayName: "  ", sessionId: "cutex.x" })).toBe("cutex.x");
    expect(producerLabel(producer({ kind: "auto", attribution: "exclusive", candidates: [{ sessionId: "cutex.gone", displayName: null, turnId: null }] }), t as never)).toBe("artifacts.producer.autoExclusive(cutex.gone)");
    const items = [
      summary("af-1", "a.md", { latest: ver(1, { producer: nameless }) }),
      summary("af-2", "b.md", { latest: ver(1, { producer: producer({ sessionId: "cutex.b", displayName: "B" }) }) }),
      summary("af-3", "c.md", { latest: ver(1, { producer: producer({ kind: "owner", sessionId: null, displayName: null }) }) }),
    ];
    expect(producerOptions(items).map((o) => [o.key, o.name])).toEqual([
      ["agent:cutex.b", "B"],
      ["agent:cutex.gone", "cutex.gone"],
      ["owner", ""],
    ]);
  });

  it("library: producer filter keys, options and sorting", () => {
    const owner = producer({ kind: "owner", sessionId: null, displayName: "owner" });
    const autoP = producer({ kind: "auto", sessionId: null, attribution: "ambiguous" });
    const items = [
      summary("af-1", "b.md", { updatedAt: "2026-10-10T03:00:00Z", createdAt: "2026-10-09T00:00:00Z", kind: "figure" }),
      summary("af-2", "a.md", { updatedAt: "2026-10-10T01:00:00Z", createdAt: "2026-10-10T02:00:00Z", latest: ver(1, { producer: owner }) }),
      summary("af-3", "c.csv", { updatedAt: "2026-10-10T02:00:00Z", kind: "table", latest: ver(1, { producer: autoP }) }),
    ];
    expect(producerKey(items[0]!.latest.producer)).toBe("agent:cutex.a");
    expect(producerOptions(items).map((o) => o.key)).toEqual(["agent:cutex.a", "owner", "auto"]);
    expect(arrangeLibrary(items, { producer: "", sort: "updated" }).map((a) => a.name)).toEqual(["b.md", "c.csv", "a.md"]);
    expect(arrangeLibrary(items, { producer: "", sort: "name" }).map((a) => a.name)).toEqual(["a.md", "b.md", "c.csv"]);
    expect(arrangeLibrary(items, { producer: "", sort: "kind" }).map((a) => a.name)).toEqual(["a.md", "b.md", "c.csv"]);
    expect(arrangeLibrary(items, { producer: "", sort: "created" }).map((a) => a.name)).toEqual(["a.md", "c.csv", "b.md"]);
    expect(arrangeLibrary(items, { producer: "owner", sort: "updated" }).map((a) => a.name)).toEqual(["a.md"]);
    expect(restoreLibrary({ q: "x", kind: "poster", sort: "size", layout: "grid", archived: "all" })).toEqual({ ...DEFAULT_LIBRARY, q: "x", layout: "grid", archived: "all" });
    expect(restoreLibrary(null)).toEqual(DEFAULT_LIBRARY);
  });
});

describe("previews", () => {
  it("kind by media type, then extension", () => {
    expect(previewKind("text/markdown; charset=utf-8", "a.txt")).toBe("markdown");
    expect(previewKind("application/octet-stream", "reports/a.md")).toBe("markdown");
    expect(previewKind("image/svg+xml", "f.svg")).toBe("image");
    expect(previewKind("text/csv", "t")).toBe("csv");
    expect(previewKind("text/plain", "t.tsv")).toBe("tsv");
    expect(previewKind("application/json", "x")).toBe("text");
    expect(previewKind("application/octet-stream", "fit.py")).toBe("text");
    expect(previewKind("application/pdf", "paper.pdf")).toBe("binary");
  });

  it("HTML pages: text/html / xhtml or an .html / .htm name, but an image media type stays an image", () => {
    expect(previewKind("text/html; charset=utf-8", "doodle")).toBe("html");
    expect(previewKind("application/xhtml+xml", "x")).toBe("html");
    expect(previewKind("text/plain", "figures/doodle.html")).toBe("html");
    expect(previewKind("", "page.HTM")).toBe("html");
    expect(previewKind("image/png", "odd.html")).toBe("image");
    expect(previewKind("text/markdown", "notes.html")).toBe("markdown");
  });

  it("the page / source choice of an HTML tab survives restore and re-init of the same ref only", () => {
    const ref = "af-0123456789abcdef0123456789abcdef@latest";
    expect(restoreView({ ref, pane: "preview", code: true }, 1)).toEqual({ ref, pane: "preview", code: true });
    expect(restoreView({ ref, pane: "preview", code: "yes" }, 1)).toEqual({ ref, pane: "preview" });
    expect(initView({ ref }, { ref, pane: "preview", code: true })).toEqual({ ref, pane: "preview", code: true });
    expect(initView({ ref: "af-0123456789abcdef0123456789abcdef@2" }, { ref, pane: "preview", code: true })).toEqual({ ref: "af-0123456789abcdef0123456789abcdef@2", pane: "preview" });
  });

  it("CSV / TSV: quotes, doubled quotes, CRLF, blank lines; at most n rows", () => {
    expect(parseDelimited('a,b\r\n"x, y","he said ""hi"""\n\n1,2', ",", 10)).toEqual({ rows: [["a", "b"], ["x, y", 'he said "hi"'], ["1", "2"]], more: false });
    expect(parseDelimited("a\tb\n1\t2\n", "\t", 10).rows).toEqual([["a", "b"], ["1", "2"]]);
    const many = Array.from({ length: 20 }, (_, i) => `${i},x`).join("\n");
    expect(parseDelimited(many, ",", 5)).toEqual({ rows: Array.from({ length: 5 }, (_, i) => [String(i), "x"]), more: true });
    expect(parseDelimited('"multi\nline",z', ",", 5).rows).toEqual([["multi\nline", "z"]]);
  });

  it("bytes and fences", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(fence("a ``` b", "md")).toBe("````md\na ``` b\n````");
  });
});

describe("external versions (cutex sends no bytes for them)", () => {
  it("对比: diff null without binary = not diffed; external vs too large; a real (even empty) diff is not a gap", () => {
    const blob = ver(1);
    const external = ver(2, { storage: "external" });
    expect(diffGap({ binary: false, diff: null }, blob, external)).toBe("external");
    expect(diffGap({ binary: false, diff: null }, external, external)).toBe("external");
    expect(diffGap({ binary: false, diff: null }, blob, ver(2))).toBe("large");
    expect(diffGap({ binary: false, diff: null }, undefined, undefined)).toBe("large");
    expect(diffGap({ binary: false, diff: "" }, blob, ver(2))).toBeNull();
    expect(diffGap({ binary: false, diff: "@@ -1 +1 @@" }, blob, ver(2))).toBeNull();
    expect(diffGap({ binary: true, diff: null }, blob, external)).toBeNull();
  });

  it("预览: a changed external file has no content; blobs and unchanged externals do", () => {
    expect(externalGone({ externalChanged: true, content: "" })).toBe(true);
    expect(externalGone({ externalChanged: false, content: "" })).toBe(false);
    expect(externalGone({ externalChanged: null, content: "" })).toBe(false);
    expect(externalGone({ externalChanged: true, content: "line 0" })).toBe(false);
  });
});

describe("artifact_publish tool call", () => {
  const call = (status: string, args: unknown, result?: unknown, isError = false) => ({
    type: "mcpToolCall",
    id: "m1",
    server: "cutex",
    tool: "artifact_publish",
    status,
    arguments: args,
    ...(result ? { result: { content: [{ type: "text", text: JSON.stringify(result) }], ...(isError ? { isError: true } : {}) } } : {}),
  });

  it("done: the full artifact name (the markdown label is only its last segment), the pinned ref, new_version", () => {
    const r = { ok: true, artifact_id: ID, name: "reports/a [x].md", version: 3, ref: `${ID}@3`, link: `cutex:artifact/${ID}@3`, markdown: `[a \\[x\\].md v3](cutex:artifact/${ID}@3)`, new_version: false, scope: { kind: "project", id: "p" } };
    expect(publishCallOf(call("completed", { path: "reports/a.md" }, r))).toEqual({ status: "done", name: "reports/a [x].md", path: "reports/a.md", ref: `${ID}@3`, version: 3, newVersion: false });
    const { name: _name, ...noName } = r;
    expect(publishCallOf(call("completed", { path: "reports/a.md" }, noName))).toMatchObject({ status: "done", name: "a [x].md" });
  });

  it("running, refused and malformed results; other tools are not ours", () => {
    expect(publishCallOf(call("inProgress", { path: "out/fig.png" }))).toMatchObject({ status: "running", name: "fig.png" });
    expect(publishCallOf(call("completed", { path: "../x", name: "X" }, { ok: false, error: "artifact_path_forbidden" }, true))).toMatchObject({ status: "failed", name: "X" });
    expect(publishCallOf(call("completed", { path: "a" }, { ref: "not-a-ref" }))).toMatchObject({ status: "failed" });
    expect(publishCallOf({ ...call("completed", {}), tool: "artifact_list" })).toBeNull();
    expect(publishCallOf({ ...call("completed", {}), server: "other" })).toBeNull();
    expect(nameFromMarkdown("[a.md v12](cutex:artifact/af-x@12)")).toBe("a.md");
    expect(nameFromMarkdown("[a.md](https://x)")).toBeNull();
  });
});
