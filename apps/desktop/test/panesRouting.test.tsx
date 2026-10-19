// @vitest-environment jsdom
// Panes step 2 (docs/research/panes-20261019.md §8 risk 「漏改会发错智能体」): with two conversations side by
// side, a key, an open request (`signal`) or a notice reaches ONE conversation — the one it names, or the
// focused one. Two scopes are rendered like components/PaneHost does (a ConversationScope each).
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} } };
});

import { ConversationScope, type ConversationScopeValue } from "../src/renderer/src/lib/conversationScope";
import { meantHere, useUiSignal } from "../src/renderer/src/lib/uiSignal";
import { useConversationEsc } from "../src/renderer/src/lib/useConversationEsc";
import { useApp } from "../src/renderer/src/store";
import { viewKey } from "../src/renderer/src/lib/viewKey";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LEFT: ConversationScopeValue = { paneId: "main", hostId: "local", sessionId: "same", focused: false, visible: true };
/** The same session id on another host: another agent. */
const RIGHT: ConversationScopeValue = { paneId: "c2", hostId: "host-a", sessionId: "same", focused: true, visible: true };

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: ReactNode) {
  act(() => root.render(node));
}
const inScope = (value: ConversationScopeValue, child: ReactNode) => h(ConversationScope.Provider, { value, key: value.paneId }, child);

describe("meantHere: who a signal / notice is for", () => {
  const here = { hostId: "host-a", sessionId: "same" };
  it("one that names an agent: only the conversation showing that agent (host + id)", () => {
    expect(meantHere(viewKey("host-a", "same"), here, false)).toBe(true);
    expect(meantHere(viewKey("local", "same"), here, true)).toBe(false);
    expect(meantHere(viewKey("host-a", "same"), null, true)).toBe(false);
  });
  it("one that names none: the focused conversation", () => {
    expect(meantHere(undefined, here, true)).toBe(true);
    expect(meantHere(undefined, here, false)).toBe(false);
  });
});

describe("open requests (store signal) reach one conversation", () => {
  function Listener({ name, seen }: { name: string; seen: string[] }) {
    useUiSignal("goal", (arg) => seen.push(`${name}:${arg ?? ""}`));
    return null;
  }

  it("a signal naming an agent opens it in that agent's pane only, whichever pane has the focus", () => {
    const seen: string[] = [];
    render([inScope(LEFT, h(Listener, { name: "left", seen })), inScope(RIGHT, h(Listener, { name: "right", seen }))]);
    act(() => useApp.getState().signal("goal", "edit", { hostId: "local", sessionId: "same" }));
    expect(seen).toEqual(["left:edit"]);
    act(() => useApp.getState().signal("goal", "replace:x", { hostId: "host-a", sessionId: "same" }));
    expect(seen).toEqual(["left:edit", "right:replace:x"]);
  });

  it("a signal naming no agent goes to the focused conversation", () => {
    const seen: string[] = [];
    render([inScope(LEFT, h(Listener, { name: "left", seen })), inScope(RIGHT, h(Listener, { name: "right", seen }))]);
    act(() => useApp.getState().signal("goal"));
    expect(seen).toEqual(["right:"]);
    // The focus moves to the left pane: the next one goes there.
    render([inScope({ ...LEFT, focused: true }, h(Listener, { name: "left", seen })), inScope({ ...RIGHT, focused: false }, h(Listener, { name: "right", seen }))]);
    act(() => useApp.getState().signal("goal"));
    expect(seen).toEqual(["right:", "left:"]);
  });
});

describe("Esc stops the focused conversation's turn only", () => {
  function EscPane({ name, focused, acted }: { name: string; focused: boolean; acted: string[] }) {
    useConversationEsc(
      { preset: "queueFirst", turnId: `turn-${name}`, pendingSteers: 0, delegation: false, blocked: false, focused },
      { arm: () => acted.push(`${name}:arm`), act: (action) => acted.push(`${name}:${action}`) },
    );
    return null;
  }
  const esc = () => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));

  it("two conversations with running turns: one Esc, one interrupt — the focused one's", () => {
    const acted: string[] = [];
    render([h(EscPane, { key: "l", name: "left", focused: false, acted }), h(EscPane, { key: "r", name: "right", focused: true, acted })]);
    esc();
    expect(acted).toEqual(["right:interrupt"]);
    render([h(EscPane, { key: "l", name: "left", focused: true, acted }), h(EscPane, { key: "r", name: "right", focused: false, acted })]);
    esc();
    expect(acted).toEqual(["right:interrupt", "left:interrupt"]);
  });

  it("a single conversation (no focus flag) behaves as before", () => {
    const acted: string[] = [];
    function Single() {
      useConversationEsc({ preset: "queueFirst", turnId: "t1", pendingSteers: 0, delegation: false, blocked: false }, { arm: () => {}, act: (a) => acted.push(a) });
      return null;
    }
    render(h(Single));
    esc();
    expect(acted).toEqual(["interrupt"]);
  });
});
