// @vitest-environment jsdom
// One folding rule for work groups (owner 2026-11-14, with a screenshot: a group's old failed row 「列出 Maid · 失败」
// came back whenever the agent ran a new command, and went away again when it stopped). A group is folded unless the
// owner opened it — finished or running, failed or not; failures show only as the header's 「· N 失败」; a running
// group shows only its live step on the header line; a new step never opens or closes it; a reload starts folded.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, v?: Record<string, unknown>) => (v ? `${key}:${JSON.stringify(v)}` : key) }) }));
vi.mock("../src/renderer/src/store", () => {
  const state = { selectedId: "s1", sessions: {}, backgroundItems: {} };
  const useApp = Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state, subscribe: () => () => {} });
  return { useApp, agentState: () => undefined, selectedSidebar: () => null, sidebarOf: () => null, featuresOf: () => new Set(), agentHost: () => "local", viewHostIn: () => "local", viewOf: () => undefined };
});
vi.mock("../src/renderer/src/lib/ownerNotifyStore", () => ({ useHostOwnerNotes: () => [] }));
vi.mock("../src/renderer/src/modules/TimelineOutlet", async () => {
  const { PlainToolRow } = await import("../src/renderer/src/components/PlainToolRow");
  const { createElement } = await import("react");
  return { ToolOutlet: ({ item }: { item: unknown }) => createElement(PlainToolRow, { item } as never) };
});

const { WorkGroup } = await import("../src/renderer/src/components/WorkGroup");
const { summarize } = await import("../src/renderer/src/lib/workGroups");
type StepEntry = import("../src/renderer/src/lib/workGroups").StepEntry;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cmd = (id: string, status: string, exitCode: number | null = status === "completed" ? 0 : status === "failed" ? 1 : null): StepEntry =>
  ({ kind: "tool", id, turnId: "t1", item: { id, type: "commandExecution", command: id, status, exitCode, aggregatedOutput: `${id} output` } }) as unknown as StepEntry;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
/** `open` = the group may still grow (Timeline's segment flag); the key stays the first step's, as in Timeline. */
const render = (steps: StepEntry[], open: boolean) => act(() => root.render(h(WorkGroup, { key: `work:${steps[0]!.id}`, steps, open, summary: summarize(steps), sessionId: "s1" })));
const rows = () => [...host.querySelectorAll("[data-tool-row]")];
const header = () => host.querySelector("button")!;
const failedRowShown = () => host.textContent!.includes("list-maid output") || rows().some((r) => r.textContent!.includes("list-maid"));

describe("work group folding: one rule", () => {
  const before = [cmd("ls", "completed"), cmd("list-maid", "failed"), cmd("cat", "completed")];

  it("finished with a failure: folded, the failure only as the header's red count", () => {
    for (const steps of [before, [...before.slice(0, 2)], [cmd("ok", "completed"), cmd("list-maid", "failed")]]) {
      render(steps, false);
      expect(rows()).toHaveLength(0);
      expect(failedRowShown()).toBe(false);
      expect(header().textContent).toContain('work.failed:{"n":1}');
      expect(header().querySelector(".text-danger, [class*='text-danger']")).not.toBeNull();
    }
    // Clicking the header opens it, failed row included.
    act(() => header().click());
    expect(rows()).toHaveLength(2);
    expect(failedRowShown()).toBe(true);
  });

  it("a new command in the same group: old rows stay folded, only the live step shows (on the header)", () => {
    render(before, false);
    expect(rows()).toHaveLength(0);
    render([...before, cmd("cargo-test", "inProgress")], true);
    expect(rows()).toHaveLength(0);
    expect(failedRowShown()).toBe(false);
    expect(header().querySelector(".animate-spin")).not.toBeNull();
    expect(host.querySelector("[data-work-current]")!.textContent).toBe("· cargo-test");
    // The command ends and another starts: still folded.
    render([...before, cmd("cargo-test", "completed"), cmd("git-status", "inProgress")], true);
    expect(rows()).toHaveLength(0);
    expect(host.querySelector("[data-work-current]")!.textContent).toBe("· git-status");
    // Done: folded, no live step.
    render([...before, cmd("cargo-test", "completed"), cmd("git-status", "completed")], false);
    expect(rows()).toHaveLength(0);
    expect(host.querySelector("[data-work-current]")).toBeNull();
  });

  it("a manual expand survives new commands; a manual collapse too", () => {
    render(before, false);
    act(() => header().click());
    expect(rows()).toHaveLength(3);
    render([...before, cmd("cargo-test", "inProgress")], true);
    expect(rows()).toHaveLength(4);
    render([...before, cmd("cargo-test", "failed"), cmd("retry", "inProgress")], true);
    expect(rows()).toHaveLength(5);
    render([...before, cmd("cargo-test", "failed"), cmd("retry", "completed")], false);
    expect(rows()).toHaveLength(5);
    act(() => header().click());
    expect(rows()).toHaveLength(0);
    render([...before, cmd("cargo-test", "failed"), cmd("retry", "completed"), cmd("more", "inProgress")], true);
    expect(rows()).toHaveLength(0);
  });

  it("after a reload (a fresh mount) the group starts folded, even one the owner had opened", () => {
    render(before, false);
    act(() => header().click());
    expect(rows()).toHaveLength(3);
    act(() => root.unmount());
    root = createRoot(host);
    render(before, false);
    expect(rows()).toHaveLength(0);
    expect(failedRowShown()).toBe(false);
  });
});
