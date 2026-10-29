// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DataTable } from "../src/renderer/src/components/DataTable";

const prefs = vi.hoisted(() => ({ foldedGroups: [] as string[] }));
vi.mock("../src/renderer/src/lib/prefs", () => ({
  useUiPrefs: () => prefs,
  toggleFolded: (key: string) => { prefs.foldedGroups = prefs.foldedGroups.includes(key) ? [] : [key]; },
}));

let root: Root;
let host: HTMLDivElement;
let resize: () => void;
let layout: boolean;
let layoutWidth: number;
let contentTop: number;
const heights = new Map<number, number>();
const rect = (top: number, height: number, width = layoutWidth) => ({ top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON() {} });
const bodyHeight = (el: Element): number => {
  const key = el.getAttribute("data-virtual-item");
  if (key?.startsWith("group:")) return 32;
  if (key) return (heights.get(Number(key.slice(key.lastIndexOf(":") + 1))) ?? 40) +
    [...el.children].reduce((sum, row) => sum + Number(row.getAttribute("data-detail-height") ?? 0), 0);
  return Number.parseFloat((el.firstElementChild?.firstElementChild as HTMLElement | null)?.style.height ?? "0") || 0;
};
const rows = Array.from({ length: 380 }, (_, id) => ({ id }));
const columns = [{ key: "title", header: "Title", cell: (row: { id: number }) => <button data-testid={`row-${row.id}`}>{row.id}</button> }];
const menu = vi.fn();
function mount(virtualize = true, after?: (row: { id: number }) => React.ReactNode) {
  act(() => root.render(<DataTable columns={columns} groups={[{ key: "open", label: "Open", rows }]} rowKey={(row) => String(row.id)} foldPrefix="test" virtualize={virtualize} onRowContextMenu={menu} after={after} />));
}
const scroll = (top: number) => act(() => { host.scrollTop = top; host.dispatchEvent(new Event("scroll")); vi.runOnlyPendingTimers(); });
const button = (id: number) => host.querySelector<HTMLButtonElement>(`[data-testid="row-${id}"]`)!;
// JSDOM does not implement Tab's default action. Check its uncancelled event and the exact
// DOM-adjacent native stop, then emulate only that default focus action (never select by row id).
function tab(expected: HTMLElement, backwards = false) {
  const current = document.activeElement!;
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: backwards, bubbles: true, cancelable: true });
  act(() => current.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  const stops = [...host.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']")];
  const next = stops[stops.indexOf(current as HTMLElement) + (backwards ? -1 : 1)];
  expect(next).toBe(expected);
  act(() => next!.focus());
  expect(document.activeElement).toBe(expected);
}
beforeEach(() => {
  vi.useFakeTimers();
  layout = true;
  layoutWidth = 800;
  contentTop = 124;
  heights.clear();
  prefs.foldedGroups = [];
  menu.mockClear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resize = cb; } observe() {} disconnect() {} });
  host = document.createElement("div");
  host.style.overflowY = "auto";
  Object.defineProperty(host, "clientHeight", { get: () => layout ? 400 : 0 });
  document.body.append(host);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!layout) return rect(0, 0, 0);
    if (this === host) return rect(100, 400);
    if (this.tagName === "TBODY") {
      let top = contentTop - host.scrollTop;
      for (const el of this.parentElement!.children) {
        if (el === this) break;
        if (el.tagName === "TBODY") top += bodyHeight(el);
      }
      return rect(top, bodyHeight(this));
    }
    return rect(100 - host.scrollTop, 424);
  });
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("bounds the initial mount, retains native columns/headings and reaches distant rows via the page scroller", () => {
  const cell = vi.fn(columns[0]!.cell);
  const original = columns[0]!.cell;
  columns[0]!.cell = cell;
  try {
    mount();
    expect(cell.mock.calls.length).toBeLessThan(100);
    expect(host.querySelectorAll("button").length).toBeLessThan(40);
    expect(host.querySelector("colgroup col")).not.toBeNull();
    expect(host.textContent).toContain("Open");
    scroll(10000);
    expect(host.querySelector('[data-testid="row-250"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="row-1"]')).toBeNull();
    expect(host.querySelector('[data-testid="row-0"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="row-379"]')).not.toBeNull();
    expect(host.querySelectorAll("button").length).toBeLessThan(40);
    act(() => host.querySelector('[data-testid="row-250"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    expect(menu).toHaveBeenCalledWith(expect.anything(), rows[250]);
  } finally { columns[0]!.cell = original; }
});

it("remeasures wrapped/expanded rows and responds to collapse/expand", () => {
  mount(true, (row) => row.id === 0 ? <tr><td>Expanded detail</td></tr> : null);
  expect(host.textContent).toContain("Expanded detail");
  expect(host.querySelector('[data-virtual-item="row:open:0"]')!.querySelectorAll("tr")).toHaveLength(2);
  const gapHeight = () => Number.parseFloat((host.querySelector('tbody[aria-hidden="true"] ~ tbody[aria-hidden="true"] td') as HTMLElement).style.height);
  const before = gapHeight();
  heights.set(0, 240);
  act(() => { resize(); vi.runOnlyPendingTimers(); });
  expect(gapHeight()).toBeGreaterThan(before);
  act(() => (host.querySelector('[data-virtual-item="group:open"] tr') as HTMLElement).click());
  mount();
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(host.textContent).toContain("Open");
  act(() => (host.querySelector('[data-virtual-item="group:open"] tr') as HTMLElement).click());
  mount();
  expect(host.querySelectorAll("button").length).toBeGreaterThan(0);
  expect(host.querySelectorAll("button").length).toBeLessThan(40);
});

it("retains the focused row across scrolling and mounts adjacent native Tab stops", () => {
  mount();
  const button = host.querySelector('[data-testid="row-5"]') as HTMLButtonElement;
  act(() => button.focus());
  scroll(10000);
  expect(document.activeElement).toBe(button);
  expect(host.querySelector('[data-testid="row-4"]')).not.toBeNull();
  const next = host.querySelector('[data-testid="row-6"]') as HTMLButtonElement;
  act(() => next.focus());
  expect(host.querySelector('[data-testid="row-7"]')).not.toBeNull();
  expect(host.querySelectorAll("button").length).toBeLessThan(45);
});

it("keeps Tab neighbors across group boundaries", () => {
  act(() => root.render(<DataTable columns={columns} groups={[
    { key: "a", label: "A", rows: rows.slice(0, 190) },
    { key: "b", label: "B", rows: rows.slice(190) },
  ]} rowKey={(row) => String(row.id)} foldPrefix="test" virtualize />));
  scroll(7400);
  act(() => (host.querySelector('[data-testid="row-189"]') as HTMLButtonElement).focus());
  scroll(0);
  expect(host.querySelector('[data-testid="row-190"]')).not.toBeNull();
  act(() => (host.querySelector('[data-testid="row-190"]') as HTMLButtonElement).focus());
  expect(host.querySelector('[data-testid="row-191"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="row-189"]')).not.toBeNull();
});

it("keeps sequential Tab and Shift+Tab DOM stops across a large virtual gap", () => {
  const controls = [{ key: "controls", header: "Controls", cell: (row: { id: number }) => <>
    <button data-testid={`row-${row.id}`}>{row.id}</button><button data-testid={`menu-${row.id}`}>Menu</button>
  </> }];
  act(() => root.render(<DataTable columns={controls} groups={[{ key: "open", label: "Open", rows }]}
    rowKey={(row) => String(row.id)} foldPrefix="test" virtualize />));
  act(() => button(5).focus());
  scroll(10000);
  expect(document.activeElement).toBe(button(5));
  expect(button(10)).toBeNull();
  for (let id = 5; id < 12; id++) {
    tab(host.querySelector<HTMLElement>(`[data-testid="menu-${id}"]`)!);
    tab(button(id + 1));
    expect(button(id + 2)).not.toBeNull();
    expect(host.querySelectorAll("button").length).toBeLessThan(90);
  }
  for (let id = 12; id > 3; id--) {
    tab(host.querySelector<HTMLElement>(`[data-testid="menu-${id - 1}"]`)!, true);
    tab(button(id - 1), true);
    expect(button(id - 2)).not.toBeNull();
  }
});

it("scrolls to the bottom with the final rows inside the viewport, not just pinned", () => {
  mount();
  const total = () => [...host.querySelectorAll("tbody")].reduce((sum, body) => sum + bodyHeight(body), 24);
  scroll(total() - host.clientHeight);
  const last = button(379).closest("tbody")!;
  expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.getBoundingClientRect().bottom);
  expect(last.getBoundingClientRect().top).toBeGreaterThanOrEqual(host.getBoundingClientRect().top);
  expect(button(378)).not.toBeNull();
  expect(button(370)).not.toBeNull();
  expect(button(200)).toBeNull();
  expect(host.querySelectorAll("button").length).toBeLessThan(40);
});

it("settles around an initially restored page scroll without writing its position", () => {
  host.scrollTop = 10000;
  mount();
  act(() => vi.runOnlyPendingTimers());
  expect(host.scrollTop).toBe(10000);
  expect(button(250)).not.toBeNull();
  const body = button(250).closest("tbody")!.getBoundingClientRect();
  expect(body.top).toBeGreaterThanOrEqual(host.getBoundingClientRect().top);
  expect(body.bottom).toBeLessThanOrEqual(host.getBoundingClientRect().bottom);
  expect(host.querySelectorAll("button").length).toBeLessThan(40);
});

it("mounts only endpoints when the table starts below the viewport, then fills its visible range", () => {
  contentTop = 1000;
  mount();
  expect(host.scrollTop).toBe(0);
  expect(host.querySelectorAll("[data-virtual-item]")).toHaveLength(3);
  expect(button(0)).not.toBeNull();
  expect(button(379)).not.toBeNull();
  expect(button(1)).toBeNull();
  scroll(1000);
  expect(button(5)).not.toBeNull();
  expect(host.querySelectorAll("button").length).toBeGreaterThan(10);
  expect(host.querySelectorAll("button").length).toBeLessThan(40);
});

it("remeasures an expanded row after growth, shrink and virtual unmount/remount", () => {
  let detailHeight = 80;
  const after = (row: { id: number }) => row.id === 50 ? <tr data-detail-height={detailHeight}><td><button data-testid="detail">Detail</button></td></tr> : null;
  mount(true, after);
  scroll(2000);
  const body = () => button(50).closest("tbody")!;
  expect(body().getBoundingClientRect().height).toBe(120);
  const before = host.querySelectorAll('tbody[aria-hidden="true"]')[2]!.querySelector<HTMLElement>("td")!.style.height;
  heights.set(50, 140);
  act(() => { resize(); vi.runOnlyPendingTimers(); });
  expect(body().getBoundingClientRect().height).toBe(220);
  expect(host.querySelectorAll('tbody[aria-hidden="true"]')[2]!.querySelector<HTMLElement>("td")!.style.height).not.toBe(before);
  expect(button(51).closest("tbody")!.getBoundingClientRect().top).toBe(body().getBoundingClientRect().bottom);
  scroll(10000);
  expect(button(50)).toBeNull();
  scroll(2000);
  expect(body().getBoundingClientRect().height).toBe(220);
  detailHeight = 20;
  mount(true, after);
  expect(body().getBoundingClientRect().height).toBe(160);
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="detail"]')!.focus());
  scroll(10000);
  expect(document.activeElement?.getAttribute("data-testid")).toBe("detail");
  expect(body().getBoundingClientRect().height).toBe(160);
});

it("invalidates offscreen wrapped-row measurements when a parent render changes table width", () => {
  mount();
  scroll(2000);
  heights.set(50, 140);
  act(() => { resize(); vi.runOnlyPendingTimers(); });
  scroll(10000);
  expect(button(50)).toBeNull();
  // The offscreen row would now lay out at 40px. A parent render can precede RO delivery.
  heights.delete(50);
  layoutWidth = 1000;
  mount();
  const total = [...host.querySelectorAll("tbody")].reduce((sum, body) => sum + bodyHeight(body), 24);
  expect(total).toBe(24 + 32 + 380 * 40);
  expect(host.querySelectorAll("button").length).toBeLessThan(40);
});

it("keeps surviving focused rows and scroll through group collapse/expand and filtering", () => {
  let filtered = rows;
  const render = () => act(() => root.render(<DataTable columns={columns} groups={[
    { key: "a", label: "A", rows: filtered.filter((row) => row.id < 100) },
    { key: "b", label: "B", rows: filtered.filter((row) => row.id >= 100) },
  ]} rowKey={(row) => String(row.id)} foldPrefix="test" virtualize />));
  render();
  scroll(10000);
  const focused = button(250);
  act(() => focused.focus());
  const top = host.scrollTop;
  act(() => (host.querySelector('[data-virtual-item="group:a"] tr') as HTMLElement).click());
  render();
  expect(document.activeElement).toBe(focused);
  expect(host.scrollTop).toBe(top);
  expect(button(0)).toBeNull();
  tab(button(251));
  act(() => (host.querySelector('[data-virtual-item="group:a"] tr') as HTMLElement).click());
  render();
  expect(document.activeElement).toBe(button(251));
  expect(host.scrollTop).toBe(top);
  filtered = rows.filter((row) => row.id >= 20);
  render();
  expect(button(250)).toBe(focused);
  expect(document.activeElement).toBe(button(251));
  expect(host.scrollTop).toBe(top);
  tab(button(250), true);
  expect(host.querySelectorAll("button").length).toBeLessThan(45);
  filtered = filtered.filter((row) => row.id !== 250);
  render();
  expect(button(250)).toBeNull();
  expect(document.activeElement).toBe(document.body);
});

it("keeps hidden production tables bounded until layout returns", () => {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(800);
  layout = false;
  mount();
  expect(host.querySelectorAll("button").length).toBeLessThan(40);
  layout = true;
  act(() => { resize(); vi.runOnlyPendingTimers(); });
  scroll(10000);
  expect(host.querySelector('[data-testid="row-250"]')).not.toBeNull();
});

it("keeps other consumers unvirtualized and falls back only without layout", () => {
  mount(false);
  expect(host.querySelectorAll("button")).toHaveLength(380);
  act(() => root.render(null));
  layout = false;
  mount();
  expect(host.querySelectorAll("button")).toHaveLength(380);
  layout = true;
  act(() => { resize(); vi.runOnlyPendingTimers(); });
  expect(host.querySelectorAll("button").length).toBeLessThan(40);
});
