// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ shared: true }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s }));
vi.mock("../src/renderer/src/lib/shelfSource", () => ({ useShelfLayout: () => ({ pages: [{ shared: fx.shared, cards: [{ tabs: ["pinned"] }] }] }) }));
import { useApp } from "../src/renderer/src/store";
import { contextProject, startProjectContext } from "../src/renderer/src/modules/project-view/context";
import { useFocusedProject, useProjectViewState } from "../src/renderer/src/modules/project-view/data";
import { emptyState } from "../src/renderer/src/modules/project-view/model";
import { sideItemOf, isContextualPane } from "../src/renderer/src/lib/paneKinds";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, stop: () => void;
const sidebar = { active: [], retired: [], hostRows: { a: { projectId: "alpha" }, b: { projectId: "beta" }, solo: {} }, projects: { projects: [{ project_id: "alpha" }, { project_id: "beta" }] } };
beforeEach(() => {
  localStorage.clear(); fx.shared = true;
  useApp.setState({ selectedId: "a", selectedHost: "local", hosts: null, sidebar: sidebar as never, byHost: {} });
  stop = startProjectContext();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { stop(); act(() => root.unmount()); host.remove(); });
function Probe() {
  const state = useProjectViewState("pinned", { ...emptyState(), hostId: "old-host", projectId: "old-project" });
  const focused = useFocusedProject();
  const target = state.projectId ? { hostId: state.hostId, projectId: state.projectId } : focused;
  return h("div", null, target ? `${target.hostId}/${target.projectId}` : "project-view.empty");
}
it("a pinned page renders the context project directly and follows focus changes", () => {
  act(() => root.render(h(Probe)));
  expect(host.textContent).toBe("local/alpha");
  act(() => useApp.setState({ selectedId: "b" }));
  expect(host.textContent).toBe("local/beta");
  act(() => useApp.setState({ selectedId: "solo" }));
  expect(host.textContent).toBe("local/beta");
});
it("without a current or remembered project the view has no invented default", () => {
  stop(); localStorage.clear();
  useApp.setState({ selectedId: "solo" });
  stop = startProjectContext();
  expect(contextProject(useApp.getState())).toBeNull();
  act(() => root.render(h(Probe)));
  expect(host.textContent).toBe("project-view.empty");
});
it("focus changes keep identical project IDs scoped to their host", () => {
  act(() => root.render(h(Probe)));
  act(() => useApp.setState({ selectedHost: "remote", selectedId: "a", byHost: { remote: { sidebar } } as never }));
  expect(host.textContent).toBe("remote/alpha");
  act(() => useApp.setState({ selectedHost: "local", selectedId: "solo" }));
  expect(host.textContent).toBe("remote/alpha");
});
it("a later mount restores the last valid project and ignores a removed project", () => {
  stop();
  useApp.setState({ selectedId: "solo" });
  stop = startProjectContext();
  expect(contextProject(useApp.getState())).toEqual({ hostId: "local", projectId: "alpha" });
  useApp.setState({ sidebar: { ...sidebar, projects: { projects: [] } } as never });
  expect(contextProject(useApp.getState())).toBeNull();
});
it("explicit unpinned project tabs keep their project", () => {
  fx.shared = false;
  act(() => root.render(h(Probe)));
  expect(host.textContent).toBe("old-host/old-project");
});
it("only unbound pane adapters opt into opening their context automatically", () => {
  const kind = (binding: string) => ({ id: "test.pane", titleKey: "test", binding, instances: "single", parseParams: () => ({}), init: () => ({}), Body: () => null, useTitle: () => ({ title: "test" }), icon: () => null }) as never;
  expect(isContextualPane(sideItemOf(kind("none")))).toBe(true);
  expect(isContextualPane(sideItemOf(kind("host")))).toBe(false);
  expect(isContextualPane(sideItemOf(kind("agent")))).toBe(false);
});
