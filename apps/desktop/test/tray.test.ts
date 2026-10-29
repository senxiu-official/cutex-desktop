// The tray (canvas principles §7, owner 2026-10-21; contract 1.20): where it is drawn (on the desktop / a
// thin line while panes cover it / revealed over them), the reveal and auto-hide timing (lib/trayStore), the
// shortcut, the dimming distance, the desktop layer's geometry (never changed by the edit panel or the
// tray), and its shortcuts (modules/home/dock.ts): its pins (not the desktop's icons, owner 2026-10-24), badges
// from cutex state, 打开方式 per item.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESK_PANEL_W, deskGeometry, isTrayKey, TRAY_EDGE_GRACE_MS, TRAY_HIDE_MS, TRAY_IDLE_MS, trayPlacement, type TrayInput, paneArea, trayArrowStep, trayBand, trayDropEdge, trayVertical, TRAY_BAND_PX, TRAY_DOCK_PX, TRAY_HANDLE_PX } from "../src/renderer/src/lib/trayModel";
import { DEFAULT_TRAY_PREFS, parseTrayPrefs } from "../src/renderer/src/lib/trayPrefs";
import { hideTray, holdTray, releaseTray, revealTray, toggleTray, useTray } from "../src/renderer/src/lib/trayStore";
import { desktopMounted } from "../src/renderer/src/lib/paneDesk";
import { agentBadge, dockPins, dockRef, openModeOf, prunedModes, readModes, serviceBadge, withOpenMode } from "../src/renderer/src/modules/home/dockModes";
import { deskIconsOf, deskIconsStored, isOnDesk, pinId, pinsOf, sizeOf, withDeskIcon, withDeskIconSize, withoutDeskIcon, withPin, withPinAt, withPinBefore, withPinMoved, withoutPin } from "../src/renderer/src/modules/home/model";
import { withIconOnDesk } from "../src/renderer/src/modules/home/deskDrop";
import type { HomeDoc, HomePin } from "../src/shared/home";
import { setKeybindingPlatform } from "../src/renderer/src/lib/keybindings";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const covered: TrayInput = { items: 3, fullWindow: false, persistent: false, desktopOn: false, revealed: false };
const pinned: TrayInput = { ...covered, persistent: true };

describe("where the tray is", () => {
  it("托盘常驻 (default): always the strip in its band, whatever is in front", () => {
    expect(trayPlacement(pinned)).toBe("docked");
    expect(trayPlacement({ ...pinned, desktopOn: true })).toBe("docked");
    expect(trayPlacement({ ...pinned, revealed: true })).toBe("docked");
  });

  it("auto-hide, desktop on screen: the strip in its band (a reveal does not matter)", () => {
    expect(trayPlacement({ ...covered, desktopOn: true })).toBe("docked");
    expect(trayPlacement({ ...covered, desktopOn: true, revealed: true })).toBe("docked");
  });

  it("auto-hide, panes cover the desktop: the handle; revealed: over the panes", () => {
    expect(trayPlacement(covered)).toBe("handle");
    expect(trayPlacement({ ...covered, revealed: true })).toBe("overlay");
  });

  it("nothing to dock, or a full-window page: no tray at all", () => {
    expect(trayPlacement({ ...covered, items: 0 })).toBe("none");
    expect(trayPlacement({ ...pinned, items: 0 })).toBe("none");
    expect(trayPlacement({ ...covered, items: 0, desktopOn: true })).toBe("none");
    expect(trayPlacement({ ...pinned, fullWindow: true, desktopOn: true })).toBe("none");
  });

  it("the desktop layer is mounted behind the panes unless a full-window page or the first-run guide shows", () => {
    expect(desktopMounted({ hasLayer: true, fullWindow: false, firstRun: false })).toBe(true);
    expect(desktopMounted({ hasLayer: true, fullWindow: true, firstRun: false })).toBe(false);
    expect(desktopMounted({ hasLayer: true, fullWindow: false, firstRun: true })).toBe(false);
    expect(desktopMounted({ hasLayer: false, fullWindow: false, firstRun: false })).toBe(false);
  });
});

describe("reveal and auto-hide", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hideTray();
  });
  afterEach(() => vi.useRealTimers());

  it("bottom edge: revealed, hides unless the pointer goes in; in = held; out = hides after a moment", () => {
    revealTray("edge");
    releaseTray(TRAY_EDGE_GRACE_MS);
    expect(useTray.getState().revealed).toBe(true);
    vi.advanceTimersByTime(TRAY_EDGE_GRACE_MS + 1);
    expect(useTray.getState().revealed).toBe(false);

    revealTray("edge");
    releaseTray(TRAY_EDGE_GRACE_MS);
    holdTray(); // the pointer went in
    vi.advanceTimersByTime(TRAY_EDGE_GRACE_MS * 4);
    expect(useTray.getState()).toMatchObject({ revealed: true, held: true });
    releaseTray(); // and out again
    vi.advanceTimersByTime(TRAY_HIDE_MS - 10);
    expect(useTray.getState().revealed).toBe(true);
    vi.advanceTimersByTime(20);
    expect(useTray.getState().revealed).toBe(false);
  });

  it("the shortcut: toggles; never used → hides by itself; held (pointer / a menu of it) → stays", () => {
    toggleTray();
    expect(useTray.getState()).toMatchObject({ revealed: true, via: "key" });
    toggleTray();
    expect(useTray.getState().revealed).toBe(false);
    toggleTray();
    vi.advanceTimersByTime(TRAY_IDLE_MS + 1);
    expect(useTray.getState().revealed).toBe(false);
    toggleTray();
    holdTray();
    vi.advanceTimersByTime(TRAY_IDLE_MS * 3);
    expect(useTray.getState().revealed).toBe(true);
  });

  it("Ctrl / ⌘ + J only (not with Shift / Alt, not a plain J)", () => {
    const k = (o: Partial<KeyboardEvent>) => ({ code: "KeyJ", key: "j", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
    expect(isTrayKey(k({ ctrlKey: true }))).toBe(true);
    // ⌘ on macOS (lib/keybindings Mod); elsewhere the Windows / Super key is not Ctrl.
    expect(isTrayKey(k({ metaKey: true }))).toBe(false);
    setKeybindingPlatform("mac");
    expect(isTrayKey(k({ metaKey: true }))).toBe(true);
    setKeybindingPlatform(null);
    expect(isTrayKey(k({}))).toBe(false);
    expect(isTrayKey(k({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isTrayKey(k({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isTrayKey(k({ ctrlKey: true, code: "KeyK", key: "k" }))).toBe(false);
  });

});

describe("the desktop is the bottom layer", () => {
  it("its box is all of the work area whatever floats over it (edit panel, tray)", () => {
    const boxes = [false, true].flatMap((editing) => (["desktop", "none"] as const).map((tray) => deskGeometry({ editing, tray }).layer));
    for (const b of boxes) expect(b).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("编辑主页 floats as a card over its right side; the content keeps clear of a floating tray", () => {
    expect(deskGeometry({ editing: false, tray: "desktop" }).panel).toBeNull();
    const g = deskGeometry({ editing: true, tray: "desktop" });
    // Checklist #16: a card of the work row — flush with its top / right / bottom edges (the row keeps 8 px from the window).
    expect(g.panel).toMatchObject({ right: 0, top: 0, width: DESK_PANEL_W });
    expect(deskGeometry({ editing: true, tray: "none" }).panel!.bottom).toBe(0);
    expect(DESK_PANEL_W).toBeGreaterThanOrEqual(286 + g.content.right);
    // The panel ends above the tray; the content's sides do not move for the panel.
    expect(g.panel!.bottom).toBeGreaterThan(deskGeometry({ editing: true, tray: "none" }).panel!.bottom);
    expect(g.content.right).toBe(deskGeometry({ editing: false, tray: "desktop" }).content.right);
    expect(g.content.bottom).toBeGreaterThan(deskGeometry({ editing: false, tray: "none" }).content.bottom);
  });
});

const pin = (key: string, kind: HomePin["kind"] = "agent", hostId = "local"): HomePin => ({ hostId, kind, key });

describe("the tray's pins and the desktop's icons are two lists (owner 2026-10-24)", () => {
  const keysOf = (pins: readonly HomePin[]) => pins.map((p) => p.key);

  it("the tray shows the home pins in their order; an icon's size changes only the desktop", () => {
    let d: HomeDoc = { deskIcons: [] };
    for (const p of [pin("eva"), pin("reader", "service"), pin("cutex:artifact/x@latest", "artifact")]) d = withPin(d, p);
    expect(dockPins(d).map(pinId)).toEqual(pinsOf(d).map(pinId));
    // Pinning in the tray puts nothing on the desktop.
    expect(deskIconsOf(d)).toEqual([]);
    d = withDeskIcon(d, pin("reader", "service"));
    const resized = withDeskIconSize(d, pinId(pin("reader", "service")), "w");
    expect(dockPins(resized)).toEqual(dockPins(d));
    expect(sizeOf(deskIconsOf(resized)[0]!)).toBe("w");
    expect(withPinMoved(d, pinId(pin("eva")), 2).deskIcons).toEqual(d.deskIcons);
  });

  it("a document from before the split: the desktop shows the pins, and the first tray change copies them in once", () => {
    let d: HomeDoc = { pins: [pin("a"), pin("b"), pin("reader", "service")] };
    expect(deskIconsStored(d)).toBe(false);
    expect(keysOf(deskIconsOf(d))).toEqual(["a", "b", "reader"]);
    // Nothing changes: no copy written.
    expect(withPinMoved(d, "missing", 0)).toBe(d);
    expect(withPinBefore(d, pinId(pin("a")), pinId(pin("b")))).toBe(d);
    // 取消固定 in the tray: the icon stays on the desktop.
    d = withoutPin(d, pinId(pin("b")));
    expect(keysOf(pinsOf(d))).toEqual(["a", "reader"]);
    expect(deskIconsStored(d)).toBe(true);
    expect(keysOf(deskIconsOf(d))).toEqual(["a", "b", "reader"]);
    // From now on the lists are apart: a new pin is not an icon, and moving pins leaves the icons alone.
    d = withPin(d, pin("c"));
    expect(isOnDesk(d, pin("c"))).toBe(false);
    d = withPinMoved(d, pinId(pin("c")), 0);
    expect(keysOf(deskIconsOf(d))).toEqual(["a", "b", "reader"]);
    // A reorder as the first change copies too.
    const moved = withPinBefore({ pins: [pin("a"), pin("b")] }, pinId(pin("b")), pinId(pin("a")));
    expect(keysOf(pinsOf(moved))).toEqual(["b", "a"]);
    expect(keysOf(deskIconsOf(moved))).toEqual(["a", "b"]);
  });

  it("从桌面移除 leaves the tray's pin; 取消固定 in the tray leaves the icon; 撤销 puts the pin back where it was", () => {
    let d: HomeDoc = {};
    for (const k of ["a", "b", "c"]) d = withPin(d, pin(k));
    // Before the split the first pin change copied nothing (there was nothing): the desktop is empty.
    expect(deskIconsOf(d)).toEqual([]);
    d = withDeskIcon(withDeskIcon(d, pin("a")), pin("b"));
    const offDesk = withoutDeskIcon(d, pinId(pin("b")));
    expect(keysOf(deskIconsOf(offDesk))).toEqual(["a"]);
    expect(keysOf(pinsOf(offDesk))).toEqual(["a", "b", "c"]);
    const gone = withoutPin(d, pinId(pin("b")));
    expect(keysOf(pinsOf(gone))).toEqual(["a", "c"]);
    expect(keysOf(dockPins(gone))).toEqual(["a", "c"]);
    expect(keysOf(deskIconsOf(gone))).toEqual(["a", "b"]);
    expect(keysOf(pinsOf(withPinAt(gone, pin("b"), 1)))).toEqual(["a", "b", "c"]);
    // Already back (another device): unchanged.
    expect(withPinAt(d, pin("b"), 0)).toBe(d);
  });

  it("an icon is added once (already there / 64 = unchanged); malformed stored entries are skipped", () => {
    let d: HomeDoc = { deskIcons: [pin("a"), { kind: "agent" }, pin("a")] as unknown as HomeDoc["deskIcons"] };
    expect(keysOf(deskIconsOf(d))).toEqual(["a"]);
    expect(withDeskIcon({ deskIcons: [pin("a")] }, pin("a"))).toEqual({ deskIcons: [pin("a")] });
    d = { deskIcons: [] };
    for (let i = 0; i < 70; i++) d = withDeskIcon(d, pin(`s${i}`));
    expect(deskIconsOf(d)).toHaveLength(64);
    expect(withoutDeskIcon(d, "missing")).toBe(d);
  });

  it("an icon put on a desk whose tiles were turned off turns them back on", () => {
    const d: HomeDoc = { deskIcons: [], desk: { v: 1, items: [], bands: {}, off: ["home.tile"] } };
    const next = withIconOnDesk(d, pin("eva"));
    expect(isOnDesk(next, pin("eva"))).toBe(true);
    expect((next.desk as { off?: string[] }).off).toBeUndefined();
    expect(next.blocks?.find((b) => b.id === "tiles")?.visible).toBe(true);
  });
});

describe("badges from cutex state", () => {
  it("agents: 需要你 with its number (the only number); running / unread / error as dots; offline dimmed", () => {
    expect(agentBadge("needsYou", 3)).toEqual({ dot: "needs", count: 3, dim: false });
    expect(agentBadge("needsYou", 0)).toMatchObject({ dot: "needs", count: 1 });
    expect(agentBadge("running", 0)).toEqual({ dot: "running", count: null, dim: false });
    expect(agentBadge("done", 0)).toEqual({ dot: "unread", count: null, dim: false });
    expect(agentBadge("error", 0)).toMatchObject({ dot: "error", count: null });
    expect(agentBadge("idle", 0)).toEqual({ dot: null, count: null, dim: false });
    expect(agentBadge("offline", 0)).toMatchObject({ dot: null, dim: true });
    expect(agentBadge(undefined, 0).dot).toBeNull();
  });

  it("services: their health (no numbers)", () => {
    expect(serviceBadge("reachable")).toMatchObject({ dot: "ok", count: null });
    expect(serviceBadge("starting").dot).toBe("warn");
    expect(serviceBadge("unreachable").dot).toBe("error");
    for (const s of ["stopped", "offline", "missing"]) expect(serviceBadge(s)).toMatchObject({ dot: null, dim: true });
    expect(serviceBadge("unknown")).toEqual({ dot: null, count: null, dim: false });
  });
});

describe("workspace refs", () => {
  it("agents, services and artifacts open / drag through the workspace model; a link does not", () => {
    expect(dockRef({ hostId: "local", kind: "agent", key: "eva", title: "Eva" })).toEqual({ kind: "agent", hostId: "local", key: "eva", title: "Eva" });
    expect(dockRef(pin("reader", "service"))).toEqual({ kind: "service", hostId: "local", key: "reader" });
    expect(dockRef(pin("cutex:artifact/x@latest", "artifact"))?.kind).toBe("artifact");
    expect(dockRef(pin("https://example.org", "url"))).toBeNull();
  });
});

describe("打开方式 per item", () => {
  it("default 替换; a choice per pin; 替换 again = not stored", () => {
    const a = pin("a");
    const b = pin("b", "service");
    expect(openModeOf({}, a)).toBe("replace");
    let m = withOpenMode({}, a, "beside");
    m = withOpenMode(m, b, "project");
    expect(openModeOf(m, a)).toBe("beside");
    expect(openModeOf(m, b)).toBe("project");
    expect(openModeOf(m, pin("a", "agent", "ssh-ws"))).toBe("replace");
    m = withOpenMode(m, a, "replace");
    expect(m).toEqual({ [pinId(b)]: "project" });
  });

  it("unpinned items forget their choice; stored values are checked", () => {
    const m = withOpenMode(withOpenMode({}, pin("a"), "beside"), pin("b"), "project");
    expect(prunedModes(m, [pin("b")])).toEqual({ [pinId(pin("b"))]: "project" });
    expect(prunedModes(m, [pin("a"), pin("b")])).toBe(m);
    expect(readModes({ x: "beside", y: "bogus", z: "replace", w: 3 })).toEqual({ x: "beside" });
    expect(readModes(null)).toEqual({});
    expect(readModes(["beside"])).toEqual({});
  });
});

describe("the tray's band and edge (owner 2026-10-21)", () => {
  const frame = { left: 0, top: 40, right: 1600, bottom: 1000 };

  it("docked: a band of its own; auto-hidden: only the handle's thin band (also while revealed: the panes do not move)", () => {
    expect(trayBand("docked")).toBe(TRAY_BAND_PX);
    expect(TRAY_BAND_PX).toBeGreaterThanOrEqual(TRAY_DOCK_PX);
    expect(trayBand("handle")).toBe(TRAY_HANDLE_PX);
    expect(trayBand("overlay")).toBe(TRAY_HANDLE_PX);
    expect(trayBand("none")).toBe(0);
    // The handle is a pill one can find and hit, not a hairline.
    expect(TRAY_HANDLE_PX).toBeGreaterThanOrEqual(12);
  });

  it("the panes get the work area minus the band at the docked edge: never under the tray", () => {
    for (const edge of ["bottom", "top", "left", "right"] as const) {
      const area = paneArea(frame, edge, TRAY_BAND_PX);
      const lost = frame.right - frame.left - (area.right - area.left) + (frame.bottom - frame.top - (area.bottom - area.top));
      expect(lost).toBe(TRAY_BAND_PX);
      // The band's own box (the rest of the frame) does not intersect the panes' area.
      const band = edge === "bottom" ? { ...frame, top: area.bottom } : edge === "top" ? { ...frame, bottom: area.top } : edge === "left" ? { ...frame, right: area.left } : { ...frame, left: area.right };
      const overlapW = Math.min(band.right, area.right) - Math.max(band.left, area.left);
      const overlapH = Math.min(band.bottom, area.bottom) - Math.max(band.top, area.top);
      expect(overlapW <= 0 || overlapH <= 0).toBe(true);
    }
    expect(paneArea(frame, "bottom", 0)).toEqual(frame);
  });

  it("dragging the grip: the nearest edge of the work area (relative to its size)", () => {
    expect(trayDropEdge({ x: 800, y: 990 }, frame)).toBe("bottom");
    expect(trayDropEdge({ x: 800, y: 50 }, frame)).toBe("top");
    expect(trayDropEdge({ x: 10, y: 500 }, frame)).toBe("left");
    expect(trayDropEdge({ x: 1590, y: 500 }, frame)).toBe("right");
    // 100 px from the left of 1600 px (6 %) beats 100 px from the bottom of 960 px (10 %).
    expect(trayDropEdge({ x: 100, y: 900 }, frame)).toBe("left");
    expect(trayDropEdge({ x: 300, y: 950 }, frame)).toBe("bottom");
  });

  it("vertical on the left / right; the arrow keys follow the orientation", () => {
    expect(trayVertical("left")).toBe(true);
    expect(trayVertical("right")).toBe(true);
    expect(trayVertical("bottom")).toBe(false);
    expect(trayVertical("top")).toBe(false);
    expect(trayArrowStep("ArrowRight", false)).toBe(1);
    expect(trayArrowStep("ArrowLeft", false)).toBe(-1);
    expect(trayArrowStep("ArrowDown", false)).toBe(0);
    expect(trayArrowStep("ArrowDown", true)).toBe(1);
    expect(trayArrowStep("ArrowUp", true)).toBe(-1);
    expect(trayArrowStep("ArrowRight", true)).toBe(0);
  });

  it("stored prefs: 托盘常驻 on, the bottom, two columns and one tray row by default; unknown values fall back", () => {
    expect(DEFAULT_TRAY_PREFS).toEqual({ persistent: true, edge: "bottom", allowThreeColumns: false, twoRows: false });
    expect(parseTrayPrefs(null)).toEqual(DEFAULT_TRAY_PREFS);
    expect(parseTrayPrefs({ persistent: false, edge: "left" })).toEqual({ persistent: false, edge: "left", allowThreeColumns: false, twoRows: false });
    expect(parseTrayPrefs({ allowThreeColumns: true })).toEqual({ ...DEFAULT_TRAY_PREFS, allowThreeColumns: true });
    expect(parseTrayPrefs({ twoRows: true })).toEqual({ ...DEFAULT_TRAY_PREFS, twoRows: true });
    expect(parseTrayPrefs({ twoRows: "yes" })).toEqual(DEFAULT_TRAY_PREFS);
    expect(parseTrayPrefs({ persistent: "no", edge: "middle", allowThreeColumns: "yes", grouping: "project" })).toEqual(DEFAULT_TRAY_PREFS);
    expect(parseTrayPrefs([1])).toEqual(DEFAULT_TRAY_PREFS);
  });
});
