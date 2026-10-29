// The page header of a conversation column showing a page (页面打开位置 = 占用会话, docs/desktop-modules.md
// §24.4 / §26.4; owner 2026-10-21): the page's icon (its sidebar entry's) and breadcrumb (PageItem.useTitle),
// then 放大 / 关闭 / ⋯ — never the agent's header. × and Esc (lib/escLayers) close the page and the column shows
// its conversation again; ⋯ 「在 Shelf 中打开」 moves the page into the focused conversation's Shelf. A page
// opened in a Shelf (the default) has the Shelf pane's header instead (components/side/SideCard). Shell file:
// no feature names here (test/modules.test.ts scans it).
import { AppWindow, Columns2, Expand, Maximize2, Minimize2, MoreHorizontal, PanelRightOpen, Shrink, X } from "lucide-react";
import { useI18n } from "../i18n";
import { openMenuFrom, type MenuEntry } from "../lib/contextMenu";
import { pageLookOf } from "../lib/paneKinds";
import { toggleExclusive, toggleFullscreenPanel, toggleMaximize } from "../lib/paneActions";
import { useGrow } from "../lib/panelGrow";
import { openPageInShelf } from "../lib/paneServices";
import { closeColumnPage } from "../lib/paneStore";
import { usePanelFull } from "../lib/panelFull";
import { usePageOf, useSlot } from "../modules/react";
import type { ItemId, PageParams } from "../modules/types";
import { PageCrumbs } from "./PageTitle";
import { bindingLabel, keyVar } from "../lib/keybindings";
import { isElement } from "../lib/ownerWindow";

const CTRL_BTN = "relative flex h-6 w-[26px] shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground";

export function PageHeader({ paneId, page, focused, maxed, framed }: { paneId: string; page: { page: ItemId; params: PageParams }; focused: boolean; maxed: boolean; framed: boolean }) {
  const { t } = useI18n();
  const open = usePageOf(page);
  const nav = useSlot("nav.primary");
  const Icon = pageLookOf(page.page, nav)?.icon ?? AppWindow;
  const full = usePanelFull((s) => s.target?.area === "work" && s.target.id === paneId);
  // 放大 = 最大化 (rule 2: every gap of the row, greyed without one); ⋯ → 独占 (the former 放大).
  const grown = useGrow((s) => s.target?.kind === "conv" && s.target.paneId === paneId);
  const noGap = useGrow((s) => (s.room.conv[paneId] ?? 0) <= 0) && !full && !maxed && !grown;
  const maxTip = full ? t("panel.exitFullscreen", { key: "Esc" }) : maxed ? t("panel.exclusiveOff") : noGap ? t("panel.maxNoGap") : t(grown ? "pane.restoreMax" : "pane.maximize", keyVar("paneMaximise"));
  const pressMax = () => (maxed ? toggleExclusive({ area: "work", id: paneId }) : toggleMaximize({ area: "work", id: paneId }));
  const closeTip = t("pane.closePage");
  const toShelf = () => {
    const { page: id, params } = page;
    closeColumnPage(paneId);
    openPageInShelf(id, params);
  };
  const more = (anchor: HTMLElement) => {
    const entries: MenuEntry[] = [
      { label: t("pageHeader.openInShelf"), icon: <PanelRightOpen size={14} />, onSelect: toShelf },
      { label: t(full ? "panel.exitFullscreenShort" : "panel.fullscreen"), icon: full ? <Shrink size={14} /> : <Expand size={14} />, hint: bindingLabel("panelFullscreen"), onSelect: () => void toggleFullscreenPanel({ area: "work", id: paneId }) },
      { label: t(maxed ? "panel.exclusiveOff" : "panel.exclusive"), icon: <Columns2 size={14} />, title: t("panel.exclusiveHint"), onSelect: () => toggleExclusive({ area: "work", id: paneId }) },
      "separator",
      { label: closeTip, icon: <X size={14} />, onSelect: () => closeColumnPage(paneId) },
    ];
    openMenuFrom(anchor, entries);
  };
  return (
    <div
      data-pane-header=""
      data-page-header={page.page}
      onDoubleClick={(e) => {
        if (isElement(e.target) && e.target.closest("button")) return;
        pressMax();
      }}
      className={`flex h-9 shrink-0 items-center gap-1.5 border-b pr-1.5 pl-2.5 select-none ${focused && framed ? "border-accent/40" : "border-border"} ${focused ? "text-foreground" : "text-muted"}`}
    >
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center text-muted">
        <Icon size={15} />
      </span>
      <div data-page-crumbs="" className="flex min-w-0 flex-1 items-center overflow-hidden">
        {open?.entry ? <PageCrumbs entry={open.entry} params={page.params} /> : <span className="min-w-0 truncate text-sm">{page.page}</span>}
      </div>
      <span data-pane-controls="row" className="flex h-6 shrink-0 items-center gap-0.5">
        <button data-pane-max="" title={maxTip} aria-label={maxTip} aria-pressed={maxed || full || grown} aria-disabled={noGap || undefined} onClick={pressMax} className={`${CTRL_BTN} ${noGap ? "opacity-40" : ""}`}>
          {maxed || full || grown ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button data-pane-close="" data-page-close="" title={closeTip} aria-label={closeTip} onClick={() => closeColumnPage(paneId)} className={CTRL_BTN}>
          <X size={14} />
        </button>
        <button data-pane-more="" title={t("convHeader.more")} aria-label={t("convHeader.more")} aria-haspopup="menu" onClick={(e) => more(e.currentTarget)} className={CTRL_BTN}>
          <MoreHorizontal size={14} />
        </button>
      </span>
    </div>
  );
}
