// @vitest-environment jsdom
// Multi-window P4: agent HTML pages and HTML files drawn in desk windows (docs/desktop-modules.md §24.17, §10.2).
// Main leases each one-use document to the ONE webContents it is drawn in (the main window or a desk it opened),
// resolved at prepare time; it loads only there, a page's native confirm parents to that window, and the lease
// and channels go when that window goes. The renderer creates the frame in the desk's document, listens for the
// page's messages on the desk window, and checks the copy gesture against the desk document. Nothing new is
// opened to the page: the same three channels, the same CSP and frame sandbox.
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { OFFLINE_PAGE_CSP } from "@cutex-desktop/opaque-frame/page";
import { OPAQUE_FRAME_SANDBOX } from "@cutex-desktop/opaque-frame";
import type { ArtifactContent, ArtifactDetail } from "../src/shared/artifactStore";
import { PAGE_MESSAGE_TAG } from "../src/shared/pageBridge";
import { createArtifactPageService, PAGE_DOCUMENTS_PER_OWNER, preparePlaced, type PageChannelDeps } from "../src/main/frames";
import { DeskRegistry } from "../src/main/deskWindows";
import { createPageStorage } from "../src/main/pageStorage";
import { frameGestureActive } from "../src/renderer/src/modules/artifacts/pageBroker";

const frames = {
  prepareArtifactPage: vi.fn(async (_input: unknown, _deskId?: string) => ({ ok: true as const, frame: { id: "f1", url: "about:blank" } })),
  prepareFilePage: vi.fn(async (_input: unknown, _deskId?: string) => ({ ok: true as const, frame: { id: "f2", url: "about:blank" }, externalRefs: 0 })),
  release: vi.fn(async (_id: string) => {}),
  page: vi.fn(async (_id: string, _call: unknown) => ({ ok: true as const, value: "v" })),
};
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { frames }, api: {}, onEvent: () => () => {} }));
const { PageFrame } = await import("../src/renderer/src/modules/artifacts/PageFrame");
const { FilePageFrame } = await import("../src/renderer/src/components/FilePageFrame");
const { DeskContext } = await import("../src/renderer/src/lib/deskContext");
const { I18nProvider } = await import("../src/renderer/src/i18n");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MAIN = 7; // the main window's webContents (the renderer that asks)
const DESK = 21; // a desk window's webContents
const OTHER_DESK = 22;
const A = "af-0123456789abcdef0123456789abcdef";
const content: ArtifactContent = { version: 2, encoding: "utf8", content: "<p>form</p>", offset: 0, totalBytes: 11, truncated: false, mediaType: "text/html", sha256: null, externalChanged: null };
const detail = { artifact: { artifactId: A, name: "decide.html" }, versions: [{ version: 2, producer: { kind: "agent", sessionId: "s-writer", displayName: "demo-writer", attribution: null } }] } as unknown as ArtifactDetail;

function mainSide(options: { confirm?: PageChannelDeps["confirm"]; open?: Set<number> } = {}) {
  const documents = createFrameDocumentStore({ scheme: "cutex-plugin" });
  const open = options.open ?? new Set([DESK, OTHER_DESK]);
  const confirm = vi.fn(options.confirm ?? (async () => true));
  const submit = vi.fn(async () => ({}));
  const service = createArtifactPageService({
    documents,
    placeOpen: (owner, place) => owner === MAIN && open.has(place),
    contentReader: () => ({ artifactStoreContent: async () => content }),
    fileReader: () => ({ fileWindow: async () => ({ content: "<p>file</p>", encoding: "utf8", size: 11, truncated: false, offset: 0 }) as never }),
    ensureContained: async () => {},
    page: { storage: createPageStorage({ root: mkdtempSync(join(tmpdir(), "mw-p4-")) }), host: () => ({ artifactStoreGet: async () => detail, submit }), confirm, writeClipboard: vi.fn(), locale: () => "en" },
  });
  const prepare = async (place: number) => {
    const r = await service.prepare(MAIN, { hostId: "local", artifactId: A, version: 2 }, place);
    if (!r.ok) throw new Error("prepare");
    return r.frame;
  };
  return { documents, service, confirm, submit, prepare, open };
}

describe("main: a frame document is leased to the window it is drawn in", () => {
  it("a desk's page loads only in that desk; the main window's only in the main window", async () => {
    const m = mainSide();
    const inDesk = await m.prepare(DESK);
    const inMain = await m.prepare(MAIN);
    expect(m.documents.ownsUrl(inDesk.url, DESK)).toBe(true);
    expect(m.documents.ownsUrl(inDesk.url, MAIN)).toBe(false);
    expect(m.documents.ownsUrl(inDesk.url, OTHER_DESK)).toBe(false);
    expect(m.documents.ownsUrl(inMain.url, MAIN)).toBe(true);
    expect(m.documents.ownsUrl(inMain.url, DESK)).toBe(false);
  });

  it("CSP and sandbox of a desk's document are the same offline ones", async () => {
    const m = mainSide();
    const inDesk = await m.prepare(DESK);
    const response = m.documents.respond(new Request(inDesk.url));
    expect(response.headers.get("content-security-policy")).toBe(`${OFFLINE_PAGE_CSP}; sandbox allow-scripts`);
    // One use, as before.
    expect(m.documents.respond(new Request(inDesk.url)).status).toBe(404);
  });

  it("a desk closed while its page was read gets no document", async () => {
    const m = mainSide({ open: new Set() });
    await expect(m.service.prepare(MAIN, { hostId: "local", artifactId: A, version: 2 }, DESK)).rejects.toThrow();
    await expect(m.service.prepareFile(MAIN, { hostId: "local", path: "/x/a.html" }, DESK)).rejects.toThrow();
    // The owner's own window needs no desk.
    expect((await m.service.prepare(MAIN, { hostId: "local", artifactId: A, version: 2 })).ok).toBe(true);
  });

  it("the submit confirm parents to the window bound at prepare (the desk), not to anything named later", async () => {
    const m = mainSide();
    const inDesk = await m.prepare(DESK);
    expect(await m.service.page(MAIN, inDesk.id, { op: "submit", format: "text", text: "hi" })).toEqual({ ok: true, sent: true });
    expect(m.confirm.mock.calls[0]![3]).toBe(DESK);
    const inMain = await m.prepare(MAIN);
    await new Promise((r) => setTimeout(r, 0));
    m.confirm.mockClear();
    // The page op carries no window: an extra argument is ignored by the service (and refused by the IPC handler).
    await (m.service.page as (...a: unknown[]) => Promise<unknown>)(MAIN, inMain.id, { op: "storage.keys" }, "dffffffffffff");
    expect(m.confirm).not.toHaveBeenCalled();
  });

  it("closing a desk releases exactly its documents and channels; an open confirm closes as cancel", async () => {
    let seen: AbortSignal | null = null;
    const m = mainSide({ confirm: (_o, _t, signal) => new Promise((resolve) => { seen = signal; signal.addEventListener("abort", () => resolve(true)); }) });
    const inDesk = await m.prepare(DESK);
    const unread = await m.prepare(DESK);
    const inOther = await m.prepare(OTHER_DESK);
    const inMain = await m.prepare(MAIN);
    const file = await m.service.prepareFile(MAIN, { hostId: "local", path: "/x/a.html" }, DESK);
    expect(file.ok && m.documents.ownsUrl(file.frame.url, DESK)).toBe(true);
    const pending = m.service.page(MAIN, inDesk.id, { op: "submit", format: "text", text: "hi" });
    await vi.waitFor(() => expect(seen).not.toBeNull());
    m.service.releasePlace(DESK);
    m.documents.releaseOwner(DESK);
    expect(await pending).toEqual({ ok: true, sent: false });
    expect(m.submit).not.toHaveBeenCalled();
    expect(await m.service.page(MAIN, inDesk.id, { op: "storage.keys" })).toEqual({ ok: false, error: "unavailable" });
    for (const url of [inDesk.url, unread.url, file.ok ? file.frame.url : ""]) expect(m.documents.ownsUrl(url, DESK)).toBe(false);
    // Another desk and the main window keep theirs.
    expect(m.documents.ownsUrl(inOther.url, OTHER_DESK)).toBe(true);
    expect(m.documents.ownsUrl(inMain.url, MAIN)).toBe(true);
    expect(await m.service.page(MAIN, inMain.id, { op: "storage.keys" })).toEqual({ ok: true, value: [] });
  });

  it("the renderer releasing a desk's frame drops its lease there; another renderer cannot", async () => {
    const m = mainSide();
    const inDesk = await m.prepare(DESK);
    m.service.release(99, inDesk.id);
    expect(m.documents.ownsUrl(inDesk.url, DESK)).toBe(true);
    expect(await m.service.page(99, inDesk.id, { op: "storage.keys" })).toEqual({ ok: false, error: "unavailable" });
    m.service.release(MAIN, inDesk.id);
    expect(m.documents.ownsUrl(inDesk.url, DESK)).toBe(false);
  });

  it("the main window's document going (reload, crash) releases its pages in every desk too", async () => {
    const m = mainSide();
    const inDesk = await m.prepare(DESK);
    const inMain = await m.prepare(MAIN);
    m.service.releaseOwner(MAIN);
    expect(m.documents.ownsUrl(inDesk.url, DESK)).toBe(false);
    expect(m.documents.ownsUrl(inMain.url, MAIN)).toBe(false);
  });
});

describe("main: the frames IPC prepare step (preparePlaced)", () => {
  // A real registry: desk "a" opened by MAIN (webContents DESK), desk "b" opened by another renderer (99).
  const registry = () => {
    let n = 0;
    const r = new DeskRegistry<object>(() => 0, (bytes) => (bytes === 6 ? ["00000000000a", "00000000000b"][n++]! : "f".repeat(bytes * 2 - 1) + n));
    for (const [owner, contents] of [[MAIN, DESK], [99, OTHER_DESK]] as const) {
      const t = r.issue(owner)!;
      r.admit({ url: "about:blank", frameName: t.name, openerId: owner });
      r.register(t.name, owner, {}, contents);
    }
    return r;
  };
  const input = { hostId: "local", artifactId: A, version: 2 };

  it("leases to the desk's webContents when the sender names its own open desk, else to the sender", async () => {
    const m = mainSide();
    const r = registry();
    const inDesk = await preparePlaced(m.service, r, MAIN, { op: "artifactPage", deskId: "d00000000000a", ...input });
    expect(inDesk.ok && m.documents.ownsUrl(inDesk.frame.url, DESK)).toBe(true);
    expect(inDesk.ok && m.documents.ownsUrl(inDesk.frame.url, MAIN)).toBe(false);
    const file = await preparePlaced(m.service, r, MAIN, { op: "filePage", deskId: "d00000000000a", hostId: "local", path: "/x/a.html" });
    expect(file.ok && m.documents.ownsUrl(file.frame.url, DESK)).toBe(true);
    const inMain = await preparePlaced(m.service, r, MAIN, { op: "artifactPage", ...input });
    expect(inMain.ok && m.documents.ownsUrl(inMain.frame.url, MAIN)).toBe(true);
  });

  it("another renderer's desk, a closed desk or a malformed id throws before anything is read", async () => {
    const service = { prepare: vi.fn(), prepareFile: vi.fn() };
    const r = registry();
    for (const deskId of ["d00000000000b", "dffffffffffff", "x", 21, null]) {
      expect(() => preparePlaced(service, r, MAIN, { op: "artifactPage", deskId, ...input })).toThrow("invalid frame request");
      expect(() => preparePlaced(service, r, MAIN, { op: "filePage", deskId, hostId: "local", path: "/x/a.html" })).toThrow("invalid frame request");
    }
    r.remove("d00000000000a");
    expect(() => preparePlaced(service, r, MAIN, { op: "artifactPage", deskId: "d00000000000a", ...input })).toThrow("invalid frame request");
    expect(service.prepare).not.toHaveBeenCalled();
    expect(service.prepareFile).not.toHaveBeenCalled();
  });
});

describe("main: one renderer's pages are capped across all its windows", () => {
  it("at most PAGE_DOCUMENTS_PER_OWNER in all its windows together; the main window keeps room for plugin frames", async () => {
    const m = mainSide();
    const held = [];
    for (let i = 0; i < PAGE_DOCUMENTS_PER_OWNER; i++) held.push(await m.prepare(i % 2 ? DESK : OTHER_DESK));
    // The main window's own count is 0, yet nothing more is leased anywhere: the cap is the renderer's.
    await expect(m.service.prepare(MAIN, { hostId: "local", artifactId: A, version: 2 }, MAIN)).rejects.toThrow("Too many prepared frame documents");
    await expect(m.service.prepareFile(MAIN, { hostId: "local", path: "/x/a.html" }, DESK)).rejects.toThrow("Too many prepared frame documents");
    // The main window's own key is untouched: plugin documents still fit there.
    const plugin = m.documents.add(MAIN, { html: "<p>p</p>", csp: "default-src 'none'" });
    expect(m.documents.ownsUrl(plugin.url, MAIN)).toBe(true);
    // Another renderer is not affected, and a released page makes room again.
    expect((await m.service.prepare(99, { hostId: "local", artifactId: A, version: 2 })).ok).toBe(true);
    m.service.release(MAIN, held[0]!.id);
    expect((await m.service.prepare(MAIN, { hostId: "local", artifactId: A, version: 2 }, DESK)).ok).toBe(true);
  });
});

describe("main: no new channel", () => {
  const preload = readFileSync(join(__dirname, "../src/preload/index.ts"), "utf8");
  it("the frames bridge sends the same six ops on the one frames channel; page requests name no window", () => {
    const ops = [...preload.matchAll(/(?<!\.)invoke\(FRAMES_CHANNEL, \{ op: "(\w+)"/g)].map((m) => m[1]).sort();
    expect(ops).toEqual(["artifactPage", "filePage", "page", "pageDataClear", "pageDataUsage", "release"]);
    expect(preload).toMatch(/page: \(id, call\) => (?<!\.)invoke\(FRAMES_CHANNEL, \{ op: "page", id, call \} satisfies FrameRequest\)/);
  });
});

describe("renderer: pages drawn in a desk", () => {
  const DESK_ID = "d000000000001";
  let deskFrame: HTMLIFrameElement;
  let deskDoc: Document;
  let deskWin: Window;
  let root: ReturnType<typeof createRoot>;
  let container: HTMLElement;

  beforeEach(() => {
    for (const f of Object.values(frames)) f.mockClear();
    deskFrame = document.createElement("iframe");
    document.body.append(deskFrame);
    deskDoc = deskFrame.contentDocument!;
    deskWin = deskFrame.contentWindow!;
    container = deskDoc.createElement("div");
    deskDoc.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    deskFrame.remove();
  });

  const renderInDesk = async (child: ReturnType<typeof h>) => {
    await act(async () => root.render(h(I18nProvider, null, h(DeskContext.Provider, { value: DESK_ID }, child))));
  };

  it("an agent page asks main for a document leased to this desk and mounts the frame in the desk document", async () => {
    await renderInDesk(h(PageFrame, { hostId: "local", artifactId: A, version: 2, title: "t" }));
    await vi.waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    expect(frames.prepareArtifactPage).toHaveBeenCalledWith({ hostId: "local", artifactId: A, version: 2 }, DESK_ID);
    const page = container.querySelector("iframe")!;
    expect(page.ownerDocument).toBe(deskDoc);
    expect(page.getAttribute("sandbox")).toBe(OPAQUE_FRAME_SANDBOX);
    expect(page.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(container.querySelector("[data-desk-page-notice]")).toBeNull();
  });

  it("the broker hears this frame's messages on the desk window (not the main window), per frame instance", async () => {
    await renderInDesk(h(PageFrame, { hostId: "local", artifactId: A, version: 2, title: "t" }));
    await vi.waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    const page = container.querySelector("iframe")!;
    const data = { tag: PAGE_MESSAGE_TAG, id: 1, op: "storage.keys" };
    // On the main window: not this frame's parent, nothing forwarded.
    window.dispatchEvent(new MessageEvent("message", { data, source: page.contentWindow, origin: "null" }));
    // On the desk window from another window (the desk itself): ignored.
    deskWin.dispatchEvent(new MessageEvent("message", { data, source: deskWin, origin: "null" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(frames.page).not.toHaveBeenCalled();
    deskWin.dispatchEvent(new MessageEvent("message", { data, source: page.contentWindow, origin: "null" }));
    await vi.waitFor(() => expect(frames.page).toHaveBeenCalledWith("f1", { op: "storage.keys" }));
    // The page op names no window (main bound it at prepare).
    expect(frames.page.mock.calls[0]).toHaveLength(2);
    // Unmounting (the desk closing) stops listening and releases the document.
    act(() => root.render(null));
    expect(frames.release).toHaveBeenCalledWith("f1");
    frames.page.mockClear();
    deskWin.dispatchEvent(new MessageEvent("message", { data, source: page.contentWindow, origin: "null" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(frames.page).not.toHaveBeenCalled();
  });

  it("a copy without a gesture in the desk document is answered here and never reaches main", async () => {
    await renderInDesk(h(PageFrame, { hostId: "local", artifactId: A, version: 2, title: "t" }));
    await vi.waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    const page = container.querySelector("iframe")!;
    deskWin.dispatchEvent(new MessageEvent("message", { data: { tag: PAGE_MESSAGE_TAG, id: 2, op: "copy", text: "x" }, source: page.contentWindow, origin: "null" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(frames.page).not.toHaveBeenCalled();
  });

  // jsdom has no userActivation: stub it per window (the desk's iframe window vs the main window).
  const activate = (view: Window, doc: Document, active: boolean, focused: Element | null) => {
    Object.defineProperty(view.navigator, "userActivation", { value: { isActive: active }, configurable: true });
    Object.defineProperty(doc, "hasFocus", { value: () => active, configurable: true });
    Object.defineProperty(doc, "activeElement", { get: () => focused, configurable: true });
  };
  const unstub = (view: Window, doc: Document) => {
    delete (view.navigator as { userActivation?: unknown }).userActivation;
    delete (doc as { hasFocus?: unknown }).hasFocus;
    delete (doc as { activeElement?: unknown }).activeElement;
  };
  const copyFromPage = async (page: HTMLIFrameElement, id: number) => {
    deskWin.dispatchEvent(new MessageEvent("message", { data: { tag: PAGE_MESSAGE_TAG, id, op: "copy", text: "x" }, source: page.contentWindow, origin: "null" }));
    await new Promise((r) => setTimeout(r, 0));
  };

  it("a copy during a gesture in the desk document goes to main; a gesture only in the main window does not count", async () => {
    await renderInDesk(h(PageFrame, { hostId: "local", artifactId: A, version: 2, title: "t" }));
    await vi.waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    const page = container.querySelector("iframe")!;
    try {
      // The click was in the desk (its document active and focused on the frame); the main window is idle.
      activate(deskWin, deskDoc, true, page);
      activate(window, document, false, null);
      await copyFromPage(page, 3);
      await vi.waitFor(() => expect(frames.page).toHaveBeenCalledWith("f1", { op: "copy", text: "x" }));
      frames.page.mockClear();
      // Reverse: the main window active and focused (even on this frame element), the desk idle -> refused here.
      activate(deskWin, deskDoc, false, null);
      activate(window, document, true, page);
      await copyFromPage(page, 4);
      expect(frames.page).not.toHaveBeenCalled();
    } finally {
      unstub(deskWin, deskDoc);
      unstub(window, document);
    }
  });

  it("a container whose document has no window gets no page (never a broker on another window)", async () => {
    const lost = document.implementation.createHTMLDocument("gone");
    const lostBox = lost.createElement("div");
    lost.body.append(lostBox);
    const onProblem = vi.fn();
    const lostRoot = createRoot(lostBox);
    await act(async () => lostRoot.render(h(I18nProvider, null, h(DeskContext.Provider, { value: DESK_ID }, h(PageFrame, { hostId: "local", artifactId: A, version: 2, title: "t", onProblem })))));
    await vi.waitFor(() => expect(onProblem).toHaveBeenCalledWith("failed"));
    expect(frames.prepareArtifactPage).not.toHaveBeenCalled();
    expect(lostBox.querySelector("iframe")).toBeNull();
    act(() => lostRoot.unmount());
  });

  it("an HTML file in a desk: leased to the desk, mounted in its document, no broker", async () => {
    await renderInDesk(h(FilePageFrame, { hostId: "local", path: "a.html", scope: { kind: "project", id: "p1" }, title: "a.html" }));
    await vi.waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    expect(frames.prepareFilePage).toHaveBeenCalledWith({ hostId: "local", path: "a.html", scope: { kind: "project", id: "p1" } }, DESK_ID);
    const page = container.querySelector("iframe")!;
    expect(page.ownerDocument).toBe(deskDoc);
    expect(page.getAttribute("sandbox")).toBe(OPAQUE_FRAME_SANDBOX);
    deskWin.dispatchEvent(new MessageEvent("message", { data: { tag: PAGE_MESSAGE_TAG, id: 1, op: "storage.keys" }, source: page.contentWindow, origin: "null" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(frames.page).not.toHaveBeenCalled();
  });

  it("in the main window nothing changes: no desk id is sent", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const mainRoot = createRoot(host);
    await act(async () => mainRoot.render(h(I18nProvider, null, h(PageFrame, { hostId: "local", artifactId: A, version: 2, title: "t" }))));
    await vi.waitFor(() => expect(host.querySelector("iframe")).not.toBeNull());
    expect(frames.prepareArtifactPage).toHaveBeenCalledWith({ hostId: "local", artifactId: A, version: 2 }, undefined);
    expect(host.querySelector("iframe")!.ownerDocument).toBe(document);
    act(() => mainRoot.unmount());
    host.remove();
  });
});

describe("renderer: the copy gesture is the desk document's", () => {
  const fakeDoc = (active: boolean, focus: boolean, activeElement: unknown) => ({ defaultView: { navigator: { userActivation: { isActive: active } } }, hasFocus: () => focus, activeElement }) as unknown as Document;
  it("checks the activation and focus of the document the frame is in", () => {
    const frame = {} as Element;
    expect(frameGestureActive(frame, fakeDoc(true, true, frame))).toBe(true);
    // A click in the main window does not count for a frame in a desk (the desk document has no activation / focus).
    expect(frameGestureActive(frame, fakeDoc(false, true, frame))).toBe(false);
    expect(frameGestureActive(frame, fakeDoc(true, false, frame))).toBe(false);
    expect(frameGestureActive(frame, fakeDoc(true, true, {}))).toBe(false);
  });
});
