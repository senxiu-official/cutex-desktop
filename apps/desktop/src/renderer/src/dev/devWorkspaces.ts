// Preview entry for the workspaces (docs/desktop-modules.md §24.13; prototype .claude/preview-workspaces.html),
// started by dev/mockBridge.ts with `?ws=<scenario>`:
//   empty    one empty Shelf page with all currently available launcher sections
//   start    one workspace: the first agent with its own Shelf (files / changes, a 网页 page, a shared page)
//   project  + the second agent projected into that Shelf (a live conversation pane)
//   split    + the second agent side by side, with its own Shelf (both workspaces' Shelves live, §24.13)
//   replace  the workspace switched to the second agent (its own Shelf); the first one's is remembered
//   back     replace, then replaced back: the first agent's Shelf returns as it was
//   rails    Shelf Rail 常驻 (§24.12.3): the first agent's tool area closed (its Shelf as its rail) beside the second
//            agent with an empty Shelf (its empty rail: avatar + ＋)
//   service  a service (听书, made by Mika) in another agent's Shelf: 「打开 Mika」 (`&wsMenu`: its ▾ menu open)
//   svchdr   Mika's conversation with its header's 「N 个服务」 popover open (`&svcs=16`: Mika owns 16 services,
//            modules/services/mock.ts; `&svcPage=2`: PageDown pressed once)
//   svclink  听书 opened from Mika's header: linked (Mika's avatar + 断开); `&unlink`: 断开 pressed (pinned, toast)
//   popup    split, the first agent's 网页 page in view in its Shelf (the workspace WITHOUT the focus), then that web
//            page opens a popup (as main's `new-tab` event would): the new tab lands in the first agent's Shelf,
//            the focus stays on the second (design 017). `&before`: stop before the popup. `__ws.popup()` fires another.
//            `&folded`: the first agent's Shelf folded to its rail first — the popup lands there and it stays folded,
//            its 网页 page's Rail button flashes and keeps a dot until that page is opened (design 017, Q3).
//   click    popup's set-up, then a click inside that web page (main's browser `pressed`, as lib/shelfSource
//            pressInstance takes it): the first agent's workspace takes the focus (design 017, Q1). `&before`: stop
//            before it; `__ws.pageClick()` clicks again. `&frame`: an agent page (an <iframe>) on its own page in the
//            first agent's Shelf instead — press inside it for real (a mouse click; nothing is clicked for you).
//   reveal   popup's set-up with the first agent's files page in view (its 网页 tab behind), then main's `reveal` for
//            that tab (an agent acting on it): its 网页 page comes forward in that Shelf, the focus stays on the
//            second (design 017, Q2). `&before`: stop before it; `__ws.reveal()` reveals again.
// `&wsDrag=shelf|edge|conv`: a sidebar row held mid-drag over that target (the overlay's label). `window.__ws`
// drives the same from the console; `window.__wsReady` is set when the scene is built.
import { openSide } from "../lib/sideOpen";
import { addShelf, emptyLayout, collapseShelf, expandShelf, locate, moveToNewPage, setOpen, setPageShared, shelfOnSide, switchPage } from "../lib/sideLayout";
import { instanceOwner, updateLayout, useSide, withLiveShelf } from "../lib/sideLayoutStore";
import { pressInstance } from "../lib/shelfSource";
import { sideReveal } from "../lib/sideServices";
import { openBesideAt, projectInto, replaceWith, startWorkspaceDrag } from "../lib/workspaces";
import { useApp } from "../store";
import { openFromHeader, openServiceInShelf } from "../lib/serviceLink";
import { sideOpenFrom } from "../lib/shelfTarget";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function idOf(result: unknown): string | null {
  const r = result as { status?: string; instanceId?: string };
  return r?.status === "opened" && r.instanceId ? r.instanceId : null;
}

function pointer(type: string, x: number, y: number, target: EventTarget, buttons = 1): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true }));
}

/** The `?ws=popup` scene's web page (the first agent's 网页 tab) and its tab key. */
let popupOpener: { host: string; instanceId: string } | null = null;
let popups = 0;

/** The `?ws=click` scene's pane pressed inside (the web page, or with `&frame` the agent page). */
let clickTarget: string | null = null;

/** A click inside that page (main's `pressed`: modules/browser/popupOpen pressBrowserTab → pressInstance). */
function pageClick(): void {
  if (clickTarget) pressInstance(clickTarget);
}

/** main's `reveal` for the `?ws=reveal` scene's web page (as modules/browser/popupOpen revealBrowserTab does). */
function fireReveal(): void {
  const id = popupOpener?.instanceId;
  const owner = id ? instanceOwner(id) : undefined;
  if (!id || owner === undefined) return;
  if (owner) withLiveShelf(owner, () => sideReveal({ instanceId: id }));
  else sideReveal({ instanceId: id });
}

/** That web page opens a popup: main's `new-tab` event for it, through the browser module's handler. */
function firePopup(): void {
  if (!popupOpener) return;
  popups++;
  // As modules/browser/popupOpen does for main's `new-tab` (shell code does not import modules).
  sideOpenFrom({ instanceId: popupOpener.instanceId }, "browser.tab", { url: `https://example.com/docs/popup-${popups}` }, { binding: { kind: "host", hostId: popupOpener.host }, focus: false });
}

async function base(): Promise<{ first: string; second: string; host: string; web: string | null; files: string | null } | null> {
  const app = useApp.getState();
  const rows = app.sidebar?.active ?? [];
  const first = rows[0];
  const second = rows.find((r) => r.cutexSessionId !== first?.cutexSessionId && r.runtime?.status === "online") ?? rows[1];
  if (!first || !second) return null;
  const host = app.hosts?.active ?? "local";
  await app.select(first.cutexSessionId, host);
  await wait(300);
  for (const b of document.querySelectorAll<HTMLButtonElement>("button")) if (/跳过引导|Skip/.test(b.textContent ?? "")) b.click();
  const files = idOf(openSide("workspace.files", {}, { reveal: true, focus: true }));
  await wait(120);
  openSide("workspace.changes", {}, { reveal: true });
  await wait(120);
  // A 网页 page (a browser tab on a page of its own) and a shared page (在所有对话中显示).
  const web = idOf(openSide("browser.tab", { url: "https://example.com/docs" }, { reveal: true }));
  await wait(120);
  const right = shelfOnSide(useSide.getState().layout, "right");
  if (web && right) updateLayout((l) => moveToNewPage(l, { instance: web }, right.id, Date.now()));
  const shared = idOf(openSide("browser.tab", { url: "https://example.com/board" }, { reveal: true }));
  await wait(120);
  if (shared && right) {
    updateLayout((l) => moveToNewPage(l, { instance: shared }, right.id, Date.now()));
    const page = locate(useSide.getState().layout, shared)?.page.id;
    if (page) updateLayout((l) => setPageShared(l, page, true));
  }
  const back = files ? locate(useSide.getState().layout, files)?.page.id : null;
  if (back) updateLayout((l) => switchPage(l, back));
  return { first: first.cutexSessionId, second: second.cutexSessionId, host, web, files };
}

/** The service scenes (lib/serviceLink): 听书 (`audiobook`, owner Mika in the mock). */
async function buildService(scene: string, q: URLSearchParams): Promise<void> {
  const app = useApp.getState();
  const host = app.hosts?.active ?? "local";
  const rows = app.sidebar?.active ?? [];
  const owner = rows.find((r) => r.cutexSessionId === "mika");
  const other = rows.find((r) => r.cutexSessionId !== "mika" && r.runtime?.status === "online") ?? rows.find((r) => r.cutexSessionId !== "mika");
  if (!owner || !other) return;
  const click = (sel: string) => document.querySelector<HTMLElement>(sel)?.click();
  for (const b of document.querySelectorAll<HTMLButtonElement>("button")) if (/跳过引导|Skip/.test(b.textContent ?? "")) b.click();
  if (scene === "service") {
    await app.select(other.cutexSessionId, host);
    await wait(400);
    openSide("workspace.files", {}, { reveal: true });
    await wait(150);
    openServiceInShelf(host, "audiobook");
    await wait(400);
    if (q.has("wsMenu")) click("[data-service-owner-menu]");
    return;
  }
  await app.select(owner.cutexSessionId, host);
  await wait(400);
  if (scene === "svchdr") {
    openFromHeader("main", host, owner.cutexSessionId, { slug: "kks-voice-audition", displayName: "KKS Voice Audition" });
    await wait(300);
    click('[data-conv-item="network"]');
    if (q.get("svcPage") === "2") {
      await wait(200);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }));
    }
    return;
  }
  openFromHeader("main", host, owner.cutexSessionId, { slug: "audiobook", displayName: "听书" });
  await wait(400);
  if (q.has("unlink")) {
    click("[data-service-unlink]");
    await wait(300);
  }
}

/** The scenes with the first agent's Shelf (its 网页 page) beside the focused second agent (design 017). */
const SOURCE_SCENES = ["popup", "click", "reveal"];

async function build(scene: string): Promise<void> {
  if (scene === "header") {
    const app = useApp.getState();
    await app.select("eva", app.hosts?.active ?? "local");
    updateLayout(() => emptyLayout());
    return;
  }
  // A repeatable empty page, independent of previously persisted preview layouts.
  if (scene === "empty") {
    const app = useApp.getState();
    const first = app.sidebar?.active[0];
    if (first) await app.select(first.cutexSessionId, app.hosts?.active ?? "local");
    updateLayout(() => addShelf(emptyLayout(), "right").layout);
    return;
  }
  // No page at all (the Shelf folded to its empty rail, only ＋): its ＋ menu's 新建空页 makes the first page.
  if (scene === "nopages") {
    const app = useApp.getState();
    const first = app.sidebar?.active[0];
    if (first) await app.select(first.cutexSessionId, app.hosts?.active ?? "local");
    updateLayout(() => emptyLayout());
    return;
  }
  const b = await base();
  if (!b) return;
  await wait(200);
  if (scene === "project") projectInto(b.host, b.second);
  if (scene === "split" || SOURCE_SCENES.includes(scene)) {
    openBesideAt(b.host, b.second, "right");
    await wait(200);
    // The second workspace has its own Shelf: a terminal-free one with its files.
    openSide("workspace.files", {}, { reveal: true });
  }
  if (scene === "rails") {
    // No shared page (it would follow the focus into the second agent's Shelf, which stays empty here).
    for (const p of useSide.getState().layout.pages) if (p.shared) updateLayout((l) => setPageShared(l, p.id, false));
    updateLayout((l) => setOpen(l, false));
    await wait(200);
    openBesideAt(b.host, b.second, "right");
  }
  if (scene === "replace" || scene === "back") {
    replaceWith(b.host, b.second);
    await wait(200);
    openSide("workspace.changes", {}, { reveal: true, focus: true });
  }
  if (scene === "back") {
    // Replace back: the first agent's workspace returns as it was left (its pages, the page in view).
    await wait(300);
    replaceWith(b.host, b.first);
  }
  if (SOURCE_SCENES.includes(scene) && b.web) {
    // The first agent's Shelf expanded on its 网页 page (the second workspace opening folded it), then the focus
    // goes back to the second agent: the web page shows in the Shelf of the workspace WITHOUT the focus.
    const q = new URLSearchParams(location.search);
    const app = useApp.getState();
    await app.select(b.first, b.host);
    await wait(200);
    const at = locate(useSide.getState().layout, b.web);
    if (at) updateLayout((l) => expandShelf(switchPage(l, at.page.id), at.page.shelf ?? "", at.page.id));
    popupOpener = { host: b.host, instanceId: b.web };
    clickTarget = b.web;
    if (scene === "click" && q.has("frame")) {
      // An agent page (the mock's interactive sketch, an <iframe>) on a page of its own, in view.
      clickTarget = idOf(openSide("artifacts.view", { ref: "af-7d00d1e0a1b2c3d4e5f60718293a4b5c@latest" }, { reveal: true, focus: true }));
      await wait(300);
    }
    // Its files page in view: the 网页 tab is behind it (main's reveal brings it forward).
    const files = scene === "reveal" && b.files ? locate(useSide.getState().layout, b.files)?.page.id : null;
    if (files) updateLayout((l) => switchPage(l, files));
    if (q.has("folded")) {
      const shelf = locate(useSide.getState().layout, b.web)?.page.shelf;
      if (shelf) updateLayout((l) => collapseShelf(l, shelf));
    }
    await wait(200);
    await app.select(b.second, b.host);
    await wait(300);
    if (!q.has("before")) {
      if (scene === "popup") firePopup();
      if (scene === "click" && !q.has("frame")) pageClick();
      if (scene === "reveal") fireReveal();
    }
  }
  await wait(300);
}

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** A sidebar row (the second agent, else the last row) pressed and moved over `to` — held there (no drop). */
async function holdDrag(to: string): Promise<void> {
  const rows = [...document.querySelectorAll<HTMLElement>("[data-row-selectable]")];
  const src = rows.find((r) => !r.hasAttribute("data-row-selected")) ?? rows[rows.length - 1];
  const app = useApp.getState();
  const row = app.sidebar?.active.find((r) => r.cutexSessionId !== app.selectedId);
  if (!src || !row) return;
  const from = center(src);
  const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: from.x, clientY: from.y, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true });
  startWorkspaceDrag({ kind: "agent", hostId: app.hosts?.active ?? "local", key: row.cutexSessionId, title: row.displayName }, down);
  pointer("pointermove", from.x + 20, from.y + 4, window);
  await wait(50);
  const work = document.querySelector("[data-side-work]")!.getBoundingClientRect();
  const shelf = document.querySelector("[data-side-box], [data-shelf-box]")?.getBoundingClientRect();
  const point = to === "edge" ? { x: work.right - 20, y: work.top + work.height / 2 } : to === "shelf" && shelf ? { x: shelf.left + shelf.width / 2, y: shelf.top + shelf.height * 0.4 } : { x: work.left + work.width * 0.35, y: work.top + work.height * 0.45 };
  pointer("pointermove", point.x, point.y, window);
}

export function installDevWorkspaces(q: URLSearchParams): void {
  const scene = q.get("ws") || "start";
  const at = Number(q.get("wsAt")) || 1500;
  const drag = q.get("wsDrag");
  (window as unknown as { __ws: unknown }).__ws = { holdDrag, drop: () => pointer("pointerup", 0, 0, window, 0), popup: firePopup, pageClick, reveal: fireReveal };
  setTimeout(
    () =>
      void (["service", "svchdr", "svclink"].includes(scene) ? buildService(scene, q) : build(scene))
        .then(() => (drag ? holdDrag(drag) : undefined))
        .then(() => ((window as unknown as { __wsReady: boolean }).__wsReady = true)),
    at,
  );
}
