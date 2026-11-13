// @vitest-environment jsdom
// Owner 2026-11-12: places that name an agent or a project show its avatar / icon and open it on click
// (components/Parties Who + ProjectRef). On a page outside a conversation (审批) they resolve on the record's host:
// an agent of another host shows `@host` and opens there; an unknown agent / project is plain text, not a link.
import { act, createElement as h, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ openAgent: [] as [string, string][], select: [] as [string, string | undefined][], openPage: [] as [string, unknown][] }));

vi.mock("../src/renderer/src/i18n", async (original) => ({
  ...(await original<object>()), useI18n: () => ({ t: (key: string, vars?: Record<string, string>) => (key === "titlebar.openProject" ? `open ${vars?.name}` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
vi.mock("../src/renderer/src/lib/portraitPacks", () => ({ usePortraitPacks: () => ({ index: null }), portraitRefOf: () => null, portraitFor: () => null, usePortraitImage: () => null }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const useApp = create(() => ({
    sidebar: null as unknown, byHost: {} as Record<string, { sidebar: unknown }>, hosts: { active: "local", hosts: [{ id: "local", label: "EVA" }, { id: "remote", label: "Remote" }] },
    pinned: new Set<string>(), selectedId: null as string | null,
    select: async (id: string, host?: string) => void calls.select.push([id, host]),
    openAgent: async (id: string, host: string) => void calls.openAgent.push([id, host]),
  }));
  type S = ReturnType<typeof useApp.getState>;
  return {
    useApp, featuresOf: () => new Set(), pinnedOn: () => new Set(),
    sidebarOf: (s: S, hostId: string | null | undefined) => (!hostId || hostId === s.hosts.active ? s.sidebar : (s.byHost[hostId]?.sidebar ?? null)),
  };
});
vi.mock("../src/renderer/src/lib/conversationScope", async () => {
  const { useApp } = await import("../src/renderer/src/store");
  return {
    useConvScope: () => null, useConvHost: () => "local", convFeaturesOf: () => new Set(),
    convSidebarOf: (_scope: unknown, s: { sidebar: unknown }) => s.sidebar,
    convHostOf: () => "local",
    useConvSidebar: () => useApp((s) => s.sidebar),
  };
});
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: { openPage: (id: string, params: unknown) => void calls.openPage.push([id, params]) } } }));
vi.mock("../src/renderer/src/lib/projectIconSync", () => ({ useProjectIcons: () => ({}) }));

import { useApp } from "../src/renderer/src/store";
import { ProjectRef, Who } from "../src/renderer/src/components/Parties";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, runtime: { status: "online" } });
const sidebar = (rows: ReturnType<typeof row>[], projects: { id: string; name: string }[] = []) => ({
  active: rows, retired: [], hostRows: Object.fromEntries(rows.map((r) => [r.cutexSessionId, { projectId: null }])),
  projects: { projects: projects.map((p) => ({ project_id: p.id, presentation: { display_name: p.name, badge_label: p.name.slice(0, 2), color: "#5e89dd" } })) },
});

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  calls.openAgent.length = 0; calls.select.length = 0; calls.openPage.length = 0;
  useApp.setState({
    sidebar: sidebar([row("cutex.alden", "Alden")], [{ id: "desktop", name: "cutex-desktop" }]) as never,
    byHost: { remote: { sidebar: sidebar([row("cutex.kai", "Kai")], [{ id: "waveline", name: "Waveline" }]) } } as never,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (el: ReactElement) => act(() => root.render(el));
const link = () => host.querySelector<HTMLElement>("[role=link]");

describe("Who on a given host", () => {
  it("resolves on that host, shows its avatar and opens it there", () => {
    render(h(Who, { id: "cutex.alden", name: "old name", hostId: "local" }));
    expect(host.querySelector("[data-who] .truncate")?.textContent).toBe("Alden");
    expect(host.querySelector("[data-who-host]")).toBeNull();
    expect(link()?.getAttribute("title")).toBe("Alden\ncutex.alden");
    act(() => link()!.click());
    expect(calls.openAgent).toEqual([["cutex.alden", "local"]]);
    expect(calls.select).toEqual([]);
  });

  it("another host's agent shows @host muted and opens on that host; Enter works too", () => {
    render(h(Who, { id: "cutex.kai", name: null, hostId: "remote" }));
    expect(host.querySelector("[data-who-host]")?.textContent).toBe("@Remote");
    expect(link()?.tabIndex).toBe(0);
    act(() => link()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(calls.openAgent).toEqual([["cutex.kai", "remote"]]);
  });

  it("an agent that host does not hold is its name, no link", () => {
    render(h(Who, { id: "cutex.alden", name: "Alden", hostId: "remote" }));
    expect(link()).toBeNull();
    expect(host.querySelector("[data-who] .truncate")?.textContent).toBe("Alden");
    expect(host.querySelector("[data-who-host]")?.textContent).toBe("@Remote");
    render(h(Who, { id: "cutex.gone", name: "Gone", hostId: "local" }));
    expect(link()).toBeNull();
    expect(host.querySelector("[data-who] .truncate")?.textContent).toBe("Gone");
    expect(host.querySelector("[data-who]")?.getAttribute("title")).toBe("Gone\ncutex.gone");
  });

  it("without a host it keeps the conversation behaviour", () => {
    render(h(Who, { id: "cutex.alden", name: null }));
    act(() => link()!.click());
    expect(calls.select).toEqual([["cutex.alden", "local"]]);
  });
});

describe("ProjectRef", () => {
  it("shows the project's icon and name, opens its project page", () => {
    render(h(ProjectRef, { hostId: "local", projectId: "desktop" }));
    expect(host.textContent).toContain("cutex-desktop");
    expect(host.querySelector("[data-project-badge]")).not.toBeNull();
    expect(link()?.getAttribute("aria-label")).toBe("open cutex-desktop");
    expect(link()?.getAttribute("title")).toBe("cutex-desktop\ndesktop");
    act(() => link()!.click());
    expect(calls.openPage).toEqual([["projects.page", { project: "desktop" }]]);
  });

  it("another host's project opens with that host and shows @host", () => {
    render(h(ProjectRef, { hostId: "remote", projectId: "waveline" }));
    expect(host.textContent).toContain("@Remote");
    act(() => link()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(calls.openPage).toEqual([["projects.page", { project: "waveline", host: "remote" }]]);
  });

  it("an unknown project is its name with a neutral icon, no link", () => {
    render(h(ProjectRef, { hostId: "local", projectId: "gone", name: "Old project" }));
    expect(link()).toBeNull();
    expect(host.textContent).toBe("Old project");
    expect(host.querySelector("[data-project-badge]")).toBeNull();
    expect(host.querySelector("svg")).not.toBeNull();
  });
});
