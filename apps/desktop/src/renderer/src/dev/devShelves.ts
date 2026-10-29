// Preview entry for the Shelves (docs/desktop-modules.md §24.12), started by dev/mockBridge.ts with `?shelves`:
// a right Shelf (files / changes, a second page with the browser) and a left Shelf (a terminal page and a
// named empty page), so both Shelf Rails show. `?shelves=inner`: both rails on the inner edge. `window.__shelves`
// (for screenshots): `menu()` opens the right Shelf's ⋯, `dragMix()` starts a tab drag onto a pane of another
// kind on a Shelf that does not allow mixing (the refusal + "as a new pane" offer), `drop()` / `cancel()`.
import { openSide } from "../lib/sideOpen";
import { addShelfPage, findCard, locate, moveToNewShelf, setShelfOptions, shelfOnSide, switchPage } from "../lib/sideLayout";
import { updateLayout, useSide } from "../lib/sideLayoutStore";
import { useApp } from "../store";
import { launchable } from "../lib/sideMenus";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function idOf(result: unknown): string | null {
  const r = result as { status?: string; instanceId?: string };
  return r?.status === "opened" && r.instanceId ? r.instanceId : null;
}

async function build(inner: boolean, agent: string | null): Promise<void> {
  // An agent in view (the follow-bound tools show what it sees); the first-run dialogs out of the way.
  const app = useApp.getState();
  const row = app.sidebar?.active.find((r) => !agent || r.displayName === agent) ?? app.sidebar?.active[0];
  if (row) await app.select(row.cutexSessionId, app.hosts?.active ?? "local");
  await wait(300);
  for (const b of document.querySelectorAll<HTMLButtonElement>("button")) if (/跳过引导|Skip/.test(b.textContent ?? "")) b.click();
  const files = idOf(openSide("workspace.files", {}, { reveal: true, focus: true }));
  await wait(150);
  idOf(openSide("workspace.changes", {}, { reveal: true }));
  await wait(150);
  // The left Shelf's tool: the side chat (else any other launchable tool the preview has).
  const pick = launchable().find((i) => i.kind === "side-chat.chat") ?? launchable().find((i) => !/workspace|browser/.test(i.kind));
  const term = pick ? idOf(openSide(pick.kind, pick.params, { reveal: true })) : null;
  await wait(150);
  // The terminal goes to a left Shelf of its own; the left Shelf gets a second, named page.
  if (term) updateLayout((l) => moveToNewShelf(l, { instance: term }, "left", Date.now()));
  await wait(100);
  const left = shelfOnSide(useSide.getState().layout, "left");
  if (left) {
    updateLayout((l) => addShelfPage(l, left.id, { name: "资料", icon: "book" }).layout);
    const first = locate(useSide.getState().layout, term ?? "")?.page.id;
    if (first) updateLayout((l) => switchPage(l, first));
  }
  // The right Shelf: a browser page beside the workspace page.
  const right = shelfOnSide(useSide.getState().layout, "right");
  if (right) {
    updateLayout((l) => addShelfPage(l, right.id, { name: "网页", icon: "globe" }).layout);
    const web = useSide.getState().layout.activePage;
    openSide("browser.tab", { url: "https://example.com/docs" }, { reveal: true, ...(web ? { page: web } : {}) });
    await wait(150);
    const page = files ? locate(useSide.getState().layout, files)?.page.id : null;
    if (page) updateLayout((l) => switchPage(l, page));
  }
  if (inner) for (const x of useSide.getState().layout.shelves ?? []) updateLayout((l) => setShelfOptions(l, x.id, { railPlacement: "inner" }));
}

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function pointer(type: string, x: number, y: number, target: EventTarget, buttons = 1): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true }));
}

/** A tab of the left Shelf's terminal pane dragged onto the right Shelf's files pane header (mixing off there). */
async function dragMix(): Promise<void> {
  const layout = useSide.getState().layout;
  const left = shelfOnSide(layout, "left");
  const term = Object.entries(layout.instances).find(([id]) => locate(layout, id)?.page.shelf === left?.id)?.[0];
  const files = Object.entries(layout.instances).find(([id, i]) => i.kind === "workspace.files" && locate(layout, id))?.[0];
  if (!term || !files) return;
  const handle = document.querySelector(`[data-side-tab="${CSS.escape(term)}"]`);
  const target = document.querySelector(`[data-side-card-head="${CSS.escape(locate(layout, files)!.card.id)}"]`);
  if (!handle || !target) return;
  const from = center(handle);
  pointer("pointerdown", from.x, from.y, handle);
  pointer("pointermove", from.x + 12, from.y + 4, window);
  await wait(60);
  const to = center(target);
  pointer("pointermove", to.x - 30, to.y, window);
  await wait(120);
  pointer("pointermove", to.x - 20, to.y + 1, window);
}

export function installDevShelves(q: URLSearchParams): void {
  const at = Number(q.get("shelvesAt")) || 1500;
  const inner = q.get("shelves") === "inner";
  const agent = q.get("shelfAgent");
  (window as unknown as { __shelves: unknown }).__shelves = {
    menu: () => document.querySelector<HTMLElement>(`[data-shelf-menu="${CSS.escape(shelfOnSide(useSide.getState().layout, "right")?.id ?? "")}"]`)?.click(),
    dragMix,
    drop: () => pointer("pointerup", 0, 0, window, 0),
    card: (id: string) => findCard(useSide.getState().layout, id),
    snapshot: () => shelvesSnapshot(),
  };
  setTimeout(() => void build(inner, agent).then(() => ((window as unknown as { __shelvesReady: boolean }).__shelvesReady = true)), at);
}

/** The Shelves as plain data (screenshots / debugging). */
export function shelvesSnapshot(): unknown {
  const l = useSide.getState().layout;
  return { shelves: l.shelves, pages: l.pages.map((p) => ({ id: p.id, shelf: p.shelf, kept: p.kept, name: p.name, cards: p.cards.map((c) => [c.kind, c.tabs.length]) })), active: l.activePage };
}
