// Desk windows (multi-window P1), main side: the ticket / admission rules, the registry the window controls
// and frame owner group are checked against (main/deskWindows.ts), and the bounds memory per desk id
// (shared/windowBounds.ts). Electron wiring (main/deskShell.ts) was checked in a built app over CDP (P0 report).
import { describe, expect, it } from "vitest";
import { createFrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { confirmParent, DESK_NAME_PREFIX, DeskRegistry, frameRequestAllowed, MAX_DESKS, NONCE_TTL_MS } from "../src/main/deskWindows";
import { DEFAULT_DESK_SIZE, DESK_CASCADE, MAX_DESK_RECORDS, MIN_DESK_SIZE, parseWindowStates, refitBounds, restoreDeskBounds } from "../src/shared/windowBounds";

const MAIN = 7;
const OTHER = 9;

function registry() {
  let t = 1_000;
  let n = 0;
  const reg = new DeskRegistry<{ name: string }>(() => t, (bytes) => (n++).toString(16).padStart(bytes * 2, "0"));
  return { reg, advance: (ms: number) => (t += ms) };
}

/** Ticket → window.open admitted → did-create-window registered. */
function openDesk(reg: DeskRegistry<{ name: string }>, contentsId: number, requested?: string) {
  const ticket = reg.issue(MAIN, requested)!;
  const deskId = reg.admit({ url: "about:blank", frameName: ticket.name, openerId: MAIN });
  const entry = reg.register(ticket.name, MAIN, { name: ticket.name }, contentsId);
  return { ticket, deskId, entry };
}

describe("desk tickets and admission", () => {
  it("admits only about:blank with main's one-use name, from the window it was issued to", () => {
    const { reg } = registry();
    const ticket = reg.issue(MAIN)!;
    expect(ticket.name.startsWith(DESK_NAME_PREFIX)).toBe(true);
    expect(ticket.deskId).toMatch(/^d[0-9a-f]{12}$/);
    expect(reg.admit({ url: "https://example.com/", frameName: ticket.name, openerId: MAIN })).toBeNull();
    expect(reg.admit({ url: "about:blank", frameName: ticket.name, openerId: OTHER })).toBeNull();
    expect(reg.admit({ url: "about:blank", frameName: `${DESK_NAME_PREFIX}guess`, openerId: MAIN })).toBeNull();
    expect(reg.admit({ url: "about:blank", frameName: "anything", openerId: MAIN })).toBeNull();
    expect(reg.admit({ url: "about:blank", frameName: ticket.name, openerId: MAIN })).toBe(ticket.deskId);
    // One use.
    expect(reg.admit({ url: "about:blank", frameName: ticket.name, openerId: MAIN })).toBeNull();
  });

  it("a ticket expires", () => {
    const { reg, advance } = registry();
    const ticket = reg.issue(MAIN)!;
    advance(NONCE_TTL_MS + 1);
    expect(reg.admit({ url: "about:blank", frameName: ticket.name, openerId: MAIN })).toBeNull();
  });

  it("registers only a window main admitted (anything else is destroyed by the caller)", () => {
    const { reg } = registry();
    expect(reg.register(`${DESK_NAME_PREFIX}x`, MAIN, { name: "x" }, 20)).toBeNull();
    const ticket = reg.issue(MAIN)!;
    // Issued but never admitted.
    expect(reg.register(ticket.name, MAIN, { name: "y" }, 21)).toBeNull();
    const { entry } = openDesk(reg, 22);
    expect(entry).toMatchObject({ ownerId: MAIN, contentsId: 22 });
    expect(reg.size).toBe(1);
  });

  it("reopens a remembered desk under its id; a bad or taken id gets a new one", () => {
    const { reg } = registry();
    const { deskId } = openDesk(reg, 30, "d0123456789ab");
    expect(deskId).toBe("d0123456789ab");
    expect(reg.issue(MAIN, "d0123456789ab")!.deskId).not.toBe("d0123456789ab");
    expect(reg.issue(MAIN, "../../etc")!.deskId).toMatch(/^d[0-9a-f]{12}$/);
  });

  it("caps open + pending desks", () => {
    const { reg } = registry();
    for (let i = 0; i < MAX_DESKS; i++) expect(reg.issue(MAIN)).not.toBeNull();
    expect(reg.issue(MAIN)).toBeNull();
  });
});

describe("desk registry checks", () => {
  it("window controls: a desk id is honoured only for the window that opened it, while it is open", () => {
    const { reg } = registry();
    const { deskId } = openDesk(reg, 40);
    expect(reg.resolve(MAIN, deskId)?.contentsId).toBe(40);
    expect(reg.resolve(OTHER, deskId)).toBeNull();
    expect(reg.resolve(MAIN, "dffffffffffff")).toBeNull();
    expect(reg.resolve(MAIN, { deskId })).toBeNull();
    reg.remove(deskId!);
    expect(reg.resolve(MAIN, deskId)).toBeNull();
  });

  it("opaque frame requests: sub-frames of the main window or its registered desks, each its own leases only", () => {
    const { reg } = registry();
    const { deskId } = openDesk(reg, 50);
    // doc/a is leased to the main window, doc/d to desk 50.
    const leased = new Map([["cutex-plugin://doc/a", MAIN], ["cutex-plugin://doc/d", 50]]);
    const ownsUrl = (url: string, place: number) => leased.get(url) === place;
    const req = (webContentsId: number | undefined, resourceType = "subFrame", url = "cutex-plugin://doc/a") => frameRequestAllowed({ resourceType, webContentsId, url }, MAIN, reg, ownsUrl);
    expect(req(MAIN)).toBe(true);
    expect(req(50, "subFrame", "cutex-plugin://doc/d")).toBe(true);
    // A main-window lease is not served to the desk, nor the desk's to the main window (multi-window P4).
    expect(req(50)).toBe(false);
    expect(req(MAIN, "subFrame", "cutex-plugin://doc/d")).toBe(false);
    // Not a sub-frame, an unknown webContents, an unowned URL, no main window.
    expect(req(50, "mainFrame", "cutex-plugin://doc/d")).toBe(false);
    expect(req(MAIN, "xhr")).toBe(false);
    expect(req(51)).toBe(false);
    expect(req(undefined)).toBe(false);
    expect(req(50, "subFrame", "cutex-plugin://doc/b")).toBe(false);
    expect(frameRequestAllowed({ resourceType: "subFrame", webContentsId: 50, url: "cutex-plugin://doc/d" }, null, reg, ownsUrl)).toBe(false);
    // A closed desk's webContents no longer counts, even for its own (not yet released) lease.
    reg.remove(deskId!);
    expect(req(50, "subFrame", "cutex-plugin://doc/d")).toBe(false);
  });

  it("frame owner group: the owner and the desks it opened, each as its own place", () => {
    const { reg } = registry();
    openDesk(reg, 60);
    openDesk(reg, 61);
    expect(reg.frameHostOf(MAIN, MAIN)).toBe(MAIN);
    expect(reg.frameHostOf(61, MAIN)).toBe(61);
    expect(reg.frameHostOf(61, OTHER)).toBeNull();
    expect(reg.frameHostOf(62, MAIN)).toBeNull();
    expect(reg.frameHostOf(MAIN, null)).toBeNull();
    // A desk another window opened is not in this window's group.
    const ticket = reg.issue(OTHER)!;
    reg.admit({ url: "about:blank", frameName: ticket.name, openerId: OTHER });
    reg.register(ticket.name, OTHER, { name: "other" }, 63);
    expect(reg.frameHostOf(63, MAIN)).toBeNull();
    expect(reg.frameHostOf(63, OTHER)).toBe(63);
  });

  it("frame place at prepare: the sender itself, or an open desk it opened (never one it merely names)", () => {
    const { reg } = registry();
    const { deskId } = openDesk(reg, 65);
    expect(reg.placeFor(MAIN, undefined)).toBe(MAIN);
    expect(reg.placeFor(MAIN, deskId)).toBe(65);
    expect(reg.placeFor(OTHER, deskId)).toBeNull();
    expect(reg.placeFor(MAIN, "dffffffffffff")).toBeNull();
    expect(reg.placeFor(MAIN, "../x")).toBeNull();
    expect(reg.placeFor(MAIN, null)).toBeNull();
    expect(reg.placeFor(MAIN, 65)).toBeNull();
    reg.remove(deskId!);
    expect(reg.placeFor(MAIN, deskId)).toBeNull();
  });

  it("agent page confirm: the window the frame was prepared for, while it is still the owner's", () => {
    const { reg } = registry();
    const { deskId, ticket } = openDesk(reg, 70);
    const own = (id: number) => ({ name: `own-${id}` });
    expect(confirmParent(MAIN, MAIN, reg, own)).toEqual({ name: `own-${MAIN}` });
    expect(confirmParent(MAIN, 70, reg, own)).toEqual({ name: ticket.name });
    expect(confirmParent(OTHER, 70, reg, own)).toBeNull();
    expect(confirmParent(MAIN, 71, reg, own)).toBeNull();
    // The desk closed while its page waited: no dialog (the page hears `unavailable`).
    reg.remove(deskId!);
    expect(confirmParent(MAIN, 70, reg, own)).toBeNull();
  });

  it("the shared one-use store keyed by place: a document leased to one window is never served to another", () => {
    const { reg } = registry();
    openDesk(reg, 80);
    openDesk(reg, 81);
    const store = createFrameDocumentStore({ scheme: "cutex-plugin" });
    const doc = { html: "<p>x</p>", csp: "default-src 'none'" };
    const inMain = store.add(MAIN, doc);
    const inDesk = store.add(80, doc);
    const allowed = (webContentsId: number, url: string) => frameRequestAllowed({ resourceType: "subFrame", webContentsId, url }, MAIN, reg, (u, place) => store.ownsUrl(u, place));
    expect(allowed(MAIN, inMain.url)).toBe(true);
    expect(allowed(80, inDesk.url)).toBe(true);
    expect(allowed(80, inMain.url)).toBe(false);
    expect(allowed(81, inDesk.url)).toBe(false);
    expect(allowed(MAIN, inDesk.url)).toBe(false);
    // The desk closes: its leases go (releaseOwner by place), the main window's stay.
    store.releaseOwner(80);
    expect(allowed(80, inDesk.url)).toBe(false);
    expect(allowed(MAIN, inMain.url)).toBe(true);
  });
});

describe("window-state.json with desks", () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const right = { x: 1920, y: 0, width: 2560, height: 1400 };
  const state = (x: number, y: number, width = 1000, height = 700, maximized = false) => ({ bounds: { x, y, width, height }, maximized });

  it("reads the old single record as the main window's", () => {
    expect(parseWindowStates(state(10, 20))).toEqual({ main: state(10, 20), desks: {} });
    expect(parseWindowStates(null)).toEqual({ main: null, desks: {} });
    expect(parseWindowStates([1, 2])).toEqual({ main: null, desks: {} });
  });

  it("one record per valid desk id, at most MAX_DESK_RECORDS", () => {
    const desks: Record<string, unknown> = { "d0123456789ab": state(2000, 10), "../x": state(0, 0), dbad: state(0, 0), "d0123456789ac": { bounds: null } };
    for (let i = 0; i < MAX_DESK_RECORDS + 3; i++) desks[`d${String(i).padStart(12, "0")}`] = state(i, i);
    const parsed = parseWindowStates({ main: state(1, 2), desks });
    expect(parsed.main).toEqual(state(1, 2));
    expect(parsed.desks["d0123456789ab"]).toEqual(state(2000, 10));
    expect(Object.keys(parsed.desks)).toHaveLength(MAX_DESK_RECORDS);
    expect(parsed.desks["../x"]).toBeUndefined();
  });

  it("a saved desk on the other display comes back there", () => {
    expect(restoreDeskBounds(state(2200, 100, 1200, 900, true), [primary, right], null)).toEqual({ bounds: { x: 2200, y: 100, width: 1200, height: 900 }, maximized: true });
  });

  it("its display gone / nothing saved: next to the main window on the main window's display", () => {
    const anchor = { x: 100, y: 80, width: 1280, height: 820 };
    const r = restoreDeskBounds(state(5000, 100), [primary], anchor);
    expect(r.maximized).toBe(false);
    expect(r.bounds).toEqual({ x: 100 + DESK_CASCADE, y: 80 + DESK_CASCADE, ...DEFAULT_DESK_SIZE });
    // The main window on the right display: the desk opens there, kept inside it.
    const onRight = restoreDeskBounds(null, [primary, right], { x: 3800, y: 900, width: 600, height: 400 });
    expect(onRight.bounds.x + onRight.bounds.width).toBeLessThanOrEqual(right.x + right.width);
    expect(onRight.bounds.y + onRight.bounds.height).toBeLessThanOrEqual(right.height);
    expect(onRight.bounds.x).toBeGreaterThanOrEqual(right.x);
  });

  it("no anchor: centred on the primary display, never below the desk minimum unless the display is smaller", () => {
    expect(restoreDeskBounds(null, [primary], null).bounds).toEqual({ x: 440, y: 140, ...DEFAULT_DESK_SIZE });
    const tiny = restoreDeskBounds(null, [{ x: 0, y: 0, width: 500, height: 400 }], null).bounds;
    expect(tiny.width).toBe(500);
    expect(tiny.height).toBe(400);
    expect(MIN_DESK_SIZE.width).toBeGreaterThan(500);
  });

  it("display removed: a window left off every display moves to the primary one; one still visible stays", () => {
    expect(refitBounds({ x: 2200, y: 100, width: 1000, height: 700 }, [primary, right])).toBeNull();
    expect(refitBounds({ x: 2200, y: 100, width: 1000, height: 700 }, [primary])).toEqual({ x: 460, y: 170, width: 1000, height: 700 });
    expect(refitBounds({ x: 0, y: 0, width: 10, height: 10 }, [])).toBeNull();
  });
});
