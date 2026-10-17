// @vitest-environment jsdom
// Settings cards (components/settings/Form Section / Card): a render error of a card's content shows
// in that card (message + 重试) and is logged, instead of an empty or crashed page; the cards are no CSS
// size containers any more (Chromium left their rows at height 0 after a multi-card commit: desktop
// 0.1.2, 主机后端更新 right after a cutex update) — narrow layout comes from lib/narrowCard. The
// same holds for the whole renderer: lib/sizeFlags, and the guard at the end of this file.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { act, createElement as h, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ logged: [] as { kind: string; message: string; stack?: string }[], state: { daemon: { kind: "disconnected" }, hosts: null } as Record<string, unknown> }));

vi.mock("../src/renderer/src/bridge", () => ({
  api: {},
  bridge: { shell: { logError: (e: { kind: string; message: string; stack?: string }) => (fx.logged.push(e), Promise.resolve()) } },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));

const { Section, SettingRow } = await import("../src/renderer/src/components/settings/Form");
const { isNarrowWidth, NARROW_CARD_REM } = await import("../src/renderer/src/lib/narrowCard");
const { dataFlags, sizeFlagKey, useSizeFlags, widthAtLeast, widthBelow } = await import("../src/renderer/src/lib/sizeFlags");
const sec = (props: { title: string; id?: string }, children: ReactNode) => h(Section, { ...props, children });
const row = (label: string, children: ReactNode) => h(SettingRow, { label, children });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  fx.logged.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("settings card errors", () => {
  it("shows the error and a retry inside the card, keeps the title and the other cards, logs it", () => {
    let broken = true;
    function Installed() {
      if (broken) throw new Error("installedReleases is null");
      return h("span", null, "0.1.1");
    }
    act(() =>
      root.render(
        h("div", null, sec({ title: "当前版本", id: "settings-status" }, row("已安装版本", h(Installed))), sec({ title: "回滚" }, row("回滚到", "0.1.0"))),
      ),
    );
    const status = host.querySelector("#settings-status")!;
    expect(status.textContent).toContain("当前版本");
    const alert = status.querySelector("[data-card-error]")!;
    expect(alert.textContent).toContain("settings.cardError(installedReleases is null)");
    expect(host.textContent).toContain("回滚到");
    expect(fx.logged.some((e) => e.kind === "error" && e.message === "[settings card] installedReleases is null" && (e.stack ?? "").includes("Installed"))).toBe(true);

    broken = false;
    const retry = [...status.querySelectorAll("button")].find((b) => b.textContent === "settings.cardRetry")!;
    act(() => retry.click());
    expect(status.querySelector("[data-card-error]")).toBeNull();
    expect(status.textContent).toContain("0.1.1");
  });

  it("an error in one card does not blank a card updated in the same commit", () => {
    let bump: (n: number) => void = () => {};
    function Boom(): ReactNode {
      throw new Error("boom");
    }
    function Page() {
      const [n, setN] = useState(0);
      bump = setN;
      return h(
        "div",
        null,
        sec({ title: "A", id: "a" }, row("release", `r${240 + n}`)),
        sec({ title: "B", id: "b" }, n > 0 ? h(Boom) : row("ok", "fine")),
      );
    }
    act(() => root.render(h(Page)));
    act(() => bump(1));
    expect(host.querySelector("#a")!.textContent).toContain("r241");
    expect(host.querySelector("#b [data-card-error]")!.textContent).toContain("boom");
  });
});

describe("narrow cards", () => {
  it("narrow below 28rem of content width", () => {
    expect(NARROW_CARD_REM).toBe(28);
    expect(isNarrowWidth(447, 16)).toBe(true);
    expect(isNarrowWidth(448, 16)).toBe(false);
    expect(isNarrowWidth(500, 20)).toBe(true);
    expect(isNarrowWidth(0, 16)).toBe(false); // not laid out yet: keep the wide layout
  });

  it("the card is a group/card, not a CSS size container; rows key off data-narrow", () => {
    act(() => root.render(sec({ title: "T" }, row("L", "v"))));
    const card = host.querySelector("section > div:last-child")!;
    expect(card.className).toContain("group/card");
    expect(card.className).not.toContain("@container");
    expect(card.querySelector(".grid")!.className).toContain("group-data-[narrow]/card:grid-cols-");
  });

  it("the card narrows from a measured width (ResizeObserver → data-narrow)", () => {
    const ro = installResizeObserver();
    act(() => root.render(sec({ title: "T" }, row("L", "v"))));
    const card = host.querySelector<HTMLElement>("section > div:last-child")!;
    expect(card.hasAttribute("data-narrow")).toBe(false);
    act(() => ro.resize(card, 300, 100));
    expect(card.hasAttribute("data-narrow")).toBe(true);
    act(() => ro.resize(card, 640, 100));
    expect(card.hasAttribute("data-narrow")).toBe(false);
    act(() => ro.resize(card, 0, 0)); // hidden (not laid out): keeps the last layout
    expect(card.hasAttribute("data-narrow")).toBe(false);
  });
});

/** A fake ResizeObserver: `resize(el, w, h)` delivers a content box to the observers of `el`. */
function installResizeObserver() {
  const observers = new Set<{ cb: ResizeObserverCallback; els: Set<Element>; self: ResizeObserver }>();
  class FakeResizeObserver {
    private entry: { cb: ResizeObserverCallback; els: Set<Element>; self: ResizeObserver };
    constructor(cb: ResizeObserverCallback) {
      this.entry = { cb, els: new Set(), self: this as unknown as ResizeObserver };
      observers.add(this.entry);
    }
    observe(el: Element) {
      this.entry.els.add(el);
    }
    unobserve(el: Element) {
      this.entry.els.delete(el);
    }
    disconnect() {
      observers.delete(this.entry);
    }
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return {
    resize(el: Element, width: number, height: number) {
      for (const o of observers) if (o.els.has(el)) o.cb([{ target: el, contentRect: { width, height } } as unknown as ResizeObserverEntry], o.self);
    },
    count: () => observers.size,
  };
}

describe("size flags (lib/sizeFlags)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keys, data attributes and the rem helpers", () => {
    const tests = { md: widthAtLeast(28), tight: widthBelow(12), tall: (b: { height: number }) => b.height > 100 };
    expect(sizeFlagKey(tests, { width: 448, height: 50 }, 16)).toBe("md");
    expect(sizeFlagKey(tests, { width: 191, height: 101 }, 16)).toBe("tight tall");
    expect(sizeFlagKey(tests, { width: 447, height: 0 }, 16)).toBe("");
    expect(dataFlags({ md: true, tight: false })).toEqual({ "data-md": "", "data-tight": undefined });
  });

  it("re-renders only when a flag flips, sets --cqw / --cqh with units, disconnects on unmount", () => {
    const ro = installResizeObserver();
    const TESTS = { narrow: widthBelow(20), short: (b: { height: number }) => b.height <= 200 };
    let renders = 0;
    function Probe() {
      renders++;
      const [ref, flags] = useSizeFlags(TESTS, { units: true });
      return h("div", { ref, id: "probe", ...dataFlags(flags) });
    }
    act(() => root.render(h(Probe)));
    const el = host.querySelector<HTMLElement>("#probe")!;
    const before = renders;
    act(() => ro.resize(el, 800, 600));
    expect(el.getAttribute("style")).toContain("--cqw: 8px");
    expect(el.style.getPropertyValue("--cqh")).toBe("6px");
    expect(el.hasAttribute("data-narrow") || el.hasAttribute("data-short")).toBe(false);
    act(() => ro.resize(el, 790, 590)); // no flag flips: no re-render
    expect(renders).toBe(before);
    act(() => ro.resize(el, 300, 150));
    expect(el.hasAttribute("data-narrow") && el.hasAttribute("data-short")).toBe(true);
    expect(el.style.getPropertyValue("--cqw")).toBe("3px");
    act(() => root.render(h("p")));
    expect(ro.count()).toBe(0);
  });
});

// Chromium can leave the children of a CSS size container without layout boxes after one React
// commit changes several containers (desktop 0.1.2: empty 10 px settings cards). The renderer
// measures with lib/sizeFlags instead. A new size container fails here unless it is listed below
// with the reason it is safe (one instance, never re-rendered together with others, …).
const SIZE_CONTAINER_ALLOW: Record<string, string> = {};

describe("no CSS size containers in the renderer", () => {
  const root = join(__dirname, "../src/renderer");
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" ? [] : files(join(dir, e.name))) : /\.(tsx?|css)$/.test(e.name) ? [join(dir, e.name)] : []));
  const SIZES = "(?:3xs|2xs|xs|sm|md|lg|xl|[2-7]xl)";
  const patterns: [string, RegExp][] = [
    ["@container (Tailwind class or CSS rule)", /@container\b/],
    ["Tailwind container variant", new RegExp(`(?:^|[\\s"'\`{(])@(?:\\[[^\\]]+\\]|(?:max|min)-\\[[^\\]]+\\]|(?:max-|min-)?${SIZES}):`)],
    ["container-type / container-name / containerType", /container-(?:type|name)\s*:|containerType|containerName/],
    ["container query units", /\d(?:cqw|cqh|cqi|cqb|cqmin|cqmax)\b/],
  ];
  const cssShorthand = /(?:^|[;{\s])container\s*:/;

  it("finds none outside the allow-list", () => {
    const found: string[] = [];
    const all = files(root);
    expect(all.map((f) => relative(root, f).split(sep).join("/"))).toEqual(expect.arrayContaining(["src/components/LaunchPage.css", "src/styles.css", "src/components/settings/ProfileCard.tsx"]));
    for (const file of all) {
      const rel = relative(root, file).split(sep).join("/");
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const hits = patterns.filter(([, re]) => re.test(text)).map(([what]) => what);
      if (file.endsWith(".css") && cssShorthand.test(text)) hits.push("container shorthand");
      if (hits.length && !SIZE_CONTAINER_ALLOW[rel]) found.push(`${rel}: ${hits.join(", ")}`);
    }
    expect(found).toEqual([]);
  });

  it("catches the forms it is meant to catch", () => {
    const hit = (s: string) => patterns.some(([, re]) => re.test(s));
    for (const s of [`className="@container flex"`, `"grid @max-[28rem]:grid-cols-1"`, `"hidden @lg:inline"`, `"@[34rem]:grid"`, `"@min-[20rem]:flex"`, `@container launcher (min-width: 1200px) {`, `container-type: inline-size;`, `height: 34cqw;`, `style={{ containerType: "size" }}`])
      expect(hit(s), s).toBe(true);
    for (const s of [`"group-data-[narrow]/card:grid-cols-2"`, `calc(4 * var(--cqw, 1vw))`, `user@example.com`, `"md:grid-cols-2"`]) expect(hit(s), s).toBe(false);
    expect(cssShorthand.test(".x { container: launcher / size; }")).toBe(true);
  });
});
