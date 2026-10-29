// 最大化 (rule 2, lib/panelGrow) wired to the stores: the Shelf hooks, the restore point (the panels' widths before:
// the single column's width, the two columns' widths / share and the group's place, the live Shelves' widths) and
// what drops it — the row's set of panes changing (a conversation pane or a Shelf comes or goes, the Shelf maximised
// folded or gone). Edge drags, something new opening inside a Shelf, a window resize, 独占 / 全屏 keep it (the
// maximised widths are real ones now, owner 2026-10-23). Started by lib/paneActions startPaneActions.
import { getAppearance, setAppearance } from "./appearance";
import { conversationPanes, paneBinding } from "./paneLayout";
import { setPaneLayout, usePanes } from "./paneStore";
import { dropRestorePoint, setGrowHooks, unexpand, useGrow, type GrowRestore } from "./panelGrow";
import { restorePanels } from "./panelFull";
import { fullscreenOn } from "./panelFull";
import { useRowDrag } from "./rowDrag";
import { editConvMeta, liveConversation, setMode, updateLayout, useSide } from "./sideLayoutStore";
import { expandShelf, findCard, findShelf, setShelfWidth, shelvesOf } from "./sideLayout";
import { growStoredMeta } from "./panelGrow";

/** The widths 最大化 changes, as they were. */
interface Widths {
  singleColumnW: number;
  colW: readonly (number | null)[];
  lead: number | null;
  leadShare: number | null;
  /** The pane layout's columns' shares (two filling workspaces). */
  cols: readonly number[];
  /** The live conversation's Shelves (null: the default width). */
  conv: string | null;
  shelves: readonly { id: string; width: number | null }[];
}

setGrowHooks({
  liveConv: liveConversation,
  layout: () => useSide.getState().layout,
  expand: (shelfId) => updateLayout((l) => expandShelf(l, shelfId)),
  restore: (e) => {
    if (e.conv === null || e.conv === liveConversation()) updateLayout((l) => unexpand(l, e));
    // The focus moved to another conversation meanwhile: that one's remembered Shelf (only this Shelf).
    else editConvMeta(e.conv, (meta) => growStoredMeta(meta, e.conv, e));
  },
  exclusiveOn: () => fullscreenOn() || !!useSide.getState().mode || !!usePanes.getState().layout.max,
  endExclusive: () => {
    restorePanels();
    if (useSide.getState().mode) setMode(null);
    if (usePanes.getState().layout.max) setPaneLayout((l) => ({ ...l, max: null }));
  },
  snapshot: (): Widths => {
    const r = useRowDrag.getState();
    return {
      singleColumnW: getAppearance().singleColumnW,
      colW: [...r.colW],
      lead: r.lead,
      leadShare: r.leadShare,
      cols: usePanes.getState().layout.cols.map((c) => c.w),
      conv: liveConversation(),
      shelves: shelvesOf(useSide.getState().layout).map((x) => ({ id: x.id, width: x.width ?? null })),
    };
  },
  restoreWidths: (raw: GrowRestore) => {
    const w = raw as Widths;
    if (getAppearance().singleColumnW !== w.singleColumnW) setAppearance({ singleColumnW: w.singleColumnW });
    useRowDrag.setState({ colW: [...w.colW], lead: w.lead, leadShare: w.leadShare });
    setPaneLayout((l) => (l.cols.length === w.cols.length ? { ...l, cols: l.cols.map((c, i) => ({ ...c, w: w.cols[i]! })) } : l));
    // The Shelves' widths: the conversation that was live then (another one's Shelves were not changed by 最大化).
    if (w.conv === liveConversation()) updateLayout((l) => w.shelves.reduce((acc, x) => (findShelf(acc, x.id) ? setShelfWidth(acc, x.id, x.width) : acc), l));
  },
});

/** The row's conversation panes and what each shows. */
function panesSig(): string {
  const l = usePanes.getState().layout;
  return conversationPanes(l)
    .map((id) => `${id}=${paneBinding(l, id)?.sessionId ?? ""}`)
    .join(",");
}

/** The live conversation's Shelves on screen (expanded). */
function shelvesSig(): string {
  const layout = useSide.getState().layout;
  return layout.open ? shelvesOf(layout).filter((x) => !x.collapsed).map((x) => x.id).join(",") : "";
}

/** Whether the target's panel is still there as it was maximised (a conversation pane; a Shelf expanded, a pane on its page). */
function holds(): boolean {
  const t = useGrow.getState().target;
  if (!t) return true;
  if (t.kind === "conv") return conversationPanes(usePanes.getState().layout).includes(t.paneId);
  // Another conversation's Shelf (the focus moved): the row draws it from that conversation's own layout.
  if (t.conv !== liveConversation()) return true;
  const layout = useSide.getState().layout;
  const shelf = findShelf(layout, t.shelfId);
  if (!shelf || shelf.collapsed || !layout.open) return false;
  return !t.card || !!findCard(layout, t.card);
}

let started = false;
export function startPanelGrow(): () => void {
  if (started) return () => {};
  started = true;
  let target = useGrow.getState().target;
  let panes = panesSig();
  // The Shelves of the conversation that was live when 最大化 began (another one focused meanwhile: not compared —
  // the focus moving between two workspaces changes nothing of the row).
  let conv = liveConversation();
  let shelves = shelvesSig();
  const check = () => {
    const s = useGrow.getState();
    // A new restore point (最大化 just expanded a collapsed Shelf for it): that is the set it belongs to.
    if (s.target !== target) {
      target = s.target;
      panes = panesSig();
      conv = liveConversation();
      shelves = shelvesSig();
      return;
    }
    if (!s.target) return;
    const p = panesSig();
    const sh = liveConversation() === conv ? shelvesSig() : shelves;
    const changed = p !== panes || sh !== shelves;
    panes = p;
    shelves = sh;
    if (changed || !holds()) dropRestorePoint();
  };
  const offA = usePanes.subscribe(check);
  const offB = useSide.subscribe(check);
  const offC = useGrow.subscribe(check);
  return () => {
    started = false;
    offA();
    offB();
    offC();
  };
}
