// The side chat renders replies with the conversation's renderer (components/Markdown): the same math, code,
// tables, task lists, footnotes and links as the main timeline, on one fixture.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({
  api: { openExternal: () => Promise.resolve() },
  apiFor: () => ({}),
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSlot: () => [],
  useModuleEnabled: () => false,
  useModulePref: (_m: string, _k: string, d: unknown) => [d, () => {}],
  useModuleStatuses: () => new Map(),
}));

const { Markdown } = await import("../src/renderer/src/components/Markdown");
const { SideEntry } = await import("../src/renderer/src/modules/side-chat/SideChatBody");
const { loadKatex } = await import("../src/renderer/src/lib/katexRender");
const { SIDE_MARKDOWN_FIXTURE } = await import("../src/renderer/src/modules/side-chat/markdownFixture");

beforeAll(async () => {
  await loadKatex();
});

const formulas = (html: string) => [...html.matchAll(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/g)].map((m) => m[1]!.trim());
const agent = (text: string, streaming = false) => ({ kind: "agent" as const, id: "a", turnId: "t", text, streaming });
const side = (text: string, streaming = false) => renderToStaticMarkup(h(SideEntry, { entry: agent(text, streaming) }));

describe("side chat markdown", () => {
  let html = "";
  beforeAll(() => { html = side(SIDE_MARKDOWN_FIXTURE); });

  it("is the main timeline's renderer, byte for byte", () => {
    expect(html).toBe(`<div class="min-w-0" data-side-markdown="">${renderToStaticMarkup(h(Markdown, { text: SIDE_MARKDOWN_FIXTURE, streaming: false }))}</div>`);
  });

  it("typesets inline, display, \\( \\) and \\[ \\] math with KaTeX", () => {
    expect(formulas(html)).toEqual(["e^{i\\pi}+1=0", "\\int_0^1 x^2\\,dx = \\tfrac13", "a^2+b^2=c^2", "\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}"]);
    expect(html).toContain("katex-display");
    expect(html.replace(/data-math-source="[^"]*"/g, "")).not.toContain("$");
  });

  it("keeps code, tables, task lists, footnotes and links", () => {
    expect(html).toContain('data-language="ts"');
    expect(html).toContain("<table");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain('id="user-content-fn-1"');
    expect(html).toContain('href="https://example.com/docs"');
  });

  it("streams like the timeline: an unfinished $$ stays source, no half formula", () => {
    const partial = side("Sum: $$\\sum_{k=1}^{n", true);
    expect(formulas(partial)).toEqual([]);
    expect(partial).toContain("\\sum_{k=1}^{n");
  });

  it("reasoning uses the compact renderer too", () => {
    const reasoning = renderToStaticMarkup(h(SideEntry, { entry: { kind: "reasoning", id: "r", turnId: "t", summary: ["Check $x^2$"], content: [], streaming: false, startedAt: null, completedAt: null } }));
    expect(formulas(reasoning)).toEqual(["x^2"]);
  });
});

describe("notes card markdown", () => {
  const note = (scope: { kind: "session"; id: string } | { kind: "host" }) => ({
    id: "n1", title: "Summary", body: SIDE_MARKDOWN_FIXTURE, scope, pins: [], anchor: null, anchorState: "ok" as const, anchorStateAt: null,
    revision: 1, createdAt: "2026-11-16T00:00:00Z", updatedAt: "2026-11-16T00:00:00Z",
  });
  const card = async (scope: Parameters<typeof note>[0]) => {
    const { NoteCard } = await import("../src/renderer/src/modules/notes/NoteCard");
    const html = renderToStaticMarkup(h(NoteCard, { hostId: "local", note: note(scope), readOnly: true }));
    return html.slice(html.indexOf("data-note-body"));
  };

  it("renders a note body with the conversation renderer: math, code, table, task list, footnote", async () => {
    const html = await card({ kind: "session", id: "s1" });
    expect(formulas(html)).toHaveLength(4);
    expect(formulas(html)).toEqual(formulas(side(SIDE_MARKDOWN_FIXTURE)));
    expect(html).toContain('data-language="ts"');
    expect(html).toContain("<table");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain('id="user-content-fn-1"');
    expect(html).not.toContain("[blocked]");
  });

  it("a relative file link is a file link only when the note has a source agent", async () => {
    const fileLink = /<a role="link"[^>]*title="README.md"/;
    expect(await card({ kind: "session", id: "s1" })).toMatch(fileLink);
    const hostNote = await card({ kind: "host" });
    expect(hostNote).not.toMatch(fileLink);
    expect(hostNote).toContain('<span title="README.md">README.md</span>');
  });
});
