import { useEffect, useRef } from "react";
import { isContextualPane } from "../../lib/paneKinds";
import { openSide } from "../../lib/sideOpen";
import { useShelfPeer } from "../../lib/shelfSourceContext";
// A pane with nothing for the agent in view, on a page that keeps its layout for every agent (a page the owner made, a
// shared one; owner 2026-10-23): an empty slot of the same size where the pane is — its kind, 「打开…」 (its kind for
// this agent, as a tab of this pane) and 「看 X 的」 for each agent whose things it holds. No ×: what it holds is
// someone else's. The page's other panes draw as usual (components/side/SidePageView). Folded (its card collapsed for
// another agent, or short of room): its title bar with a ▾ that opens it (double-click on the title bar too).
import { ChevronDown } from "lucide-react";
import { useI18n } from "../../i18n";
import type { SideComponentEntry } from "../../lib/sideComponents";
import { slotInfo } from "../../lib/hiddenPage";
import { useOwnerNames } from "../../lib/hiddenPageNames";
import { activateTab, type SideCard, type SidePage, type SideViewContext } from "../../lib/sideLayout";
import { launch, launchable } from "../../lib/sideMenus";
import { updateLayout } from "../../lib/sideLayoutStore";
import { useShelfLayout } from "../../lib/shelfSource";
import { useApp } from "../../store";
import { btn } from "../Button";
import { isElement } from "../../lib/ownerWindow";

export function EmptySlot({ page, card, entry, ctx, height, folded = false, onRestore }: { page: SidePage; card: SideCard; entry: SideComponentEntry; ctx: SideViewContext; height: number | null; folded?: boolean; onRestore?: () => void }) {
  const { t } = useI18n();
  const layout = useShelfLayout();
  const peer = useShelfPeer();
  const automatic = isContextualPane(entry.item) && !peer && !folded;
  const attempted = useRef("");
  const info = slotInfo(layout, [card], ctx);
  const names = useOwnerNames(info.owners);
  const title = t(entry.item.titleKey);
  const Icon = entry.item.icon;
  const item = launchable().find((i) => i.kind === card.kind) ?? null;
  const open = () => {
    if (!item) return;
    // Into this pane (placement takes the most recently used pane of the kind on the page).
    const tab = card.active ?? card.tabs[0];
    if (tab) updateLayout((l) => activateTab(l, tab, Date.now()));
    launch(item.kind, item.params, page.id);
  };
  useEffect(() => {
    if (!automatic) return;
    const key = JSON.stringify([page.id, card.id, ctx.hostId, ctx.sessionId]);
    if (attempted.current === key) return;
    attempted.current = key;
    const tab = card.active ?? card.tabs[0];
    if (tab) updateLayout((l) => activateTab(l, tab, Date.now()));
    openSide(card.kind, item?.params ?? (tab ? layout.instances[tab]?.state : null) ?? {}, { page: page.id, focus: false, reveal: false });
  }, [automatic, page.id, card.id, ctx.hostId, ctx.sessionId]);
  return (
    <div
      data-side-card={card.id}
      data-side-empty-slot={card.kind}
      style={height === null ? undefined : { height }}
      className={`shell-card relative flex min-h-0 shrink-0 flex-col overflow-hidden ${height === null ? "flex-1" : ""}`}
    >
      <div className="flex h-9 shrink-0 items-center gap-0.5 pr-1.5 pl-1.5 text-subtle" onDoubleClick={(e) => onRestore && !(isElement(e.target) && e.target.closest("button")) && onRestore()}>
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center">
          <Icon size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate px-1.5 text-xs font-medium">{title}</span>
        {folded && onRestore && (
          <button data-side-fold={card.id} onClick={onRestore} aria-expanded={false} title={t("side.expand")} aria-label={t("side.expand")} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground">
            <ChevronDown size={13} className="-rotate-90" />
          </button>
        )}
      </div>
      {!folded && (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden p-4 text-center text-xs text-subtle">
        <div data-side-empty-note="">{t("shelf.slot.none", { kind: title })}</div>
        {item && (
          <button data-side-empty-open={card.kind} onClick={open} className={btn({ variant: "secondary", size: "sm" })}>
            {item.icon}
            {t("shelf.slot.open", { kind: title })}
          </button>
        )}
        {info.owners.length > 0 && (
          <div className="flex max-w-full flex-wrap justify-center gap-x-3 gap-y-1">
            {info.owners.map((o, i) => (
              <button key={`${o.hostId}\u0000${o.sessionId}`} data-side-empty-owner={o.sessionId} onClick={() => void useApp.getState().select(o.sessionId, o.hostId)} className="text-accent hover:underline">
                {t("shelf.page.seeOwner", { name: names[i] ?? o.sessionId })}
              </button>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
