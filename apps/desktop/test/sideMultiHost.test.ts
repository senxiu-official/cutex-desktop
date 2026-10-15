import { describe, expect, it, vi } from "vitest";

// An agent of another host opened in place (multi-host P1): selectedHost = "remote", focus = "local".
const state = vi.hoisted(() => ({
  hosts: { active: "local" },
  selectedHost: "remote" as string | null,
  selectedId: "remote-agent",
  sidebar: { hostRows: { "remote-agent": { projectId: "focus-project" } } },
  byHost: { remote: { sidebar: { hostRows: { "remote-agent": { projectId: "remote-project" } } } } },
}));
vi.mock("../src/renderer/src/store", () => ({
  useApp: { getState: () => state },
  agentHost: (s: typeof state) => s.selectedHost ?? s.hosts.active,
  sidebarOf: (s: typeof state, hostId: string) => (hostId === s.hosts.active ? s.sidebar : (s.byHost as Record<string, { sidebar: unknown }>)[hostId]?.sidebar ?? null),
}));
const { bookmarkContext } = await import("../src/renderer/src/modules/bookmarks/context");

describe("bookmark context follows the open agent's host, not the focus host", () => {
  it("captures the other-host agent and its own host's project", () => {
    const ref = { hostId: "remote", kind: "agent", key: "x", title: "x", params: {} };
    expect(bookmarkContext(ref)).toEqual({ sessionId: "remote-agent", projectId: "remote-project", projectExplicit: false });
  });
  it("does not attach the selected agent to a ref of a different host", () => {
    const ref = { hostId: "local", kind: "agent", key: "x", title: "x", params: {} };
    expect(bookmarkContext(ref)).toEqual({ projectExplicit: false });
  });
});
