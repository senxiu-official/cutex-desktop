// @vitest-environment jsdom
// Cross-review of 731b5f3c2 (night-review): a history row's delegation link must not re-render on an unrelated
// delegation update, and it must not sit inside the row's expand <button>.
import { act, createElement as h, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawItem } from "../src/renderer/src/lib/timeline";
import type { AskSummary } from "../src/shared/ipc";
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
const { useDelegations, mergeHostRows } = await import("../src/renderer/src/lib/delegationStore");
const { useConvHost } = await import("../src/renderer/src/lib/conversationScope");
const { taskToolRow } = await import("../src/renderer/src/lib/taskRows");
const { TaskToolRow } = await import("../src/renderer/src/components/TaskRows");

const hex = (i: number) => i.toString(16).padStart(32, "0");
const close = (i: number): RawItem => ({ type: "mcpToolCall", server: "cutex", tool: "delegation_close", id: `c-${i}`, status: "completed", arguments: { delegation: `delegation-${hex(i).slice(-6)}`, outcome: "abandoned", note: i % 2 ? "long enough note to make the row expandable, well over eighty characters in total length here" : undefined }, result: { structuredContent: { ok: true } } }) as RawItem;
const summary = (askId: string, title: string, revision = 1): AskSummary => ({ askId, title, targetName: "worker", requester: { kind: "agent", cutexSessionId: "cutex.r" }, target: "cutex.w", execution: "answered", attempts: 0, createdAt: "", updatedAt: "", revision }) as unknown as AskSummary;

let root: Root | undefined;
let box: HTMLDivElement;
let host = "";
function Probe() { host = useConvHost(); return null; }
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; box?.remove(); act(() => useDelegations.setState({ byKey: {} })); });

describe("delegation tool rows", () => {
  it("1000 history rows: an update to an unrelated delegation (another host, or another id) renders none of them", () => {
    let renders = 0;
    const items = Array.from({ length: 1000 }, (_, i) => close(i + 1));
    box = document.createElement("div"); document.body.append(box); root = createRoot(box);
    act(() => root!.render(h("div", null, h(Probe), ...items.map((item) => h(Profiler, { key: item.id, id: item.id, onRender: () => { renders++; } }, h(TaskToolRow, { item, task: taskToolRow(item)! }))))));
    act(() => useDelegations.setState((s) => ({ byKey: mergeHostRows(s.byKey, host, [summary(`ask-${hex(1)}`, "Known one")]) })));
    expect(box.textContent).toContain("Known one → worker");
    renders = 0;
    act(() => useDelegations.setState((s) => ({ byKey: mergeHostRows(s.byKey, "other-host", [summary(`ask-${hex(5000)}`, "elsewhere")]) })));
    act(() => useDelegations.setState((s) => ({ byKey: mergeHostRows(s.byKey, host, [summary(`ask-${hex(7000)}`, "unrelated")]) })));
    expect(renders).toBe(0);
    // The row whose own record changes does update.
    act(() => useDelegations.setState((s) => ({ byKey: mergeHostRows(s.byKey, host, [summary(`ask-${hex(1)}`, "Renamed", 2)]) })));
    expect(renders).toBe(1);
    expect(box.textContent).toContain("Renamed → worker");
  });

  it("the delegation link is beside the expand button, never inside it; Tab reaches the expand button, then the link", () => {
    const item = close(1);
    box = document.createElement("div"); document.body.append(box); root = createRoot(box);
    act(() => root!.render(h("div", null, h(Probe), h(TaskToolRow, { item, task: taskToolRow(item)! }))));
    for (const button of box.querySelectorAll("button")) expect(button.querySelector("a, button, input, select, textarea, [tabindex], [role=link], [role=button]")).toBeNull();
    const link = box.querySelector<HTMLElement>("[data-delegation-row-ref]")!;
    expect(link.closest("button")).toBeNull();
    // Keyboard order: the expand button, then the link (the mouse-only tail is not a Tab stop).
    const stops = [...box.querySelectorAll<HTMLElement>("button, [tabindex]")].filter((n) => n.tabIndex >= 0);
    expect(stops.map((n) => (n.hasAttribute("data-delegation-row-ref") ? "link" : n.tagName))).toEqual(["BUTTON", "link"]);
    const expand = stops[0] as HTMLButtonElement;
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    act(() => expand.click());
    expect(expand.getAttribute("aria-expanded")).toBe("true");
  });
});
