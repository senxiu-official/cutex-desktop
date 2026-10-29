// @vitest-environment jsdom
// Owner 2026-10-27: 「需要你」 and 「委托 N ›」 took two rows above 「接下来」 (the strip was its own row, the status row
// another). Now the strip sits in the status row (components/StatusBar): beside the right-side chips when the row's left
// is empty, on a line of its own above them when the left shows something (目标 = the goal item, barSide "start", or
// an owner notice); a narrow row shortens the right-side chips to icon + count (lib/statusRow).
import { createElement as h, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fx = vi.hoisted(() => ({ items: [] as unknown[], notes: false }));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/statusItemsView", () => ({ useStatusItems: () => fx.items, revealStatusItem: () => ({ status: "opened" }) }));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({ useConvHost: () => "local", useConvScope: () => null, convNotify: () => {} }));
vi.mock("../src/renderer/src/components/PendingOwnerNotes", () => ({ PendingOwnerNotes: () => (fx.notes ? h("span", { "data-owner-note": "" }, "等你回复") : null) }));
vi.mock("../src/renderer/src/components/NeedsYouStrip", () => ({
  NeedsYouStrip: ({ inline }: { inline?: boolean }) => h("div", { "data-needs-you-strip": "", "data-inline": inline ? "" : undefined }, "需要你"),
}));

const { StatusBar } = await import("../src/renderer/src/components/StatusBar");
const { StatusChip, StatusChipWords } = await import("../src/renderer/src/components/StatusChip");
const { STATUS_ROW_TIGHT_REM } = await import("../src/renderer/src/lib/statusRow");

/** A status item for the row: `side` start (the goal's side) or end (委托), drawn only when `shows`. */
function item(id: string, side: "start" | "end", shows: () => ReactNode) {
  return {
    moduleId: id,
    resolved: { requested: "bar", effective: ["bar"], unavailable: [] },
    place: "bar",
    item: { id, titleKey: id, barSide: side, Bar: ({ inline }: { inline: boolean }) => (inline ? shows() : null) },
  };
}
const goal = item("goal.status", "start", () => h("div", { "data-goal": "" }, "目标 · 进行中"));
const delegations = item("delegations.status", "end", () =>
  h(StatusChip, { open: false, onOpenChange: () => {}, title: "委托 20", label: h(StatusChipWords, { full: "委托 20", short: 20 }), children: null }),
);

let host: HTMLDivElement;
let root: Root;
let width = 768;
beforeEach(() => {
  fx.items = [];
  fx.notes = false;
  width = 768;
  // jsdom has no layout: the row's content box is its clientWidth (no padding in jsdom's computed style).
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => 28);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const render = (needsYou: boolean) => act(() => root.render(h(StatusBar, { sessionId: "s1", needsYou })));
const row = () => host.querySelector<HTMLElement>("[data-status-row]")!;
const start = () => row().querySelector<HTMLElement>(":scope > [data-status-start]")!;
/** What styles.css keys on (jsdom does no layout): the strip shares the line unless the row's left shows something. */
const stripOwnLine = () => row().matches(":has(> [data-status-start]:not(:empty))");

describe("需要你 in the status row", () => {
  it("without a goal on the left: the strip is in the row, first, beside the right-side 委托 (one line)", () => {
    fx.items = [goal, delegations].map((p) => (p === goal ? { ...p, item: { ...p.item, Bar: () => null } } : p));
    render(true);
    const kids = [...row().children].map((c) => c.getAttribute("data-status-start") !== null ? "start" : c.getAttribute("data-status-end") !== null ? "end" : c.hasAttribute("data-needs-you-strip") ? "strip" : "?");
    expect(kids).toEqual(["strip", "start", "end"]);
    expect(row().querySelector("[data-needs-you-strip]")!.hasAttribute("data-inline")).toBe(true);
    expect(start().childNodes.length).toBe(0);
    expect(stripOwnLine()).toBe(false);
    expect(row().querySelector("[data-status-end]")!.textContent).toContain("委托 20");
  });

  it("with a goal (or an owner notice) on the left: the strip takes its own line above", () => {
    fx.items = [goal, delegations];
    render(true);
    expect(start().querySelector("[data-goal]")).not.toBeNull();
    expect(stripOwnLine()).toBe(true);
    fx.items = [delegations];
    fx.notes = true;
    render(true);
    expect(stripOwnLine()).toBe(true);
  });

  it("styles.css: the strip fills the left of an empty row, the empty left part goes, a filled left puts the strip on its own line", () => {
    const css = readFileSync("src/renderer/src/styles.css", "utf8").replace(/\s+/g, " ");
    expect(css).toContain("[data-status-row] > [data-needs-you-strip] { flex: 1 1 0%; min-width: 0; }");
    expect(css).toContain("[data-status-row] > [data-needs-you-strip] ~ [data-status-start]:empty { display: none; }");
    expect(css).toContain("[data-status-row]:has(> [data-status-start]:not(:empty)) > [data-needs-you-strip] { flex-basis: 100%; }");
    // Owner 2026-10-27 (avatar-size jitter): the row keeps one reserved height whether it holds the strip's avatar
    // chips, the right-side chips or nothing — the strip no longer pads the row it is on.
    expect(css).toContain("[data-status-row] { min-height: 1.5rem; }");
    expect(css).not.toContain("[data-status-row]:has(> [data-needs-you-strip]) { padding-bottom");
    // The row wraps only for that: the left part never forces a line (flex-1 = basis 0), the right part never shrinks.
    fx.items = [delegations];
    render(true);
    expect(row().className).toMatch(/\bflex-wrap\b/);
    expect(start().className).toMatch(/\bflex-1\b/);
    expect(row().querySelector("[data-status-end]")!.className).toMatch(/\bshrink-0\b/);
  });

  it("not asked (composer hidden: the strip stays above the dock in Conversation): no strip in the row", () => {
    fx.items = [delegations];
    render(false);
    expect(row().querySelector("[data-needs-you-strip]")).toBeNull();
  });

  it("Conversation passes the strip to the status row only while the composer block shows, and keeps it outside otherwise", () => {
    const src = readFileSync("src/renderer/src/components/Conversation.tsx", "utf8");
    expect(src).toMatch(/const composerShown = !archived && !readOnly && !\(view && view\.timeline\.pending\.size > 0\);/);
    expect(src).toMatch(/\{!composerShown && <MemoNeedsYouStrip sessionId=\{selectedId\} \/>\}/);
    expect(src).toMatch(/<MemoStatusBar key=\{selectedId\} sessionId=\{selectedId\} needsYou=\{composerShown\} \/>/);
    expect(src).toMatch(/data-composer-block className=\{!composerShown \? "hidden"/);
  });
});

describe("a narrow status row", () => {
  const rem = 16;
  it(`under ${STATUS_ROW_TIGHT_REM}rem the row is tight and 委托 shows icon + count; its words stay as title and for screen readers`, () => {
    fx.items = [delegations];
    width = STATUS_ROW_TIGHT_REM * rem - 1;
    render(true);
    expect(row().hasAttribute("data-tight")).toBe(true);
    expect(row().className).toMatch(/\bgroup\/status\b/);
    const button = row().querySelector("[data-status-end] button")!;
    expect(button.getAttribute("title")).toBe("委托 20");
    const [full, short] = [...button.querySelectorAll("span")];
    expect(full!.textContent).toBe("委托 20");
    expect(full!.className).toBe("group-data-[tight]/status:sr-only");
    expect(short!.textContent).toBe("20");
    expect(short!.getAttribute("aria-hidden")).toBe("true");
    expect(short!.className).toBe("hidden group-data-[tight]/status:inline");
  });

  it("at or over the threshold it is not tight (full words)", () => {
    fx.items = [delegations];
    width = STATUS_ROW_TIGHT_REM * rem;
    render(true);
    expect(row().hasAttribute("data-tight")).toBe(false);
  });
});
