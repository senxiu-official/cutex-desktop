// @vitest-environment jsdom
// Project 「动态」 in the view (design 022): shown only on hosts with cutex `project-events` (older hosts
// keep the derived 最近动态 untouched); the timeline from the log with live rows; 正在进行 open with few
// items; 停止 is click-twice (design 013, medium risk) and only the second click sends the request;
// 只看需要你 asks cutex for the attention kinds.
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
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.n !== undefined ? `${key}:${vars.n}` : key), locale: "en" }),
}));
const data = { current: null as unknown };
vi.mock("../src/renderer/src/modules/project-view/data", () => ({ useProjectData: () => data.current }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ProjectViewPanel } = await import("../src/renderer/src/modules/project-view/ProjectView");
const { emptyState } = await import("../src/renderer/src/modules/project-view/model");
const S = await import("../src/renderer/src/modules/project-view/streamStore");
const { useApp } = await import("../src/renderer/src/store");
const { ProjectStream } = await import("../src/renderer/src/modules/project-view/ProjectStream");
const { reloadActivityPrefs, useActivityPrefs, setIncludeOwnerTurns } = await import("../src/renderer/src/modules/project-view/activityPrefs");
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
  useActivityPrefs.setState({ includeOwnerTurns: false });
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

describe("Project 「动态」", () => {
  it("older hosts (no project-events) keep the derived list and read nothing", async () => {
    await render();
    expect(q("project-view-activity")).not.toBeNull();
    expect(q("project-stream")).toBeNull();
    expect(daemon.projectEvents).not.toHaveBeenCalled();
    expect(daemon.projectBackground).not.toHaveBeenCalled();
  });

  it("with project-events: the log replaces the derived list; live rows arrive on top", async () => {
    useApp.setState({ features: new Set(["project-events"]) });
    await render();
    expect(q("project-view-activity")).toBeNull();
    expect(q("project-stream")).not.toBeNull();
    // Same split as the derived list (projectViewLayout.test.tsx): a sibling of the upper scroll region with its minimum.
    expect(q("project-stream")!.parentElement).toBe(q("project-view-upper")!.parentElement);
    expect(q("project-stream")!.className).toContain("min-h-[min(50%,20rem)]");
    expect(all("project-stream-row").map((r) => r.getAttribute("data-kind"))).toEqual(["turn.completed", "turn.failed"]);
    expect(daemon.watchProjectEvents).toHaveBeenCalledWith("p1", { after: "pe:20", streamId: "s1", kinds: undefined, sessionId: null });
    act(() => (listeners.get("projectEvents") ?? []).forEach((f) => f({ hostId: "local", epoch: "e", watchId: "w1", kind: "status", status: "live" } as never)));
    act(() => (listeners.get("projectEvents") ?? []).forEach((f) => f({ hostId: "local", epoch: "e", watchId: "w1", kind: "event", event: row(21, "ask.created") } as never)));
    expect(all("project-stream-row")[0]!.getAttribute("data-kind")).toBe("ask.created");
    expect(q("project-stream-live")!.getAttribute("data-live")).toBe("live");
    expect(q("project-stream-foot")!.textContent).toBe("project-view.stream.end");
  });

  it("hides confirmed owner turns by default, restores them only under Turns, and remembers the toggle", async () => {
    useApp.setState({ features: new Set(["project-events"]) });
    daemon.projectEvents!.mockResolvedValue({ ok: true, value: { projectId: "p1", streamId: "s1", cursor: "pe:20", earliestCursor: "pe:1", order: "newestFirst", hasMore: false, events: [row(15, "turn.completed", { turnOrigin: "owner" }), row(14, "turn.interrupted", { turnOrigin: "external" }), row(13, "turn.failed")] } });
    await render();
    expect(all("project-stream-row").map((r) => r.getAttribute("data-kind"))).toEqual(["turn.interrupted", "turn.failed"]);
    expect(q("project-stream-include-owner")).toBeNull();
    const turns = { ...emptyState(), hostId: "local", projectId: "p1", evKinds: ["turn" as const] };
    await render(turns);
    const checkbox = q("project-stream-include-owner") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const reads = queries.length;
    act(() => checkbox.click());
    expect(checkbox.checked).toBe(true);
    expect(all("project-stream-row")).toHaveLength(3);
    expect(queries).toHaveLength(reads); // presentation preference does not restart the host watch
    act(() => { useActivityPrefs.setState({ includeOwnerTurns: false }); reloadActivityPrefs(); });
    expect(checkbox.checked).toBe(true);
    await render(); // All activity stays about autonomous work; preference is retained for Turns.
    expect(all("project-stream-row")).toHaveLength(2);
    await render(turns);
    expect((q("project-stream-include-owner") as HTMLInputElement).checked).toBe(true);
    expect(all("project-stream-row")).toHaveLength(3);
  });

  it("hidden live owner rows do not inflate the new-activity pill; external rows still do", async () => {
    useApp.setState({ features: new Set(["project-events"]) });
    await render();
    const scroller = q("project-stream-list")!;
    scroller.scrollTop = 30;
    act(() => scroller.dispatchEvent(new Event("scroll")));
    const emit = (event: ProjectEvent) => act(() => (listeners.get("projectEvents") ?? []).forEach((f) => f({ hostId: "local", watchId: "w1", kind: "event", event } as never)));
    emit(row(21, "turn.completed", { turnOrigin: "owner" }));
    expect(q("project-stream-new")).toBeNull();
    expect(all("project-stream-row")).toHaveLength(2);
    emit(row(22, "turn.completed", { turnOrigin: "external" }));
    expect(q("project-stream-new")?.textContent).toBe("project-view.stream.new:1");
    expect(all("project-stream-row")).toHaveLength(3);
  });

  it("keeps remote and legacy unknown origins, while hiding a confirmed remote owner turn", async () => {
    const hosts: string[] = [];
    S.setStreamDaemon((id) => { hosts.push(id); return daemon as never; });
    daemon.projectEvents!.mockResolvedValue({ ok: true, value: { projectId: "p1", streamId: "s1", cursor: "pe:20", earliestCursor: "pe:1", order: "newestFirst", hasMore: false, events: [row(15, "turn.completed", { turnOrigin: "owner" }), row(14, "turn.completed", { turnOrigin: "external" }), row(13)] } });
    act(() => root.render(h(ProjectStream, { data: { ...project(), target: { hostId: "ssh-host-b", projectId: "p1" } } as never, state: emptyState(), setState() {}, now: Date.now() })));
    await settle();
    expect(hosts).toContain("ssh-host-b");
    expect(all("project-stream-row")).toHaveLength(2);
  });

  it("explains an owner-only empty view instead of claiming the project never had activity", async () => {
    useApp.setState({ features: new Set(["project-events"]) });
    daemon.projectEvents!.mockResolvedValue({ ok: true, value: { projectId: "p1", streamId: "s1", cursor: "pe:20", earliestCursor: "pe:1", order: "newestFirst", hasMore: false, events: [row(15, "turn.completed", { turnOrigin: "owner" })] } });
    await render();
    expect(host.textContent).toContain("project-view.stream.emptyAutonomous");
    expect(all("project-stream-row")).toHaveLength(0);
  });

  it("bounds auto paging through hidden owner-only pages and leaves a working continue button", async () => {
    useApp.setState({ features: new Set(["project-events"]) });
    let reads = 0;
    daemon.projectEvents!.mockImplementation(async () => {
      const seq = 200 - reads++;
      return { ok: true, value: { projectId: "p1", streamId: "s1", cursor: "pe:200", earliestCursor: "pe:1", order: "newestFirst", hasMore: true, nextCursor: `pe:${seq - 1}`, events: [row(seq, "turn.completed", { turnOrigin: "owner" })] } };
    });
    await render();
    for (let n = 0; n < 15; n++) await settle();
    expect(reads).toBe(11);
    const button = q("project-stream-foot")!.querySelector("button")!;
    expect(button.textContent).toBe("project-view.stream.keepLooking");
    act(() => button.click()); await settle();
    expect(reads).toBe(12);
  });

  it("leaves continue available with one visible row followed by ten hidden pages", async () => {
    useApp.setState({ features: new Set(["project-events"]) });
    let reads = 0;
    daemon.projectEvents!.mockImplementation(async () => {
      const seq = 200 - reads++;
      return { ok: true, value: { projectId: "p1", streamId: "s1", cursor: "pe:200", earliestCursor: "pe:1", order: "newestFirst", hasMore: true, nextCursor: `pe:${seq - 1}`, events: [row(seq, "turn.completed", { turnOrigin: reads === 1 ? "external" : "owner" })] } };
    });
    await render();
    for (let n = 0; n < 15; n++) await settle();
    expect(reads).toBe(11);
    expect(all("project-stream-row")).toHaveLength(1);
    const button = q("project-stream-foot")!.querySelector("button")!;
    expect(button.textContent).toBe("project-view.stream.keepLooking");
    act(() => button.click()); await settle();
    expect(reads).toBe(12);
  });

  it("正在进行: open with few items; 停止 needs a second click; unknown items cannot be stopped", async () => {
    useApp.setState({ features: new Set(["project-events"]) });
    await render();
    expect(q("project-running")!.getAttribute("data-open")).toBe("true");
    expect(all("project-run-item")).toHaveLength(2);
    const stops = all("project-run-stop");
    expect(stops).toHaveLength(1);
    act(() => (stops[0] as HTMLButtonElement).click());
    expect(daemon.stopClaudeTask).not.toHaveBeenCalled();
    expect(q("project-run-stop")!.getAttribute("data-armed")).toBe("true");
    expect(document.body.textContent).toContain("project-view.run.stopArmed");
    act(() => (q("project-run-stop") as HTMLButtonElement).click());
    await settle();
    expect(daemon.stopClaudeTask).toHaveBeenCalledWith("cutex.a", "th-a", "task-1");
    // Stop requested: the next read of the list decides; meanwhile the row says so.
    expect(q("project-run-stopping")).not.toBeNull();
  });

  it("the owner's toggle on 正在进行 goes into the pane state", async () => {
    useApp.setState({ features: new Set(["project-events"]) });
    const setState = await render();
    act(() => (q("project-running")!.querySelector("button") as HTMLButtonElement).click());
    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ runOpen: false }));
  });

  it("只看需要你 asks cutex for the attention kinds and keeps the failed turn only", async () => {
    useApp.setState({ features: new Set(["project-events"]) });
    await render({ ...emptyState(), hostId: "local", projectId: "p1", needsOnly: true });
    expect(queries.at(-1)!.kinds).toEqual(["turn", "ask", "background", "approval", "ownerNotify"]);
    expect(all("project-stream-row").map((r) => r.getAttribute("data-kind"))).toEqual(["turn.failed"]);
  });

  it("a type chip and an agent filter go to cutex as kinds / sessionId", async () => {
    useApp.setState({ features: new Set(["project-events"]) });
    await render({ ...emptyState(), hostId: "local", projectId: "p1", evKinds: ["subagent", "turn"], evAgent: "cutex.a" });
    expect(queries.at(-1)).toMatchObject({ kinds: ["turn", "subagent"], sessionId: "cutex.a" });
  });
});
