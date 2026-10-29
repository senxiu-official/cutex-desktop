// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../src/renderer/src/store";
import type { TimelineEntry } from "../src/renderer/src/lib/timeline";

const store = vi.hoisted(() => ({ state: { sessions: {} as Record<string, SessionView> }, listeners: new Set<() => void>() }));
vi.mock("../src/renderer/src/store", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => { store.listeners.add(listener); return () => { store.listeners.delete(listener); }; };
  const useApp = Object.assign(<T,>(select: (state: typeof store.state) => T) => useSyncExternalStore(subscribe, () => select(store.state)), {
    getState: () => store.state, subscribe,
  });
  return { useApp, viewOf: (state: typeof store.state, host: string, session: string) => state.sessions[`${host}\n${session}`] };
});
import { StreamRenderProvider } from "../src/renderer/src/components/StreamRenderProvider";
import { STREAM_RENDER_MS, useConversationStructure, useStreamedEntry } from "../src/renderer/src/lib/streamRender";

const entry = (text: string, streaming = true): TimelineEntry => ({ kind: "agent", id: "reply", turnId: "turn", text, streaming });
function fixture(text = "") {
  return { version: 1, textVersion: 0, loading: false, queue: [], timeline: {
    threadId: "thread", entries: new Map([["reply", entry(text)]]), activeTurnId: "turn",
    turns: [{ id: "turn", entryIds: ["reply"] }],
  } } as unknown as SessionView;
}
function update(id: string, text: string, finish = false) {
  const key = `host\n${id}`, old = store.state.sessions[key]!;
  old.timeline.entries.set("reply", entry(text, !finish));
  store.state = { sessions: { ...store.state.sessions, [key]: {
    ...old, version: old.version + 1, textVersion: (old.textVersion ?? 0) + (finish ? 0 : 1),
  } } };
  for (const listener of [...store.listeners]) listener();
}

let parents = 0, rows = 0, root: Root, node: HTMLDivElement;
function TextRow({ sessionId, initial }: { sessionId: string; initial: TimelineEntry }) {
  rows++;
  const current = useStreamedEntry(sessionId, initial);
  return <p>{current.kind === "agent" ? current.text : ""}</p>;
}
function Conversation({ id }: { id: string }) {
  parents++;
  const view = useConversationStructure("host", id)!;
  return <StreamRenderProvider hostId="host" sessionId={id}><TextRow sessionId={id} initial={view.timeline.entries.get("reply")!} /></StreamRenderProvider>;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  store.listeners.clear(); store.state = { sessions: { "host\na": fixture(), "host\nb": fixture("B") } };
  parents = 0; rows = 0; node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); vi.useRealTimers(); });

describe("streamed row subscription", () => {
  it("updates only the live row and displays the complete final text immediately", () => {
    act(() => root.render(<Conversation id="a" />));
    const initialParents = parents;
    act(() => update("a", "a"));
    expect(node.textContent).toBe("a");
    act(() => { vi.advanceTimersByTime(5); update("a", "ab"); update("a", "abc"); });
    expect(node.textContent).toBe("a");
    expect(parents).toBe(initialParents);
    act(() => vi.advanceTimersByTime(STREAM_RENDER_MS));
    expect(node.textContent).toBe("abc");
    expect(parents).toBe(initialParents);
    const beforeFinish = rows;
    act(() => { update("a", "complete and unchanged content", true); });
    expect(node.textContent).toBe("complete and unchanged content");
    expect(parents).toBe(initialParents + 1);
    act(() => vi.advanceTimersByTime(200));
    expect(rows).toBeGreaterThanOrEqual(beforeFinish);
    expect(node.textContent).toBe("complete and unchanged content");
  });
  it("cancels a pending row update when switching sessions with the same item id", () => {
    act(() => root.render(<Conversation id="a" />));
    act(() => update("a", "A"));
    act(() => { vi.advanceTimersByTime(5); update("a", "A pending"); });
    act(() => root.render(<Conversation id="b" />));
    expect(node.textContent).toBe("B");
    act(() => vi.advanceTimersByTime(200));
    expect(node.textContent).toBe("B");
    act(() => update("b", "B latest"));
    expect(node.textContent).toBe("B latest");
  });
});
