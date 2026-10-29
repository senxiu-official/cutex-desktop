// The Shelf of the workspace without the focus (docs/desktop-modules.md §24.13; prototype
// .claude/preview-workspaces.html #split): two workspaces side by side, the other conversation's own Shelf
// shows as its Shelf Rail — the conversation's small avatar on top (owner 2026-10-21), then its pages (and
// the shared ones) as icons, on the side 工作区的 Shelf Rail gives it (外侧: the window's edge; 永远偏右: its
// conversation's right; lib/workspaceRow). An empty Shelf shows no rail (its entry is the conversation
// header's Shelf button). A page button focuses that workspace (its Shelf becomes the live one, expanded) and
// shows the page — the focus outline moves over visibly (styles.css .ws-col); anywhere else on the rail
// focuses the workspace. Drop target of lib/workspaces (`data-ws-shelf`: project into its Shelf).
// Reads the stored / remembered Shelf (lib/sideLayoutStore peekConvShelf); instances never mount here.
// Used while a conversation is maximised / full screen (§24.16): the other workspace shows this way (`always`);
// a click focuses it, which puts the layout back. Beside two workspaces both Shelves are live (owner 2026-10-21,
// components/side/SideArea WsShelfBox under lib/shelfSourceContext): this rail is not drawn there any more.
import { Share2 } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ItemId } from "../../modules/types";
import { focusConversationPane } from "../../lib/paneStore";
import { pageLabel } from "../../lib/sideActions";
import { useSideRegistry } from "../../lib/sideComponents";
import { COLLAPSED_SHELF_WIDTH, type ShelfSide } from "../../lib/sideLayout";
import { pageIcon } from "../../lib/shelfIcons";
import { openShelfPage } from "../../lib/shelves";
import { useWorkspaceDrag } from "../../lib/workspaces";
import { useConvRailPages } from "../../lib/workspaceRowView";
import { RailOwner } from "./ShelfRail";

const BTN = "relative flex size-[34px] shrink-0 items-center justify-center rounded-ctl text-muted transition-[background,color] duration-(--motion-short) ease-(--ease-standard) hover:bg-hover hover:text-foreground";

export function WorkspaceRail({ paneId, hostId, sessionId, name, order, at = "right", always = false }: { paneId: string; hostId: string; sessionId: string | null; name: string; order: number; at?: ShelfSide; always?: boolean }) {
  const { t } = useI18n();
  const registry = useSideRegistry();
  const hot = useWorkspaceDrag((s) => s.outcome?.kind === "project" && s.outcome.paneId === paneId);
  const pages = useConvRailPages(hostId, sessionId);
  const kindIcon = (kind: string) => registry.get(kind as ItemId)?.item.icon ?? null;
  const focus = () => focusConversationPane(paneId);
  const tip = t("ws.rail", { name });
  // An empty Shelf shows no rail (owner 2026-10-21): the header's Shelf button opens it. `always` (the other
  // workspace while a conversation is maximised / full screen, §24.16): its avatar at least, to get back to it.
  if (!pages.length && !always) return null;
  return (
    <div data-ws-shelf={paneId} data-ws-rail="" data-ws-rail-at={at} data-ws-strip={always ? "" : undefined} className={`${always ? "panel-fold " : ""}relative flex shrink-0 ${at === "left" ? "pr-2" : "justify-end pl-2"}`} style={{ width: COLLAPSED_SHELF_WIDTH, order }}>
      <nav
        aria-label={tip}
        title={tip}
        onClick={(e) => e.target === e.currentTarget && focus()}
        data-shelf-card=""
        data-shelf-collapsed=""
        className={`shelf-card flex w-10 shrink-0 cursor-pointer flex-col items-center gap-[3px] rounded-xl border border-card-border py-1 transition-colors shelf-rail-card ${hot ? "border-[#3b82f6] shadow-[inset_0_0_0_999px_rgba(59,130,246,0.1)]" : ""}`}
      >
        <RailOwner hostId={hostId} sessionId={sessionId} onClick={focus} />
        {pages.map((page) => {
          const Icon = pageIcon(page, kindIcon);
          let label = page.id;
          try {
            label = pageLabel(page);
          } catch {
            // registry not up
          }
          return (
            <button
              key={page.id}
              data-ws-rail-page={page.id}
              title={t("ws.railPage", { page: label, name })}
              aria-label={label}
              onClick={() => {
                focus();
                openShelfPage(page.id);
              }}
              className={BTN}
            >
              <Icon size={17} />
              {page.shared && (
                <span aria-hidden className="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-background text-subtle ring-1 ring-border">
                  <Share2 size={8} />
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
