// @vitest-environment jsdom
// Pinned pages (owner 2026-10-21: 固定到托盘和桌面 for Project 视图): the home pin kind `page` on the wire
// (cutex-client: key `<pageId>:<argument>`, same rule as cutex user_home::valid_page_key), whether the home
// page source keeps such pins (cutex `user-home-page-pins`; an older host refuses them), the tray / tile
// helpers, the shell registries (lib/trayPins, lib/pagePins, lib/projectMenuExtras) and Project 视图's pin
// (modules/project-view/pin.tsx): its menu row and header button only where the pin can be kept.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PIN_KINDS, homePutBody, isPagePinKey, parsePagePinKey, readHomeDoc, readHomePin } from "@cutex-desktop/cutex-client";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { dockRef, pageBadge } = await import("../src/renderer/src/modules/home/dockModes");
const { defaultSize, pagePinsKept, withPin } = await import("../src/renderer/src/modules/home/model");
const { setTrayPins, trayPinSupported } = await import("../src/renderer/src/lib/trayPins");
const { pagePinKey, pagePinKindNow, registerPagePin } = await import("../src/renderer/src/lib/pagePins");
const { projectMenuExtras, registerProjectMenuExtra } = await import("../src/renderer/src/lib/projectMenuExtras");
const { PAGE_ID, PinButton, projectPinRef, startPins } = await import("../src/renderer/src/modules/project-view/pin");
type TrayPinRef = import("../src/renderer/src/lib/trayPins").TrayPinRef;
type TrayPins = import("../src/renderer/src/lib/trayPins").TrayPins;

describe("wire: page pins (cutex-client)", () => {
  it("is a pin kind with a <pageId>:<argument> key", () => {
    expect(HOME_PIN_KINDS).toContain("page");
    for (const good of ["project-view:proj-1", "a:b", "project-view.view:host:proj", `${"a".repeat(64)}:x`]) expect(isPagePinKey(good), good).toBe(true);
    for (const bad of ["no-separator", "project-view:", ":proj", "Project:proj", "9view:proj", `${"a".repeat(65)}:x`]) expect(isPagePinKey(bad), bad).toBe(false);
    expect(parsePagePinKey("project-view:a:b")).toEqual({ pageId: "project-view", arg: "a:b" });
    expect(parsePagePinKey("nope")).toBeNull();
  });

  it("reads page pins, drops malformed ones, and refuses to write them", () => {
    expect(readHomePin({ hostId: "h", kind: "page", key: "project-view:p1", title: "P", size: "m" })).toEqual({ hostId: "h", kind: "page", key: "project-view:p1", title: "P", size: "m" });
    expect(readHomePin({ hostId: "h", kind: "page", key: "p1" })).toBeNull();
    // The page key rule only applies to page pins.
    expect(readHomePin({ hostId: "h", kind: "url", key: "p1" })).not.toBeNull();
    expect(readHomeDoc({ pins: [{ hostId: "h", kind: "page", key: "bad" }, { hostId: "h", kind: "page", key: "project-view:p" }] })?.pins).toHaveLength(1);
    expect(homePutBody(1, { pins: [{ hostId: "h", kind: "page", key: "project-view:p" }] }).home?.pins).toHaveLength(1);
    expect(() => homePutBody(1, { pins: [{ hostId: "h", kind: "page", key: "bad" }] })).toThrow(/pins/);
  });
});

describe("the home list and page pins", () => {
  it("keeps page pins only where the source can (user-home-page-pins, or this device)", () => {
    expect(pagePinsKept(null)).toBe(false);
    expect(pagePinsKept(new Set(["user-home"]))).toBe(false);
    expect(pagePinsKept(new Set(["user-home", "user-home-page-pins"]))).toBe(true);
    // No user-home: the list lives on this device (module prefs), any kind fits.
    expect(pagePinsKept(new Set(["service-tiles"]))).toBe(true);
  });

  it("a page is no workspace ref (it opens through its owner), medium by default, 需要你 as its badge", () => {
    const pin = { hostId: "local", kind: "page" as const, key: "project-view:p1" };
    expect(dockRef(pin)).toBeNull();
    expect(defaultSize("page")).toBe("m");
    expect(pageBadge(3, false)).toEqual({ dot: "needs", count: 3, dim: false });
    expect(pageBadge(0, true)).toEqual({ dot: null, count: null, dim: true });
    expect(withPin({}, pin).pins).toEqual([pin]);
  });
});

function fakePins(supported: boolean): TrayPins & { list: TrayPinRef[] } {
  const list: TrayPinRef[] = [];
  const listeners = new Set<() => void>();
  const same = (a: TrayPinRef, b: TrayPinRef) => a.hostId === b.hostId && a.kind === b.kind && a.key === b.key;
  const changed = () => listeners.forEach((l) => l());
  return {
    list,
    isPinned: (r) => list.some((x) => same(x, r)),
    pin: vi.fn(async (r: TrayPinRef) => {
      if (r.kind === "page" && !supported) return false;
      list.push(r);
      changed();
      return true;
    }),
    unpin: vi.fn(async (r: TrayPinRef) => {
      const i = list.findIndex((x) => same(x, r));
      if (i >= 0) list.splice(i, 1);
      changed();
      return true;
    }),
    supports: (kind) => kind !== "page" || supported,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

describe("shell registries", () => {
  afterEach(() => setTrayPins(null));

  it("trayPins: no keeper = nothing; a keeper without `supports` = every kind but page", () => {
    expect(trayPinSupported("agent")).toBe(false);
    setTrayPins({ isPinned: () => false, pin: async () => true, unpin: async () => true });
    expect(trayPinSupported("service")).toBe(true);
    expect(trayPinSupported("page")).toBe(false);
    setTrayPins(fakePins(true));
    expect(trayPinSupported("page")).toBe(true);
  });

  it("pagePins: register / unregister by id (a newer registration is not dropped by an older one's cleanup)", () => {
    const a = { id: "demo", usePin: () => ({ name: "a", icon: () => null, needs: 0, dim: false }), open: () => true };
    const b = { ...a };
    const offA = registerPagePin(a);
    const offB = registerPagePin(b);
    offA();
    expect(pagePinKindNow("demo")).toBe(b);
    offB();
    expect(pagePinKindNow("demo")).toBeUndefined();
    expect(pagePinKey("demo", "x")).toBe("demo:x");
  });

  it("projectMenuExtras: rows from registered builders; a throwing builder is skipped", () => {
    const off1 = registerProjectMenuExtra("one", (p) => ({ label: `one ${p.projectId}`, onSelect: () => {} }));
    const off2 = registerProjectMenuExtra("two", () => {
      throw new Error("boom");
    });
    const off3 = registerProjectMenuExtra("three", () => null);
    const rows = projectMenuExtras({ hostId: "local", projectId: "p1", name: "P" });
    expect(rows.map((r) => (r && typeof r === "object" ? r.label : r))).toEqual(["one p1"]);
    off1();
    off2();
    off3();
    expect(projectMenuExtras({ hostId: "local", projectId: "p1", name: "P" })).toEqual([]);
  });
});

describe("Project 视图's pin", () => {
  let stop: () => void = () => {};
  let root: Root | null = null;
  let host: HTMLDivElement;
  beforeEach(() => {
    stop = startPins();
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
    stop();
    setTrayPins(null);
  });

  const row = () => projectMenuExtras({ hostId: "h1", projectId: "p1", name: "Alpha" })[0];

  it("registers its page (project-view:<projectId>) and the project menu row", () => {
    expect(pagePinKindNow(PAGE_ID)).toBeDefined();
    expect(projectPinRef("h1", "p1", "Alpha")).toEqual({ hostId: "h1", kind: "page", key: "project-view:p1", title: "Alpha" });
  });

  it("menu row: hidden without a keeper or where the host refuses page pins; pins / unpins otherwise", async () => {
    expect(row()).toBeUndefined();
    setTrayPins(fakePins(false));
    expect(row()).toBeUndefined();
    const pins = fakePins(true);
    setTrayPins(pins);
    const r = row();
    expect(r && typeof r === "object" && r.label).toBe("Pin to the tray");
    await act(async () => {
      if (r && typeof r === "object") r.onSelect();
    });
    expect(pins.pin).toHaveBeenCalledWith({ hostId: "h1", kind: "page", key: "project-view:p1", title: "Alpha" });
    const again = row();
    expect(again && typeof again === "object" && again.label).toBe("Unpin");
  });

  it("header button: hidden where the pin cannot be kept, live otherwise", async () => {
    setTrayPins(fakePins(false));
    root = createRoot(host);
    act(() => root!.render(h(PinButton, { hostId: "h1", projectId: "p1", name: "Alpha" })));
    expect(host.querySelector("[data-project-view-pin]")).toBeNull();
    const pins = fakePins(true);
    act(() => setTrayPins(pins));
    const button = host.querySelector<HTMLButtonElement>("[data-project-view-pin]");
    expect(button?.getAttribute("aria-label")).toBe("project-view.pin");
    await act(async () => button!.click());
    expect(pins.list).toHaveLength(1);
    expect(host.querySelector("[data-project-view-pin]")?.getAttribute("data-project-view-pin")).toBe("pinned");
    expect(host.querySelector("[data-project-view-pin]")?.getAttribute("aria-label")).toBe("project-view.unpin");
  });
});
