// @vitest-environment jsdom
// The status row above the input (owner 2026-11-05): the 需要你 bell leads its left side; a narrow row shortens the
// right-side chips, then wraps to a second line instead of hiding them; and it never gets shorter while its width stays,
// so the composer under it does not jump as chips (or the bell) come and go (lib/statusRow useStickyHeight).
import { createElement as h, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fx = vi.hoisted(() => ({ items: [] as unknown[], notes: false, bell: true }));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/statusItemsView", () => ({ useStatusItems: () => fx.items, revealStatusItem: () => ({ status: "opened" }) }));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({ useConvHost: () => "local", useConvScope: () => null, convNotify: () => {} }));
vi.mock("../src/renderer/src/components/PendingOwnerNotes", () => ({ PendingOwnerNotes: () => (fx.notes ? h("span", { "data-owner-note": "" }, "等你回复") : null) }));
vi.mock("../src/renderer/src/components/NeedsYou", () => ({ NeedsYouBell: () => (fx.bell ? h("button", { "data-needs-you-bell": "" }, "2") : null) }));

const { StatusBar } = await import("../src/renderer/src/components/StatusBar");
const { StatusChip, StatusChipWords } = await import("../src/renderer/src/components/StatusChip");
const { STATUS_ROW_TIGHT_REM, useStickyHeight } = await import("../src/renderer/src/lib/statusRow");

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
  Object.assign(fx, { items: [], notes: false, bell: true });
  width = 768;
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
  vi.unstubAllGlobals();
});
const render = () => act(() => root.render(h(StatusBar, { sessionId: "s1" })));
const row = () => host.querySelector<HTMLElement>("[data-status-row]")!;
const start = () => row().querySelector<HTMLElement>(":scope > [data-status-start]")!;

describe("需要你 bell in the status row", () => {
  it("leads the left side, before the owner notices and the goal; 委托 stays on the right", () => {
    fx.items = [goal, delegations];
    fx.notes = true;
    render();
    // The bell is the row's first item, outside the start part, so it stays on the first line however that part wraps.
    const parts = [...row().children].map((c) => (c.hasAttribute("data-needs-you-bell") ? "bell" : c.hasAttribute("data-status-start") ? "start" : c.hasAttribute("data-status-end") ? "end" : "?"));
    expect(parts).toEqual(["bell", "start", "end"]);
    const left = [...start().children].map((c) => (c.hasAttribute("data-owner-note") ? "note" : c.querySelector("[data-goal]") || c.hasAttribute("data-goal") ? "goal" : "?"));
    expect(left).toEqual(["note", "goal"]);
    expect(row().querySelector("[data-status-end]")!.textContent).toContain("委托 20");
  });
  it("the composer column hosts it in every case: Conversation no longer mounts a strip of its own", () => {
    const src = readFileSync("src/renderer/src/components/Conversation.tsx", "utf8");
    expect(src).not.toMatch(/NeedsYouStrip/);
    expect(src).toMatch(/<MemoStatusBar key=\{selectedId\} sessionId=\{selectedId\} \/>/);
  });
});

describe("a narrow status row", () => {
  const rem = 16;
  it(`under ${STATUS_ROW_TIGHT_REM}rem the row is tight and 委托 shows icon + count; its words stay as title and for screen readers`, () => {
    fx.items = [delegations];
    width = STATUS_ROW_TIGHT_REM * rem - 1;
    render();
    expect(row().hasAttribute("data-tight")).toBe(true);
    const button = row().querySelector("[data-status-end] button")!;
    expect(button.getAttribute("data-tip")).toBe("委托 20");
    const [full, short] = [...button.querySelectorAll("span")];
    expect(full!.className).toBe("group-data-[tight]/status:sr-only");
    expect(short!.textContent).toBe("20");
    expect(short!.getAttribute("aria-hidden")).toBe("true");
  });
  it("wraps rather than hiding: both sides may take more lines", () => {
    fx.items = [goal, delegations];
    render();
    expect(row().className).toMatch(/\bflex-wrap\b/);
    expect(start().className).toMatch(/\bflex-wrap\b/);
    expect(row().querySelector("[data-status-end]")!.className).toMatch(/\bflex-wrap\b/);
    expect(row().querySelector("[data-status-end]")!.className).not.toMatch(/\bshrink-0\b/);
  });
  it("styles.css: one 1.5rem line at least; no fixed two-line reserve", () => {
    const css = readFileSync("src/renderer/src/styles.css", "utf8").replace(/\s+/g, " ");
    expect(css).toContain("[data-status-row] { min-height: 1.5rem; }");
    expect(css).not.toMatch(/data-status-dense|\[data-status-row\]\[data-multiline\]/);
  });
});

describe("useStickyHeight", () => {
  let fire: () => void = () => {};
  let height = 24;
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          fire = () => cb();
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    height = 24;
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return Math.max(height, parseFloat(this.style.minHeight) || 0);
    });
  });
  function Probe() {
    return h("div", { ref: useStickyHeight(), "data-probe": "" });
  }
  const probe = () => host.querySelector<HTMLElement>("[data-probe]")!;

  it("grows with its content and does not shrink back while the width stays", () => {
    act(() => root.render(h(Probe)));
    expect(probe().style.minHeight).toBe("24px");
    height = 52; // a chip arrived and wrapped
    act(() => fire());
    expect(probe().style.minHeight).toBe("52px");
    height = 24; // it went again
    act(() => fire());
    expect(probe().style.minHeight).toBe("52px");
  });
  it("a new width starts over", () => {
    act(() => root.render(h(Probe)));
    height = 52;
    act(() => fire());
    height = 24;
    width = 1000;
    act(() => fire());
    expect(probe().style.minHeight).toBe("24px");
  });
});
