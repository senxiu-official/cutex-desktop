// @vitest-environment jsdom
// components/RosterStick (owner 2026-11-17 / 11-18): the real 文件夹 / 系统行 headers stack at the 花名册's top edge
// (groups above the view) and bottom edge (groups below) by scroll-linked animations; a click on one in a stack
// brings its group into view (opening it if folded, through its own toggle); groups left out for space are behind
// 「+N」. jsdom lays nothing out: geometry is stubbed.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const menu = vi.hoisted(() => ({ entries: [] as { label: string; onSelect(): void }[] }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, v?: { count?: number }) => (v?.count === undefined ? key : `${key}:${v.count}`) }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ openMenuAbove: (_el: HTMLElement, entries: { label: string; onSelect(): void }[]) => void (menu.entries = entries) }));
import { RosterStick } from "../src/renderer/src/components/RosterStick";
import { edgeKeys, spanStickHeaders } from "../src/renderer/src/lib/rosterStick";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HEADER = 28;
let listHeight = 600;
let contentHeight = 2000;
let frames: FrameRequestCallback[] = [];
const toggles = new Map<string, Mock<() => void>>();
const animate = vi.fn();
const scrollTo = vi.fn();
let timelines: { source: Element }[] = [];
let ioCallback: ((entries: IntersectionObserverEntry[]) => void) | null = null;
let observed: Element[] = [];
const real = { rect: HTMLElement.prototype.getBoundingClientRect, animate: HTMLElement.prototype.animate, raf: window.requestAnimationFrame, ro: window.ResizeObserver, io: window.IntersectionObserver };

interface Spec {
  id: string;
  y: number;
  open: boolean;
  system?: boolean;
}

function Group({ spec }: { spec: Spec }) {
  const [open, setOpen] = useState(spec.open);
  return (
    <section data-stick-group={spec.id} data-stick-label={`L-${spec.id}`} {...(spec.system ? { "data-stick-system": "" } : {})} data-folded={open ? undefined : ""} data-y={spec.y}>
      <div data-stick="edge">
        <button
          aria-expanded={open}
          data-header={spec.id}
          onClick={() => {
            toggles.get(spec.id)!();
            setOpen((o) => !o);
          }}
        >
          {spec.id}
        </button>
      </div>
    </section>
  );
}

function Harness({ specs }: { specs: Spec[] }) {
  return (
    <div data-roster-box="">
      <nav data-sidebar-roster="roster">
        {specs.map((s) => (
          <Group key={s.id} spec={s} />
        ))}
      </nav>
      <RosterStick />
    </div>
  );
}

const SPECS: Spec[] = [
  { id: "folder:a", y: 0, open: true },
  { id: "independent", y: 900, open: false, system: true },
  { id: "older", y: 1300, open: false, system: true },
  { id: "chats", y: 1400, open: true, system: true },
];

let root: Root;
let div: HTMLDivElement;
const nav = () => div.querySelector<HTMLElement>("nav")!;
const flush = async () =>
  act(async () => {
    // Observer callbacks are microtasks: let them queue their frame first.
    await Promise.resolve();
    for (let i = 0; i < 5 && frames.length; i++) {
      await Promise.resolve();
      const now = frames;
      frames = [];
      now.forEach((f) => f(0));
    }
  });
function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 240, width: 240, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}
async function mount(specs = SPECS) {
  for (const s of specs) toggles.set(s.id, vi.fn());
  await act(async () => root.render(<Harness specs={specs} />));
  const n = nav();
  Object.defineProperty(n, "clientHeight", { configurable: true, get: () => listHeight });
  Object.defineProperty(n, "scrollHeight", { configurable: true, get: () => contentHeight });
  n.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];
  // Plan again with the stubbed sizes (as the ResizeObserver would).
  n.setAttribute("data-stick-group", "x");
  n.removeAttribute("data-stick-group");
  await flush();
}
/** Mark a header as sitting at the bottom edge now (its animation moved it up from its place). */
const stuck = (id: string) => div.querySelector<HTMLElement>(`[data-header="${id}"]`)!.parentElement!.setAttribute("data-test-stuck", "");
/** Mark a header as sitting in the top stack now (its animation moved it down from its place). */
const stuckTop = (id: string) => div.querySelector<HTMLElement>(`[data-header="${id}"]`)!.parentElement!.setAttribute("data-test-top", "");

beforeEach(() => {
  listHeight = 600;
  contentHeight = 2000;
  frames = [];
  timelines = [];
  ioCallback = null;
  observed = [];
  menu.entries = [];
  toggles.clear();
  animate.mockReset().mockImplementation(() => ({ cancel: vi.fn() }));
  scrollTo.mockReset();
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.matches("nav[data-sidebar-roster]")) return rect(0, listHeight);
    if (this.hasAttribute("data-test-stuck")) return rect(listHeight - HEADER, HEADER);
    if (this.hasAttribute("data-test-top")) return rect(Number(this.closest<HTMLElement>("[data-y]")!.dataset.y) + 500, HEADER);
    const at = this.closest<HTMLElement>("[data-y]");
    if (at) return rect(Number(at.dataset.y), HEADER);
    return real.rect.call(this);
  };
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => HEADER });
  HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
  window.requestAnimationFrame = (cb: FrameRequestCallback) => frames.push(cb);
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  (window as unknown as { ScrollTimeline: unknown }).ScrollTimeline = class {
    constructor(o: { source: Element }) {
      timelines.push(o);
    }
  };
  window.IntersectionObserver = class {
    constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
      ioCallback = cb;
    }
    observe(el: Element) {
      observed.push(el);
    }
    disconnect() {
      observed = [];
    }
  } as unknown as typeof IntersectionObserver;
  div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
});

afterEach(async () => {
  await act(async () => root.unmount());
  div.remove();
  HTMLElement.prototype.getBoundingClientRect = real.rect;
  HTMLElement.prototype.animate = real.animate;
  delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  window.requestAnimationFrame = real.raf;
  window.ResizeObserver = real.ro;
  window.IntersectionObserver = real.io;
  delete (window as unknown as { ScrollTimeline?: unknown }).ScrollTimeline;
});

const keysOf = (call: unknown[]) => (call[0] as { transform: string; offset: number }[]).map((k) => ({ offset: k.offset, y: Number(/translateY\((-?[\d.]+)px\)/.exec(k.transform)![1]) }));

describe("RosterStick", () => {
  it("animates every real header on the list's scroll timeline, to its top and bottom slots, with the planned keyframes", async () => {
    await mount();
    expect(timelines.at(-1)!.source).toBe(nav());
    const animated = animate.mock.contexts.map((el) => (el as HTMLElement).querySelector("button")!.dataset.header);
    expect(animated).toEqual(["folder:a", "independent", "older", "chats"]);
    const maxScroll = contentHeight - listHeight;
    expect(keysOf(animate.mock.calls[0]!)).toEqual(edgeKeys({ top: 0, height: HEADER }, { top: 0, bottom: 84 }, listHeight, maxScroll));
    expect(keysOf(animate.mock.calls[1]!)).toEqual(edgeKeys({ top: 900, height: HEADER }, { top: 28, bottom: 56 }, listHeight, maxScroll));
    expect(keysOf(animate.mock.calls[3]!)).toEqual(edgeKeys({ top: 1400, height: HEADER }, { top: 84, bottom: 0 }, listHeight, maxScroll));
    expect(animate.mock.calls[0]![1]).toMatchObject({ fill: "both", easing: "linear" });
    // The headers are moved by the animations only (not CSS sticky), the stacking ones over the rest.
    expect(nav().hasAttribute("data-stick-js")).toBe(true);
    expect([...nav().querySelectorAll("[data-stacked] [data-header]")].map((e) => (e as HTMLElement).dataset.header)).toEqual(["folder:a", "independent", "older", "chats"]);
  });

  it("planning never touches a fold, and an unchanged list is not planned again", async () => {
    await mount();
    const count = animate.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      nav().append(document.createElement("i"));
      await flush();
    }
    expect(animate.mock.calls.length).toBe(count);
    for (const t of toggles.values()) expect(t).not.toHaveBeenCalled();
  });

  it("a click on a folded header at the bottom opens it through its own toggle and brings it up, focused", async () => {
    await mount();
    stuck("independent");
    await act(async () => div.querySelector<HTMLButtonElement>('[data-header="independent"]')!.click());
    await flush();
    expect(toggles.get("independent")).toHaveBeenCalledTimes(1);
    expect(div.querySelector('[data-header="independent"]')!.getAttribute("aria-expanded")).toBe("true");
    // Its group starts right under the top stack above it (folder:a's header, 28).
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 872 }));
    expect(document.activeElement).toBe(div.querySelector('[data-header="independent"]'));
  });

  it("a click on a header in the top stack brings its group into view too (it does not fold)", async () => {
    await mount();
    stuckTop("older");
    await act(async () => div.querySelector<HTMLButtonElement>('[data-header="older"]')!.click());
    await flush();
    expect(toggles.get("older")).toHaveBeenCalledTimes(1);
    expect(div.querySelector('[data-header="older"]')!.getAttribute("aria-expanded")).toBe("true");
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1300 - 56 }));
    expect(document.activeElement).toBe(div.querySelector('[data-header="older"]'));
  });

  it("a click on an open header at the bottom only brings it up (it does not fold)", async () => {
    await mount();
    stuck("chats");
    await act(async () => div.querySelector<HTMLButtonElement>('[data-header="chats"]')!.click());
    await flush();
    expect(toggles.get("chats")).not.toHaveBeenCalled();
    expect(div.querySelector('[data-header="chats"]')!.getAttribute("aria-expanded")).toBe("true");
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1400 - 84 }));
  });

  it("a header in its place keeps its own click: fold / unfold", async () => {
    await mount();
    await act(async () => div.querySelector<HTMLButtonElement>('[data-header="folder:a"]')!.click());
    expect(toggles.get("folder:a")).toHaveBeenCalledTimes(1);
    expect(div.querySelector('[data-header="folder:a"]')!.getAttribute("aria-expanded")).toBe("false");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("over the share (small window): the left-out 文件夹 that cannot be seen — out of the list or under a stack — are behind one 「+N」 row whose menu brings each up", async () => {
    listHeight = 476;
    contentHeight = 9000;
    const folders: Spec[] = Array.from({ length: 12 }, (_, i) => ({ id: `folder:${i}`, y: i * 600, open: true }));
    await mount([...folders, { id: "independent", y: 7200, open: false, system: true }, { id: "older", y: 7500, open: false, system: true }, { id: "chats", y: 7600, open: true, system: true }]);
    const scroll = async (top: number) => {
      Object.defineProperty(nav(), "scrollTop", { configurable: true, value: top });
      await act(async () => nav().dispatchEvent(new Event("scroll")));
    };
    const more = () => div.querySelector<HTMLElement>("[data-stick-more]");
    const listed = async () => {
      await act(async () => more()!.querySelector("button")!.click());
      return menu.entries.map((e) => e.label);
    };
    // At the top: folder:6..11 are below the list.
    expect(more()!.textContent).toContain("sidebar.stickMore:6");
    expect(more()!.style.bottom).toBe("84px");
    // It slides with the titles under it on the list's scroll timeline, not by the scroll handler (owner 2026-11-19,
    // jitter at the bottom): one animation on its own element, whose keyframes end at the list's bottom (down 84).
    const slide = animate.mock.calls.filter((_, i) => animate.mock.contexts[i] === more());
    expect(slide).toHaveLength(1);
    // The same scroll timeline of the list as the titles'.
    const titleCall = animate.mock.calls.findLastIndex((_, i) => animate.mock.contexts[i] !== more());
    expect((slide[0]![1] as { timeline: unknown }).timeline).toBe((animate.mock.calls[titleCall]![1] as { timeline: unknown }).timeline);
    expect(timelines.at(-1)!.source).toBe(nav());
    expect(keysOf(slide[0]!).at(-1)).toEqual({ offset: 1, y: 84 });
    // folder:7 in the clear band between the stacks; folder:6 scrolled away above, folder:8.. below.
    await scroll(4000);
    expect(more()!.textContent).toContain("sidebar.stickMore:5");
    expect(await listed()).toEqual(["L-folder:6", "L-folder:8", "L-folder:9", "L-folder:10", "L-folder:11"]);
    // (The stubbed geometry does not move with the scroll: measure the jump from the top.)
    Object.defineProperty(nav(), "scrollTop", { configurable: true, value: 0 });
    await act(async () => menu.entries[1]!.onSelect());
    await flush();
    // Under the six kept 文件夹 before it in the top stack.
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 8 * 600 - 6 * HEADER }));
  });

  // Review 2026-11-18 (P2): a left-out header still inside the list but under the top stack (the six kept 文件夹,
  // 0..168) cannot be seen, so it is in 「+N」 — an observer on the whole list said it was visible.
  it("a left-out header covered by the top stack stays in 「+N」", async () => {
    listHeight = 476;
    contentHeight = 9000;
    const folders: Spec[] = Array.from({ length: 12 }, (_, i) => ({ id: `folder:${i}`, y: i * 600, open: true }));
    await mount([...folders, { id: "independent", y: 7200, open: false, system: true }, { id: "older", y: 7500, open: false, system: true }, { id: "chats", y: 7600, open: true, system: true }]);
    Object.defineProperty(nav(), "scrollTop", { configurable: true, value: 3480 });
    await act(async () => nav().dispatchEvent(new Event("scroll")));
    // folder:6's header is at 120..148 in the list: inside it, under the top stack.
    await act(async () => div.querySelector<HTMLElement>("[data-stick-more] button")!.click());
    expect(menu.entries.map((e) => e.label)).toContain("L-folder:6");
    // A few pixels on, its middle is in the clear band: seen, out of 「+N」.
    Object.defineProperty(nav(), "scrollTop", { configurable: true, value: 3400 });
    await act(async () => nav().dispatchEvent(new Event("scroll")));
    await act(async () => div.querySelector<HTMLElement>("[data-stick-more] button")!.click());
    expect(menu.entries.map((e) => e.label)).not.toContain("L-folder:6");
  });

  // Review 2026-11-18 (P2): a new plan whose left-out titles can all be seen clears the last plan's 「+N」 row.
  it("folding until every left-out title fits clears an old 「+N」 row", async () => {
    listHeight = 200;
    contentHeight = 2000;
    const specs: Spec[] = Array.from({ length: 5 }, (_, i) => ({ id: `folder:${i}`, y: i * 400, open: true }));
    await mount(specs);
    const more = () => div.querySelector<HTMLElement>("[data-stick-more]");
    expect(more()!.textContent).toContain("sidebar.stickMore:2");
    // Folded: the five headers at 0 / 28 / … / 112, nothing to scroll; every left-out title is in the clear band.
    contentHeight = 140;
    for (const [i, el] of [...nav().querySelectorAll<HTMLElement>("section[data-y]")].entries()) el.dataset.y = String(i * HEADER);
    nav().querySelector("section")!.setAttribute("data-folded", "");
    await flush();
    // Hidden (kept mounted for its scroll-linked slide), not listing anything.
    expect(more()!.style.visibility).toBe("hidden");
    expect(more()!.hasAttribute("inert")).toBe(true);
  });

  it("without ScrollTimeline (older engine) nothing moves and nothing breaks", async () => {
    delete (window as unknown as { ScrollTimeline?: unknown }).ScrollTimeline;
    await mount();
    expect(animate).not.toHaveBeenCalled();
  });

  it("without the stacks (older engine) nested headers stick under all the headers they are in: 文件夹 → 更早的项目 → 项目分组 add up per level (review 2026-11-18)", async () => {
    delete (window as unknown as { ScrollTimeline?: unknown }).ScrollTimeline;
    await mount();
    // A folder with 更早的项目 inside it and a project inside that (the Sidebar's nesting: header = the group's first child).
    const folder = document.createElement("section");
    folder.setAttribute("data-stick-group", "folder:n");
    folder.innerHTML = '<div data-stick="edge"><button aria-expanded="true">F</button></div><div><section data-older><div data-stick="project"><button aria-expanded="true">O</button></div><div><section data-project><div data-stick="project"><button aria-expanded="true">P</button></div></section></div></section><section data-direct><div data-stick="project"><button aria-expanded="true">D</button></div></section></div>';
    nav().append(folder);
    await flush();
    const top = (sel: string) => folder.querySelector<HTMLElement>(sel)?.style.getPropertyValue("--stick-top") ?? folder.style.getPropertyValue("--stick-top");
    expect(folder.style.getPropertyValue("--stick-top")).toBe("0px");
    expect(top("[data-older]")).toBe(`${HEADER}px`);
    expect(top("[data-direct]")).toBe(`${HEADER}px`);
    // The project inside 更早的项目 sits under both, not on top of 更早的项目's header.
    expect(top("[data-project]")).toBe(`${2 * HEADER}px`);
  });

  // Owner 2026-11-18 (handoff glitch, revision v2): two sibling groups B then A must never be stacked as if nested —
  // each top-level header sticks at the edge itself (0), so the next one pushes it out instead of sitting under it.
  it("sibling groups are not nested: every top-level header sticks at the edge (--stick-top 0)", async () => {
    delete (window as unknown as { ScrollTimeline?: unknown }).ScrollTimeline;
    await mount();
    const added: HTMLElement[] = [];
    for (const id of ["folder:b", "folder:a"]) {
      const s = document.createElement("section");
      added.push(s);
      s.setAttribute("data-stick-group", id);
      s.innerHTML = '<div data-stick="edge"><button aria-expanded="true">x</button></div><div><section data-in><div data-stick="project"><button aria-expanded="true">p</button></div></section></div>';
      nav().append(s);
    }
    await flush();
    for (const s of added) {
      expect(s.style.getPropertyValue("--stick-top")).toBe("0px");
      // A project inside a folder sits under that folder's header only (not under its sibling folder too).
      expect(s.querySelector<HTMLElement>("[data-in]")!.style.getPropertyValue("--stick-top")).toBe(`${HEADER}px`);
    }
  });

  it("with the stacks, a nested header sticks under the whole top stack of its group", async () => {
    await mount();
    const folder = document.createElement("section");
    folder.setAttribute("data-stick-group", "folder:n");
    folder.dataset.y = "1700";
    folder.innerHTML = '<div data-stick="edge"><button aria-expanded="true">F</button></div><div><section data-older><div data-stick="project"><button aria-expanded="true">O</button></div><div><section data-project><div data-stick="project"><button aria-expanded="true">P</button></div></section></div></section></div>';
    nav().append(folder);
    await flush();
    // Inside folder:n the top stack holds all five top-level headers (4 before it + its own).
    expect(folder.style.getPropertyValue("--stick-top")).toBe("0px");
    expect(folder.querySelector<HTMLElement>("[data-older]")!.style.getPropertyValue("--stick-top")).toBe(`${5 * HEADER}px`);
    expect(folder.querySelector<HTMLElement>("[data-project]")!.style.getPropertyValue("--stick-top")).toBe(`${6 * HEADER}px`);
  });

  it("the stylesheet places every sticky header by its group's --stick-top", () => {
    const css = readFileSync(join(__dirname, "../src/renderer/src/styles.css"), "utf8");
    // Exactly --stick-top: the list has no padding of its own to undo (owner 2026-11-19, titles jumped at the very top).
    for (const kind of ["edge", "project"]) expect(css).toContain(`[data-stick="${kind}"] { top: var(--stick-top, 0px);`);
    expect(css).not.toMatch(/\[data-stick="(edge|project)"\] \{ top: calc/);
    // With the stacks the list scrolls on the compositor (the stacks never trail the rows by a frame) through the card's
    // opaque colour painted with its contents, which keeps LCD text — not will-change, which turns it grayscale.
    expect(css).toContain('nav[data-sidebar-roster="roster"][data-stick-js]:not([data-stick-off]) { background: var(--bg) local; }');
    const promoted = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*data-sidebar-roster[^{]*)\{[^}]*will-change: scroll-position/g)].map((m) => m[1]!.trim());
    // A see-through (acrylic) card has no opaque colour: there the list is promoted, or Chrome scrolls it by re-rastering
    // while the titles' animations move on the compositor, out of step (owner 2026-11-24, Linux at 145%). Only there.
    expect(promoted).toEqual([':root[data-card-material="acrylic"]:not([data-edge-to-edge]) nav[data-sidebar-roster="roster"][data-stick-js]:not([data-stick-off])']);
  });

  // Owner 2026-11-19 (the titles jumped as the list reached the very top): a title stuck at an edge must sit exactly where
  // it rests at that end, so nothing in the scroller may put space before the first title or after the last one. The
  // list's padding was inside it (pt-1 / pb-2): the resting titles sat 4 px (the project title 6 px, with the folder →
  // project gap) below their stuck place, and every scroll to the top moved them there in its last pixels.
  it("the list's spacing is its box's, not the scroller's: a title stuck at either end sits where it rests there", () => {
    const tsx = readFileSync(join(__dirname, "../src/renderer/src/components/Sidebar.tsx"), "utf8");
    const nav = /<nav ref=\{roving\} data-sidebar-roster=[^>]*?className="([^"]*)"/.exec(tsx);
    expect(nav).not.toBeNull();
    expect(nav![1]!).toContain("overflow-y-auto");
    // No vertical padding in the scroller (p-*, py-*, pt-*, pb-*, at any breakpoint).
    expect(nav![1]!.split(/\s+/).filter((c) => /^(?:[a-z0-9]+:)*p[ytb]?-/.test(c))).toEqual([]);
    expect(tsx).toMatch(/<div className="[^"]*\bpt-1 pb-2\b[^"]*" data-roster-box="">/);
    // Title on title: a folder title and its first project title touch at rest as in the stack.
    const css = readFileSync(join(__dirname, "../src/renderer/src/styles.css"), "utf8");
    expect(css).toMatch(/--roster-gap-child: 0px;/);
  });

  it("「+N」 sits on the list's bottom edge, above the box's padding under the list", async () => {
    const box = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return this.matches("[data-roster-box]") ? rect(-4, listHeight + 12) : box.call(this);
    };
    listHeight = 476;
    contentHeight = 9000;
    const folders: Spec[] = Array.from({ length: 12 }, (_, i) => ({ id: `folder:${i}`, y: i * 600, open: true }));
    await mount([...folders, { id: "independent", y: 7200, open: false, system: true }, { id: "older", y: 7500, open: false, system: true }, { id: "chats", y: 7600, open: true, system: true }]);
    // Its slot (84) plus the 8 px of the box below the list.
    expect(div.querySelector<HTMLElement>("[data-stick-more]")!.style.bottom).toBe("92px");
  });

  // Owner 2026-11-19 「这个黑块有缝隙」: stacked titles tile into one band that spans the list edge to edge.
  it("every group title's background reaches the list's edges, whatever its indent (--stick-left / --stick-right)", () => {
    const nav = document.createElement("nav");
    nav.innerHTML = '<section><div data-stick="edge"></div><section class="pl-2"><div data-stick="project"></div></section></section>';
    document.body.append(nav);
    const rect = (left: number, width: number) => ({ left, right: left + width, top: 0, bottom: 28, width, height: 28, x: left, y: 0, toJSON() {} }) as DOMRect;
    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue(rect(9, 254));
    Object.defineProperty(nav, "clientWidth", { value: 254 });
    const [edge, project] = [...nav.querySelectorAll<HTMLElement>("[data-stick]")];
    vi.spyOn(edge!, "getBoundingClientRect").mockReturnValue(rect(15, 242));
    vi.spyOn(project!, "getBoundingClientRect").mockReturnValue(rect(23, 234));
    spanStickHeaders(nav);
    expect([edge!.style.getPropertyValue("--stick-left"), edge!.style.getPropertyValue("--stick-right")]).toEqual(["6px", "6px"]);
    expect([project!.style.getPropertyValue("--stick-left"), project!.style.getPropertyValue("--stick-right")]).toEqual(["14px", "6px"]);
    nav.remove();
  });

  // Cross-review 2026-11-19: clientWidth is a whole pixel; a fractional list must not leave the band short.
  it("a fractional list width (zoom, a dragged sidebar) reaches the real edge, with or without a scrollbar", () => {
    const nav = document.createElement("nav");
    nav.innerHTML = '<section><div data-stick="edge"></div></section>';
    document.body.append(nav);
    const rect = (left: number, width: number) => ({ left, right: left + width, top: 0, bottom: 28, width, height: 28, x: left, y: 0, toJSON() {} }) as DOMRect;
    const header = nav.querySelector<HTMLElement>("[data-stick]")!;
    // 254.4px wide: clientWidth 254, offsetWidth 254 (no scrollbar). Header inset 6px each side: 242.4 wide.
    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue(rect(9.2, 254.4));
    const sizes = { client: 254, offset: 254 };
    Object.defineProperty(nav, "clientWidth", { get: () => sizes.client });
    Object.defineProperty(nav, "offsetWidth", { get: () => sizes.offset });
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(rect(15.2, 242.4));
    spanStickHeaders(nav);
    expect(header.style.getPropertyValue("--stick-right")).toBe("6px");
    expect(header.style.getPropertyValue("--stick-left")).toBe("6px");
    // A 10px scrollbar: the band stops at the scrollbar, not 0.4px short of it.
    sizes.client = 244;
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(rect(15.2, 232.4));
    spanStickHeaders(nav);
    expect(header.style.getPropertyValue("--stick-right")).toBe("6px");
    // Sub-pixel remainders round outward (never short).
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(rect(15.2, 232.391));
    spanStickHeaders(nav);
    expect(header.style.getPropertyValue("--stick-right")).toBe("6.01px");
    nav.remove();
  });

  it("a resize re-measures the band (RosterStick replans on its ResizeObserver)", async () => {
    let resized: (() => void) | null = null;
    window.ResizeObserver = class {
      constructor(cb: () => void) { resized = cb; }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    let width = 240;
    const base = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const r = base.call(this);
      return this.matches("nav[data-sidebar-roster]") ? ({ ...r, left: 0, right: width, width } as DOMRect) : r;
    };
    await mount();
    const header = nav().querySelector<HTMLElement>("[data-stick]")!;
    expect(header.style.getPropertyValue("--stick-right")).toBe("0px");
    width = 300.5;
    await act(async () => resized!());
    await flush();
    expect(header.style.getPropertyValue("--stick-right")).toBe("60.5px");
  });

  it("the stylesheet draws each title as a square, edge-to-edge band that overlaps its neighbours (no seams, no corners)", () => {
    const css = readFileSync(join(__dirname, "../src/renderer/src/styles.css"), "utf8");
    expect(css).toContain('nav[data-sidebar-roster="roster"]:not([data-stick-off]) [data-stick] { border-radius: 0; }');
    const head = 'nav[data-sidebar-roster="roster"]:not([data-stick-off]) [data-stick]::before {';
    const at = css.indexOf(head);
    expect(at).toBeGreaterThan(-1);
    const ext = css.slice(at + head.length, css.indexOf("}", at));
    expect(css).toContain('nav[data-sidebar-roster="roster"] { overflow-x: hidden; }');
    for (const rule of ["top: -1px", "bottom: -1px", "left: calc(-1 * var(--stick-left, 0px))", "right: calc(-1 * var(--stick-right, 0px))", "background: inherit", "z-index: -1", "pointer-events: none"]) expect(ext).toContain(rule);
  });
});
