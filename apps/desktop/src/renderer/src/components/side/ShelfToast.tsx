// The Shelves' toast (docs/desktop-modules.md §24.12): a deleted page or a closed Shelf with 撤销, and short
// notices (a drop that became a pane of its own because the Shelf does not allow mixing). One at a time,
// bottom centre of the window, above the tray; hovering holds nothing (7 s, lib/shelves SHELF_TOAST_MS).
// Multi-window P3.5: App and every desk (components/DeskWindows) mount it; it shows in the window the change happened in.
import { useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../i18n";
import { dismissShelfToast, settleShelfToast, undoShelfToast, useShelfToast } from "../../lib/shelves";
import { useOwnerWindow } from "../../lib/ownerContext";
import { MAIN_WINDOW, useWindowKey } from "../../lib/windowScope";

export function ShelfToast() {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const here = useWindowKey();
  const toast = useShelfToast((s) => (s.toast && (s.toast.win ?? MAIN_WINDOW) === here ? s.toast : null));
  // The app (the main document) goes with an undo pending: it is final (the removed panes' components close them now).
  useEffect(() => {
    if (here !== MAIN_WINDOW) return;
    win.addEventListener("beforeunload", settleShelfToast);
    return () => win.removeEventListener("beforeunload", settleShelfToast);
  }, [here, win]);
  if (!toast) return null;
  return (
    <div role="status" data-shelf-toast="" className="pointer-events-none fixed inset-x-0 bottom-14 z-[66] flex justify-center">
      <div key={toast.id} className="motion-toast-in pointer-events-auto flex max-w-[min(34rem,calc(100vw-2rem))] items-center gap-2 rounded-xl border border-border bg-background py-1.5 pr-1.5 pl-3.5 text-ui/[inherit] shadow-e2">
        <span className="min-w-0 flex-1 truncate" title={toast.text}>
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
