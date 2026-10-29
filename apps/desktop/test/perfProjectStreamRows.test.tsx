// @vitest-environment jsdom
// Perf audit 2026-10-23: the project view re-renders on every project data change (a sidebar refresh, the minute
// tick) and built a new avatar object for every 「动态」 row, so each row (memo) and its avatar rendered again. Rows
// render again only when what they show changes. Setup as test/projectStreamView.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectBackground, ProjectEvent, ProjectEventsQuery } from "../src/shared/projectEvents";

const listeners = new Map<string, ((payload: never) => void)[]>();
vi.mock("../src/renderer/src/bridge", () => ({
  api: {},
  apiFor: () => ({}),
  bridge: {
    on: (event: string, f: (payload: never) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), f]);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter((g) => g !== f));
    },
  },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
// A stable `t`, like the app's (i18n useCallback on the locale).
const i18n = vi.hoisted(() => ({ t: (key: string) => key, locale: "en" }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({ ...(await importOriginal<object>()), useI18n: () => i18n }));
const avatars = vi.hoisted(() => ({ n: 0 }));
vi.mock("../src/renderer/src/components/Avatar", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/renderer/src/components/Avatar")>();
  // The 「动态」 rows draw theirs at 20 px (正在进行 above them: 16 px, not counted).
  return { ...real, Avatar: (p: Parameters<typeof real.Avatar>[0]) => (p.size === 20 && avatars.n++, real.Avatar(p)) };
});
const data = { current: null as unknown };
vi.mock("../src/renderer/src/modules/project-view/data", () => ({ useProjectData: () => data.current }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ProjectViewPanel } = await import("../src/renderer/src/modules/project-view/ProjectView");
const { emptyState } = await import("../src/renderer/src/modules/project-view/model");
const S = await import("../src/renderer/src/modules/project-view/streamStore");
const { useApp } = await import("../src/renderer/src/store");
type ViewState = import("../src/renderer/src/modules/project-view/model").ViewState;

const row = (seq: number, kind = "turn.completed", extra: Partial<ProjectEvent> = {}): ProjectEvent => ({
  cursor: `pe:${seq}`,
  at: new Date().toISOString(),
  projectId: "p1",
  cutexSessionId: "cutex.a",
  agentName: "alpha",
  kind,
  status: null,
  title: `title ${seq}`,
  detail: null,
  parent: { turnId: `t${seq}`, taskId: null, threadId: null },
  refs: { askId: null, jobId: null, artifactId: null, workflowRunId: null, approvalId: null, notificationId: null },
  source: { method: null, eventCursor: null },
  ...extra,
});

const background: ProjectBackground = {
  projectId: "p1",
  generatedAt: "",
  jobsAvailable: true,
  agents: [
    {
      cutexSessionId: "cutex.a",
      agentName: "alpha",
      backend: "claude",
      runtime: "online",
      complete: true,
      items: [
        { kind: "subagent", source: "claude", id: "task-1", title: "Review the diff", detail: null, turnId: "t1", threadId: "th-a", startedAt: new Date(Date.now() - 60_000).toISOString(), state: "running", stop: { kind: "native", cutexSessionId: "cutex.a", method: "claude/tasks/stop", params: { threadId: "th-a", taskId: "task-1" } } },
        { kind: "subagent", source: "claude", id: "task-2", title: "Old task", detail: null, turnId: null, threadId: "th-a", startedAt: null, state: "unknown", stop: null },
      ],
    },
  ],
};

let queries: ProjectEventsQuery[];
let daemon: Record<string, ReturnType<typeof vi.fn>>;

function project() {
  return {
    target: { hostId: "local", projectId: "p1" },
    following: false,
    group: { kind: "project", id: "p1", name: "Alpha", badge: "A", color: "blue", online: [], offline: [] },
    hostLabel: null,
    hostColor: null,
    hostOffline: false,
    members: [],
    grouped: { director: null, needsYou: [], running: [], recent: [], idle: [] },
    counts: { total: 0, online: 0, running: 0, needsYou: 0 },
    totals: { delegations: 0, jobs: 0, subagents: 0 },
    activity: [],
    nameOf: (_id: string | null, fallback?: string | null) => fallback ?? null,
    choices: [],
  };
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  S.resetProjectStreams();
  listeners.clear();
  queries = [];
  daemon = {
    projectEvents: vi.fn(async (_p: string, q: ProjectEventsQuery) => {
      queries.push(q);
      return { ok: true, value: { projectId: "p1", streamId: "s1", cursor: "pe:20", earliestCursor: "pe:1", order: "newestFirst", hasMore: false, events: [row(12), row(11, "turn.failed", { detail: "boom" })] } };
    }),
    watchProjectEvents: vi.fn(async () => "w1"),
    unwatchProjectEvents: vi.fn(async () => undefined),
    projectBackground: vi.fn(async () => ({ ok: true, value: background })),
    stopClaudeTask: vi.fn(async () => undefined),
  };
  S.setStreamDaemon(() => daemon as never);
  useApp.setState({ features: new Set() });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  S.setStreamDaemon(null);
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => await Promise.resolve());
};
const render = async (s: ViewState = { ...emptyState(), hostId: "local", projectId: "p1" }, setState = vi.fn()) => {
  data.current = project();
  act(() => root.render(h(ProjectViewPanel, { state: s, setState })));
  await settle();
  return setState;
};
const q = (testId: string) => host.querySelector(`[data-testid="${testId}"]`);
const all = (testId: string) => [...host.querySelectorAll(`[data-testid="${testId}"]`)];

const member = () => ({ id: "cutex.a", name: "alpha", row: { initial: "A", color: "blue", session: { avatar: null, cutexSessionId: "cutex.a" } } });

describe("「动态」 rows (perf audit 2026-10-23)", () => {
  it("project data derived again with the same content: no row renders again", async () => {
    useApp.setState({ features: new Set(["project-events"]) });
    const s = { ...emptyState(), hostId: "local", projectId: "p1" };
    data.current = { ...project(), members: [member()] };
    act(() => root.render(h(ProjectViewPanel, { state: s, setState: vi.fn() })));
    await settle();
    expect(all("project-stream-row").length).toBeGreaterThan(0);
    const before = avatars.n;
    expect(before).toBeGreaterThan(0);
    // A sidebar refresh: new member objects, the same content.
    for (let i = 0; i < 3; i++) {
      data.current = { ...project(), members: [member()] };
      act(() => root.render(h(ProjectViewPanel, { state: { ...s }, setState: vi.fn() })));
      await settle();
    }
    expect(avatars.n).toBe(before);
    // Its name changes: that row renders again.
    data.current = { ...project(), members: [{ ...member(), name: "alpha 2" }] };
    act(() => root.render(h(ProjectViewPanel, { state: { ...s }, setState: vi.fn() })));
    await settle();
    expect(avatars.n).toBeGreaterThan(before);
  });
});
