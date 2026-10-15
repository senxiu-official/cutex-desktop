// The title bar's right-side part (docs/desktop-modules.md §18.3, owner 2026-10-12): a launcher bar of
// side-component TYPES, Chrome side-panel style — [pinned launchers…] [＋] [side toggle].
// - A launcher (lib/sideLaunchers launcherClickAction): on the current page → the page-button icon rule;
//   on another page → reveal it there; nowhere → open it here; Ctrl/⌘ / middle click = a new instance (multi, background; + Shift = shown). Right-click = 新… /
//   从标题栏取消固定. Badges = the kind's visible instances' useTab probes (no polling of its own).
// - ＋ = the launcher menu (every launchable kind with a pin toggle, 「新…」, 新页面, 本页 ▸).
// - The toggle (Ctrl+Alt+B) carries the page's summary badge while the column is closed with one page.
// Narrow windows: pinned launchers that do not fit move into ＋ (lib/sideLauncherView useLauncherFit).
// Page actions (钉住, ⤢ ⛶ ⋯) live at the right end of the page tab row (SideTabStrip) and in ＋ → 本页.
import { useRef, type MouseEvent } from "react";
import { PanelRight, PanelRightClose, Plus } from "lucide-react";
import { useI18n } from "../../i18n";
import { contextMenu, openMenuFrom } from "../../lib/contextMenu";
import { useSideView } from "../../lib/sideComponents";
import { pageInView, visibleCards } from "../../lib/sideLayout";
import { useSide } from "../../lib/sideLayoutStore";
import { useLauncherFit, useLaunchers } from "../../lib/sideLauncherView";
import { launcherContextMenu, launcherMenu, pressLauncher, type Launchable } from "../../lib/sideMenus";
import { toggleSideColumn } from "../../lib/sideOpen";
import { newInstanceKey, openModifiers, PLAIN_OPEN } from "../../lib/openModifiers";
import { attentionText, kindBadges, pillContent } from "../../lib/sidePills";
import { Badges } from "./SideLane";

const BTN = "[app-region:no-drag] relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground";

function Launcher({ item, inView }: { item: Launchable; inView: boolean }) {
  const { t } = useI18n();
  const layout = useSide((s) => s.layout);
  const tabInfo = useSide((s) => s.tabInfo);
  const ctx = useSideView();
  const badges = kindBadges(layout, item.kind, ctx, (id) => tabInfo[id]);
  const tip = item.multi ? t("side.launcherTipMulti", { name: item.label, key: newInstanceKey() }) : item.label;
  const press = (e: MouseEvent) => pressLauncher(item.kind, item.multi ? openModifiers(e) : PLAIN_OPEN);
  const Icon = item.Icon;
  return (
    <button
      onClick={press}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        press(e);
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault(); // no autoscroll
      }}
      onContextMenu={contextMenu(() => launcherContextMenu(item.kind))}
      title={tip}
      aria-label={item.label}
      aria-pressed={inView}
      data-side-launcher={item.kind}
      className={`${BTN} ${inView ? "bg-hover text-foreground" : ""}`}
    >
      <Icon size={16} />
      <Badges attention={badges.attention} unread={badges.unread} busy={badges.busy} active={false} />
    </button>
  );
}

export function TitleBarLaunchers() {
  const { t } = useI18n();
  const ctx = useSideView();
  const layout = useSide((s) => s.layout);
  const tabInfo = useSide((s) => s.tabInfo);
  const { pinned } = useLaunchers();
  const strip = useRef<HTMLSpanElement>(null);
  const fit = useLauncherFit(strip, pinned.length);
  const shown = pinned.slice(0, fit);
  const hidden = pinned.length - shown.length;

  // Kinds with a visible card on the page in view (pressed look).
  const page = layout.open ? pageInView(layout, ctx) : null;
  const inView = new Set(page ? visibleCards(layout, page, ctx).map((c) => c.kind) : []);

  // Closed, one page: its summary (attention count or unread dot) on the toggle.
  let badge: { attention: number; unread: boolean } | null = null;
  if (!layout.open && layout.pages.length === 1) {
    const p = pillContent(layout, layout.pages[0]!, ctx, (id) => tabInfo[id]);
    if (p.attention || p.unread) badge = { attention: p.attention, unread: p.unread };
  }

  const plusTip = hidden ? t("side.launcherMenuMore", { n: hidden }) : t("side.launcherMenu");
  return (
    <>
      <span ref={strip} data-side-launchers className="flex shrink-0 items-center gap-0.5">
        {shown.map((item) => (
          <Launcher key={item.kind} item={item} inView={inView.has(item.kind)} />
        ))}
      </span>
      <button onClick={(e) => openMenuFrom(e.currentTarget, launcherMenu())} title={plusTip} aria-label={plusTip} aria-haspopup="menu" data-side-launcher-menu className={BTN}>
        <Plus size={16} />
        {hidden > 0 && <span className="absolute top-1 right-1 h-[5px] w-[5px] rounded-full bg-subtle" />}
      </button>
      <button onClick={toggleSideColumn} title={t("side.toggleHint", { key: "Ctrl+Alt+B" })} aria-label={t("side.toggle")} aria-pressed={layout.open} className={`${BTN} ${layout.open ? "bg-hover text-foreground" : ""}`}>
        {layout.open ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
        {badge &&
          (badge.attention ? (
            <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 rounded-[7px] bg-danger px-[3px] text-center text-[9px] leading-[14px] font-bold text-white">{attentionText(badge.attention)}</span>
          ) : (
            <span className="absolute top-1 right-1 h-[7px] w-[7px] rounded-full bg-accent" />
          ))}
      </button>
    </>
  );
}
