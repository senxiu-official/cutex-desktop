// Preview entry for the 文件 explorer (docs/design/019-file-explorer.md), started by dev/mockBridge.ts with
// `?explorer`: an agent in view, its Shelf with the 文件 card. `?explorer=wide` 只看 Shelf (the explorer gets
// the width), `=gallery` the folder of generated images, `=reveal` 在文件树中显示 a file deep in the tree,
// `=search` 全部搜索, `=filter` the filter, `=narrow` a narrow Shelf (the preview below), `=keys` arrow
// keys through a folder, `=follow` a file opened from the conversation. `window.__explorer` repeats the steps for screenshots.
import { openFile, openSide, revealInTree } from "../lib/sideOpen";
import { enterShelfOnly, shelfOnlyPlan } from "../lib/shelfOnly";
import { setShelfWidth, shelfOnSide } from "../lib/sideLayout";
import { updateLayout, useSide } from "../lib/sideLayoutStore";
import { focusedConversation } from "../lib/paneLayout";
import { usePanes } from "../lib/paneStore";
import { useApp } from "../store";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function key(target: Element | null, k: string, extra: KeyboardEventInit = {}): void {
  target?.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
}
const list = () => document.querySelector("[data-explorer] [data-explorer-list]");
const input = () => document.querySelector<HTMLInputElement>("[data-explorer] input");

function type(el: HTMLInputElement | null, text: string): void {
  if (!el) return;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  set.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function installDevExplorer(params: URLSearchParams): Promise<void> {
  const mode = params.get("explorer") ?? "";
  await wait(600);
  const app = useApp.getState();
  const row = app.sidebar?.active[0];
  if (row) await app.select(row.cutexSessionId, app.hosts?.active ?? "local");
  await wait(300);
  for (const b of document.querySelectorAll<HTMLButtonElement>("button")) if (/跳过引导|Skip/.test(b.textContent ?? "")) b.click();
  openSide("workspace.files", {}, { reveal: true, focus: true });
  await wait(300);
  const shelf = shelfOnSide(useSide.getState().layout, "right");
  if (mode === "narrow" && shelf) updateLayout((l) => setShelfWidth(l, shelf.id, 380));
  else if (shelf) updateLayout((l) => setShelfWidth(l, shelf.id, 760));
  if (mode === "wide" || mode === "gallery") {
    await wait(200);
    const pane = focusedConversation(usePanes.getState().layout);
    if (pane) enterShelfOnly(shelfOnlyPlan(pane));
  }
  await wait(400);
  const api = {
    reveal: () => revealInTree("apps/desktop/src/renderer/src/lib/paneLayout.ts"),
    gallery: async () => {
      // Into the folder (a double-click), then a picture selected.
      revealInTree("apps/desktop/out/renders");
      await wait(700);
      document.querySelector('[data-explorer] [data-path="apps/desktop/out/renders"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await wait(500);
      document.querySelector<HTMLElement>('[data-explorer] [data-path="apps/desktop/out/renders/launch-hero-03.png"]')?.click();
    },
    search: async (q = "daemon") => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-explorer] button")];
      buttons.find((b) => /全部搜索|Search all/.test(b.textContent ?? ""))?.click();
      await wait(100);
      type(input(), q);
    },
    filter: (q = "pa") => type(input(), q),
    keys: async (...keys: string[]) => {
      for (const k of keys) {
        const [mod, name] = k.includes("+") ? k.split("+") : ["", k];
        key(list(), name!, { altKey: mod === "Alt", shiftKey: mod === "Shift", ctrlKey: mod === "Ctrl" });
        await wait(160);
      }
    },
  };
  (window as unknown as { __explorer: typeof api }).__explorer = api;
  if (mode === "reveal" || mode === "narrow") api.reveal();
  if (mode === "gallery") await api.gallery();
  if (mode === "search") await api.search();
  if (mode === "filter") {
    api.reveal();
    await wait(800);
    api.filter();
  }
  if (mode === "follow") {
    // A file opened elsewhere (a link in the conversation): the tree selects it (follow, 019 §3); one outside
    // the current folder only lights ◎.
    openFile("apps/desktop/src/main/daemon.ts");
  }
  if (mode === "keys") {
    api.reveal();
    await wait(900);
    await api.keys("ArrowDown", "ArrowDown", "Shift+ArrowDown");
  }
}
