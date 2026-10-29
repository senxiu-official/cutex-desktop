// Dragging the tray's agent entries (owner 2026-10-24, option A of .claude/previews/preview-tray-pin-reorder.html;
// design 039 §托盘 「钉住：可拖动调顺序，沿用 home 的排序」; extended the same day by 「图钉 + 拖动」, section 4 of
// .claude/previews/preview-tray-notes-badges.html v2). An entry's drag is the usual workspace drag
// (lib/workspaces startWorkspaceDrag) with a local target while the pointer is in the tray:
//   - over the pinned group a blue insertion line shows where it lands: a pinned entry moves there (model withPinBefore,
//     the home list's order; the desktop's icons are their own list), a 最近 entry is pinned there (「钉在这里」: across the divider);
//     the divider's pushpin counts as the pinned group's end;
//   - over 最近 a pinned entry is unpinned (the whole group lights up, 「取消固定」; it goes to the front of 最近);
//   - over the apps a dashed box says it cannot go there and a release cancels;
//   - resting 0.5 s on 「… N」 unfolds the folded items so it can land among them;
//   - over the desktop while it shows (owner 2026-10-24, deskDrop) a dashed box shows where its icon goes, 「放到桌面」:
//     the release puts an icon of the entry there (the tray's pins are not the desktop's icons any more). The desk's
//     left / right edge bands still open it beside, as before.
// Anywhere else (out of the tray) the workspace targets work as before. 左移 / 右移 and Alt+← / → move a pinned entry
// one step at a time. Each move / pin / unpin offers 撤销 (lib/shelves showShelfToast).
import { createPortal } from "react-dom";
import { create } from "zustand";
import { translate } from "../../i18n";
import { probe, type WorkspaceDragLocal } from "../../lib/workspaces";
import type { HomePin } from "../../../../shared/home";
import { deskDropTarget, useDeskDropHint, type DeskSpot } from "./deskDrop";
import { DROP_TINT } from "../../lib/dropTint";
import { useOverlayRoot } from "../../lib/ownerContext";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Marks {
  /** Where the dragged entry would land (a thin line between two entries). */
  line: Box | null;
  /** Said above the line (a 最近 entry crossing the divider: 「钉在这里」). */
  tip: string | null;
  /** A group it cannot go into (the apps; 最近 for a drag that cannot unpin). */
  refuse: (Box & { text: string }) | null;
  /** A group that takes the drop as a whole (a pinned entry over 最近: 「取消固定」). */
  accept: (Box & { text: string }) | null;
}

const NONE: Marks = { line: null, tip: null, refuse: null, accept: null };
export const useTrayDropMarks = create<Marks>(() => NONE);

/** Which side of the divider a tray drag started on (null: no tray drag). While one runs, the Dock draws an empty drop
 *  slot for the other side when that side has no entries (「没有钉住的时候，开始拖一个最近项，托盘最左边就出现一条
 *  分隔线加图钉，作为落点」). */
export type TrayFrom = "pinned" | "recent";
export const useTrayDragFrom = create<{ from: TrayFrom | null }>(() => ({ from: null }));

/** How long the pointer rests on 「… N」 before it unfolds during a drag. */
export const UNFOLD_MS = 500;

const rectOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
const shown = (el: Element) => el.getClientRects().length > 0 && !el.closest("[data-tray-folded], [data-tray-overflow-hide]");

/** Which of `boxes` (in order) the pointer is before: 0…boxes.length (past the last = boxes.length). Pure. */
export function insertIndex(boxes: readonly Box[], x: number, y: number, vertical: boolean): number {
  if (vertical) {
    for (let i = 0; i < boxes.length; i++) if (y < boxes[i]!.top + boxes[i]!.height / 2) return i;
    return boxes.length;
  }
  // Horizontal, maybe in two rows (托盘两排): the row the pointer is in (else the nearest), then by x within it.
  const rows: { start: number; end: number; top: number; bottom: number }[] = [];
  boxes.forEach((b, i) => {
    const row = rows[rows.length - 1];
    if (row && b.top < row.top + (row.bottom - row.top) / 2) {
      row.end = i + 1;
      row.bottom = Math.max(row.bottom, b.top + b.height);
    } else rows.push({ start: i, end: i + 1, top: b.top, bottom: b.top + b.height });
  });
  const dist = (r: { top: number; bottom: number }) => (y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0);
  const row = rows.reduce<(typeof rows)[number] | null>((best, r) => (!best || dist(r) < dist(best) ? r : best), null);
  if (!row) return 0;
  for (let i = row.start; i < row.end; i++) if (x < boxes[i]!.left + boxes[i]!.width / 2) return i;
  return row.end;
}

/**
 * Where pin `id` would go for a pointer in a pinned group: the pin it goes before (null: the group's end) and the
 * insertion line. `entries` = every pinned entry of the group in order (folded ones too), `visible` = the drawn ones.
 */
export function dropSpot(
  entries: readonly { id: string; box: Box | null }[],
  x: number,
  y: number,
  vertical: boolean,
): { beforeId: string | null; line: Box } | null {
  const drawn = entries.filter((e): e is { id: string; box: Box } => !!e.box);
  if (!drawn.length) return null;
  const i = insertIndex(
    drawn.map((e) => e.box),
    x,
    y,
    vertical,
  );
  const gap = 3;
  // Two rows (托盘两排): past the end of the first row the line stands after its last item, not before the next row's first.
  const prev = i > 0 ? drawn[i - 1]!.box : null;
  if (i < drawn.length && prev && !vertical && drawn[i]!.box.top >= prev.top + prev.height / 2 && y < prev.top + prev.height) {
    return { beforeId: drawn[i]!.id, line: { left: prev.left + prev.width, top: prev.top, width: 3, height: prev.height } };
  }
  if (i < drawn.length) {
    const b = drawn[i]!.box;
    return { beforeId: drawn[i]!.id, line: vertical ? { left: b.left, top: b.top - gap, width: b.width, height: 3 } : { left: b.left - gap, top: b.top, width: 3, height: b.height } };
  }
  const last = drawn[drawn.length - 1]!;
  // Past the last drawn one: before the next entry of the group (a folded one), else the end.
  const next = entries[entries.findIndex((e) => e.id === last.id) + 1];
  const b = last.box;
  return { beforeId: next?.id ?? null, line: vertical ? { left: b.left, top: b.top + b.height, width: b.width, height: 3 } : { left: b.left + b.width, top: b.top, width: 3, height: b.height } };
}

/** Where pinned entry `id` goes one step `dir` along `order` (the pinned entries' ids): the pin it goes before; undefined = it cannot. */
export function stepTarget(order: readonly string[], id: string, dir: -1 | 1): string | null | undefined {
  const i = order.indexOf(id);
  if (i < 0) return undefined;
  if (dir < 0) return i > 0 ? order[i - 1]! : undefined;
  if (i >= order.length - 1) return undefined;
  return order[i + 2] ?? null;
}

export interface TrayDragOptions {
  /** The dragged entry's id (a pinned one: its pin id). */
  id: string;
  from: TrayFrom;
  /** A pinned entry dropped among the pinned ones: moved before `beforeId` (null: the group's end). */
  move?(beforeId: string | null): void;
  /** A 最近 entry dropped among the pinned ones (across the divider): pinned before `beforeId` (null: the end). */
  pin?(beforeId: string | null): void;
  /** A pinned entry dropped on 最近 (across the divider): unpinned. Absent: 最近 refuses it. */
  unpin?(): void;
  /** The entry's desktop icon (its pin, its name): dropped on the desktop while it shows, the icon goes there. */
  desk?: { pin: HomePin; name: string };
}

/** The pinned group of the tray holding `el` (the divider's pushpin stands for that group's end). */
function pinnedGroupNear(el: Element): HTMLElement | null {
  const tray = el.closest("[data-pane-tray], [data-tray-overflow]") ?? document;
  return tray.querySelector<HTMLElement>('[data-tray-group="pinned"]');
}

/** The drag's local target for a tray entry (see the file comment). */
export function trayDragLocal(opts: TrayDragOptions): WorkspaceDragLocal {
  let target: { kind: "spot"; beforeId: string | null } | { kind: "unpin" } | { kind: "desk"; spot: DeskSpot } | null = null;
  let moreTimer: ReturnType<typeof setTimeout> | null = null;
  let moreEl: HTMLElement | null = null;
  let unfolded: HTMLElement | null = null;
  const clearMore = () => {
    if (moreTimer) clearTimeout(moreTimer);
    moreTimer = null;
    moreEl = null;
  };
  const none = () => {
    useTrayDropMarks.setState(NONE);
    if (useDeskDropHint.getState().hint) useDeskDropHint.setState({ hint: null });
    target = null;
  };
  /** Over the desktop (not its edge bands): the spot of the entry's icon, its hint, 「放到桌面」. */
  const overDesk = (x: number, y: number) => {
    const desk = opts.desk;
    const spot = desk ? deskDropTarget()?.spot(desk.pin, x, y) : null;
    if (!spot || probe(x, y)?.target.kind === "edge") return null;
    const text = translate("home.desk.drop");
    useTrayDropMarks.setState(NONE);
    useDeskDropHint.setState({ hint: { cells: spot.cells, text } });
    target = { kind: "desk", spot };
    return { take: "drop" as const, action: text };
  };
  return {
    over(x, y, doc = document) {
      const els = doc.elementsFromPoint(x, y).filter((el) => !el.closest("[data-ws-dnd]"));
      const more = els.map((el) => el.closest<HTMLElement>("[data-tray-more]")).find(Boolean) ?? null;
      if (more) {
        if (more !== moreEl) {
          clearMore();
          moreEl = more;
          moreTimer = setTimeout(() => {
            if (more.getAttribute("aria-expanded") !== "true") {
              more.click();
              unfolded = more;
            }
          }, UNFOLD_MS);
        }
        none();
        return { take: "refuse", action: translate("tray.drop.unfold") };
      }
      clearMore();
      const edge = els.map((el) => el.closest<HTMLElement>("[data-tray-pin-edge]")).find(Boolean) ?? null;
      const group = edge ? pinnedGroupNear(edge) : (els.map((el) => el.closest<HTMLElement>("[data-tray-group]")).find(Boolean) ?? null);
      const kind = group?.dataset.trayGroup;
      if (!group || !kind) {
        none();
        return overDesk(x, y);
      }
      if (kind === "apps" || (kind === "recent" && opts.from === "pinned" && !opts.unpin)) {
        useTrayDropMarks.setState({ ...NONE, refuse: { ...rectOf(group), text: translate(kind === "apps" ? "tray.drop.refuseApps" : "tray.drop.refuse") } });
        target = null;
        return { take: "refuse", action: translate("ws.action.cancel") };
      }
      if (kind === "recent") {
        // A 最近 entry over 最近: nothing of the tray's (the workspace drag decides, as before).
        if (opts.from === "recent") {
          none();
          return null;
        }
        const text = translate("tray.drop.unpin");
        useTrayDropMarks.setState({ ...NONE, accept: { ...rectOf(group), text } });
        target = { kind: "unpin" };
        return { take: "drop", action: text };
      }
      if (kind !== "pinned") {
        none();
        return null;
      }
      // A 最近 entry that cannot be pinned here (no pin list): the pinned group takes nothing of it.
      if (opts.from === "recent" && !opts.pin) {
        none();
        return null;
      }
      const vertical = !!group.closest("[data-vertical]");
      const entries = [...group.querySelectorAll<HTMLElement>("[data-tray-entry]")].map((el) => ({ id: el.dataset.trayEntry!, box: shown(el) ? rectOf(el) : null }));
      // On the pushpin: the group's end.
      const spot = edge ? dropSpot(entries, Infinity, Infinity, vertical) : dropSpot(entries, x, y, vertical);
      const action = translate(opts.from === "pinned" ? "tray.drop.move" : "tray.drop.pin");
      const tip = opts.from === "recent" ? action : null;
      if (spot) {
        target = { kind: "spot", beforeId: spot.beforeId };
        useTrayDropMarks.setState({ ...NONE, line: spot.line, tip });
        return { take: "drop", action };
      }
      // Nothing pinned drawn (the empty slot while a 最近 entry is dragged): a line in the slot's middle.
      if (opts.from !== "recent" || !shown(group)) {
        none();
        return null;
      }
      const b = rectOf(group);
      const line = vertical ? { left: b.left, top: b.top + b.height / 2 - 1.5, width: b.width, height: 3 } : { left: b.left + b.width / 2 - 1.5, top: b.top, width: 3, height: b.height };
      target = { kind: "spot", beforeId: null };
      useTrayDropMarks.setState({ ...NONE, line, tip });
      return { take: "drop", action };
    },
    drop() {
      if (!target) return;
      if (target.kind === "desk") {
        if (opts.desk) deskDropTarget()?.drop(opts.desk.pin, target.spot, opts.desk.name);
      } else if (target.kind === "unpin") opts.unpin?.();
      else if (opts.from === "recent") opts.pin?.(target.beforeId);
      else if (target.beforeId !== opts.id) opts.move?.(target.beforeId);
    },
    end() {
      clearMore();
      useTrayDropMarks.setState(NONE);
      useDeskDropHint.setState({ hint: null });
      useTrayDragFrom.setState({ from: null });
      // 「… N」 opened for this drag closes with it.
      if (unfolded?.getAttribute("aria-expanded") === "true") unfolded.click();
      unfolded = null;
      target = null;
    },
  };
}

/** The drag's local target for pinned entry `id`: `move` = a drop among the pinned, `unpin` = a drop on 最近, `desk` = its desktop icon. */
export function pinnedDragLocal(id: string, move: (beforeId: string | null) => void, unpin?: () => void, desk?: TrayDragOptions["desk"]): WorkspaceDragLocal {
  return trayDragLocal({ id, from: "pinned", move, ...(unpin ? { unpin } : {}), ...(desk ? { desk } : {}) });
}

/** The line / refusal box / taking group of a tray entry's drag, over everything (the drag's shield included). */
export function TrayDropMarks() {
  const overlayRoot = useOverlayRoot();
  const { line, tip, refuse, accept } = useTrayDropMarks();
  if (!line && !refuse && !accept) return null;
  return createPortal(
    <>
      {line && (
        <div data-tray-drop-line="" aria-hidden className="tray-drop-line" style={{ left: line.left, top: line.top, width: line.width, height: line.height }}>
          {tip && <span className="tray-drop-tip tray-drop-tip-ok">{tip}</span>}
        </div>
      )}
      {refuse && (
        <div data-tray-drop-refuse="" aria-hidden className={`tray-drop-refuse ${DROP_TINT}`} style={{ left: refuse.left - 3, top: refuse.top - 3, width: refuse.width + 6, height: refuse.height + 6 }}>
          <span className="tray-drop-tip">{refuse.text}</span>
        </div>
      )}
      {accept && (
        <div data-tray-drop-accept="" aria-hidden className={`tray-drop-accept ${DROP_TINT}`} style={{ left: accept.left - 3, top: accept.top - 3, width: accept.width + 6, height: accept.height + 6 }}>
          <span className="tray-drop-tip tray-drop-tip-ok">{accept.text}</span>
        </div>
      )}
    </>,
    overlayRoot,
  );
}
