// @vitest-environment jsdom
// Header split (owner 2026-10-21, variant A; prototype .claude/preview-design-v1.html §1 `#s1-a`): the
// conversation's items moved off the window bar into each conversation column's own two-line header
// (components/ConversationHeader, lib/convHeader). Covered: what each pane's header shows (its own host +
// agent, never the other column's), the fold order of a narrow column (network → mute → project, into ⋯),
// and what the window bar (components/TitleBar) still holds.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ opened: 0 }));

vi.mock("../src/renderer/src/bridge", () => {
  const answers: Record<string, unknown> = {
    notificationLevel: "normal",
    gitStatus: { isRepo: true, branch: "feat/header", upstream: null, ahead: null, behind: null, head: null, files: [] },
  };
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(answers[m as string] ?? null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
// The window bar's neighbours are drawn by their own files (tested there): stubs that say they are here.
vi.mock("../src/renderer/src/components/HostSwitcher", () => ({ HostSwitcher: () => h("span", { "data-stub": "host-switcher" }) }));
vi.mock("../src/renderer/src/components/side/TitleBarLaunchers", () => ({ TitleBarLaunchers: () => h("span", { "data-stub": "launchers" }) }));
vi.mock("../src/renderer/src/components/ShowDesktopButton", () => ({ ShowDesktopButton: () => h("button", { "data-show-desktop": "" }), useShowDesktopRow: () => ({ label: "pane.desktop", onSelect: () => {} }) }));
vi.mock("../src/renderer/src/components/RestoreBanner", () => ({ RestoreChip: () => null }));
vi.mock("../src/renderer/src/components/WindowControls", () => ({ LinuxControls: () => h("span", { "data-stub": "window-controls" }), CaptionSpace: () => null }));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOpenPage: () => null,
  usePageOf: () => null,
  useSlot: (slot: string) => (slot === "window.search" ? [{ mode: "show", moduleId: "quick-switch", item: { id: "quick-switch.search", placeholderKey: "quick-switch.placeholder", keys: () => "Ctrl K", open: () => void fx.opened++ } }] : []),
}));

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { setAppearance } from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { setUiPref } from "../src/renderer/src/lib/prefs";
import { MAIN_WINDOW } from "../src/renderer/src/lib/windowScope";
import { noteWindowBox, resetPortraitForTest, setPortraitPrefs } from "../src/renderer/src/lib/portrait";
import { useApp } from "../src/renderer/src/store";
import { I18nProvider } from "../src/renderer/src/i18n";
import { ConversationHeader } from "../src/renderer/src/components/ConversationHeader";
import { TitleBar } from "../src/renderer/src/components/TitleBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function session(id: string, name: string, over: Partial<SessionResource> = {}): SessionResource {
  return {
    cutexSessionId: id,
    displayName: name,
    formalAgentName: name,
    registrationClass: null,
    lifecycle: "active",
    cwd: `/home/ema/${id}`,
    note: null,
    avatar: null,
    native: { threadId: `thread-${id}`, schema: null },
    runtime: { status: "online" },
    ...over,
  } as unknown as SessionResource;
}

function sidebar(sessions: SessionResource[], rows: Record<string, { projectId?: string; projectName?: string; kind?: string }>, projects: { id: string; name: string; director?: string }[]): SidebarSnapshot {
  return {
    active: sessions,
    retired: [],
    hostRows: Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, { id, name: id, kind: r.kind ?? "Agent", hostId: "x", profile: null, cwd: null, state: "online", generation: 1, nativeId: null, projectId: r.projectId ?? null, projectName: r.projectName ?? null }])),
    projects: { projects: projects.map((p) => ({ project_id: p.id, director_cutex_session_id: p.director ?? null, presentation: { display_name: p.name, badge_label: p.name.slice(0, 1), color: "#3b82f6" } })) },
  } as unknown as SidebarSnapshot;
}

const LOCAL = sidebar(
  [session("lead", "Hachimi"), session("quick", "Quick chat", { formalAgentName: null, registrationClass: "local_only" }), session("solo", "Solo")],
  { lead: { projectId: "p1" }, quick: {}, solo: {} },
  [{ id: "p1", name: "cutex-dev", director: "lead" }],
);

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const pane = this.getAttribute("data-conv-header");
    return { width: pane ? 900 : 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  useApp.setState({ hosts: null, selectedId: "lead", sidebar: LOCAL, byHost: {} as never, services: [] as never });
  setAppearance({ ...DEFAULT_APPEARANCE }, false);
  setUiPref("sidebarRail", false);
  resetPortraitForTest();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  setAppearance({ ...DEFAULT_APPEARANCE }, false);
  setUiPref("sidebarRail", false);
  resetPortraitForTest();
});

async function render(node: ReactNode) {
  await act(async () => root.render(h(I18nProvider, null, node)));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}
const head = (maxed: boolean) => h(ConversationHeader, { paneId: "main", hostId: "local", sessionId: "lead", focused: true, closable: true, maxed, framed: true });
/** The ⤢ (放大 / 最大化保持) button and the logo (the sidebar toggle): what portrait P2 changed, as landscape draws them. */
const controls = () => container.querySelector("[data-pane-controls]")?.outerHTML ?? null;
const logo = () => container.querySelector('[data-window-bar="scope"] button')?.outerHTML ?? null;

const portrait = () => act(() => void noteWindowBox(MAIN_WINDOW, { width: 1080, height: 1920 }));
const btn = () => container.querySelector<HTMLButtonElement>('[data-window-bar="scope"] button')!;

describe("portrait: the header's ⤢ and the title bar's logo", () => {
  it("⤢ (最大化保持) is not offered in portrait, whether 最大化保持 is on or off; its value is kept", async () => {
    await render(head(false));
    expect(container.querySelector("[data-pane-max]")).not.toBeNull();
    portrait();
    expect(container.querySelector("[data-pane-max]")).toBeNull();
    setAppearance({ fillMode: true }, false);
    await render(head(false));
    expect(container.querySelector("[data-pane-max]")).toBeNull();
  });
  it("on a maximised column it stays: the way back", async () => {
    portrait();
    await render(head(true));
    const max = container.querySelector<HTMLElement>("[data-pane-max]")!;
    expect(max.getAttribute("aria-pressed")).toBe("true");
  });
  it("the logo: 显示侧栏 while the overlay is hidden, 收起侧栏 + aria-expanded while portrait holds it", async () => {
    portrait();
    await render(h(TitleBar));
    expect(btn().getAttribute("aria-expanded")).toBe("false");
    const show = btn().getAttribute("aria-label");
    act(() => setPortraitPrefs(MAIN_WINDOW, { sidebarShown: true }));
    expect(btn().getAttribute("aria-expanded")).toBe("true");
    expect(btn().getAttribute("aria-label")).not.toBe(show);
    // Landscape again (the overlay pref kept for portrait): the docked sidebar's own state.
    act(() => void noteWindowBox(MAIN_WINDOW, { width: 1920, height: 1080 }));
    expect(btn().getAttribute("aria-expanded")).toBe("true");
    act(() => setUiPref("sidebarRail", true));
    expect(btn().getAttribute("aria-expanded")).toBe("false");
  });
});
