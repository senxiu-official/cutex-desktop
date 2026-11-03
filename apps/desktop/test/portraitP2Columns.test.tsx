// @vitest-environment jsdom
// Portrait P2 guard (owner 2026-10-30, design .claude/previews/portrait/design.md): the conversation columns
// (components/PaneHost ConversationColumns) learned the portrait stack's strip — with portrait inactive they must render
// byte-identical. The snapshot next to this test was recorded on main a637fa8d7, BEFORE lib/portrait existed: one
// conversation, two workspaces (focus on either), one folded to its strip (收起一个会话), a maximised one. Imports nothing of
// lib/portrait on purpose. Harness: test/turnDiffOpenPerfLayout.test.tsx (the work area and the column's parts stubbed;
// the strip stub prints the props it gets).
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = new Proxy({}, { get: (_target, method) => (method === "then" ? undefined : () => Promise.resolve(null)) });
vi.mock("../src/renderer/src/bridge", () => ({ api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (message: string) => message }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => ({ hostId: "local", sessionId: "eva", projectId: null }),
  useSideRegistry: () => new Map(),
}));
vi.mock("../src/renderer/src/lib/paneActions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDesktop: (select: (state: { snapshot: unknown }) => unknown) => select({ snapshot: null }),
  useDesktopShown: () => false,
}));
vi.mock("../src/renderer/src/components/Conversation", () => ({
  Conversation: () => h("i", { "data-fake-conversation": "" }),
  MemoConversation: () => h("i", { "data-fake-conversation": "" }),
}));
vi.mock("../src/renderer/src/components/ConversationHeader", () => ({ ConversationHeader: (p: { paneId: string }) => h("header", { "data-fake-header": p.paneId }) }));
vi.mock("../src/renderer/src/components/ConvStrip", () => ({ ConvStrip: (p: object) => h("nav", { "data-fake-strip": JSON.stringify(p) }) }));
vi.mock("../src/renderer/src/components/PageHeader", () => ({ PageHeader: () => h("header", { "data-fake-page": "" }) }));
vi.mock("../src/renderer/src/components/PaneResizer", () => ({ ColumnSplitter: () => h("hr", { "data-fake-col-splitter": "" }), RowSplitter: () => h("hr", { "data-fake-row-splitter": "" }) }));
vi.mock("../src/renderer/src/components/ChipTray", () => ({
  DesktopStage: ({ children }: { children: (desktop: string | null) => ReactNode }) => h("div", { "data-fake-stage": "panes" }, children(null)),
}));
vi.mock("../src/renderer/src/components/side/SideArea", () => ({
  SideWorkArea: ({ children, split, covered }: { children: ReactNode; split: unknown; covered: boolean }) => h("div", { "data-fake-work": JSON.stringify({ split, covered }) }, children),
}));
vi.mock("../src/renderer/src/components/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("../src/renderer/src/components/SettingsShelf", () => ({ SettingsShelfSlot: () => null }));
vi.mock("../src/renderer/src/components/CustomizeHost", () => ({ CustomizeHost: () => null }));
vi.mock("../src/renderer/src/components/ErrorBoundary", () => ({ ErrorBoundary: ({ children }: { children: ReactNode }) => h("Fragment", null, children) }));
vi.mock("../src/renderer/src/modules/Outlet", () => ({ MainOutlet: ({ children }: { children: ReactNode }) => h("Fragment", null, children), PaneOutlet: ({ children }: { children: ReactNode }) => h("Fragment", null, children) }));
vi.mock("../src/renderer/src/modules/react", () => ({ useOpenPage: () => null, usePageOf: () => null, useSlot: () => [] }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { PaneHost } = await import("../src/renderer/src/components/PaneHost");
const { conversationPanes, defaultLayout, focusPane, openBeside, toggleMaximized } = await import("../src/renderer/src/lib/paneLayout");
const { usePanes } = await import("../src/renderer/src/lib/paneStore");
const { emptyLayout } = await import("../src/renderer/src/lib/sideLayout");
const { useSide } = await import("../src/renderer/src/lib/sideLayoutStore");
const { useShelfOnly } = await import("../src/renderer/src/lib/shelfOnly");
const { useStrips } = await import("../src/renderer/src/lib/convStrips");
const { useApp } = await import("../src/renderer/src/store");
const { DEFAULT_APPEARANCE } = await import("../src/renderer/src/lib/appearanceModel");
const { setAppearance } = await import("../src/renderer/src/lib/appearance");
const { noteWindowBox, resetPortraitForTest, usePortrait } = await import("../src/renderer/src/lib/portrait");
const { MAIN_WINDOW } = await import("../src/renderer/src/lib/windowScope");

type Layout = ReturnType<typeof defaultLayout>;
let root: Root | null = null;
let host: HTMLDivElement;

function one(): Layout {
  return defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
}
function two(focus: 0 | 1): Layout {
  const work = openBeside(one(), { hostId: "local", sessionId: "alden" }, 1);
  return focusPane(work, conversationPanes(work)[focus]!, 2);
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  localStorage.clear();
  useSide.setState({ scope: "host:local", layout: { ...emptyLayout(), open: false }, mode: null, narrow: false, liveWidth: {}, focusedCard: null });
  useShelfOnly.setState({ records: {} });
  useStrips.setState({ strips: {} });
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: null } as never);
  setAppearance({ ...DEFAULT_APPEARANCE }, false);
  resetPortraitForTest();
});
afterEach(() => {
  resetPortraitForTest();
  act(() => root?.unmount());
  root = null;
  host.remove();
  useStrips.setState({ strips: {} });
});

const q = (sel: string) => host.querySelector<HTMLElement>(sel);
/** The markup with each element's attributes in name order (a focus switch there and back re-adds data-pane-focused last). */
function markup(): string {
  const out = (n: Node): string => {
    if (!(n instanceof Element)) return n.textContent ?? "";
    const tag = n.tagName.toLowerCase();
    const attrs = [...n.attributes].map((a) => `${a.name}="${a.value}"`).sort().join(" ");
    return `<${tag} ${attrs}>${[...n.childNodes].map(out).join("")}</${tag}>`;
  };
  return [...host.childNodes].map(out).join("");
}
const render = () => act(() => root!.render(h(PaneHost, { fullWindow: false, scope: null })));
const turn = (w: number, hh: number) => act(() => void noteWindowBox(MAIN_WINDOW, { width: w, height: hh }));

describe("two workspaces in a portrait window", () => {
  it("the focused one is the stack's conversation part, the other a strip across the top; a press there moves the focus; back = the split row as before", () => {
    const layout = two(0);
    const [first, second] = conversationPanes(layout) as [string, string];
    usePanes.setState({ layout });
    render();
    const before = markup();
    turn(1080, 1920);
    const focused = q(`[data-conv-pane="${first}"]`)!;
    const other = q(`[data-conv-pane="${second}"]`)!;
    expect(focused.dataset.portraitPart).toBe("conversation");
    // No inline size of its own: portrait.css places it from the stack's variables.
    expect(focused.getAttribute("style") ?? "").toBe("");
    expect(focused.className).not.toContain("ml-2");
    expect(other.dataset.portraitPart).toBe("strip");
    expect(other.dataset.convStrip).toBe(second);
    expect(JSON.parse(other.querySelector<HTMLElement>("[data-fake-strip]")!.dataset.fakeStrip!)).toMatchObject({ paneId: second, across: true });
    // The strip has no header; its conversation stays mounted under it, hidden; no column handle in the stack.
    expect(other.querySelector("[data-fake-header]")).toBeNull();
    expect(other.querySelector<HTMLElement>("[data-fake-conversation]")!.parentElement!.hidden).toBe(true);
    expect(q("[data-fake-row-splitter]")).toBeNull();
    expect(useStrips.getState().strips).toEqual({});
    // A press on the strip: that workspace is focused — it is the stack now, the first one the strip.
    act(() => void other.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(q(`[data-conv-pane="${second}"]`)!.dataset.portraitPart).toBe("conversation");
    expect(q(`[data-conv-pane="${first}"]`)!.dataset.portraitPart).toBe("strip");
    expect(useStrips.getState().strips).toEqual({});
    act(() => void q(`[data-conv-pane="${first}"]`)!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    turn(1920, 1080);
    expect(markup()).toBe(before);
  });

  it("a stored strip (收起一个会话) stays the strip it is; one workspace has no strip", () => {
    usePanes.setState({ layout: one() });
    render();
    turn(1080, 1920);
    expect(q("[data-portrait-part=strip]")).toBeNull();
    expect(q("[data-conv-pane]")?.dataset.portraitPart ?? null).toBeNull();
  });
});

// P3 (design decision 9): a stack wide enough for both (components/side/SideArea sets the window's `columns`) — each
// workspace a column of its own: both conversation parts, tagged with their column (portrait.css places them), no strip.
describe("two workspaces side by side in a portrait window (P3)", () => {
  it("both are conversation parts in their own column, headers and conversations shown; without the room the strip again; back = the split row as before", () => {
    const layout = two(0);
    const [first, second] = conversationPanes(layout) as [string, string];
    usePanes.setState({ layout });
    render();
    const before = markup();
    turn(1080, 1920);
    act(() => usePortrait.of(MAIN_WINDOW).setState({ columns: true }));
    for (const [paneId, col] of [[first, "0"], [second, "1"]] as const) {
      const s = q(`[data-conv-pane="${paneId}"]`)!;
      expect(s.dataset.portraitPart).toBe("conversation");
      expect(s.dataset.portraitCol).toBe(col);
      expect(s.hasAttribute("data-conv-strip")).toBe(false);
      expect(s.getAttribute("style") ?? "").toBe("");
      expect(s.className).not.toContain("ml-2");
      expect(s.querySelector("[data-fake-header]")).not.toBeNull();
      expect(s.querySelector<HTMLElement>("[data-fake-conversation]")!.parentElement!.hidden).toBe(false);
    }
    expect(q("[data-fake-strip]")).toBeNull();
    expect(q("[data-fake-row-splitter]")).toBeNull();
    // A press in the other column moves the focus; both stay columns.
    act(() => void q(`[data-conv-pane="${second}"]`)!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(q(`[data-conv-pane="${second}"]`)!.hasAttribute("data-pane-focused")).toBe(true);
    expect(q(`[data-conv-pane="${first}"]`)!.dataset.portraitPart).toBe("conversation");
    act(() => void q(`[data-conv-pane="${first}"]`)!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    // Not the room any more: the other one is the strip again.
    act(() => usePortrait.of(MAIN_WINDOW).setState({ columns: false }));
    expect(q(`[data-conv-pane="${second}"]`)!.dataset.portraitPart).toBe("strip");
    expect(q(`[data-conv-pane="${second}"]`)!.hasAttribute("data-portrait-col")).toBe(false);
    act(() => usePortrait.of(MAIN_WINDOW).setState({ columns: true }));
    turn(1920, 1080);
    expect(markup()).toBe(before);
  });
});
