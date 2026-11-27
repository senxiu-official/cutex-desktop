// @vitest-environment jsdom
// Markdown alerts (`> [!NOTE]` … `[!EXPLAIN]`) render as callout cards in every message (owner 2026-11-27: no switch;
// a quote without a supported marker stays the plain quote), and 「解释这段」 on selected Markdown text (a general
// feature since 2026-11-25; test/selectAnnotate.test.tsx covers the other surfaces and 批注追问).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  menu: vi.fn((..._args: unknown[]) => {}),
  actions: vi.fn((..._args: unknown[]): unknown[] => []),
  sideOpen: vi.fn((..._args: unknown[]) => ({ status: "opened" })),
  showsHost: vi.fn((..._args: unknown[]) => true),
  openAgent: vi.fn((..._args: unknown[]) => {}),
  notice: vi.fn((..._args: unknown[]) => {}),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: { openExternal: () => Promise.resolve() }, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/modules/react", async (original) => ({ ...(await original<object>()), useSlot: () => [], useModuleEnabled: () => false, useModulePref: (_m: string, _k: string, d: unknown) => [d, () => {}], useModuleStatuses: () => new Map() }));
vi.mock("../src/renderer/src/lib/contextMenu", async (original) => ({ ...(await original<object>()), openMenuAt: (...args: unknown[]) => fx.menu(...args) }));
vi.mock("../src/renderer/src/lib/refActions", async (original) => ({ ...(await original<object>()), refActionEntries: (...args: unknown[]) => fx.actions(...args) }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { side: { open: (...args: unknown[]) => fx.sideOpen(...args) }, refs: {}, ui: { notice: (...args: unknown[]) => fx.notice(...args) } } }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideShowsHost: (...args: unknown[]) => fx.showsHost(...args), sideOpen: vi.fn() }));
vi.mock("../src/renderer/src/lib/hostLists", async (original) => ({ ...(await original<object>()), openHostAgent: (...args: unknown[]) => fx.openAgent(...args) }));

const { Markdown } = await import("../src/renderer/src/components/Markdown");
const { AgentMarkdownScope } = await import("../src/renderer/src/components/AgentMarkdownScope");
const { rehypeCallouts, calloutKind } = await import("../src/renderer/src/lib/markdownCallouts");
const { DROPPED_PREFS, getUiPrefs } = await import("../src/renderer/src/lib/prefs");
const { useApp } = await import("../src/renderer/src/store");
const { BUILTIN_REF_KINDS } = await import("../src/renderer/src/lib/refs");
const sideChat = (await import("../src/renderer/src/modules/side-chat/index")).default;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] };
const el = (tagName: string, children: Node[], properties: Record<string, unknown> = {}): Node => ({ type: "element", tagName, properties, children });
const tx = (value: string): Node => ({ type: "text", value });
const marked = (quote: Node) => { rehypeCallouts()(el("root", [quote]) as never); return quote; };
const plainText = (n: Node): string => n.type === "text" ? n.value! : (n.children ?? []).map(plainText).join("");

const EXPLAIN = "> [!EXPLAIN] Ownership: one owner per value\n> A value is dropped when its owner leaves scope.\n>\n> - one owner\n> - drop at scope end";

describe("rehypeCallouts", () => {
  it("marks a [!KIND] quote, keeps every character, and lifts the title", () => {
    const quote = marked(el("blockquote", [tx("\n"), el("p", [tx("[!EXPLAIN] Ownership\nA value is dropped.")])]));
    expect(quote.properties).toMatchObject({ dataCallout: "explain", dataCalloutTitle: "Ownership" });
    expect(plainText(quote)).toBe("\n[!EXPLAIN] Ownership\nA value is dropped.");
    const p = quote.children![1]!;
    expect(p.children![0]).toMatchObject({ tagName: "span", properties: { dataCalloutHead: "" } });
    expect(p.properties?.dataCalloutHeadOnly).toBeUndefined();
  });

  it("a title with inline markup, case-insensitive kinds, and a marker-only first paragraph", () => {
    const quote = marked(el("blockquote", [el("p", [tx("[!Tip] use "), el("strong", [tx("clone")]), tx("\nbody")])]));
    expect(quote.properties).toMatchObject({ dataCallout: "tip", dataCalloutTitle: "use clone" });
    const bare = marked(el("blockquote", [el("p", [tx("[!NOTE]")]), el("p", [tx("body")])]));
    expect(bare.properties).toMatchObject({ dataCallout: "note" });
    expect(bare.properties?.dataCalloutTitle).toBeUndefined();
    expect(bare.children![0]!.properties).toMatchObject({ dataCalloutHeadOnly: "" });
  });

  it("leaves ordinary quotes, unknown kinds and quotes in code alone", () => {
    for (const first of ["just a quote", "[!FOO] nope", "text [!NOTE] later"]) {
      const quote = marked(el("blockquote", [el("p", [tx(first)])]));
      expect(quote.properties).toEqual({});
    }
    expect(calloutKind("[!caution]")).toBe("caution");
    expect(calloutKind("[!quiz]")).toBeNull();
  });
});

describe("rendering", () => {
  it("a quote without a supported marker: streamdown's plain quote, exactly as before", () => {
    for (const text of ["> just a quote\n> two lines", "> [!FOO] unknown kind", "> [!QUIZ] not supported"]) {
      const html = renderToStaticMarkup(h(Markdown, { text }));
      expect(html).toContain('data-streamdown="blockquote"');
      expect(html).not.toContain("markdown-callout");
    }
  });

  it("a supported alert: always a card, the title in its head and the body below", () => {
    const html = renderToStaticMarkup(h(Markdown, { text: EXPLAIN }));
    expect(html).toContain("markdown-callout");
    expect(html).toContain('data-callout="explain"');
    expect(html).toContain('<span class="min-w-0">Ownership: one owner per value</span>');
    expect(html).toContain("A value is dropped when its owner leaves scope.");
    expect(html).toContain("<li");
    // An untitled [!WARNING] gets its localized default title; an ordinary quote stays plain.
    const other = renderToStaticMarkup(h(Markdown, { text: "> [!WARNING]\n> careful\n\n> plain quote" }));
    expect(other).toContain('<span class="min-w-0">markdown.callout.warning</span>');
    expect(other.match(/markdown-callout/g)).toHaveLength(1);
    expect(other).toContain('data-streamdown="blockquote"');
  });

  it("every supported kind is a card", () => {
    for (const kind of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION", "EXPLAIN"]) {
      expect(renderToStaticMarkup(h(Markdown, { text: `> [!${kind}]\n> body` }))).toContain(`data-callout="${kind.toLowerCase()}"`);
    }
  });

  it("the old 教学模式 pref saved on this device is ignored, not loaded back", () => {
    expect(DROPPED_PREFS).toContain("teachingMode");
    expect("teachingMode" in getUiPrefs()).toBe(false);
  });
});

describe("解释这段 on selected text", () => {
  let node: HTMLDivElement, root: Root;
  beforeEach(() => {
    fx.menu.mockClear(); fx.actions.mockReset(); fx.actions.mockReturnValue([{ label: "side-chat.explain", onSelect: () => {} }]);
    useApp.setState({ selectedId: "selected-agent", selectedHost: "local", hosts: null } as never);
    node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  });
  afterEach(() => { act(() => root.unmount()); node.remove(); });

  async function rightClickSelection(element: unknown) {
    await act(async () => root.render(element as never));
    const p = node.querySelector("p")!;
    const range = document.createRange(); range.selectNodeContents(p);
    const sel = document.getSelection()!; sel.removeAllRanges(); sel.addRange(range);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
    await act(async () => void p.dispatchEvent(event));
    return event;
  }

  it("the menu on selected Markdown text", async () => {
    const event = await rightClickSelection(h("div", { "data-turn-id": "turn-7" }, h(Markdown, { text: "Borrowing lets you read without owning." })));
    expect(event.defaultPrevented).toBe(true);
    expect(fx.actions.mock.calls[0]![0]).toMatchObject({ kind: "selection", params: { turnId: "turn-7" } });
    expect(fx.menu).toHaveBeenCalledOnce();
  });
  it("no module action: the native menu (nothing prevented, no renderer menu)", async () => {
    fx.actions.mockReturnValue([]);
    const event = await rightClickSelection(h("div", { "data-turn-id": "turn-7" }, h(Markdown, { text: "Borrowing lets you read without owning." })));
    expect(event.defaultPrevented).toBe(false);
    expect(fx.menu).not.toHaveBeenCalled();
  });

  it("main timeline: the conversation's agent and the turn, the module's action above Copy", async () => {
    const event = await rightClickSelection(h("div", { "data-turn-id": "turn-7" }, h(Markdown, { text: "Borrowing lets you read without owning." })));
    expect(event.defaultPrevented).toBe(true);
    const ref = fx.actions.mock.calls[0]![0] as { kind: string; hostId: string; params: Record<string, string> };
    expect(ref).toMatchObject({ kind: "selection", hostId: "local", params: { sessionId: "selected-agent", text: "Borrowing lets you read without owning.", turnId: "turn-7" } });
    const entries = fx.menu.mock.calls[0]![2] as { label?: string }[];
    expect(entries.map((e) => (typeof e === "string" ? e : e.label))).toEqual(["side-chat.explain", "separator", "Copy"]);
  });

  it("a side chat / note of another agent: that agent, no turn", async () => {
    await rightClickSelection(h(AgentMarkdownScope, { paneId: "note:x", hostId: "remote", sessionId: "source-agent", children: h(Markdown, { text: "Lifetimes name how long a borrow lives." }) }));
    const ref = fx.actions.mock.calls[0]![0] as { hostId: string; params: Record<string, string> };
    expect(ref.hostId).toBe("remote");
    expect(ref.params).toEqual({ sessionId: "source-agent", text: "Lifetimes name how long a borrow lives." });
  });

  it("no module action (side chat off): the native menu", async () => {
    fx.actions.mockReturnValue([]);
    const event = await rightClickSelection(h(Markdown, { text: "Nothing to offer." }));
    expect(event.defaultPrevented).toBe(false);
    expect(fx.menu).not.toHaveBeenCalled();
  });
});

describe("the side chat's 解释这段 action", () => {
  const action = sideChat.contributes!["ref.action"]!.find((a) => a.id === "side-chat.explain")!;
  beforeEach(() => { fx.sideOpen.mockClear(); fx.openAgent.mockClear(); fx.showsHost.mockReturnValue(true); });

  it("is a `selection` action; `selection` is a built-in kind no module can claim", () => {
    expect(action.kinds).toEqual(["selection"]);
    expect(BUILTIN_REF_KINDS).toContain("selection");
  });

  it("opens a side chat on that agent with the quoted selection as its first message, forking at the turn", async () => {
    await action.run({ hostId: "local", kind: "selection", key: "a:1", title: "x", params: { sessionId: "a", text: "line one\nline two", turnId: "t9" } });
    const [component, params, options] = fx.sideOpen.mock.calls[0]! as [string, { text: string; turnId?: string }, unknown];
    expect(component).toBe("side-chat.chat");
    expect(params.turnId).toBe("t9");
    expect(params.text).toContain("> line one\n> line two");
    expect(options).toEqual({ focus: true, binding: { kind: "agent", hostId: "local", sessionId: "a" } });
  });

  it("another host's agent (not in the side column): that agent is opened first, then the side chat asks", async () => {
    fx.showsHost.mockReturnValueOnce(false).mockReturnValue(true);
    await action.run({ hostId: "remote", kind: "selection", key: "a:1", title: "x", params: { sessionId: "a", text: "x", turnId: "t2" } });
    expect(fx.openAgent).toHaveBeenCalledWith("remote", "a");
    expect(fx.sideOpen).toHaveBeenCalledWith("side-chat.chat", expect.objectContaining({ turnId: "t2" }), { focus: true, binding: { kind: "agent", hostId: "remote", sessionId: "a" } });
  });

  it("its host still not shown after opening: a notice says why, nothing opens", async () => {
    fx.showsHost.mockReturnValue(false);
    fx.notice.mockClear();
    await action.run({ hostId: "remote", kind: "selection", key: "a:1", title: "x", params: { sessionId: "a", text: "x" } });
    expect(fx.sideOpen).not.toHaveBeenCalled();
    expect(fx.notice).toHaveBeenCalledWith(expect.any(String), "error");
  });
});

describe("which actions reach a `selection` ref", async () => {
  const { refActionApplies } = await import("../src/renderer/src/lib/refActionApplies");
  const entry = (kinds?: string[]) => ({ mode: "show", item: { id: "x", titleKey: "x", icon: () => null, run: () => {}, ...(kinds ? { kinds } : {}) } }) as never;
  it("only items that list it: a kind-less item (a bookmark, a pin) never acts on transient text", () => {
    expect(refActionApplies(entry(), "selection")).toBe(false);
    expect(refActionApplies(entry(), "turn")).toBe(true);
    expect(refActionApplies(entry(["selection"]), "selection")).toBe(true);
  });
});

// Cross-review of 0cdbab605 (status-review-fixture, markdown-review-fixture): two regressions.
describe("review fixes", () => {
  it("T2: inline markup across the title line break keeps the whole body visible and the title short", () => {
    const body = "Body content must remain available. ".repeat(16).trim();
    const text = `> [!NOTE] *Title\n> ${body}*`;
    const dom = document.createElement("div");
    dom.innerHTML = renderToStaticMarkup(h(Markdown, { text }));
    expect(dom.querySelector("[data-callout-title]")?.textContent).toBe("Title");
    // What the card hides (the marker line) holds no body text; the body keeps its emphasis.
    expect(dom.querySelector("[data-callout-head]")?.textContent).toBe("[!NOTE] Title");
    for (const head of dom.querySelectorAll("[data-callout-head]")) head.remove();
    expect(dom.textContent).toContain(body);
    expect([...dom.querySelectorAll("em")].some((em) => em.textContent?.includes(body))).toBe(true);
  });

  describe("T1: a reply below the turn's first row keeps its turn", () => {
    let node: HTMLDivElement, root: Root;
    beforeEach(() => {
      fx.actions.mockReset(); fx.actions.mockReturnValue([{ label: "side-chat.explain", onSelect() {} }]); fx.menu.mockClear();
        useApp.setState({ selectedId: "selected-agent", selectedHost: "local", hosts: null } as never);
      node = document.createElement("div"); document.body.append(node); root = createRoot(node);
    });
    afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

    it("in the real TimelineBody (user message first, then the reply)", async () => {
      const { TimelineBody } = await import("../src/renderer/src/components/Timeline");
      const { timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
      const timeline = timelineFromThreadRead({ thread: { id: "thread", turns: [{ id: "historical-turn", status: "completed", items: [
        { id: "u", type: "userMessage", content: [{ type: "text", text: "User question" }] },
        { id: "a", type: "agentMessage", text: "Historical explanation to select." },
      ] }] } } as never);
      await act(async () => root.render(h(TimelineBody, { timeline, version: 1, sessionId: "selected-agent", nameOf: (id: string) => id, readOnly: true })));
      const p = [...node.querySelectorAll("p")].find((x) => x.textContent?.includes("Historical explanation"))!;
      expect(p).toBeTruthy();
      expect(p.closest("[data-turn-id]")).toBeNull(); // the anchor is on the user message's row only
      const range = document.createRange(); range.selectNodeContents(p);
      const sel = document.getSelection()!; sel.removeAllRanges(); sel.addRange(range);
      await act(async () => void p.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
      expect(fx.actions.mock.calls.at(-1)![0]).toMatchObject({ kind: "selection", params: { sessionId: "selected-agent", turnId: "historical-turn" } });
    }, 60_000); // importing the real Timeline takes seconds
  });
});
