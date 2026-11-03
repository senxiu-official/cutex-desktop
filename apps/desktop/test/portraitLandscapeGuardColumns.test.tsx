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

const SCENARIOS: { name: string; layout: () => Layout; strip?: string }[] = [
  { name: "one conversation", layout: one },
  { name: "two workspaces, the first focused", layout: () => two(0) },
  { name: "two workspaces, the second focused", layout: () => two(1) },
  { name: "two workspaces, the second folded to its strip", layout: () => two(0), strip: "local|alden" },
  { name: "two workspaces, the first maximised", layout: () => { const l = two(0); return toggleMaximized(l, conversationPanes(l)[0]!); } },
];

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
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  useStrips.setState({ strips: {} });
});

describe("the conversation columns stay byte-identical with portrait inactive", () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))("%s", (_name, sc) => {
    const layout = sc.layout();
    usePanes.setState({ layout });
    if (sc.strip) useStrips.setState({ strips: { [sc.strip]: { at: 1 } } });
    act(() => root!.render(h(PaneHost, { fullWindow: false, scope: null })));
    expect({ markup: host.innerHTML, layout: JSON.stringify(usePanes.getState().layout), strips: JSON.stringify(useStrips.getState().strips) }).toMatchSnapshot();
  });
});
