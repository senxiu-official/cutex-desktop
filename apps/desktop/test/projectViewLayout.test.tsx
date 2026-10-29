// @vitest-environment jsdom
// Project 视图's layout (owner 2026-10-21: a project with one agent showed a large gap between the
// Director's card and 最近动态): the agents part is sized to its content and the activity list takes the rest;
// owner 2026-10-28 (a long 项目交接 + agents left 动态 one row): 项目交接 and the agents share one scroll
// region and 动态 keeps at least half the view (≤ 20rem); empty states for a Director-only / empty project, no
// activity yet and a filter that hides every row.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
const data = { current: null as unknown };
vi.mock("../src/renderer/src/modules/project-view/data", () => ({ useProjectData: () => data.current }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ProjectViewPanel } = await import("../src/renderer/src/modules/project-view/ProjectView");
const { useApp } = await import("../src/renderer/src/store");
type ViewState = import("../src/renderer/src/modules/project-view/model").ViewState;

function member(id: string, name: string) {
  return {
    id,
    name,
    isDirector: id === "dir",
    signal: "idle",
    online: true,
    lastActivity: Date.now() - 60_000,
    hostId: "local",
    row: { id, initial: name[0], color: "blue", session: { avatar: null, cutexSessionId: id, runtime: { activeTurnId: null } } },
    needs: undefined,
    signalText: null,
    preview: null,
    since: null,
    plan: null,
    goal: null,
    error: null,
    load: {},
    dlgIn: [],
    dlgOut: [],
    jobs: [],
    terminals: [],
    subagents: [],
  };
}

function project(opts: { director?: boolean; others?: number; activity?: unknown[] } = {}) {
  const director = opts.director === false ? null : member("dir", "Director");
  const recent = Array.from({ length: opts.others ?? 0 }, (_, i) => member(`a${i}`, `Agent ${i}`));
  const members = [...(director ? [director] : []), ...recent];
  return {
    target: { hostId: "local", projectId: "p1" },
    following: false,
    group: { kind: "project", id: "p1", name: "Alpha", badge: "A", color: "blue", online: [], offline: [] },
    hostLabel: null,
    hostColor: null,
    hostOffline: false,
    members,
    grouped: { director, needsYou: [], running: [], recent, idle: [] },
    counts: { total: members.length, online: members.length, running: 0, needsYou: 0 },
    totals: { delegations: 0, jobs: 0, subagents: 0 },
    activity: opts.activity ?? [],
    nameOf: (_id: string | null, fallback?: string | null) => fallback ?? null,
    choices: [],
  };
}

const state: ViewState = { hostId: "local", projectId: "p1", needsOnly: false, kinds: [], idleOpen: false, evKinds: [], evAgent: null, runOpen: null };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (d: unknown, s: ViewState = state, setState = vi.fn()) => {
  data.current = d;
  act(() => root.render(h(ProjectViewPanel, { state: s, setState })));
  return setState;
};
const q = (testId: string) => host.querySelector(`[data-testid="${testId}"]`);

describe("Project 视图 layout", () => {
  it("with no current or last project shows the existing empty state and project picker", () => {
    render({ ...project(), target: null, group: null, following: true });
    expect(host.textContent).toContain("project-view.empty");
    expect(host.querySelector('button[title="project-view.pick"]')).toBeTruthy();
    expect(q("project-view-upper")).toBeNull();
  });

  it("项目交接 + agents size to their content in one scroll region; 动态 takes the rest, at least half", () => {
    render(project());
    const upper = q("project-view-upper")!;
    const agents = q("project-view-agents")!;
    const activity = q("project-view-activity")!;
    expect(agents.parentElement).toBe(upper);
    expect(upper.className).toContain("flex-[0_1_auto]");
    expect(upper.className).toContain("min-h-0");
    expect(upper.className).toContain("overflow-y-auto");
    // One scroll region up there: the agents part does not scroll or cap itself.
    expect(agents.className).not.toMatch(/overflow|max-h/);
    // 动态 is the upper region's sibling: it grows into the rest and never shrinks below its minimum.
    expect(activity.parentElement).toBe(upper.parentElement);
    expect(activity.className).toContain("flex-1");
    expect(activity.className).toContain("min-h-[min(50%,20rem)]");
    expect(activity.className).not.toContain("min-h-0");
  });

  it("a Director-only project says so under the card; an empty one says it has no agents", () => {
    render(project());
    expect(q("project-view-director")).not.toBeNull();
    expect(q("project-view-agents-empty")?.textContent).toBe("project-view.onlyDirector");
    render(project({ director: false }));
    expect(q("project-view-agents-empty")?.textContent).toBe("project-view.noAgents");
    // No dashed 「没有主管」 card on top of that.
    expect(host.textContent).not.toContain("project-view.noDirector");
    render(project({ others: 2 }));
    expect(q("project-view-agents-empty")).toBeNull();
    expect(host.querySelectorAll('[data-testid="project-view-member"]')).toHaveLength(2);
    render(project({ director: false, others: 1 }));
    expect(host.textContent).toContain("project-view.noDirector");
  });

  it("only 需要你 with nobody waiting: says that, not 「only the Director」", () => {
    render(project(), { ...state, needsOnly: true });
    expect(q("project-view-agents-empty")?.textContent).toBe("project-view.noNeeds");
  });

  it("activity: an explained empty state; a filter that hides everything offers to clear it", () => {
    render(project());
    expect(q("project-view-activity-empty")?.textContent).toContain("project-view.activityEmpty");
    expect(q("project-view-activity-empty")?.textContent).toContain("project-view.activityEmptyHint");
    const item = { id: "x", kind: "delegate", what: "delegate", at: Date.now(), actor: null, actorName: null, to: null, toName: "B", title: "T", open: { kind: "agent", sessionId: "dir" } };
    const setState = render(project({ activity: [item] }), { ...state, kinds: ["publish"] });
    const empty = q("project-view-activity-empty")!;
    expect(empty.textContent).toContain("project-view.activityNone");
    act(() => empty.querySelector("button")!.click());
    expect(setState).toHaveBeenCalledWith({ ...state, kinds: [], needsOnly: false });
  });
});

describe("Project 视图 header: 委托树 button", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useApp.setState({ features: new Set<string>() });
  });

  // A narrow project view (a side Shelf) shows the icon only; from 24rem (Tailwind `@sm`) the label too.
  // Measured with lib/sizeFlags — the header is no CSS size container (guard: settingsCard.test.tsx).
  it("icon only below 24rem of header width, icon and label from 24rem", () => {
    const resize = installResizeObserver();
    useApp.setState({ features: new Set(["delegation-tree-stop-v1"]) });
    render(project());
    const header = q("project-view-header") as HTMLElement;
    const button = header.querySelector<HTMLButtonElement>('button[title="delegations.upgrade.tree.open"]')!;
    expect(button).toBeTruthy();
    expect(header.className).not.toContain("@container");
    act(() => resize(header, 300, 60));
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).toBeTruthy();
    act(() => resize(header, 384, 60));
    expect(button.textContent).toBe("delegations.upgrade.tree.title");
    act(() => resize(header, 383, 60));
    expect(button.textContent).toBe("");
  });

  it("no 委托树 button without the delegation-tree capability", () => {
    render(project());
    expect(q("project-view-header")!.querySelector('button[title="delegations.upgrade.tree.open"]')).toBeNull();
  });
});

/** A fake ResizeObserver; the returned `resize(el, w, h)` delivers a content box to `el`'s observers. */
function installResizeObserver() {
  const observers = new Set<{ cb: ResizeObserverCallback; els: Set<Element>; self: ResizeObserver }>();
  class FakeResizeObserver {
    private entry: { cb: ResizeObserverCallback; els: Set<Element>; self: ResizeObserver };
    constructor(cb: ResizeObserverCallback) {
      this.entry = { cb, els: new Set(), self: this as unknown as ResizeObserver };
      observers.add(this.entry);
    }
    observe(el: Element) {
      this.entry.els.add(el);
    }
    unobserve(el: Element) {
      this.entry.els.delete(el);
    }
    disconnect() {
      observers.delete(this.entry);
    }
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return (el: Element, width: number, height: number) => {
    for (const o of observers) if (o.els.has(el)) o.cb([{ target: el, contentRect: { width, height } } as unknown as ResizeObserverEntry], o.self);
  };
}
