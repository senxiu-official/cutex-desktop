// @vitest-environment jsdom
// Rows keep one height from their first render to their last (owner 2026-10-24: while an agent edited files, rows in
// the middle of the conversation jumped — a running Edit showed ~5 lines of its diff, then collapsed to one when done;
// an open work group showed its newest steps, then folded to one line when the next message came). A tool row is one
// line running or done (the live state inline: spinner, +/- counts, a command's newest output line); a work group is
// one summary line open or closed (spinner and current step while it runs). Measured before / after in the mock
// preview: .claude/previews/conv-row-shift/NOTE.md.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
  const { createElement: h } = await import("react");
  return { ToolOutlet: ({ item }: { item: unknown }) => h(PlainToolRow, { item } as never) };
});

import { PlainToolRow } from "../src/renderer/src/components/PlainToolRow";
import { WorkGroup } from "../src/renderer/src/components/WorkGroup";
import { diffCounts, summarize, type StepEntry, type ToolEntry } from "../src/renderer/src/lib/workGroups";
import type { RawItem } from "../src/renderer/src/lib/timeline";

const dom = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild as HTMLElement;
};
/** The row's block lines: its element children (a second one = a second line under the row). */
const lines = (el: HTMLElement) => [...el.children].map((c) => c.tagName + (c.getAttribute("class") ?? "").split(" ").slice(0, 2).join("."));

const diff = "@@ -10,4 +10,5 @@\n   const row = useRow(id);\n-  return <div className=\"my-0.5 flex items-center gap-1.5 text-xs text-muted\">{row.label}</div>;\n+  // a long added line that wraps in a narrow column and used to show under the running row\n+  return <div className=\"my-0.5 flex min-h-5 items-center\">{row.label}</div>;\n+  const unused = 1;";
const edit = (status: string): RawItem => ({ type: "fileChange", id: "f1", status, changes: [{ path: "src/Row.tsx", kind: { type: "update" }, diff }] }) as RawItem;
const command = (status: string, out: string): RawItem => ({ type: "commandExecution", id: "c1", command: "npx vitest run", status, aggregatedOutput: out, ...(status === "completed" ? { exitCode: 0, durationMs: 900 } : {}) }) as RawItem;
const row = (item: RawItem) => dom(renderToStaticMarkup(createElement(PlainToolRow, { item })));

describe("a tool row is one line running or done", () => {
  it("a running Edit shows no diff preview: one line with the spinner, the file and its +/- counts — the same line once done", () => {
    const running = row(edit("inProgress"));
    const done = row(edit("completed"));
    expect(running.querySelector("pre")).toBeNull();
    expect(running.querySelector(".animate-spin")).not.toBeNull();
    expect(lines(running)).toEqual(lines(done));
    expect(lines(running)).toHaveLength(1);
    expect(running.querySelector("[data-tool-counts]")!.textContent).toBe("+3 −1");
    expect(done.querySelector("[data-tool-counts]")!.textContent).toBe("+3 −1");
    expect(diffCounts(edit("completed"))).toEqual({ added: 3, removed: 1 });
  });

  it("a running command shows its newest output line inline (not 3 lines under it); done, the line stays one", () => {
    const running = row(command("inProgress", " ✓ case 0\n ✓ case 1\n ✓ case 2\n"));
    expect(running.querySelector("pre")).toBeNull();
    expect(running.querySelector("[data-tool-live]")!.textContent).toBe("· ✓ case 2");
    const done = row(command("completed", " ✓ case 0\n ✓ case 1\n ✓ case 2\n ✓ case 3\n"));
    expect(done.querySelector("[data-tool-live]")).toBeNull();
    expect(lines(running)).toEqual(lines(done));
    expect(lines(done)).toHaveLength(1);
  });

  it("no diff to count (a change reported by path only): no counts", () => {
    const bare = row({ type: "fileChange", id: "f2", status: "completed", changes: [{ path: "a.ts" }] } as RawItem);
    expect(bare.querySelector("[data-tool-counts]")).toBeNull();
    expect(diffCounts(command("completed", ""))).toBeNull();
  });
});

describe("a work group is one summary line open or closed", () => {
  const tool = (item: RawItem, n: number): ToolEntry => ({ kind: "tool", id: `${item.id}-${n}`, turnId: "t1", item: { ...item, id: `${item.id}-${n}` } }) as unknown as ToolEntry;
  const group = (steps: StepEntry[], open: boolean) =>
    dom(renderToStaticMarkup(createElement(WorkGroup, { steps, open, summary: summarize(steps as ToolEntry[]), sessionId: "s1" })));

  it("open and running: the summary line with the spinner and the current step, no step rows; closed: the same line", () => {
    const done = [1, 2, 3].map((n) => tool(edit("completed"), n));
    const live = group([...done, tool(command("inProgress", "building…"), 4)], true);
    expect(live.querySelectorAll("[data-tool-row]")).toHaveLength(0);
    expect(live.querySelector(".animate-spin")).not.toBeNull();
    expect(live.querySelector("[data-work-current]")!.textContent).toBe("· npx vitest run");
    const closed = group([...done, tool(command("completed", "ok"), 4)], false);
    expect(closed.querySelectorAll("[data-tool-row]")).toHaveLength(0);
    expect(closed.querySelector("[data-work-current]")).toBeNull();
    expect(lines(live)).toEqual(lines(closed));
    expect(lines(closed)).toHaveLength(1);
  });

  it("open but its newest step done (waiting for the next): no spinner, still one line", () => {
    const g = group([1, 2].map((n) => tool(edit("completed"), n)), true);
    expect(g.querySelector(".animate-spin")).toBeNull();
    expect(lines(g)).toHaveLength(1);
  });

  it("a failed step stays visible under the line, open or closed alike", () => {
    const failed = { ...command("failed", "boom"), exitCode: 1 } as RawItem;
    const steps = [tool(edit("completed"), 1), tool(failed, 2), tool(edit("completed"), 3)];
    const open = group(steps, true);
    const closed = group(steps, false);
    expect(open.querySelectorAll("[data-tool-row]")).toHaveLength(1);
    expect(lines(open)).toEqual(lines(closed));
  });
});
