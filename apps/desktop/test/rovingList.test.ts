// @vitest-environment jsdom
// The sidebar's keyboard model (lib/rovingList, owner 2026-11-10): one Tab stop for the list, ↑ / ↓ / Home / End
// between rows and fold headers, → unfolds, ← folds (on a row: back to its header), typing untouched, mouse untouched.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyRoving, bindRovingList, rovingItems } from "../src/renderer/src/lib/rovingList";

let nav: HTMLElement;
let unbind: () => void;
const opened: string[] = [];

/** nav > section(header > toggle, body > rows + 离线 fold) × 2, like components/Sidebar's LaidOutProject. */
function project(id: string, rows: string[], selected?: string) {
  const section = document.createElement("section");
  section.dataset.rosterKind = "project";
  const header = document.createElement("div");
  const toggle = document.createElement("button");
  toggle.id = `h-${id}`;
  toggle.setAttribute("aria-expanded", "true");
  const view = document.createElement("button");
  view.id = `view-${id}`;
  header.append(toggle, view);
  const body = document.createElement("div");
  for (const r of rows) {
    const row = document.createElement("div");
    row.id = r;
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.dataset.rowSelectable = "";
    if (r === selected) row.dataset.rowSelected = "";
    row.addEventListener("click", () => opened.push(r));
    row.addEventListener("keydown", (e) => e.key === "Enter" && opened.push(r));
    const more = document.createElement("button");
    more.className = "row-more";
    row.append(more);
    body.append(row);
  }
  const fold = document.createElement("div");
  fold.dataset.agentFold = "offline";
  const foldButton = document.createElement("button");
  foldButton.id = `fold-${id}`;
  foldButton.setAttribute("aria-expanded", "false");
  const filter = document.createElement("input");
  fold.append(foldButton, filter);
  body.append(fold);
  section.append(header, body);
  // The toggle folds the body away (as React would), and back.
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    if (open) body.remove();
    else section.append(body);
  });
  foldButton.addEventListener("click", () => foldButton.setAttribute("aria-expanded", String(foldButton.getAttribute("aria-expanded") !== "true")));
  return section;
}

const $ = (id: string) => document.getElementById(id)!;
const press = (key: string, at: Element = document.activeElement!) => at.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const stops = () => [...nav.querySelectorAll<HTMLElement>("*")].filter((e) => e.tabIndex >= 0 && e.tagName !== "INPUT").map((e) => e.id);

beforeEach(() => {
  // jsdom lays nothing out: every element counts as shown.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  opened.length = 0;
  nav = document.createElement("nav");
  nav.append(project("a", ["eva", "kai", "mika"], "kai"), project("b", ["lead"]));
  document.body.append(nav);
  unbind = bindRovingList(nav);
});
afterEach(() => {
  unbind();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("one Tab stop for the whole list: the selected row; row buttons and headers leave the Tab order, inputs stay", () => {
  expect(stops()).toEqual(["kai"]);
  expect(($("fold-a").nextElementSibling as HTMLInputElement).tabIndex).toBe(0);
});

it("no selection: the first stop (the first header)", () => {
  delete $("kai").dataset.rowSelected;
  expect(applyRoving(nav, null)?.id).toBe("h-a");
});

it("↑ / ↓ / Home / End move the focus and the Tab stop through rows and fold headers in order", () => {
  expect(rovingItems(nav).map((e) => e.id)).toEqual(["h-a", "eva", "kai", "mika", "fold-a", "h-b", "lead", "fold-b"]);
  $("kai").focus();
  press("ArrowDown");
  expect(document.activeElement!.id).toBe("mika");
  press("ArrowDown");
  expect(document.activeElement!.id).toBe("fold-a");
  press("ArrowDown");
  expect(document.activeElement!.id).toBe("h-b");
  expect(stops()).toEqual(["h-b"]);
  press("ArrowUp");
  press("ArrowUp");
  expect(document.activeElement!.id).toBe("mika");
  press("End");
  expect(document.activeElement!.id).toBe("fold-b");
  press("Home");
  expect(document.activeElement!.id).toBe("h-a");
  press("ArrowUp");
  expect(document.activeElement!.id).toBe("h-a");
});

it("← on a row goes to its header; ← on an open header folds it, → unfolds it; a fold button folds the same way", () => {
  $("mika").focus();
  press("ArrowLeft");
  expect(document.activeElement!.id).toBe("h-a");
  press("ArrowLeft");
  expect($("h-a").getAttribute("aria-expanded")).toBe("false");
  expect(document.getElementById("mika")).toBeNull();
  expect(document.activeElement!.id).toBe("h-a");
  press("ArrowRight");
  expect($("h-a").getAttribute("aria-expanded")).toBe("true");
  expect(document.getElementById("mika")).not.toBeNull();
  $("fold-a").focus();
  press("ArrowRight");
  expect($("fold-a").getAttribute("aria-expanded")).toBe("true");
  press("ArrowLeft");
  expect($("fold-a").getAttribute("aria-expanded")).toBe("false");
  press("ArrowLeft");
  expect(document.activeElement!.id).toBe("h-a");
});

it("Enter still opens the row (its own handler); typing in a fold's filter keeps its arrow keys", () => {
  $("eva").focus();
  press("Enter");
  expect(opened).toEqual(["eva"]);
  const input = $("fold-a").nextElementSibling as HTMLInputElement;
  input.focus();
  const e = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
  input.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
});

it("modifier + arrow is not the list's (window shortcuts keep working)", () => {
  $("kai").focus();
  const e = new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, bubbles: true, cancelable: true });
  $("kai").dispatchEvent(e);
  expect(e.defaultPrevented).toBe(false);
  expect(document.activeElement!.id).toBe("kai");
});

it("the mouse is untouched: a click on a row that is not the Tab stop opens it, and makes it the stop once focused", () => {
  $("lead").click();
  expect(opened).toEqual(["lead"]);
  $("lead").focus();
  expect(stops()).toEqual(["lead"]);
});

it("rows drawn later leave the Tab order too; the selection moving elsewhere moves the stop while the focus is outside", async () => {
  const late = document.createElement("div");
  late.id = "late";
  late.tabIndex = 0;
  late.dataset.rowSelectable = "";
  $("lead").after(late);
  await Promise.resolve();
  expect(late.tabIndex).toBe(-1);
  delete $("kai").dataset.rowSelected;
  late.dataset.rowSelected = "";
  await Promise.resolve();
  expect(stops()).toEqual(["late"]);
});
