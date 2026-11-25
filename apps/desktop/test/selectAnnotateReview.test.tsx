// @vitest-environment jsdom
// Select-to-annotate review fixes (audit 2026-11-25 on feat/select-annotate): delegation text is attributed to its own
// agent and turn (not the conversation beside it; ambiguous = only 复制), 「从 … 重开」 carries the quote and the note
// into the new side chat, a request arriving while a message is pending waits instead of being dropped (and the
// retry clears only what it carried), and the keyboard (Shift+F10 / ContextMenu key) opens the selection menu.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SideChat } from "../src/shared/sideChat";
import type { AskSummary } from "../src/shared/ipc";

const fx = vi.hoisted(() => ({
  menu: vi.fn((..._args: unknown[]) => {}),
  actions: vi.fn((..._args: unknown[]): unknown[] => []),
  sideOpen: vi.fn((..._args: unknown[]) => ({ status: "opened" })),
  notice: vi.fn((..._args: unknown[]) => {}),
  api: { sideOpen: vi.fn(), sideRead: vi.fn(), sideSend: vi.fn(), sideInterrupt: vi.fn(), sideRespond: vi.fn(), sideClose: vi.fn(), notesCreate: vi.fn(), history: vi.fn() },
}));
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "en" }) }));
vi.mock("../src/renderer/src/modules/react", async (original) => ({ ...(await original<object>()), useSlot: () => [], useModuleEnabled: () => false, useModulePref: (_m: string, _k: string, d: unknown) => [d, () => {}], useModuleStatuses: () => new Map() }));
vi.mock("../src/renderer/src/lib/contextMenu", async (original) => ({ ...(await original<object>()), openMenuAt: (...args: unknown[]) => fx.menu(...args) }));
vi.mock("../src/renderer/src/lib/refActions", async (original) => ({ ...(await original<object>()), refActionEntries: (...args: unknown[]) => fx.actions(...args) }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: {
  side: { open: (...args: unknown[]) => fx.sideOpen(...args) },
  refs: { open: vi.fn() },
  ui: { notice: (...args: unknown[]) => fx.notice(...args) },
  daemonFor: () => fx.api,
} }));
vi.mock("../src/renderer/src/lib/hostGatingView", () => ({ useModuleHostGate: () => ({ ok: true, waiting: false }) }));
vi.mock("../src/renderer/src/lib/delegationStore", async (original) => ({ ...(await original<object>()), loadDelegationDetail: async () => {}, loadCardDelegation: async () => {} }));

const { Markdown } = await import("../src/renderer/src/components/Markdown");
const { SelectionActions, SelectionSourceScope } = await import("../src/renderer/src/components/SelectionActions");
const { DelegationDetailBody } = await import("../src/renderer/src/components/DelegationCard");
const { useApp } = await import("../src/renderer/src/store");
const { initSide, reopenParams, sideStart, takeSideDraft, takeSideQuote } = await import("../src/renderer/src/modules/side-chat/cardState");
const { sendSide, sideKey, sideModuleActive, useSides } = await import("../src/renderer/src/modules/side-chat/state");
const { SideChatCard } = await import("../src/renderer/src/modules/side-chat/SideChatCard");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let node: HTMLDivElement, root: Root;
const mount = () => { node = document.createElement("div"); document.body.append(node); root = createRoot(node); };
const unmount = () => { act(() => root.unmount()); node.remove(); };
const selectIn = (el: Element) => { const range = document.createRange(); range.selectNodeContents(el); const sel = document.getSelection()!; sel.removeAllRanges(); sel.addRange(range); };
async function rightClick(el: HTMLElement) {
  selectIn(el);
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
  await act(async () => void el.dispatchEvent(event));
  return event;
}
const labels = () => (fx.menu.mock.calls.at(-1)![2] as (string | { label?: string })[]).map((e) => (typeof e === "string" ? e : e.label));
const withActions = () => fx.actions.mockImplementation((ref) => ((ref as { kind: string }).kind === "selection" ? [{ label: "side-chat.explain", onSelect: () => {} }] : []));

describe("delegation text is attributed to its own agent (P1)", () => {
  beforeEach(() => {
    fx.menu.mockClear(); fx.actions.mockReset(); withActions();
    // The conversation beside it is another host's other agent: never the source.
    useApp.setState({ selectedId: "agent-1", selectedHost: "local", hosts: null } as never);
    mount();
  });
  afterEach(unmount);
  const ask = (over: Partial<AskSummary> = {}) => ({ askId: "ask-1", title: "t", requester: { kind: "agent", cutexSessionId: "req-1" }, target: "tgt-1", execution: "answered", revision: -1, answerPreview: "The answer preview line.", attempt: { turnId: "tgt-turn-3" }, ...over }) as unknown as AskSummary;
  const render = (d: AskSummary) => act(async () => root.render(h(DelegationDetailBody, { d, brief: "The brief paragraph.", here: null, host: "host-b" })));

  it("the brief is the requesting agent's, the result the target's at the turn it ran in, on the record's host", async () => {
    await render(ask());
    const brief = [...node.querySelectorAll("p")].find((p) => p.textContent === "The brief paragraph.")!;
    await rightClick(brief);
    expect(fx.actions.mock.calls.at(-1)![0]).toMatchObject({ kind: "selection", hostId: "host-b", params: { sessionId: "req-1", text: "The brief paragraph." } });
    expect((fx.actions.mock.calls.at(-1)![0] as { params: Record<string, string> }).params.turnId).toBeUndefined();
    await rightClick(node.querySelector<HTMLElement>("[data-delegation-result]")!);
    expect(fx.actions.mock.calls.at(-1)![0]).toMatchObject({ hostId: "host-b", params: { sessionId: "tgt-1", turnId: "tgt-turn-3", text: "The answer preview line." } });
  });

  it("ambiguous (the owner's brief, a result mirrored from another host): only 复制", async () => {
    await render(ask({ requester: { kind: "owner" }, remote: { peerId: "p" } as never }));
    const brief = [...node.querySelectorAll("p")].find((p) => p.textContent === "The brief paragraph.")!;
    const event = await rightClick(brief);
    expect(event.defaultPrevented).toBe(true);
    expect(labels()).toEqual(["Copy"]);
    await rightClick(node.querySelector<HTMLElement>("[data-delegation-result]")!);
    expect(labels()).toEqual(["Copy"]);
    expect(fx.actions).not.toHaveBeenCalled();
  });
});

describe("keyboard opening (P2-4)", () => {
  beforeEach(() => {
    fx.menu.mockClear(); fx.actions.mockReset(); withActions();
    useApp.setState({ selectedId: "agent-1", selectedHost: "local", hosts: null } as never);
    mount();
  });
  afterEach(unmount);
  const key = (init: KeyboardEventInit) => { const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }); document.body.dispatchEvent(e); return e; };

  it("Shift+F10 and the ContextMenu key open the selection menu for the selected text; the follow-up contextmenu is swallowed", async () => {
    await act(async () => root.render(h("div", { "data-turn-id": "turn-7" }, h(Markdown, { text: "Ownership moves on assignment." }))));
    selectIn(node.querySelector("p")!);
    const shift = key({ key: "F10", shiftKey: true });
    expect(shift.defaultPrevented).toBe(true);
    expect(labels()).toEqual(["side-chat.explain", "separator", "Copy"]);
    expect(fx.actions.mock.calls.at(-1)![0]).toMatchObject({ params: { sessionId: "agent-1", turnId: "turn-7", text: "Ownership moves on assignment." } });
    const native = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(native);
    expect(native.defaultPrevented).toBe(true);
    fx.menu.mockClear();
    expect(key({ key: "ContextMenu" }).defaultPrevented).toBe(true);
    expect(fx.menu).toHaveBeenCalledOnce();
  });

  it("wrapped text and copy-only scopes too; nothing without a selection or outside a block, or for plain F10", async () => {
    await act(async () => root.render(h("div", null,
      h(SelectionActions, { as: "pre", turnId: "turn-2", children: "tool output" }),
      h(SelectionSourceScope, { source: "copy", children: h(SelectionActions, { as: "span", children: "ambiguous" }) }),
      h("p", { id: "plain" }, "not agent text"))));
    selectIn(node.querySelector("pre")!);
    key({ key: "F10", shiftKey: true });
    expect(fx.actions.mock.calls.at(-1)![0]).toMatchObject({ params: { text: "tool output", turnId: "turn-2" } });
    selectIn(node.querySelector("span")!);
    key({ key: "ContextMenu" });
    expect(labels()).toEqual(["Copy"]);
    fx.menu.mockClear();
    expect(key({ key: "F10" }).defaultPrevented).toBe(false);
    selectIn(node.querySelector("#plain")!);
    expect(key({ key: "ContextMenu" }).defaultPrevented).toBe(false);
    document.getSelection()!.removeAllRanges();
    expect(key({ key: "F10", shiftKey: true }).defaultPrevented).toBe(false);
    expect(fx.menu).not.toHaveBeenCalled();
  });
});

function chat(over: Partial<SideChat> = {}): SideChat {
  return {
    id: "side-1", sessionId: "agent-1", threadId: "side-thread", anchorTurnId: "turn-7", lastTurnId: null, forkedThroughTurnId: null, runtimeGeneration: 1,
    status: "ready", createdAt: "2026-11-25T00:00:00Z", updatedAt: "2026-11-25T00:00:01Z", activeTurnId: null, revision: 1, events: [], pendingRequests: [], truncated: false, model: "gpt-test", effort: "high", ...over,
  };
}
const skey = sideKey("local", "side-1");
const view = () => useSides.getState().views[skey]!;
function seed(over: Record<string, unknown> = {}) {
  useSides.setState({ views: { [skey]: { chat: chat(), draft: "", sending: false, error: null, summary: null, pendingMessage: null, unread: false, ...over } as never } });
}
function renderCard(state: Record<string, unknown>, setState = vi.fn()) {
  const props = { instance: { id: "inst-1", kind: "side-chat.chat", state, binding: { kind: "agent", hostId: "local", sessionId: "agent-1" } }, hostId: "local", sessionId: "agent-1", setState, visible: true, active: true, mode: "normal", where: "card", revealed: 0, close: () => {}, open: () => {} };
  return act(async () => root.render(h(SideChatCard, props as never)));
}

describe("「从 … 重开」 carries the quote and the note (P2-1)", () => {
  beforeEach(() => {
    sideModuleActive(true);
    for (const fn of Object.values(fx.api)) fn.mockReset();
    fx.api.sideRead.mockImplementation(() => new Promise(() => {}));
    fx.api.sideClose.mockResolvedValue({ closed: true });
    mount();
  });
  afterEach(() => { unmount(); sideModuleActive(false); });

  it("a quote from a later turn lands in the open side chat; reopening there starts a new one with the quote and the typed note", async () => {
    seed({ draft: "my note" });
    const request = initSide({ quote: "later passage", turnId: "turn-9" }, { chatId: "side-1" });
    const setState = vi.fn();
    await renderCard(request, setState);
    expect(view().quote).toEqual({ text: "later passage", turnId: "turn-9" });
    // The offer to reopen at turn-9 (two clicks: armed, then confirm).
    const offer = () => [...node.querySelectorAll("button")].find((b) => /side-chat\.reopen/.test(b.textContent ?? ""))!;
    await act(async () => offer().click());
    await act(async () => offer().click());
    expect(fx.api.sideClose).toHaveBeenCalledWith("agent-1", "side-1");
    const next = setState.mock.calls.at(-1)![0] as { start: string };
    expect(sideStart(next.start)).toMatchObject({ turnId: "turn-9", quote: "later passage", quoteTurnId: "turn-9", draft: "my note" });
    expect(sideStart(next.start).text).toBeUndefined();
    // Handed over once: the new side chat's composer gets them, nothing is sent by itself.
    expect(takeSideQuote(next.start)).toEqual({ text: "later passage", turnId: "turn-9" });
    expect(takeSideDraft(next.start)).toBe("my note");
    expect(takeSideDraft(next.start)).toBe("");
  });

  it("reopenParams: a newer request's quote wins; an empty note is not carried; text never is", () => {
    expect(reopenParams({ turnId: "t9", quote: "new" }, { quote: { text: "old", turnId: "t7" }, draft: "  " })).toEqual({ turnId: "t9", quote: "new", text: undefined });
    expect(reopenParams({ turnId: "t9", text: "sent already" }, null)).toEqual({ turnId: "t9", text: undefined });
  });
});

describe("a request while a message is pending waits (P2-2)", () => {
  beforeEach(() => {
    sideModuleActive(true);
    for (const fn of Object.values(fx.api)) fn.mockReset();
    fx.api.sideRead.mockImplementation(() => new Promise(() => {}));
    mount();
  });
  afterEach(() => { unmount(); sideModuleActive(false); });

  it("the new quote / explain text is kept until the retry went, then taken; the retry clears only what it carried", async () => {
    seed({ draft: "first note", quote: null, pendingMessage: { text: "first note", clientMessageId: "m1", draft: "first note", quote: null }, error: "network down" });
    const request = initSide({ quote: "new passage", text: "explain this", turnId: "turn-9" }, { chatId: "side-1" });
    await renderCard(request);
    // Locked: neither the quote nor the draft changed, and the request is still there.
    expect(view()).toMatchObject({ draft: "first note", quote: null });
    expect(sideStart(request.request).quote).toBe("new passage");
    fx.api.sideSend.mockResolvedValue({ chat: chat({ revision: 2 }) });
    await act(async () => { await sendSide("local", "side-1"); });
    expect(fx.api.sideSend).toHaveBeenCalledWith("agent-1", "side-1", { text: "first note", clientMessageId: "m1" });
    // The retry's own note is cleared; then the waiting request lands.
    expect(view()).toMatchObject({ pendingMessage: null, draft: "explain this", quote: { text: "new passage", turnId: "turn-9" } });
  });

  it("a newer draft or quote than the pending message's is not cleared by its success", async () => {
    seed({ draft: "newer", quote: { text: "newer quote", turnId: "t2" }, pendingMessage: { text: "> old\n\nold", clientMessageId: "m1", draft: "old", quote: { text: "old", turnId: "t1" } } });
    fx.api.sideSend.mockResolvedValue({ chat: chat({ revision: 2 }) });
    await sendSide("local", "side-1");
    expect(fx.api.sideSend.mock.calls[0]![2]).toEqual({ text: "> old\n\nold", clientMessageId: "m1" });
    expect(view()).toMatchObject({ draft: "newer", quote: { text: "newer quote", turnId: "t2" }, pendingMessage: null });
  });
});
