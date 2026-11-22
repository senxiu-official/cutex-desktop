// @vitest-environment jsdom
// Unreachable hosts leave the 花名册 (owner 2026-11-17; review 2026-11-18 P2): a host that goes 连不上 / is switched
// off lists none of its rows there — not even its last (cached) snapshot; it is in the footer switcher. Coming back
// online brings its rows back. 现在·全部 keeps the last rows, greyed, as before.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOpenPage: () => null,
  usePageOf: () => null,
  useSlot: () => [],
}));

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { setUiPref } from "../src/renderer/src/lib/prefs";
import { useApp } from "../src/renderer/src/store";
import { I18nProvider } from "../src/renderer/src/i18n";
import { Sidebar } from "../src/renderer/src/components/Sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function session(id: string, name: string, project: string): SessionResource {
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  return { cutexSessionId: id, displayName: name, formalAgentName: name, registrationClass: null, lifecycle: "active", cwd: `/srv/${project}`, note: null, avatar: null, createdAt: null, activity: { lastConversationAt: at }, native: { threadId: `t-${id}`, schema: null }, runtime: { status: "online", activeTurnId: null } } as unknown as SessionResource;
}
function snapshot(host: string, agents: [string, string][], project: string, name: string): SidebarSnapshot {
  const active = agents.map(([id, n]) => session(id, n, project));
  return {
    active,
    retired: [],
    hostRows: Object.fromEntries(agents.map(([id, n]) => [id, { id, name: n, kind: "Agent", hostId: host, profile: null, cwd: null, state: "online", generation: 1, nativeId: null, projectId: project, projectName: null }])),
    projects: { projects: [{ project_id: project, director_cutex_session_id: null, presentation: { display_name: name, badge_label: name[0], color: "cyan" } }] },
  } as unknown as SidebarSnapshot;
}
const LOCAL = snapshot("local", [["l1", "Lumen"]], "home", "Home");
const ALPHA = snapshot("alpha", [["a1", "Zeta"], ["a2", "Yarrow"]], "far", "Far");

let root: Root;
let container: HTMLElement;
const reach = (alpha: "connected" | "unreachable" | "off") => {
  const daemon = alpha === "connected" ? { kind: "connected" } : { kind: "unreachable", baseUrl: "", message: "no route" };
  useApp.setState({
    hosts: {
      active: "local",
      scope: { kind: "all" },
      hosts: [
        { id: "local", kind: "local", label: "This PC", conn: { epoch: 1, daemon: { kind: "connected" } } },
        { id: "alpha", kind: "dev-direct", label: "alpha", conn: alpha === "off" ? null : { epoch: 1, daemon } },
      ],
    } as never,
    daemon: { kind: "connected" } as never,
    selectedId: null,
    sidebar: LOCAL,
    // The slice (and so its cached snapshot) stays while the host is unreachable.
    byHost: { alpha: { epoch: "a1", daemon, features: new Set(), featuresKnown: true, sidebar: ALPHA, approvals: null, services: null, waiting: {} } } as never,
  });
};
const names = () => [...container.querySelectorAll<HTMLElement>("[data-row-selectable]")].map((r) => r.textContent ?? "");
const has = (name: string) => names().some((n) => n.includes(name));
async function render() {
  await act(async () => root.render(h(I18nProvider, null, h(Sidebar))));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  setUiPref("noOnlineProjects", "expand");
  setUiPref("sidebarLayout", "roster");
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setUiPref("sidebarLayout", "roster");
  setUiPref("noOnlineProjects", "collapse");
});

describe("花名册: unreachable hosts are not listed", () => {
  it("online → 连不上: the host's cached rows leave the 花名册; back online they return", async () => {
    reach("connected");
    await render();
    expect(has("Zeta")).toBe(true);
    expect(has("Lumen")).toBe(true);
    await act(async () => reach("unreachable"));
    expect(has("Zeta")).toBe(false);
    expect(has("Yarrow")).toBe(false);
    expect(container.querySelector('[data-group-key*="alpha"]')).toBeNull();
    expect(has("Lumen")).toBe(true);
    await act(async () => reach("connected"));
    expect(has("Zeta")).toBe(true);
  });

  it("switched off (关闭): the same", async () => {
    reach("connected");
    await render();
    await act(async () => reach("off"));
    expect(has("Zeta")).toBe(false);
    expect(has("Lumen")).toBe(true);
  });

  it("现在·全部 keeps an unreachable host's last rows (unchanged)", async () => {
    setUiPref("sidebarLayout", "now-all");
    reach("connected");
    await render();
    await act(async () => reach("unreachable"));
    expect(has("Zeta")).toBe(true);
  });
});
