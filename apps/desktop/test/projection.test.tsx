// @vitest-environment jsdom
// The projection (docs/desktop-modules.md §24.13; canvas principles §7): another agent's live conversation in the
// focused conversation's Shelf. The routing guarantees of panes step 2 hold: what is typed into the projection
// goes to the projected agent only (never the selected / focused one), and Esc in it never stops the focused
// conversation's turn (it is inside the side root: lib/escInterrupt inSide). Also: the item's params and dedupe.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  submit: vi.fn(async () => null),
  interrupt: vi.fn(async () => {}),
}));

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    sidebarOf: () => ({ active: [{ cutexSessionId: "proj", displayName: "ui-tester", runtime: { status: "online", activeTurnId: null } }], retired: [] }),
    useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
  };
});
// The timeline / dock / queue are their own components' business here: only where the input goes.
vi.mock("../src/renderer/src/components/Timeline", () => ({ TimelineBody: () => h("div", { "data-timeline": "" }) }));
vi.mock("../src/renderer/src/components/InteractionDock", () => ({ InteractionDock: () => null }));
vi.mock("../src/renderer/src/components/QueuePanel", () => ({ QueuePanel: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof ResizeObserver === "undefined") vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const { viewKey } = await import("../src/renderer/src/lib/viewKey");
const { emptyTimeline } = await import("../src/renderer/src/lib/timeline");
const { ProjectionBody } = await import("../src/renderer/src/modules/conversation/Projection");
const { parseProjection, projectionComponent } = await import("../src/renderer/src/modules/conversation/projectionItem");
const { useConversationEsc } = await import("../src/renderer/src/lib/useConversationEsc");

const view = { loading: false, error: null, resyncing: false, connection: "live", runtimeGeneration: 1, timeline: { ...emptyTimeline(), threadId: "th" }, queue: [], queuePause: null, asksPaused: null, admission: null, version: 1, historySource: "live", startError: null, older: null };

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  fx.submit.mockClear();
  fx.state = {
    selectedId: "main",
    selectedHost: "local",
    hosts: null,
    daemon: { kind: "connected" },
    byHost: {},
    views: { [viewKey("host-b", "proj")]: 1 },
    sessions: { [viewKey("host-b", "proj")]: view },
    outbox: {},
    queueHidden: {},
    pendingSteers: {},
    queueHandoff: {},
    retainView: () => () => {},
    setViewVisible: () => {},
    submit: fx.submit,
    interrupt: fx.interrupt,
  };
  container = document.createElement("div");
  // Instances are drawn in the side instance layer (data-side-root), like SideInstanceLayer does.
  container.dataset.sideRoot = "";
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const props = (sessionId = "proj") =>
  ({
    instance: { id: "i9", kind: "conversation.projection", binding: { kind: "agent", hostId: "local", sessionId: "main" }, state: { hostId: "host-b", sessionId }, pinned: false },
    hostId: "local",
    sessionId: "main",
    setState: () => {},
    visible: true,
    active: true,
    mode: "normal",
    where: "card",
    revealed: 0,
    close: () => {},
    open: () => ({ status: "unavailable", reason: "bad-params" }),
    keepMounted: () => false,
    held: false,
  }) as never;

function typeAndEnter(text: string) {
  const area = container.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  return area;
}

describe("projection routing (§24.13)", () => {
  it("a send in the projection goes to the projected agent (its host + session), not the selected one", () => {
    act(() => root.render(h(ProjectionBody, props())));
    expect(container.querySelector('[data-projection="proj"]')?.getAttribute("data-projection-host")).toBe("host-b");
    typeAndEnter("截图做到哪了？");
    expect(fx.submit).toHaveBeenCalledTimes(1);
    expect(fx.submit).toHaveBeenCalledWith("截图做到哪了？", "auto", [], { sessionId: "proj", hostId: "host-b" });
  });

  it("Esc in the projection never stops the focused conversation's turn (only that conversation's own Esc does)", () => {
    const act1 = vi.fn();
    function MainConversation() {
      useConversationEsc({ preset: "queueFirst", turnId: "t-main", pendingSteers: 0, delegation: false, blocked: false, focused: true }, { arm: () => {}, act: act1 });
      return null;
    }
    const mainBox = document.createElement("div");
    document.body.appendChild(mainBox);
    const mainRoot = createRoot(mainBox);
    act(() => mainRoot.render(h(MainConversation)));
    act(() => root.render(h(ProjectionBody, props())));
    const area = container.querySelector("textarea")!;
    area.focus();
    act(() => void area.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    // a non-editable spot of the projection (its timeline)
    const tl = container.querySelector("[data-timeline]")!;
    act(() => void tl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(act1).not.toHaveBeenCalled();
    // the same key on the conversation itself does stop its turn
    area.blur();
    act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(act1).toHaveBeenCalledWith("interrupt");
    act(() => mainRoot.unmount());
    mainBox.remove();
  });

  it("the component: params = the projected agent (host + session), one per agent (dedupe), restored from its state", () => {
    expect(parseProjection({ hostId: "host-b", sessionId: "proj" })).toEqual({ hostId: "host-b", sessionId: "proj" });
    expect(parseProjection({ sessionId: "proj" })).toBeNull();
    expect(parseProjection({ hostId: "a|b", sessionId: "proj" })).toBeNull();
    expect(projectionComponent.dedupeKey!({ hostId: "host-b", sessionId: "proj" })).toBe("host-b|proj");
    expect(projectionComponent.restore!({ hostId: "host-b", sessionId: "proj" }, 1)).toEqual({ hostId: "host-b", sessionId: "proj" });
    expect(projectionComponent.instances).toBe("multi");
    expect(projectionComponent.defaultBinding).toBe("agent");
  });
});
