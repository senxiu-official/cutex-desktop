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
import { CONV_HEADER_COMPACT_SERVICES_BELOW, CONV_HEADER_FOLD_BELOW, CONV_HEADER_FOLD_ORDER, convHeaderFolded, convHeaderServicesCompact, convHeaderInfo } from "../src/renderer/src/lib/convHeader";
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
const REMOTE = sidebar([session("lead", "Setting UI")], { lead: { projectId: "p9", projectName: "Owner devices" } }, [{ id: "p9", name: "Owner devices" }]);

describe("fold order of a narrow column", () => {
  it("network folds first, then mute, then the project chip; wider = nothing folded", () => {
    expect(CONV_HEADER_FOLD_ORDER).toEqual(["network", "mute", "project"]);
    expect(convHeaderFolded(null)).toEqual([]);
    expect(convHeaderFolded(0)).toEqual([]);
    expect(convHeaderFolded(900)).toEqual([]);
    expect(convHeaderServicesCompact(CONV_HEADER_COMPACT_SERVICES_BELOW)).toBe(false);
    expect(convHeaderServicesCompact(CONV_HEADER_COMPACT_SERVICES_BELOW - 1)).toBe(true);
    expect(convHeaderFolded(CONV_HEADER_FOLD_BELOW.network)).toEqual([]);
    expect(convHeaderFolded(CONV_HEADER_FOLD_BELOW.network - 1)).toEqual(["network"]);
    expect(convHeaderFolded(CONV_HEADER_FOLD_BELOW.mute - 1)).toEqual(["network", "mute"]);
    expect(convHeaderFolded(CONV_HEADER_FOLD_BELOW.project - 1)).toEqual(["network", "mute", "project"]);
    expect(convHeaderFolded(200)).toEqual(["network", "mute", "project"]);
  });
  it("whatever the width, the folded items are a prefix of the order (never mute without network)", () => {
    for (let w = 100; w < 800; w += 7) expect(CONV_HEADER_FOLD_ORDER.slice(0, convHeaderFolded(w).length)).toEqual(convHeaderFolded(w));
  });
});

describe("what one pane's header shows (pure)", () => {
  it("the agent of its own host: same session id on two hosts = two different headers", () => {
    const left = convHeaderInfo(LOCAL, "lead")!;
    const right = convHeaderInfo(REMOTE, "lead")!;
    expect([left.session.displayName, left.director, left.project, left.cwd]).toEqual(["Hachimi", true, { id: "p1", name: "cutex-dev" }, "/home/ema/lead"]);
    expect([right.session.displayName, right.director, right.project]).toEqual(["Setting UI", false, { id: "p9", name: "Owner devices" }]);
  });
  it("a quick chat has no project chip; an independent agent gets the 独立 chip (id null); unknown agent = nothing", () => {
    expect(convHeaderInfo(LOCAL, "quick")?.project).toBeNull();
    expect(convHeaderInfo(LOCAL, "solo")?.project).toEqual({ id: null, name: null });
    expect(convHeaderInfo(LOCAL, "nobody")).toBeNull();
    expect(convHeaderInfo(null, "lead")).toBeNull();
  });
});

let root: Root;
let container: HTMLElement;
const widths: Record<string, number> = {};
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom has no layout: a header measures as the width the test gives its pane.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const pane = this.getAttribute("data-conv-header");
    return { width: pane ? (widths[pane] ?? 0) : 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  useApp.setState({
    hosts: null,
    selectedId: null,
    sidebar: LOCAL,
    byHost: { "host-a": { sidebar: REMOTE, services: null } } as never,
    services: [{ ownerCutexSessionId: "lead", health: "reachable", slug: "board", displayName: "Board", port: 24404 }] as never,
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(node: ReactNode) {
  await act(async () => root.render(h(I18nProvider, null, node)));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}
const items = (el: Element | null) => [...(el?.querySelectorAll("[data-conv-item]") ?? [])].map((e) => e.getAttribute("data-conv-item"));
const header = (pane: string) => container.querySelector(`[data-conv-header="${pane}"]`);

describe("conversation headers (rendered)", () => {
  const pane = (paneId: string, hostId: string, sessionId: string, focused: boolean) => h(ConversationHeader, { key: paneId, paneId, hostId, sessionId, focused, closable: true, maxed: false, framed: true });

  it("two columns side by side: each header shows its own agent on two lines, with the pane's buttons", async () => {
    widths.main = widths.c2 = 800;
    await render([pane("main", "local", "lead", true), pane("c2", "host-a", "lead", false)]);
    const left = header("main")!;
    const right = header("c2")!;
    expect(left.querySelector('[data-conv-item="name"]')?.textContent).toContain("Hachimi");
    expect(right.querySelector('[data-conv-item="name"]')?.textContent).toContain("Setting UI");
    // Line 1 (design 040 step 7): name, role (only the Director); on its right the start / stop button, the bell,
    // the services tag, then the pane's controls. Line 2: project + star · cwd · branch — over the whole width.
    expect(items(left)).toEqual(["name", "role", "online", "mute", "project", "star", "cwd", "branch", "network"]);
    expect(items(right)).toEqual(["name", "online", "mute", "project", "star", "cwd", "branch"]);
    for (const el of [left, right]) {
      const line1 = el.querySelector('[data-conv-line="1"]')!;
      expect(line1.querySelector("[data-conv-right] [data-pane-controls]")).not.toBeNull();
      expect(el.querySelector('[data-conv-line="2"] [data-conv-item="project"]')).not.toBeNull();
      // No divider any more: the hover-only buttons and the services tag sit before Shelf · — · ⋯.
      expect(line1.querySelector("[data-conv-divider]")).toBeNull();
      expect(line1.querySelector('[data-conv-left] [data-conv-item="online"]')).not.toBeNull();
      expect(line1.querySelector('[data-conv-left] [data-conv-item="mute"]')).not.toBeNull();
      expect(line1.querySelector('[data-conv-right] [data-conv-item]')).toBeNull();
      // The avatar is 40 px with two lines and carries online / offline (the green dot).
      expect(el.querySelector<HTMLElement>("[data-conv-avatar] [data-avatar]")?.style.width).toBe("40px");
      // Line 2 is a sibling of line 1 in the same column: nothing beside it takes its width.
      expect(el.querySelector('[data-conv-line="2"]')?.parentElement).toBe(line1.parentElement);
    }
    expect(left.querySelector('[data-conv-line="2"]')?.textContent).toContain("feat/header");
    expect(right.querySelector('[data-conv-item="project"]')?.textContent).toContain("Owner devices");
    for (const el of [left, right]) {
      expect(el.querySelector("[data-pane-max]")).not.toBeNull();
      expect(el.querySelector("[data-pane-collapse]")).not.toBeNull();
      // §24.13: 关闭 closes the pane (the agent keeps running); the page × is only there for a page over the conversation.
      expect(el.querySelector("[data-pane-close-keep]")).not.toBeNull();
      expect(el.querySelector("[data-pane-close]")).toBeNull();
      expect(el.querySelector("[data-conv-overflow]")).toBeNull();
    }
  });

  it("narrow columns fold network, then mute, then the project chip into ⋯ (each column by its own width)", async () => {
    widths.main = CONV_HEADER_FOLD_BELOW.network - 10;
    widths.c2 = CONV_HEADER_FOLD_BELOW.project - 10;
    await render([pane("main", "local", "lead", true), pane("c2", "local", "solo", false)]);
    expect(items(header("main"))).toEqual(["name", "role", "online", "mute", "project", "star", "cwd", "branch"]);
    expect(header("main")?.querySelector("[data-conv-overflow]")?.getAttribute("data-conv-overflow")).toBe("network");
    // A small dot on ⋯: something is folded into it.
    expect(header("main")?.querySelector("[data-pane-more] [data-conv-folded-dot]")).not.toBeNull();
    // The independent agent has no services: ⋯ holds what it has, in fold order.
    expect(items(header("c2"))).toEqual(["name", "online", "cwd", "branch"]);
    expect(header("c2")?.querySelector("[data-conv-overflow]")?.getAttribute("data-conv-overflow")).toBe("mute project");

    widths.c3 = CONV_HEADER_FOLD_BELOW.mute - 10;
    await render([pane("c3", "local", "lead", true)]);
    expect(header("c3")?.querySelector("[data-conv-overflow]")?.getAttribute("data-conv-overflow")).toBe("network mute");
    expect(items(header("c3"))).toContain("project");
  });

  it("uses full services at wide widths, compact Globe/count at medium, and menu-only in one-line mode", async () => {
    const { setUiPref } = await import("../src/renderer/src/lib/prefs");
    widths.medium = CONV_HEADER_COMPACT_SERVICES_BELOW - 10;
    await render([pane("medium", "local", "lead", true)]);
    const el = header("medium")!;
    const services = el.querySelector<HTMLButtonElement>('[data-conv-item="network"]')!;
    expect(services.closest('[data-conv-line="2"]')).not.toBeNull();
    expect(services.getAttribute("data-services-compact")).toBe("true");
    expect(services.querySelector("svg.lucide-server")).not.toBeNull();
    expect(services.textContent).toBe("1");
    expect(services.getAttribute("aria-label")).toBeTruthy();
    expect(el.querySelector('[data-conv-line="2"]')!.lastElementChild?.hasAttribute("data-conv-services")).toBe(true);
    act(() => services.click());
    expect(document.querySelector('[data-agent-services="lead"]')).not.toBeNull();
    act(() => setUiPref("titleTwoLines", false));
    expect(el.querySelector('[data-conv-line="2"]')).toBeNull();
    expect(el.querySelector('[data-conv-item="network"]')).toBeNull();
    expect(el.querySelector('[data-pane-more]')?.getAttribute("data-conv-overflow")).toContain("network");
    expect(el.querySelector<HTMLElement>("[data-conv-avatar] [data-avatar]")?.style.width).toBe("28px");
    act(() => setUiPref("titleTwoLines", true));
  });

  it("protects the project and uses compact online controls in narrow columns", async () => {
    widths.narrow = 334;
    await render([pane("narrow", "local", "lead", true)]);
    const el = header("narrow")!;
    const online = el.querySelector<HTMLButtonElement>('[data-conv-item="online"]')!;
    expect(online.dataset.onlineCompact).toBe("true");
    expect(online.textContent).toBe("");
    expect(online.getAttribute("aria-label")).toBeTruthy();
    expect(online.getAttribute("title")).toBeTruthy();
    expect(online.closest("[data-conv-left]")).not.toBeNull();
    expect(el.querySelector('[data-conv-item="name"]')!.textContent).toContain("Hachimi");
    expect(el.querySelector('[data-conv-item="project"]')!.className).toContain("shrink-0");
    expect(el.querySelector('[data-conv-item="cwd"]')!.className).toContain("shrink-[10]");
  });

  it("a single conversation: the same two-line header; 放大 is there and on (§24.16: alone it takes the whole work row); no page ×", async () => {
    widths.main = 900;
    await render(h(ConversationHeader, { paneId: "main", hostId: "local", sessionId: "lead", focused: true, closable: false, maxed: false, framed: false }));
    expect(items(header("main"))).toEqual(["name", "role", "online", "mute", "project", "star", "cwd", "branch", "network"]);
    expect(header("main")?.querySelector("[data-conv-folded-dot]")).toBeNull();
    expect(header("main")?.querySelector<HTMLButtonElement>("[data-pane-max]")?.disabled).toBe(false);
    expect(header("main")?.querySelector("[data-pane-close]")).toBeNull();
    expect(header("main")?.querySelector("[data-pane-collapse]")).not.toBeNull();
  });
});

describe("design 040 step 7", () => {
  it("online is the avatar's green dot; without the start / stop button there is no 在线 text; the avatar is 28 px with one line (owner 2026-10-23: compact) and 40 px with two, project on line 1", async () => {
    const { setUiPref } = await import("../src/renderer/src/lib/prefs");
    widths.main = 900;
    act(() => setUiPref("runtimeButton", "off"));
    await render(h(ConversationHeader, { paneId: "main", hostId: "local", sessionId: "lead", focused: true, closable: false, maxed: false, framed: false }));
    const el = header("main")!;
    expect(items(el)).not.toContain("online");
    expect(el.querySelector("[data-conv-avatar] [data-avatar-presence]")?.getAttribute("data-avatar-presence")).toBe("online");
    act(() => setUiPref("titleTwoLines", false));
    expect(el.querySelector('[data-conv-line="2"]')).toBeNull();
    expect(el.querySelector('[data-conv-line="1"] [data-conv-item="project"]')).not.toBeNull();
    expect(el.querySelector<HTMLElement>("[data-conv-avatar] [data-avatar]")?.style.width).toBe("28px");
    act(() => setUiPref("titleTwoLines", true));
    expect(el.querySelector<HTMLElement>("[data-conv-avatar] [data-avatar]")?.style.width).toBe("40px");
    act(() => setUiPref("runtimeButton", "all"));
  });

  it("an agent its host's sidebar does not list yet (just created): the avatar slot is there at once, then the agent's own", async () => {
    widths.main = 900;
    await render(h(ConversationHeader, { paneId: "main", hostId: "local", sessionId: "fresh", focused: true, closable: false, maxed: false, framed: false }));
    const el = header("main")!;
    expect(el.querySelector('[data-conv-avatar="pending"] [data-avatar]')).not.toBeNull();
    // The re-read sidebar lists it: the real avatar (with its status) takes the same slot, the placeholder goes.
    const fresh = session("fresh", "Fresh", { avatar: { kind: "emoji", value: "🦊" } } as never);
    await act(async () => useApp.setState({ sidebar: { ...LOCAL, active: [...LOCAL.active, fresh] } }));
    expect(el.querySelector('[data-conv-avatar="pending"]')).toBeNull();
    expect(el.querySelector('[data-conv-avatar=""] [data-avatar]')?.getAttribute("data-avatar")).toBe("emoji");
  });

  it("放大 stays shown while it is on (maxed); hover-only otherwise", async () => {
    widths.main = 900;
    await render(h(ConversationHeader, { paneId: "main", hostId: "local", sessionId: "lead", focused: true, closable: false, maxed: true, framed: true }));
    expect(header("main")!.querySelector("[data-pane-max]")!.className).not.toContain("opacity-0");
  });
});

describe("the window bar", () => {
  it("keeps host scope (显示桌面 in its entry group), the ⌘K search field, the launcher bar and window controls — nothing of a conversation", async () => {
    useApp.setState({ selectedId: "lead", view: { kind: "conversation" } as never });
    await render(h(TitleBar));
    const bar = container.querySelector("header")!;
    expect([...bar.querySelectorAll("[data-window-bar]")].map((e) => e.getAttribute("data-window-bar"))).toEqual(["scope", "entries", "search", "actions"]);
    expect(bar.querySelector('[data-window-bar="scope"] [data-stub="host-switcher"]')).not.toBeNull();
    const actions = bar.querySelector('[data-window-bar="actions"]')!;
    // Owner 2026-10-23: 显示桌面 is not in the right-hand group any more — the left one has it.
    expect([...actions.querySelectorAll("[data-show-desktop], [data-stub]")].map((e) => e.getAttribute("data-stub") ?? "show-desktop")).toEqual(["launchers", "window-controls"]);
    expect(bar.querySelector('[data-window-bar="scope"] [data-show-desktop]')).not.toBeNull();
    expect(bar.querySelector("[data-conv-item], [data-conv-header], img[alt]:not([alt=''])")).toBeNull();
    expect(bar.textContent).not.toContain("Hachimi");
    const search = bar.querySelector<HTMLButtonElement>('[data-window-bar="search"]')!;
    expect(search.textContent).toContain("Ctrl K");
    act(() => search.click());
    expect(fx.opened).toBe(1);
  });
});
