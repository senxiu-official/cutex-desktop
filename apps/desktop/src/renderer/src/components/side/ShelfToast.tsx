// The Shelves' toast (docs/desktop-modules.md §24.12): a deleted page or a closed Shelf with 撤销, and short
// notices (a drop that became a pane of its own because the Shelf does not allow mixing). One at a time,
// centred low in the window but never over the tray or a composer (lib/toastSpot); hovering holds nothing
// (7 s, lib/shelves SHELF_TOAST_MS). A tooltip only when its text is cut off (lib/tips `data-tip-overflow`).
// Multi-window P3.5: App and every desk (components/DeskWindows) mount it; it shows in the window the change happened in.
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../i18n";
import { dismissShelfToast, settleShelfToast, undoShelfToast, useShelfToast } from "../../lib/shelves";
import { useOwnerWindow } from "../../lib/ownerContext";
import { MAIN_WINDOW, useWindowKey } from "../../lib/windowScope";
import { useToastSpot } from "../../lib/toastSpot";

export function ShelfToast() {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const here = useWindowKey();
  const toast = useShelfToast((s) => (s.toast && (s.toast.win ?? MAIN_WINDOW) === here ? s.toast : null));
  const card = useRef<HTMLDivElement>(null);
  const spot = useToastSpot(card, toast?.id);
  // The app (the main document) goes with an undo pending: it is final (the removed panes' components close them now).
  useEffect(() => {
    if (here !== MAIN_WINDOW) return;
    win.addEventListener("beforeunload", settleShelfToast);
    return () => win.removeEventListener("beforeunload", settleShelfToast);
  }, [here, win]);
  if (!toast) return null;
  return (
    <div role="status" data-shelf-toast="" className="pointer-events-none fixed z-[170] flex justify-center" style={spot.wrapper}>
      <div ref={card} key={toast.id} className="float float-toast max-w-[min(34rem,calc(100vw-2rem))]" style={spot.maxWidth === undefined ? undefined : { maxWidth: `min(34rem, ${spot.maxWidth}px)` }}>
        <span className="min-w-0 flex-1 truncate" data-tip={toast.text} data-tip-overflow="">
          {toast.text}
        </span>
        {toast.undo && (
          <button data-shelf-undo="" onClick={undoShelfToast} className="shrink-0 rounded-md px-2 py-0.5 font-medium text-accent hover:bg-hover">
            {t("shelf.toast.undo")}
          </button>
        )}
        {toast.action && (
          <button
            data-shelf-toast-action=""
            onClick={() => {
              dismissShelfToast(toast.id);
              toast.action!.run();
            }}
            className="shrink-0 rounded-md px-2 py-0.5 font-medium text-accent hover:bg-hover"
          >
            {toast.action.label}
          </button>
        )}
        <button onClick={() => dismissShelfToast(toast.id)} aria-label={t("shelf.toast.dismiss")} className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
