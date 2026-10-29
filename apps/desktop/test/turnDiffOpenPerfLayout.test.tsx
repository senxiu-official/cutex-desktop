// @vitest-environment jsdom
// The turn-diff perf fix keeps one conversation on the column fiber it uses beside a Shelf. These tests
// hold the two behaviours that old single-only wrapper provided: 显示桌面 hides the conversation, and
// 只看 Shelf replaces it with its in-place strip.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ desktopShown: false }));
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
  useDesktop: (select: (state: { snapshot: unknown }) => unknown) => select({ snapshot: fx.desktopShown ? [] : null }),
  useDesktopShown: () => fx.desktopShown,
}));
vi.mock("../src/renderer/src/components/Conversation", () => ({
  Conversation: () => h("i", { "data-fake-conversation": "" }),
  MemoConversation: () => h("i", { "data-fake-conversation": "" }),
}));
vi.mock("../src/renderer/src/components/ConversationHeader", () => ({ ConversationHeader: () => h("header", { "data-fake-header": "" }) }));
vi.mock("../src/renderer/src/components/ConvStrip", () => ({ ConvStrip: () => h("nav", { "data-fake-strip": "" }) }));
vi.mock("../src/renderer/src/components/PageHeader", () => ({ PageHeader: () => h("header", { "data-fake-page": "" }) }));
vi.mock("../src/renderer/src/components/PaneResizer", () => ({ ColumnSplitter: () => null, RowSplitter: () => null }));
vi.mock("../src/renderer/src/components/ChipTray", () => ({
  DesktopStage: ({ input, children }: { input: { desktopShown: boolean }; children: (desktop: string | null) => ReactNode }) =>
    h("div", { "data-fake-stage": input.desktopShown ? "desktop" : "panes" }, children(input.desktopShown ? "desktop" : null)),
}));
vi.mock("../src/renderer/src/components/side/SideArea", () => ({ SideWorkArea: ({ children }: { children: ReactNode }) => h("div", { "data-fake-work": "" }, children) }));
vi.mock("../src/renderer/src/components/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("../src/renderer/src/components/SettingsShelf", () => ({ SettingsShelfSlot: () => null }));
vi.mock("../src/renderer/src/components/CustomizeHost", () => ({ CustomizeHost: () => null }));
vi.mock("../src/renderer/src/components/ErrorBoundary", () => ({ ErrorBoundary: ({ children }: { children: ReactNode }) => h("Fragment", null, children) }));
vi.mock("../src/renderer/src/modules/Outlet", () => ({ MainOutlet: ({ children }: { children: ReactNode }) => h("Fragment", null, children), PaneOutlet: ({ children }: { children: ReactNode }) => h("Fragment", null, children) }));
vi.mock("../src/renderer/src/modules/react", () => ({ useOpenPage: () => null, usePageOf: () => null, useSlot: () => [] }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { PaneHost } = await import("../src/renderer/src/components/PaneHost");
const { conversationPanes, defaultLayout } = await import("../src/renderer/src/lib/paneLayout");
const { usePanes } = await import("../src/renderer/src/lib/paneStore");
const { emptyLayout } = await import("../src/renderer/src/lib/sideLayout");
const { useSide } = await import("../src/renderer/src/lib/sideLayoutStore");
const { useShelfOnly } = await import("../src/renderer/src/lib/shelfOnly");
const { useApp } = await import("../src/renderer/src/store");
const { DEFAULT_APPEARANCE } = await import("../src/renderer/src/lib/appearanceModel");
const { setAppearance } = await import("../src/renderer/src/lib/appearance");

let root: Root | null = null;
let host: HTMLDivElement;
let paneId: string;
const q = (selector: string) => host.querySelector<HTMLElement>(selector);
const render = () => act(() => root!.render(h(PaneHost, { fullWindow: false, scope: null })));

beforeEach(() => {
  fx.desktopShown = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  localStorage.clear();
  const layout = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
  paneId = conversationPanes(layout)[0]!;
  usePanes.setState({ layout });
  useSide.setState({ scope: "host:local", layout: { ...emptyLayout(), open: false }, mode: null, narrow: false, liveWidth: {}, focusedCard: null });
  useShelfOnly.setState({ records: {} });
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: null } as never);
  setAppearance({ ...DEFAULT_APPEARANCE }, false);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

it("显示桌面 keeps the single column mounted but hidden", () => {
  render();
  const conversation = q("[data-fake-conversation]")!;
  expect(conversation.closest("section")!.hidden).toBe(false);
  fx.desktopShown = true;
  render();
  expect(conversation.closest("section")!.hidden).toBe(true);
  fx.desktopShown = false;
  render();
  expect(conversation.closest("section")!.hidden).toBe(false);
});

it("只看 Shelf keeps the single conversation as its in-place strip", () => {
  useShelfOnly.setState({ records: { "local|eva": { at: 1, shelfId: "s", before: null } } });
  render();
  const column = q(`[data-conv-pane="${paneId}"]`)!;
  expect(column.dataset.convSingle).toBe(paneId);
  expect(column.dataset.convStrip).toBe(paneId);
  expect(q("[data-fake-strip]")).not.toBeNull();
  expect(q("[data-fake-header]")).toBeNull();
  expect(q("[data-fake-conversation]")!.parentElement!.hidden).toBe(true);
});
