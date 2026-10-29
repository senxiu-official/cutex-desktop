// What a click on an agent does (lib/workspaceEffects agentPlan, docs/design/008-foretell.md + 001 / 002): the
// pure plan the hover preview and the click both come from — on screen = focus it (a strip: expand), nothing on
// screen = the empty workspace takes it, 替换 = the focused one, 并排 = a second one on the right (two on screen:
// the other one), a minimised one beside a single workspace comes back on its side, 投影 = the focused one's Shelf.
import { describe, expect, it, vi } from "vitest";
import { agentPlan } from "../src/renderer/src/lib/workspaceEffects";
import type { WsScreen } from "../src/renderer/src/lib/workspaces";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const ref = { hostId: "local", key: "X" };
const one: WsScreen = { panes: [{ paneId: "main", hostId: "local", sessionId: "A" }], focused: "main" };
const two: WsScreen = {
  panes: [
    { paneId: "main", hostId: "local", sessionId: "A" },
    { paneId: "p2", hostId: "local", sessionId: "B" },
  ],
  focused: "p2",
};
const empty: WsScreen = { panes: [{ paneId: "main", hostId: "local", sessionId: null }], focused: "main" };
const none = { strips: [] as string[], open: null };

describe("agentPlan", () => {
  it("on screen: focus the workspace showing it (any mode)", () => {
    const shown = { ...two, panes: [...two.panes.slice(0, 1), { paneId: "p2", hostId: "local", sessionId: "X" }], focused: "main" };
    expect(agentPlan(ref, "replace", shown, none)).toEqual({ kind: "focus", paneId: "p2", strip: false });
    expect(agentPlan(ref, "beside", shown, none)).toEqual({ kind: "focus", paneId: "p2", strip: false });
    // Same session id on another host: not this agent.
    expect(agentPlan({ hostId: "ssh-b", key: "A" }, "replace", one, none).kind).not.toBe("focus");
  });

  it("on screen as a strip: focus = expand the strip", () => {
    const shown: WsScreen = { panes: [{ paneId: "main", hostId: "local", sessionId: "X" }, two.panes[1]!], focused: "p2" };
    expect(agentPlan(ref, "replace", shown, { strips: ["main"], open: null })).toEqual({ kind: "focus", paneId: "main", strip: true });
  });

  it("nothing on screen: the empty workspace takes it (whatever the mode)", () => {
    expect(agentPlan(ref, "replace", empty, none)).toEqual({ kind: "open", paneId: "main" });
    expect(agentPlan(ref, "beside", empty, none)).toEqual({ kind: "open", paneId: "main" });
    expect(agentPlan(ref, "project", empty, none)).toEqual({ kind: "open", paneId: "main" });
    expect(agentPlan(ref, "replace", { panes: [], focused: null }, none)).toEqual({ kind: "open", paneId: null });
  });

  it("替换: the focused workspace shows it (the one it shows leaves)", () => {
    expect(agentPlan(ref, "replace", one, none)).toEqual({ kind: "replace", paneId: "main", from: { hostId: "local", sessionId: "A" } });
    // Design 039: with two workspaces on screen a plain click goes to the agent's own workspace (below), it replaces no column.
    expect(agentPlan(ref, "replace", two, none)).toMatchObject({ kind: "switch" });
    // The focus on a pane without an agent: the first one that has one.
    expect(agentPlan(ref, "replace", { ...one, focused: "gone" }, none)).toEqual({ kind: "replace", paneId: "main", from: { hostId: "local", sessionId: "A" } });
  });

  it("并排 with one workspace: a second one on the right (a minimised one: on its side)", () => {
    expect(agentPlan(ref, "beside", one, none)).toEqual({ kind: "beside", side: "right", restore: false });
    expect(agentPlan(ref, "beside", one, { strips: [], open: { side: "left" } })).toEqual({ kind: "beside", side: "left", restore: false });
    expect(agentPlan(ref, "beside", one, { strips: [], open: {} })).toEqual({ kind: "beside", side: "right", restore: false });
  });

  it("并排 with every column taken (design 039): the owner picks which one it replaces; a setting of 3 columns still adds one", () => {
    expect(agentPlan(ref, "beside", two, none)).toEqual({ kind: "pick", panes: ["main", "p2"] });
    expect(agentPlan(ref, "beside", { ...two, focused: "main" }, none)).toEqual({ kind: "pick", panes: ["main", "p2"] });
    expect(agentPlan(ref, "beside", two, { ...none, max: 3 })).toEqual({ kind: "beside", side: "right", restore: false });
  });

  it("替换 (design 039): a plain click goes to the agent's own workspace — all its members — and the one on screen stays whole", () => {
    const D = { hostId: "local", sessionId: "D" };
    const X = { hostId: "local", sessionId: "X" };
    // X has a remembered workspace X+D: both columns come, A+B stays in the tray.
    expect(agentPlan(ref, "replace", two, { ...none, set: [X, D] })).toEqual({ kind: "switch", members: [X, D], from: [{ hostId: "local", sessionId: "A" }, { hostId: "local", sessionId: "B" }] });
    expect(agentPlan(ref, "replace", one, { ...none, set: [X, D] })).toMatchObject({ kind: "switch", members: [X, D] });
    // No workspace of its own: just X (with two on screen: A+B leave together, none is replaced).
    expect(agentPlan(ref, "replace", two, none)).toMatchObject({ kind: "switch", members: [X] });
    // One column and nothing remembered: the column shows it (as before).
    expect(agentPlan(ref, "replace", one, none)).toMatchObject({ kind: "replace", paneId: "main" });
  });

  it("minimised from a side, one workspace on screen: a plain click brings it back on that side", () => {
    expect(agentPlan(ref, "replace", one, { strips: [], open: { side: "left" } })).toEqual({ kind: "beside", side: "left", restore: true });
    expect(agentPlan(ref, "replace", one, { strips: [], open: { side: "right" } })).toEqual({ kind: "beside", side: "right", restore: true });
    // A replaced one (open, no side): replace as usual.
    expect(agentPlan(ref, "replace", one, { strips: [], open: {} })).toEqual({ kind: "replace", paneId: "main", from: { hostId: "local", sessionId: "A" } });
    // Two on screen: no room to come back beside — its own workspace takes the screen.
    expect(agentPlan(ref, "replace", two, { strips: [], open: { side: "left" } })).toMatchObject({ kind: "switch" });
  });

  it("投影: into the focused workspace's Shelf", () => {
    expect(agentPlan(ref, "project", one, none)).toEqual({ kind: "project", paneId: "main" });
    expect(agentPlan(ref, "project", two, none)).toEqual({ kind: "project", paneId: "p2" });
  });
});
