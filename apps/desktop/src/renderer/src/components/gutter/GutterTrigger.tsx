// One gutter item's trigger (docs/desktop-modules.md §19.3): the item's own Trigger, or a default pill
// with its icon. The wrapper is what the popover anchors to and where focus returns.
import { forwardRef } from "react";
import { useI18n } from "../../i18n";
import type { GutterEntry } from "../../lib/gutterItems";
import { ItemBoundary } from "../../modules/Outlet";

interface Props {
  entry: GutterEntry;
  hostId: string;
  sessionId: string;
  open: boolean;
  /** A docked list that is folded away right now (the trigger shows it again). */
  folded?: boolean;
  docked?: boolean;
  where: "gutter" | "composer";
  toggle(): void;
}

export const GutterTrigger = forwardRef<HTMLDivElement, Props>(function GutterTrigger({ entry, hostId, sessionId, open, folded, docked, where, toggle }, ref) {
  const { t } = useI18n();
  const { Trigger, icon: Icon, titleKey } = entry.item;
  const title = docked ? t(folded ? "gutter.dockShow" : "gutter.dockHide") : t(titleKey);
  return (
    <div ref={ref} data-gutter-trigger={entry.item.id} className="pointer-events-auto flex">
      <ItemBoundary moduleId={entry.moduleId} resetKey={sessionId}>
        {Trigger ? (
          <Trigger hostId={hostId} sessionId={sessionId} open={open} toggle={toggle} where={where} />
        ) : where === "gutter" ? (
          <button
            onClick={toggle}
            title={title}
            aria-label={title}
            aria-expanded={open}
            className={`flex h-[30px] items-center gap-1 rounded-full border border-border bg-background px-2 text-xs text-muted shadow-sm transition-colors hover:bg-surface hover:text-foreground ${open ? "bg-surface text-foreground" : ""}`}
          >
            <Icon size={15} className={open ? "text-accent" : undefined} />
          </button>
        ) : (
          <button
            onClick={toggle}
            title={title}
            aria-label={title}
            aria-expanded={open}
            className={`flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground ${open ? "text-accent" : ""}`}
          >
            <Icon size={14} />
          </button>
        )}
      </ItemBoundary>
    </div>
  );
});
