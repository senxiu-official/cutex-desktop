// @vitest-environment jsdom
// TODO 工具行专用视图 (2026-11-12): web lookups (Codex webSearch, Claude WebSearch / WebFetch) and a file change's diff
// get their own views on the core row; everything else about the row (status, failure, layout) stays the core's.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawItem } from "../src/renderer/src/lib/timeline";
import { webToolRow, webUrl } from "../src/renderer/src/lib/webToolRows";
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
const { WebToolRow } = await import("../src/renderer/src/modules/conversation/WebToolRow");
const { FileChangeRow } = await import("../src/renderer/src/modules/conversation/FileChangeRow");
const conversation = (await import("../src/renderer/src/modules/conversation")).default;

const claude = (tool: string, args: unknown, over = {}): RawItem => ({ type: "dynamicToolCall", namespace: "claude", tool, arguments: args, id: "c", status: "completed", success: true, contentItems: [{ type: "inputText", text: "page text" }], ...over }) as RawItem;
const codex = (action: unknown, query = ""): RawItem => ({ type: "webSearch", id: "w", query, action }) as RawItem;
const change = (changes: unknown[]): RawItem => ({ type: "fileChange", id: "f", status: "completed", changes }) as RawItem;

describe("webToolRow", () => {
  it("Codex webSearch: search (one or several queries), openPage, findInPage", () => {
    expect(webToolRow(codex({ type: "search", query: "tokio cas", queries: null }))).toMatchObject({ kind: "webSearch", summary: "tokio cas", url: null });
    expect(webToolRow(codex({ type: "search", query: null, queries: ["a", "b"] }))).toMatchObject({ kind: "webSearch", summary: "a · b", fields: [{ name: "query", value: "a" }, { name: "query", value: "b" }] });
    expect(webToolRow(codex(null, "older item query"))).toMatchObject({ kind: "webSearch", summary: "older item query" });
    expect(webToolRow(codex({ type: "openPage", url: "https://docs.rs/tokio" }))).toMatchObject({ kind: "webPage", summary: "https://docs.rs/tokio", url: "https://docs.rs/tokio" });
    expect(webToolRow(codex({ type: "findInPage", url: "https://docs.rs/tokio", pattern: "Mutex" }))).toMatchObject({ kind: "webPage", summary: "Mutex · https://docs.rs/tokio" });
  });
  it("Claude WebSearch / WebFetch (JSON-string arguments too)", () => {
    expect(webToolRow(claude("WebSearch", { query: "agent sdk", allowed_domains: ["docs.claude.com"] }))).toMatchObject({ kind: "webSearch", summary: "agent sdk", fields: [{ name: "query", value: "agent sdk" }, { name: "allowed_domains", value: "docs.claude.com" }] });
    expect(webToolRow(claude("WebFetch", JSON.stringify({ url: "https://example.com/a.md", prompt: "summarise" })))).toMatchObject({ kind: "webPage", url: "https://example.com/a.md", fields: [{ name: "url", value: "https://example.com/a.md" }, { name: "prompt", value: "summarise" }] });
  });
  it("nothing to show, another namespace, or another tool: not this view", () => {
    for (const i of [codex({ type: "search", query: null, queries: null }), codex({ type: "other" }), codex({ type: "openPage", url: null }), claude("WebFetch", {}), claude("WebSearch", { query: " " }), claude("WebFetch", { url: "https://x" }, { namespace: "cutex" }), claude("Read", { file_path: "a" })]) expect(webToolRow(i)).toBeNull();
  });
  it("only http(s) pages become links", () => {
    expect(webUrl("https://example.com/x")).toBe("https://example.com/x");
    for (const u of ["javascript:alert(1)", "file:///etc/passwd", "not a url", null]) expect(webUrl(u)).toBeNull();
    expect(webToolRow(codex({ type: "openPage", url: "file:///C:/secret.txt" }))).toMatchObject({ kind: "webPage", url: null, summary: "file:///C:/secret.txt" });
  });
});

describe("conversation module: the new renderers come after the standard ones and match only their items", () => {
  const entries = conversation.contributes!["timeline.tool"]!;
  const ids = entries.map((e) => e.id);
  it("registered after conversation.standardTools", () => {
    expect(ids.indexOf("conversation.webTools")).toBeGreaterThan(ids.indexOf("conversation.standardTools"));
    expect(ids).toContain("conversation.fileChange");
  });
  it("a file change without diff text keeps the plain row", () => {
    const file = entries.find((e) => e.id === "conversation.fileChange")!;
    expect(file.match(change([{ path: "a.rs" }]))).toBe(false);
    expect(file.match(change([{ path: "a.rs", kind: { type: "update" }, diff: "@@ -1 +1 @@\n-a\n+b\n" }]))).toBe(true);
    expect(file.match(codex({ type: "search", query: "x" }))).toBe(false);
  });
});

let root: Root | undefined;
let box: HTMLDivElement;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
function mount(node: ReturnType<typeof h>) { box = document.createElement("div"); document.body.append(box); root = createRoot(box); act(() => root!.render(node)); }
const toggle = () => act(() => box.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; box?.remove(); });

describe("WebToolRow", () => {
  it("one row 「打开网页 · url」; expanded: the page as a link, the prompt and the returned text", () => {
    mount(h(WebToolRow, { item: claude("WebFetch", { url: "https://example.com/a.md", prompt: "summarise" }), sessionId: "s" }));
    expect(box.querySelector('[data-tool-view="webPage"]')).not.toBeNull();
    expect(box.textContent).toContain("conversation.tools.webPage");
    expect(box.textContent).toContain("https://example.com/a.md");
    expect(box.querySelector("[data-web-tool-link]")).toBeNull();
    toggle();
    const link = box.querySelector<HTMLAnchorElement>("[data-web-tool-link]")!;
    expect(link.getAttribute("href")).toBe("https://example.com/a.md");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noreferrer");
    expect(box.textContent).toContain("summarise");
    expect(box.querySelector("pre")!.textContent).toBe("page text");
  });
  it("a non-http page is text, never a link", () => {
    mount(h(WebToolRow, { item: codex({ type: "openPage", url: "file:///C:/secret.txt" }), sessionId: "s" }));
    toggle();
    expect(box.querySelector("a")).toBeNull();
    expect(box.textContent).toContain("file:///C:/secret.txt");
  });
  it("a failed fetch keeps the core row's failure", () => {
    mount(h(WebToolRow, { item: claude("WebFetch", { url: "https://example.com" }, { status: "failed", success: false, contentItems: [{ type: "inputText", text: "HTTP 404" }] }), sessionId: "s" }));
    expect(box.textContent).toContain("taskrow.outcome.failed");
  });
});

describe("FileChangeRow", () => {
  it("collapsed: files and +/− counts as before; expanded: the unified diff viewer, one section per file", () => {
    mount(h(FileChangeRow, { item: change([
      { path: "src/a.ts", kind: { type: "update", move_path: null }, diff: "@@ -1,2 +1,2 @@\n-old\n+new\n ctx\n" },
      { path: "src/b.ts", kind: { type: "add" }, diff: "one\ntwo\n" },
    ]), sessionId: "s" }));
    expect(box.querySelector('[data-tool-view="fileChange"]')).not.toBeNull();
    expect(box.textContent).toContain("src/a.ts");
    expect(box.querySelector("[data-tool-counts]")!.textContent).toBe("+3 −1");
    expect(box.querySelector("[data-file-change-diff]")).toBeNull();
    toggle();
    const diff = box.querySelector("[data-file-change-diff]")!;
    expect(diff).not.toBeNull();
    expect(diff.textContent).toContain("old");
    expect(diff.textContent).toContain("new");
    // Each file is named in its own header (full --- / +++ headers).
    expect(diff.textContent).toContain("src/a.ts");
    expect(diff.textContent).toContain("src/b.ts");
    // Not the plain grey block any more.
    expect(box.querySelector("pre.whitespace-pre-wrap")).toBeNull();
  });
});

describe("FileChangeRow: a large change is capped on the first expand (cross-review 2026-11-13)", () => {
  const big = (files: number, lines: number) => change(Array.from({ length: files }, (_, f) => ({ path: `src/f${f}.ts`, kind: { type: "add" }, diff: Array.from({ length: lines }, (_, i) => `line ${f}-${i}`).join("\n") + "\n" })));
  it("100 files × 100 lines: only the first files (≈1,500 lines) mount, then 显示其余 N 个文件 shows the rest", () => {
    mount(h(FileChangeRow, { item: big(100, 100), sessionId: "s" }));
    toggle();
    const diff = box.querySelector("[data-file-change-diff]")!;
    expect(diff.textContent).toContain("src/f0.ts");
    expect(diff.textContent).not.toContain("src/f20.ts");
    expect(diff.querySelectorAll("*").length).toBeLessThan(15000);
    const more = box.querySelector<HTMLButtonElement>("[data-file-change-more]")!;
    expect(more).not.toBeNull();
    expect(more.textContent).toContain("conversation.tools.fileChange.more");
    act(() => more.click());
    expect(box.querySelector("[data-file-change-diff]")!.textContent).toContain("src/f99.ts");
    expect(box.querySelector("[data-file-change-more]")).toBeNull();
  });
  it("a small change shows whole, with no control", () => {
    mount(h(FileChangeRow, { item: big(3, 20), sessionId: "s" }));
    toggle();
    expect(box.querySelector("[data-file-change-diff]")!.textContent).toContain("src/f2.ts");
    expect(box.querySelector("[data-file-change-more]")).toBeNull();
  });
});
