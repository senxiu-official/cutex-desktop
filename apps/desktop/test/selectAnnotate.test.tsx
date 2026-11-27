// @vitest-environment jsdom
// 批注追问 (harness survey Z4, owner 2026-11-25): a passage selected in an agent's text goes to the side chat as a quote
// above the composer, with a link back to its turn; the owner adds a note and both go as one message. Select-to-ask is
// general (owner 11-25): the menu is on Markdown and on any text wrapped in components/SelectionActions
// (user bubbles, tool output, side-chat bubbles).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SideChat } from "../src/shared/sideChat";

const fx = vi.hoisted(() => ({
  menu: vi.fn((..._args: unknown[]) => {}),
  actions: vi.fn((..._args: unknown[]): unknown[] => []),
  sideOpen: vi.fn((..._args: unknown[]) => ({ status: "opened" })),
  refsOpen: vi.fn(async (..._args: unknown[]): Promise<{ status: string; reason?: string }> => ({ status: "opened" })),
  notice: vi.fn((..._args: unknown[]) => {}),
  showsHost: vi.fn((..._args: unknown[]) => true),
  openAgent: vi.fn((..._args: unknown[]) => {}),
  api: { sideOpen: vi.fn(), sideRead: vi.fn(), sideSend: vi.fn(), sideInterrupt: vi.fn(), sideRespond: vi.fn(), sideClose: vi.fn(), notesCreate: vi.fn(), history: vi.fn() },
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: { openExternal: () => Promise.resolve() }, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "en" }) }));
vi.mock("../src/renderer/src/modules/react", async (original) => ({ ...(await original<object>()), useSlot: () => [], useModuleEnabled: () => false, useModulePref: (_m: string, _k: string, d: unknown) => [d, () => {}], useModuleStatuses: () => new Map() }));
vi.mock("../src/renderer/src/lib/contextMenu", async (original) => ({ ...(await original<object>()), openMenuAt: (...args: unknown[]) => fx.menu(...args) }));
vi.mock("../src/renderer/src/lib/refActions", async (original) => ({ ...(await original<object>()), refActionEntries: (...args: unknown[]) => fx.actions(...args) }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: {
  side: { open: (...args: unknown[]) => fx.sideOpen(...args) },
  refs: { open: (...args: unknown[]) => fx.refsOpen(...args) },
  ui: { notice: (...args: unknown[]) => fx.notice(...args) },
  daemonFor: () => fx.api,
} }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideShowsHost: (...args: unknown[]) => fx.showsHost(...args), sideOpen: vi.fn() }));
vi.mock("../src/renderer/src/lib/hostLists", async (original) => ({ ...(await original<object>()), openHostAgent: (...args: unknown[]) => fx.openAgent(...args) }));

const { Markdown } = await import("../src/renderer/src/components/Markdown");
const { AgentMarkdownScope } = await import("../src/renderer/src/components/AgentMarkdownScope");
const { SelectionActions } = await import("../src/renderer/src/components/SelectionActions");
const { useApp } = await import("../src/renderer/src/store");
const { BUILTIN_REF_KINDS } = await import("../src/renderer/src/lib/refs");
const { refActionApplies } = await import("../src/renderer/src/lib/refActionApplies");
const sideChat = (await import("../src/renderer/src/modules/side-chat/index")).default;
const { initSide, parseSideParams, takeSideQuote } = await import("../src/renderer/src/modules/side-chat/cardState");
const { quoteLines, quotedMessage, splitQuoted } = await import("../src/renderer/src/modules/side-chat/model");
const { sendSide, setSideDraft, setSideQuote, sideKey, sideModuleActive, useSides } = await import("../src/renderer/src/modules/side-chat/state");
const { SideChatBody, SideEntry } = await import("../src/renderer/src/modules/side-chat/SideChatBody");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const annotate = sideChat.contributes!["ref.action"]!.find((a) => a.id === "side-chat.annotate")!;

describe("the quoted message", () => {
  it("quote lines, then a blank line and the note; a quote alone; no quote = the note as typed", () => {
    expect(quoteLines("line one\n\nline two")).toBe("> line one\n>\n> line two");
    expect(quotedMessage({ text: "a\nb", turnId: "t1" }, "my note")).toBe("> a\n> b\n\nmy note");
    expect(quotedMessage({ text: "a", turnId: null }, "  ")).toBe("> a");
    expect(quotedMessage(null, "plain")).toBe("plain");
  });
  it("a sent message splits back into its quote and note for the bubble; other messages are left alone", () => {
    expect(splitQuoted("> a\n>\n> b\n\nmy note\nsecond")).toEqual({ quote: "a\n\nb", note: "my note\nsecond" });
    expect(splitQuoted("> only")).toEqual({ quote: "only", note: "" });
    expect(splitQuoted("请解释下面这段：\n\n> x")).toBeNull();
    expect(splitQuoted(">not a quote line")).toBeNull();
  });
});

describe("the selection menu", () => {
  let node: HTMLDivElement, root: Root;
  beforeEach(() => {
    fx.menu.mockClear(); fx.actions.mockReset();
    fx.actions.mockImplementation((ref) => ((ref as { kind: string }).kind === "selection" ? [{ label: "side-chat.explain", onSelect: () => {} }, { label: "side-chat.annotate", onSelect: () => {} }] : []));
    useApp.setState({ selectedId: "agent-1", selectedHost: "local", hosts: null } as never);
    node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  });
  afterEach(() => { act(() => root.unmount()); node.remove(); });

  async function rightClickSelection(element: unknown = h("div", { "data-turn-id": "turn-7" }, h(Markdown, { text: "Ownership moves on assignment." })), selector = "p") {
    await act(async () => root.render(element as never));
    const p = node.querySelector<HTMLElement>(selector)!;
    const range = document.createRange(); range.selectNodeContents(p);
    const sel = document.getSelection()!; sel.removeAllRanges(); sel.addRange(range);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
    await act(async () => void p.dispatchEvent(event));
    return event;
  }
  const labels = () => (fx.menu.mock.calls.at(-1)![2] as (string | { label?: string })[]).map((e) => (typeof e === "string" ? e : e.label));

  it("Markdown: the actions + Copy, from a `selection` ref of the agent, text and turn", async () => {
    fx.menu.mockClear(); fx.actions.mockClear();
    const event = await rightClickSelection();
    expect(event.defaultPrevented).toBe(true);
    expect(labels()).toEqual(["side-chat.explain", "side-chat.annotate", "separator", "Copy"]);
    expect(fx.actions.mock.calls.map((c) => c[0])).toEqual([expect.objectContaining({ kind: "selection", hostId: "local", params: { sessionId: "agent-1", text: "Ownership moves on assignment.", turnId: "turn-7" } })]);
  });
  it("SelectionActions (a user bubble, tool output): the same menu; the row's turn when given; its own menu otherwise", async () => {
    const own = vi.fn();
    const event = await rightClickSelection(h("div", { "data-turn-id": "turn-1", onContextMenu: own }, h(SelectionActions, { as: "pre", turnId: "turn-9", children: "cargo test\n3 passed" })), "pre");
    expect(event.defaultPrevented).toBe(true);
    expect(fx.actions.mock.calls[0]![0]).toMatchObject({ kind: "selection", params: { sessionId: "agent-1", text: "cargo test\n3 passed", turnId: "turn-9" } });
    expect(own).not.toHaveBeenCalled(); // the selection menu stops the row's message menu
    // Without a selection the row's own menu opens.
    document.getSelection()!.removeAllRanges();
    fx.menu.mockClear();
    await act(async () => void node.querySelector("pre")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(fx.menu).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledOnce();
  });
  it("SelectionActions without a turn of its own: the nearest timeline row's", async () => {
    await rightClickSelection(h("div", { "data-turn-id": "turn-3" }, h(SelectionActions, { as: "span", children: "my question" })), "span");
    expect(fx.actions.mock.calls[0]![0]).toMatchObject({ params: { text: "my question", turnId: "turn-3" } });
  });
  it("text of a scoped agent (a side chat, a note): that agent, no turn", async () => {
    await rightClickSelection(h(AgentMarkdownScope, { paneId: "side", hostId: "local", sessionId: "other-agent", children: h(SelectionActions, { children: "side text" }) }), "[data-selection-actions]");
    expect(fx.actions.mock.calls[0]![0]).toMatchObject({ params: { sessionId: "other-agent", text: "side text" } });
    expect((fx.actions.mock.calls[0]![0] as { params: Record<string, string> }).params.turnId).toBeUndefined();
  });
  it("no module action: the native menu", async () => {
    fx.actions.mockReturnValue([]);
    const event = await rightClickSelection();
    expect(event.defaultPrevented).toBe(false);
    expect(fx.menu).not.toHaveBeenCalled();
  });
});

describe("批注追问 (side-chat.annotate)", () => {
  beforeEach(() => { fx.sideOpen.mockClear(); fx.openAgent.mockClear(); fx.showsHost.mockReturnValue(true); });

  it("a `selection` action (the built-in, explicit-only kind 解释这段 uses too)", () => {
    expect(annotate.kinds).toEqual(["selection"]);
    expect(BUILTIN_REF_KINDS).toContain("selection");
    const entry = (kinds?: string[]) => ({ mode: "show", item: { kinds } }) as never;
    expect(refActionApplies(entry(), "selection")).toBe(false);
    expect(refActionApplies(entry(["selection"]), "selection")).toBe(true);
  });
  it("opens the agent's side chat with the passage as a quote (nothing sent), forking at its turn", async () => {
    await annotate.run({ hostId: "local", kind: "selection", key: "a:1", title: "x", params: { sessionId: "a", text: "line one\nline two", turnId: "t9" } });
    expect(fx.sideOpen).toHaveBeenCalledWith("side-chat.chat", { quote: "line one\nline two", turnId: "t9" }, { focus: true, binding: { kind: "agent", hostId: "local", sessionId: "a" } });
    const params = fx.sideOpen.mock.calls[0]![1] as Record<string, unknown>;
    expect(params.text).toBeUndefined();
  });
  it("a selection without a main-timeline turn (side chat / note text) still quotes, without a source", async () => {
    await annotate.run({ hostId: "local", kind: "selection", key: "a:1", title: "x", params: { sessionId: "a", text: "x" } });
    expect(fx.sideOpen).toHaveBeenCalledWith("side-chat.chat", { quote: "x" }, expect.anything());
  });
  it("another host's agent: that agent is opened first, then the quote and its turn go to its side chat (review P2-3)", async () => {
    fx.showsHost.mockReturnValueOnce(false).mockReturnValue(true);
    await annotate.run({ hostId: "remote", kind: "selection", key: "a:1", title: "x", params: { sessionId: "a", text: "x", turnId: "t9" } });
    expect(fx.openAgent).toHaveBeenCalledWith("remote", "a");
    expect(fx.sideOpen).toHaveBeenCalledWith("side-chat.chat", { quote: "x", turnId: "t9" }, { focus: true, binding: { kind: "agent", hostId: "remote", sessionId: "a" } });
  });
  it("its host can't be shown: a notice with the reason, no invisible card; empty text does nothing", async () => {
    fx.showsHost.mockReturnValue(false);
    fx.notice.mockClear();
    await annotate.run({ hostId: "remote", kind: "selection", key: "a:1", title: "x", params: { sessionId: "a", text: "x" } });
    expect(fx.sideOpen).not.toHaveBeenCalled();
    expect(fx.notice).toHaveBeenCalledWith(expect.stringMatching(/side chat|侧边对话/), "error");
    fx.showsHost.mockReturnValue(true);
    await annotate.run({ hostId: "local", kind: "selection", key: "a:1", title: "x", params: { sessionId: "a", text: "  " } });
    expect(fx.sideOpen).not.toHaveBeenCalled();
  });
  it("card params: the quote is validated like the text and handed over once, with its turn as the source", () => {
    expect(parseSideParams({ quote: "q", turnId: "t1" })).toEqual({ quote: "q", turnId: "t1" });
    expect(parseSideParams({ quote: 3 })).toBeNull();
    const state = initSide({ quote: "private passage", turnId: "t1" }, null);
    expect(JSON.stringify(state)).not.toContain("private passage");
    expect(takeSideQuote(state.start)).toEqual({ text: "private passage", turnId: "t1" });
    expect(takeSideQuote(state.start)).toBeNull();
    expect(takeSideQuote(initSide({ quote: "no turn" }, null).start)).toEqual({ text: "no turn", turnId: null });
  });
});

function chat(over: Partial<SideChat> = {}): SideChat {
  return {
    id: "side-1", sessionId: "agent-1", threadId: "side-thread", anchorTurnId: "turn-7", lastTurnId: null, forkedThroughTurnId: null, runtimeGeneration: 1,
    status: "ready", createdAt: "2026-11-25T00:00:00Z", updatedAt: "2026-11-25T00:00:01Z", activeTurnId: null, revision: 1, events: [], pendingRequests: [], truncated: false, model: "gpt-test", effort: "high", ...over,
  };
}
const key = sideKey("local", "side-1");
const view = () => useSides.getState().views[key]!;
function seed(over: Record<string, unknown> = {}) {
  useSides.setState({ views: { [key]: { chat: chat(), draft: "", sending: false, error: null, summary: null, pendingMessage: null, unread: false, ...over } as never } });
}

describe("sending a quote with the note", () => {
  beforeEach(() => {
    sideModuleActive(true);
    for (const fn of Object.values(fx.api)) fn.mockReset();
    fx.api.sideRead.mockImplementation(() => new Promise(() => {}));
    seed();
  });
  afterEach(() => sideModuleActive(false));

  it("one message: the quote, a blank line, the note; both cleared after the host takes it", async () => {
    setSideQuote("local", "side-1", { text: "a passage", turnId: "turn-7" });
    setSideDraft("local", "side-1", "why here?");
    fx.api.sideSend.mockResolvedValue({ chat: chat({ revision: 2 }) });
    await sendSide("local", "side-1");
    expect(fx.api.sideSend).toHaveBeenCalledWith("agent-1", "side-1", { text: "> a passage\n\nwhy here?", clientMessageId: expect.any(String) });
    expect(view()).toMatchObject({ draft: "", quote: null, pendingMessage: null });
  });
  it("the quote alone can be sent; without quote or note nothing goes", async () => {
    await sendSide("local", "side-1");
    expect(fx.api.sideSend).not.toHaveBeenCalled();
    setSideQuote("local", "side-1", { text: "just this", turnId: null });
    fx.api.sideSend.mockResolvedValue({ chat: chat({ revision: 2 }) });
    await sendSide("local", "side-1");
    expect(fx.api.sideSend.mock.calls[0]![2]).toMatchObject({ text: "> just this" });
  });
  it("a failed send keeps the quote and note; while a message is pending the quote cannot change; the retry sends the same text", async () => {
    setSideQuote("local", "side-1", { text: "p", turnId: "turn-7" });
    setSideDraft("local", "side-1", "n");
    fx.api.sideSend.mockRejectedValueOnce(new Error("network down"));
    await sendSide("local", "side-1");
    expect(view()).toMatchObject({ draft: "n", quote: { text: "p", turnId: "turn-7" }, pendingMessage: { text: "> p\n\nn" } });
    setSideQuote("local", "side-1", null);
    expect(view().quote).toEqual({ text: "p", turnId: "turn-7" });
    fx.api.sideSend.mockResolvedValue({ chat: chat({ revision: 2 }) });
    await sendSide("local", "side-1");
    expect(fx.api.sideSend.mock.calls.map((c) => (c[2] as { text: string; clientMessageId: string }).text)).toEqual(["> p\n\nn", "> p\n\nn"]);
    expect(fx.api.sideSend.mock.calls[1]![2]).toEqual(fx.api.sideSend.mock.calls[0]![2]);
    expect(view()).toMatchObject({ draft: "", quote: null });
  });
  it("a new quote replaces the previous one", () => {
    setSideQuote("local", "side-1", { text: "first", turnId: "t1" });
    setSideQuote("local", "side-1", { text: "second", turnId: "t2" });
    expect(view().quote).toEqual({ text: "second", turnId: "t2" });
  });
});

describe("the side chat card", () => {
  let node: HTMLDivElement, root: Root;
  beforeEach(() => {
    sideModuleActive(true);
    fx.api.sideRead.mockImplementation(() => new Promise(() => {}));
    fx.refsOpen.mockReset(); fx.refsOpen.mockResolvedValue({ status: "opened" }); fx.notice.mockClear();
    seed({ quote: { text: "Ownership moves on assignment.", turnId: "turn-7" } });
    node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  });
  afterEach(() => { act(() => root.unmount()); node.remove(); sideModuleActive(false); });
  const render = () => act(() => root.render(h(SideChatBody, { hostId: "local", sessionId: "agent-1", chatId: "side-1", visible: true, revealed: 0 })));

  it("shows the quote above the composer with 回到原文 to its turn, a note placeholder, and send enabled", async () => {
    render();
    const chip = node.querySelector<HTMLElement>("[data-side-quote]")!;
    expect(chip.textContent).toContain("Ownership moves on assignment.");
    // turn-7 is not in a loaded main timeline: the plain label, the turn id only in the tooltip (never as text).
    expect(chip.textContent).toContain("side-chat.quoteLabel");
    expect(chip.textContent).not.toContain("turn-7");
    expect(node.querySelector("textarea")!.placeholder).toBe("side-chat.annotatePlaceholder");
    expect(node.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled).toBe(false);
    await act(async () => chip.querySelector<HTMLButtonElement>("[data-side-quote-jump]")!.click());
    expect(fx.refsOpen).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn", hostId: "local", params: expect.objectContaining({ sessionId: "agent-1", turnId: "turn-7" }) }), { how: "jump" });
    expect(fx.notice).not.toHaveBeenCalled();
  });
  it("a turn that can no longer be opened says so", async () => {
    fx.refsOpen.mockResolvedValue({ status: "unavailable", reason: "reverted" });
    render();
    await act(async () => node.querySelector<HTMLButtonElement>("[data-side-quote-jump]")!.click());
    expect(fx.notice).toHaveBeenCalledWith("side-chat.jumpFailed", "error");
  });
  it("remove takes the quote off (back to the plain placeholder); a quote without a turn has no jump", () => {
    render();
    act(() => node.querySelector<HTMLButtonElement>("[aria-label='side-chat.quoteRemove']")!.click());
    expect(node.querySelector("[data-side-quote]")).toBeNull();
    expect(node.querySelector("textarea")!.placeholder).toBe("side-chat.placeholder");
    act(() => setSideQuote("local", "side-1", { text: "from a note", turnId: null }));
    expect(node.querySelector("[data-side-quote]")!.textContent).toContain("side-chat.quoteLabel");
    expect(node.querySelector("[data-side-quote-jump]")).toBeNull();
  });
  it("the side chat's start turn (from the host) is a link back too", async () => {
    render();
    const source = node.querySelector<HTMLElement>("[data-side-source]")!;
    expect(source.textContent).toContain("side-chat.quoteJump");
    await act(async () => source.querySelector("button")!.click());
    expect(fx.refsOpen).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn", params: expect.objectContaining({ turnId: "turn-7" }) }), { how: "jump" });
  });
  it("a sent quoted message shows the quote as a quote and the note below", () => {
    act(() => root.render(h(SideEntry, { entry: { kind: "user", id: "u", turnId: "s1", text: "> a passage\n\nmy note" } as never })));
    expect(node.querySelector("[data-side-sent-quote]")!.textContent).toBe("a passage");
    expect(node.textContent).toBe("a passagemy note");
  });
});
